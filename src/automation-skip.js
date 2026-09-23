// דילוג על הודעות שאוטומציה חיצונית (n8n) כבר עונה עליהן במספר של נועה.
// בלי זה הלקוח מקבל שתי תשובות: אחת מהאוטומציה (ציון, קישור, קריאת שירות) ואחת מנועה.
// הזיהוי הוא של ביטוי שלם בלבד (גבולות מילה) — "הסר" בתוך "הסרטון" לא נחשב.
import { getAutomationOverrides } from "./store.js";

// כל קבוצה = אוטומציה אחת ב-n8n. active=false → הבוט כבוי אצלם, נועה עונה כרגיל.
// אפשר להדליק/לכבות בזמן ריצה: POST /admin/automation {secret, group, active}
export const AUTOMATION_GROUPS = [
  // ---- 1. שירות לסטודנט (פעיל) ----
  { key: "study_cert", label: "אישור לימודים", active: true,
    phrases: ["אישור לימודים", "אישור לימוד"] },
  { key: "make_payment", label: "ביצוע תשלום", active: true,
    phrases: ["ביצוע תשלום", "תשלום חוב", "לבצע תשלום"] },
  { key: "payment_status", label: "מצב תשלומים", active: true,
    phrases: ["מצב תשלומים"] },
  { key: "finance_dept", label: "מחלקת כספים", active: true,
    phrases: ["מחלקת כספים", "מחלקה לכספים", "הנהלת חשבונות"] },
  { key: "order_books", label: "הזמנת ספרי לימוד", active: true,
    phrases: ["הזמנת ספרי לימוד", "הזמנת ספרים", "הזמנת ספר", "להזמין ספרים"] },
  { key: "books_shipping", label: "סטטוס משלוח ספרים", active: true,
    phrases: ["סטטוס משלוח ספרים", "סטטוס משלוח", "משלוח ספרים"] },

  // ---- 2. הסרה מרשימת דיוור (האוטומציה מסירה ב-Fireberry, smoove ו-Wizup ושולחת אישור) ----
  { key: "unsubscribe", label: "הסרה מרשימת דיוור", active: true,
    phrases: [
      "הסר", "הסרה", "הסירו", "להסיר", "תסיר", "תסירו", "תפסיקו",
      "להוריד אותי", "תורידו אותי", "תוריד אותי",
      "להוציא אותי", "תוציאו אותי", "תוציא אותי",
      "מחקו אותי", "תמחקו אותי", "תמחק אותי", "למחוק אותי",
      "תפסיקו לשלוח", "להפסיק לשלוח", "תפסיק לשלוח",
      "לא לשלוח", "אל תשלחו", "אל תשלח", "לא רוצה לקבל",
      "רשימת התפוצה", "רשימת תפוצה", "לא רלוונטי",
      "לא מעוניין", "לא מעונינת", "לא מעוניינת", "ירדתי מזה",
      "stop", "unsubscribe",
    ] },

  // ---- 3. מתי נוח ליצור קשר (רק כתשובה לשאלה — "בוקר טוב" זו ברכה) ----
  { key: "contact_time", label: "מתי נוח ליצור קשר", active: true, replyOnly: true,
    phrases: ["בוקר", "צהריים", "צהרים", "אחר הצהריים", "אחרי הצהריים", "אחה\"צ", "אחהצ"] },

  // ---- 4. שיווק והרשמות ----
  { key: "promo_1800", label: "מבצע 1800", active: true,
    phrases: ["מעוניין", "מעוניינת", "מעוניין/ת"] },
  { key: "zoom_2110", label: "מפגש זום 21.10", active: true,
    phrases: ["הרשמה למפגש זום 21.10", "אני רוצה להרשם לזום", "אני רוצה להירשם לזום"] },
  { key: "save_seat", label: "שמירת מקום", active: true,
    phrases: ["אני רוצה לשמור מקום"] },

  // ---- 5. בנויים אבל כבויים ב-n8n — להדליק כאן כשמדליקים שם ----
  { key: "grades", label: "ציונים ומשובים", active: false,
    phrases: ["ציונים ומשובים", "ציונים", "ציון", "משוב"] },
  { key: "schedule", label: "מערכת שעות", active: false,
    phrases: ["מערכת שעות", "מערכת השעות"] },
  { key: "tech_support", label: "תקלות טכניות", active: false,
    phrases: ["תמיכה טכנית", "תקלה טכנית", "תקלה"] },
  { key: "payment_method", label: "שינוי אמצעי תשלום", active: false,
    phrases: ["שינוי אמצעי תשלום", "אמצעי תשלום"] },
  { key: "invoices", label: "קבלות וחשבוניות", active: false,
    phrases: ["קבלות וחשבוניות", "קבלות", "חשבונית"] },
];

// נרמול: רווחים כפולים, גרשיים חכמים, סימני פיסוק בקצוות
function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[״”“]/g, '"')
    .replace(/[׳’‘]/g, "'")
    .replace(/[!?.,:;…()\[\]{}\-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// תו של מילה: אותיות עבריות/לטיניות, ספרות, גרש וגרשיים (חלק ממילים כמו אחה"צ)
const WORD = "[\\u05d0-\\u05ea\\u05f0-\\u05f4a-z0-9'\"]";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// האם הביטוי מופיע בהודעה כמילה/ביטוי שלם (לא כחלק ממילה אחרת)
export function containsWholePhrase(text, phrase) {
  const t = normalize(text);
  const p = normalize(phrase);
  if (!t || !p) return false;
  const re = new RegExp(`(^|[^${WORD.slice(1, -1)}])${escapeRe(p)}($|[^${WORD.slice(1, -1)}])`, "i");
  return re.test(t);
}

// האם ההודעה היא ממש הביטוי (עם או בלי סימני פיסוק/אימוג'י מסביב)
function equalsPhrase(text, phrase) {
  return normalize(text).replace(/[^א-תװ-״a-z0-9'" ]/g, "").trim() === normalize(phrase);
}

function isActive(group) {
  const ov = getAutomationOverrides();
  return group.key in ov ? !!ov[group.key] : group.active;
}

// זיהוי הסרה שלם (לשימוש גם בגרדרייל של המוח כשהאוטומציה כבויה)
export function isUnsubscribeText(text) {
  const g = AUTOMATION_GROUPS.find((x) => x.key === "unsubscribe");
  return g.phrases.some((p) => containsWholePhrase(text, p));
}

// הודעה נכנסת → הקבוצה שהאוטומציה תענה עליה, או null אם נועה צריכה לענות
export function matchAutomation(text, history = []) {
  for (const g of AUTOMATION_GROUPS) {
    if (!isActive(g)) continue;
    if (g.replyOnly) {
      // רק כתשובה לשאלת "מתי נוח": ההודעה היא בדיוק הביטוי, או שהתבנית נשלחה זה עתה
      const lastBot = [...history].reverse().find((m) => m.role === "assistant");
      const asked = /check_lead_what_time_contact|מתי נוח/.test(lastBot?.content || "");
      const hit = g.phrases.find((p) => (asked ? containsWholePhrase(text, p) : equalsPhrase(text, p)));
      if (hit) return { group: g.key, label: g.label, phrase: hit };
      continue;
    }
    const hit = g.phrases.find((p) => containsWholePhrase(text, p));
    if (hit) return { group: g.key, label: g.label, phrase: hit };
  }
  return null;
}

// מצב הקבוצות לתצוגה/ניהול
export function automationStatus() {
  return AUTOMATION_GROUPS.map((g) => ({ key: g.key, label: g.label, active: isActive(g), phrases: g.phrases }));
}
