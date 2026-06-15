// מנוע החימום: שולח את התבנית הבאה ברצף ללידים שלא ענו, כל X ימים.
import { config } from "./config.js";
import { allLeads, updateLead, pushAssistantTurn, isPaused } from "./store.js";
import { sendTemplate } from "./whatsapp.js";

// הקשר קצר של מה שנשלח בכל שלב — נשמר בהיסטוריה כדי שהבוט יבין את תשובת הליד
const STEP_CONTEXT = [
  "[שלחתי הודעת פתיחה והצעתי לבחור מה מעניין: 1 = מקצוע טיפולי חדש, 2 = עזרה לילד או בן משפחה, 3 = מטפל קיים שמחפש כלי נוסף]",
  "[שלחתי את הסיפור של יובל לוי מייסד השיטה, והזמנתי לכתוב 'איך' כדי לשמוע איך זה עובד]",
  "[שלחתי עדות של מאי מולר, בוגרת שהצליחה, והצעתי לשמוע עוד סיפורים]",
  "[הסברתי על ייחוד השיטה (3 מימדים, בדיקת שריר) והצעתי לראות הדגמת טיפול]",
  "[נתתי דוגמה של אלעזר שהתחיל בלי רקע, והזמנתי לשאול כל שאלה על הלימודים]",
  "[שלחתי מספרים על המכללה והכרה, והזמנתי לשאול על התעודה]",
  "[הסברתי על מבנה הזמן והגמישות בשנה א', ושאלתי איזו מתכונת מתאימה]",
  "[הסברתי מה קורה אחרי התעודה (שיווק, מאגר מטפלים, הכנסה), ושאלתי על העיר]",
  "[הזמנתי לשיחת התאמה עם יועצת לימודים, אפשר לענות 'שיחה']",
  "[שלחתי הודעה אחרונה ברצף, עם הזמנה לשיחת התאמה]",
];

// רצף התבניות לפי שלב. שלב 0 = הודעת פתיחה. שלבים 1-9 = חימום (יום 3,6,...,27).
export const SEQUENCE = [
  "welcome_intro_v2", // 0  מיידי בכניסה
  "story_yuval_v2", // 1  יום 3
  "testimonial_v2", // 2  יום 6
  "method_unique_v2", // 3  יום 9
  "no_experience_v2", // 4  יום 12
  "numbers_proof_v2", // 5  יום 15
  "schedule_flex_v2", // 6  יום 18
  "after_diploma_v2", // 7  יום 21
  "soft_close_v2", // 8  יום 24
  "last_call_v2", // 9  יום 27
];

const firstName = (name) => (name || "").trim().split(/\s+/)[0] || "מתעניין";

// שולח שלב בודד לליד ומעדכן את מצבו
async function sendStep(lead, step) {
  const tmpl = SEQUENCE[step];
  const res = await sendTemplate(lead.id, tmpl, [firstName(lead.name)]);
  if (res.ok || res.dryRun) {
    const last = step >= SEQUENCE.length - 1;
    pushAssistantTurn(lead.id, STEP_CONTEXT[step]); // שמירת ההקשר לרצף השיחה
    updateLead(lead.id, {
      seqStep: step,
      lastDripTs: Date.now(),
      status: last ? "cold" : "in_sequence",
    });
    console.log(`📤 חימום שלב ${step} (${tmpl}) → ${lead.name || lead.id}${last ? " [רצף הסתיים]" : ""}`);
  } else {
    console.error(`⚠️ שליחת חימום נכשלה ל-${lead.id} שלב ${step} (${tmpl})`);
  }
}

// כניסת ליד חדש: שולח את הודעת הפתיחה (שלב 0)
export async function startSequence(lead) {
  if (!config.drip.enabled) {
    console.log(`⏸️ חימום מושבת — הליד ${lead.name || lead.id} נרשם אך לא נשלחה הודעת פתיחה`);
    return;
  }
  if (lead.seqStep >= 0) return; // כבר התחיל
  await sendStep(lead, 0);
}

// בדיקה תקופתית: מי בשל לשלב הבא
export async function runDripCheck() {
  if (!config.drip.enabled || isPaused()) return 0;
  const now = Date.now();
  const stepMs = config.drip.stepDays * 24 * 60 * 60 * 1000;
  const quietMs = config.drip.quietHours * 60 * 60 * 1000; // לא לשלוח אם ענה לאחרונה
  let sent = 0;
  for (const lead of allLeads()) {
    if (lead.status !== "in_sequence") continue; // active_chat/hot/unsubscribed/cold לא מקבלים
    if (lead.seqStep < 0) continue; // עוד לא נשלחה פתיחה (startSequence יטפל)
    if (lead.seqStep >= SEQUENCE.length - 1) continue; // סיים רצף
    if (now - lead.lastDripTs < stepMs) continue; // עוד לא עברו X ימים
    if (lead.lastInboundTs && now - lead.lastInboundTs < quietMs) continue; // בשיחה פעילה
    await sendStep(lead, lead.seqStep + 1);
    sent++;
  }
  if (sent) console.log(`🔥 מנוע חימום: נשלחו ${sent} הודעות`);
  return sent;
}

let timer = null;
export function startDripScheduler() {
  if (timer) return;
  if (!config.drip.enabled) {
    console.log("⏸️ מנוע חימום מושבת (DRIP_ENABLED=false) — לא נשלחות תבניות. הבוט השיחתי פעיל.");
    return;
  }
  const everyMs = config.drip.checkMinutes * 60 * 1000;
  timer = setInterval(() => runDripCheck().catch((e) => console.error("[drip]", e.message)), everyMs);
  console.log(
    `⏰ מנוע חימום פעיל: בדיקה כל ${config.drip.checkMinutes} דק' · מרווח ${config.drip.stepDays} ימים בין הודעות`
  );
}
