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

  // ---- 5. שירות לסטודנט, הופעלו ב-n8n 24/9 ----
  { key: "grades", label: "ציונים ומשובים", active: true,
    phrases: ["ציונים ומשובים", "ציונים", "ציון", "משוב"] },
  { key: "schedule", label: "מערכת שעות", active: true,
    phrases: ["מערכת שעות", "מערכת השעות"] },
  { key: "tech_support", label: "תקלות טכניות", active: true,
    phrases: ["תמיכה טכנית", "תקלה טכנית", "תקלה"] },
  { key: "payment_method", label: "שינוי אמצעי תשלום", active: true,
    phrases: ["שינוי אמצעי תשלום", "אמצעי תשלום"] },
  { key: "invoices", label: "קבלות וחשבוניות", active: true,
    phrases: ["קבלות וחשבוניות", "קבלות", "חשבונית"] },

  // ---- 6. תפריט ייעוץ והרשמה של n8n (24/9). exact: רק כשההודעה היא בדיוק כפתור/אפשרות מהתפריט.
  //      ליד שכותב משפט חופשי ("כמה עולה שנה א'?", "מה המסלולים?") מדבר עם נועה, לא עם התפריט. ----
  { key: "menu", label: "תפריט ייעוץ והרשמה", active: true, exact: true,
    phrases: [
      "ייעוץ והרשמה", "מידע מסלולי לימודים", "תיאום שיחה עם יועץ", "לתיאום שיחה עם יועץ",
      "תנאי קבלה ללימודים", "מלגות וסבסוד לימודים", "חזרה לתפריט הראשי",
      "לימודים פרונטלים", "לימודים דיגיטלים", "לימודים פרונטליים", "לימודים דיגיטליים",
      "שנה א'", "שנה ב'", "שנה ג'",
      "להרשמה לשנה א'", "להרשמה לשנה ב'", "להרשמה לשנה ג'", "תנו לי מידע נוסף",
    ] },
  // מספרי תפריט. חריג: הודעת הפתיחה של נועה עצמה מבקשת לענות 1/2/3 — כשזו התשובה לה, נועה עונה.
  { key: "menu_digits", label: "תפריט 1/2/3", active: true, exact: true,
    unlessBotAsked: /הצעתי לבחור: 1|1 = מקצוע/,
    phrases: ["1", "2", "3"] },
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
  const lastBot = [...history].reverse().find((m) => m.role === "assistant")?.content || "";
  for (const g of AUTOMATION_GROUPS) {
    if (!isActive(g)) continue;
    // נועה עצמה שאלה שאלה שהתשובה לה נראית כמו אפשרות תפריט (למשל 1/2/3) — זו תשובה לנועה
    if (g.unlessBotAsked && g.unlessBotAsked.test(lastBot)) continue;
    let hit;
    if (g.replyOnly) {
      // רק כתשובה לשאלת "מתי נוח": ההודעה היא בדיוק הביטוי, או שהתבנית נשלחה זה עתה
      const asked = /check_lead_what_time_contact|מתי נוח/.test(lastBot);
      hit = g.phrases.find((p) => (asked ? containsWholePhrase(text, p) : equalsPhrase(text, p)));
    } else if (g.exact) {
      hit = g.phrases.find((p) => equalsPhrase(text, p));
    } else {
      hit = g.phrases.find((p) => containsWholePhrase(text, p));
    }
    if (hit) return { group: g.key, label: g.label, phrase: hit };
  }
  return null;
}

// מצב הקבוצות לתצוגה/ניהול
export function automationStatus() {
  return AUTOMATION_GROUPS.map((g) => ({ key: g.key, label: g.label, active: isActive(g), phrases: g.phrases }));
}
