// המוח: לוקח הקשר ליד + הודעה נכנסת → מחזיר החלטה מלאה
// כולל גרדריילים דטרמיניסטיים שלא תלויים במודל (הסרה, רשת ביטחון למחיר)
import { askClaude } from "./claude.js";

const UNSUB_WORDS = ["הסר", "הסרה", "להסיר", "תסירו", "stop", "unsubscribe", "תפסיקו"];
const HUMAN_WORDS = ["נציג", "יועצת", "לדבר עם בנאדם", "אדם אמיתי", "טלפון איתי"];

// זיהוי בקשת הסרה — חייב לעבוד גם אם המודל מפספס
// תופס גם "הסר..", "הסר בבקשה", "הסרה!" וכו'
function isUnsubscribe(text) {
  const t = (text || "").trim().toLowerCase();
  return UNSUB_WORDS.some((w) => t === w || t.startsWith(w));
}

// רשת ביטחון: לתפוס אם המודל בטעות נקב במחיר שנה א' (₪ ליד מספר 3-5 ספרות)
// חריג: סכומי סבסוד/מימון/מלגה (למשל "סבסוד עד 5,500 ₪ למילואים") מותרים — הם לא מחיר הקורס
function mentionsYearOnePrice(text) {
  if (!text) return false;
  const re = /(\d[\d,]{2,})\s*(₪|שקל|ש"ח|שח)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const num = Number(m[1].replace(/[^\d]/g, ""));
    if (num < 1000) continue; // 200-400 (מחיר טיפול) ו-400 (דמי הרשמה) מותרים
    const ctx = text.slice(Math.max(0, m.index - 50), m.index + m[0].length + 30);
    if (/סבסוד|מימון|מלגה|קרן|החזר/.test(ctx)) continue; // סכום הטבה, לא מחיר קורס
    return true;
  }
  return false;
}

const PRICE_FALLBACK =
  "מבין/ה אותך לגמרי שחשוב לדעת 🙂 הצעת המחיר נבנית אישית בשיחת התאמה קצרה עם יועצת לימודים — בלי לחץ ובלי התחייבות, בודקים יחד מה מתאים לך. רוצה שאתאם לך שיחה?";

const UNSUB_REPLY =
  "הסרנו אותך מרשימת התפוצה ולא יישלחו אליך עוד הודעות 🙂 אפשר תמיד לחזור ולכתוב לנו כאן.";

// זיהוי אישור הגעה (לתזכורות אירועים/יום פתוח) — תשובה קבועה, בלי AI ובלי CRM
const CONFIRM_RE = /^(אני\s+)?(מאשר|מאשרת|מאשרים)(\s+הגעה)?[!.\s🙂👍❤️]*$|^אישור\s+הגעה[!.\s]*$|^(אני\s+)?(אגיע|מגיע|מגיעה|נגיע|בע"ה\s+אגיע)[!.\s🙂👍❤️]*$/;
function isAttendanceConfirm(text) {
  const t = (text || "").trim();
  return t.length <= 30 && CONFIRM_RE.test(t);
}

/**
 * @param {object} lead - { name, persona, score, ... }
 * @param {Array<{role,content}>} history - שיחה קודמת (אופציונלי)
 * @param {string} incoming - ההודעה החדשה מהליד
 * @returns {Promise<object>} החלטה: reply, persona, intent, score_delta, handoff, ...
 */
// מנקה קווים מפרידים (—, –, --) שנשמעים "רובוטיים" → פסיק, לטון אנושי
function humanizeDashes(text) {
  if (!text) return text;
  text = text.replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2"); // טווחי מספרים: מקף רגיל
  text = text.replace(/\s*[—–]\s*/g, ", "); // קו מפריד → פסיק
  text = text.replace(/\s*--+\s*/g, ", ");
  text = text.replace(/,\s*,/g, ",").replace(/[ \t]{2,}/g, " ");
  return text;
}

export async function handleMessage(lead, history, incoming, askFn = askClaude) {
  // גרדרייל 0: אישור הגעה לאירוע — תשובה קבועה, בלי מודל ובלי שום כתיבה ל-CRM
  if (isAttendanceConfirm(incoming)) {
    return {
      reply: "מעולה, רשמנו את אישור ההגעה 🙂 נתראה!",
      persona: lead.persona || "unknown",
      intent: "smalltalk",
      score_delta: 0,
      handoff: false,
      handoff_reason: "",
      _guardrail: "event_confirm",
    };
  }

  // גרדרייל 1: הסרה — דטרמיניסטי, לא שולחים בכלל למודל
  if (isUnsubscribe(incoming)) {
    return {
      reply: UNSUB_REPLY,
      persona: lead.persona || "unknown",
      intent: "unsubscribe",
      score_delta: -100,
      handoff: false,
      handoff_reason: "",
      _guardrail: "unsubscribe",
    };
  }

  // בניית רשימת ההודעות למודל. שורת הקשר ראשונה עם פרטי הליד.
  const context = `פרטי הליד: שם=${lead.name || "לא ידוע"}, פרסונה=${
    lead.persona || "unknown"
  }, ציון חום=${lead.score ?? 0}.`;

  const messages = [];
  if (history && history.length) {
    messages.push(...history);
  }
  messages.push({ role: "user", content: `${context}\n\nהודעת הליד: ${incoming}` });

  let result = await askFn(messages);

  // גרדרייל 2: רשת ביטחון למחיר — אם המודל נקב במחיר לימוד, מחליפים תשובה
  if (mentionsYearOnePrice(result.reply)) {
    result.reply = PRICE_FALLBACK;
    result.intent = "buying_signal";
    result.handoff = true;
    result.handoff_reason = "שאלת מחיר — נדרשת יועצת (המודל ניסה לנקוב מחיר, נחסם)";
    result._guardrail = "price_scrubbed";
  }

  // גרדרייל 3: מילת "נציג" מפורשת → להבטיח handoff גם אם המודל פספס
  if (HUMAN_WORDS.some((w) => (incoming || "").includes(w))) {
    result.handoff = true;
    result.intent = result.intent === "unsubscribe" ? result.intent : "request_human";
    if (!result.handoff_reason) result.handoff_reason = "הליד ביקש לדבר עם נציג";
  }

  // ניקוי קווים מפרידים מהתשובה לפני שליחה (טון אנושי)
  result.reply = humanizeDashes(result.reply);
  return result;
}
