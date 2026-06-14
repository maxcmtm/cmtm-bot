// המוח: לוקח הקשר ליד + הודעה נכנסת → מחזיר החלטה מלאה
// כולל גרדריילים דטרמיניסטיים שלא תלויים במודל (הסרה, רשת ביטחון למחיר)
import { askClaude } from "./claude.js";

const UNSUB_WORDS = ["הסר", "הסרה", "להסיר", "תסירו", "stop", "unsubscribe", "תפסיקו"];
const HUMAN_WORDS = ["נציג", "יועצת", "לדבר עם בנאדם", "אדם אמיתי", "טלפון איתי"];

// זיהוי בקשת הסרה — חייב לעבוד גם אם המודל מפספס
function isUnsubscribe(text) {
  const t = (text || "").trim().toLowerCase();
  return UNSUB_WORDS.some((w) => t === w || t.startsWith(w + " ") || t === w + ".");
}

// רשת ביטחון: לתפוס אם המודל בטעות נקב במחיר שנה א' (₪ ליד מספר 3-5 ספרות)
function mentionsYearOnePrice(text) {
  if (!text) return false;
  // סכום בשקלים: מספר עם 3+ ספרות ליד ₪ או "שקל" — אבל לא 200-400 (מחיר טיפול שמותר)
  const matches = text.match(/(\d[\d,]{2,})\s*(₪|שקל|ש"ח|שח)/g) || [];
  return matches.some((m) => {
    const num = Number(m.replace(/[^\d]/g, ""));
    return num >= 1000; // מחירי לימוד; 200-400 (טיפול) ו-400 (דמי הרשמה) מותרים
  });
}

const PRICE_FALLBACK =
  "מבין/ה אותך לגמרי שחשוב לדעת 🙂 הצעת המחיר נבנית אישית בשיחת התאמה קצרה עם יועצת לימודים — בלי לחץ ובלי התחייבות, בודקים יחד מה מתאים לך. רוצה שאתאם לך שיחה?";

const UNSUB_REPLY =
  "הוסרת מרשימת התפוצה ולא תקבל/י מאיתנו עוד הודעות 🙂 אם תרצה/י לחזור בעתיד — אנחנו תמיד כאן.";

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
