// מנוע החימום: שולח את התבנית הבאה ברצף ללידים שלא ענו, כל X ימים.
import { config } from "./config.js";
import { allLeads, updateLead, pushAssistantTurn, isPaused } from "./store.js";
import { sendTemplate, sendText, getNumberQuality } from "./whatsapp.js";
import { sweepTwinLeads } from "./fireberry.js";

// הקשר קצר של מה שנשלח בכל שלב — נשמר בהיסטוריה כדי שהבוט יבין את תשובת הליד
const STEP_CONTEXT = [
  "[שלחתי הודעת פתיחה והצעתי לבחור: 1 = מקצוע טיפולי חדש, 2 = עזרה לילד או בן משפחה, 3 = מטפל קיים שרוצה כלי לקליניקה]",
  "[שלחתי את הסיפור של יובל לוי מייסד השיטה, והזמנתי לכתוב 'איך' כדי לשמוע איך הגוף מכוון לשורש הבעיה]",
  "[שלחתי את הסיפור של מאי, בוגרת שעברה ממשבר אישי לקליניקה פעילה, והצעתי לשלוח עדות או סרטון אם יכתבו 'מאי']",
  "[הסברתי במה השיטה שונה (איתור השורש, בדיקת שריר) והצעתי לראות הדגמת טיפול אם יכתבו 'הדגמה']",
  "[התייחסתי לחשש 'אין לי רקע', נתתי דוגמה של אלעזר, ושאלתי מה הכי מעסיק אותם לגבי הלימודים]",
  "[שלחתי מספרים והכרות על המכללה, והזמנתי לכתוב 'תעודה' לשאלות על תעודה, הכרה או מימון]",
  "[הסברתי על הזמן והגמישות בשנה א', ושאלתי איזו מתכונת מתאימה: פרונטלי, זום או מוקלט]",
  "[הסברתי מה קורה אחרי התעודה, וביקשתי שישלחו שם עיר כדי לבדוק ביקוש באזור]",
  "[הזמנתי לשיחת התאמה קצרה בלי התחייבות, אפשר לענות 'שיחה']",
  "[שלחתי הודעה אחרונה בסדרה, עם הזמנה לכתוב 'שיחה' לתיאום]",
];

// רצף התבניות לפי שלב. שלב 0 = הודעת פתיחה. שלבים 1-9 = חימום (יום 3,6,...,27).
export const SEQUENCE = [
  "welcome_intro_v3", // 0  מיידי בכניסה
  "story_yuval_v3", // 1  יום 3
  "testimonial_v3", // 2  יום 6
  "method_unique_v3", // 3  יום 9
  "no_experience_v3", // 4  יום 12
  "numbers_proof_v3", // 5  יום 15
  "schedule_flex_v3", // 6  יום 18
  "after_diploma_v3", // 7  יום 21
  "soft_close_v3b", // 8  יום 24
  "last_call_v3", // 9  יום 27
];

const firstName = (name) => (name || "").trim().split(/\s+/)[0] || "מתעניין";

// שקט בשבת (שעון ישראל): שישי מ-15:00 ועד מוצ"ש 21:00 — לא שולחים הודעות יזומות.
// מה שהוחמץ נשלח אוטומטית בבדיקה הראשונה אחרי צאת השבת.
export function isShabbat(d = null) {
  const now = d || new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  const day = now.getDay(); // 5=שישי, 6=שבת
  const hour = now.getHours();
  return (day === 5 && hour >= 15) || (day === 6 && hour < 21);
}

// שעות שקט (שעון ישראל): אין הודעות יזומות בין 21:00 ל-09:00.
// ליד לא אמור לקבל שיווק ב-2 בלילה — זה גם מעצבן וגם מזמין דיווחי ספאם.
export function isQuietHours(d = null) {
  const now = d || new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  const hour = now.getHours();
  return hour >= 21 || hour < 9;
}

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
  if (lead.status === "unsubscribed") return; // ביקש שלא נפנה אליו
  if (isQuietHours()) {
    console.log(`🌙 שעות שקט — הודעת הפתיחה ל-${lead.name || lead.id} תישלח בבוקר`);
    return; // runDripCheck ישלים בבוקר (seqStep נשאר -1)
  }
  if (isShabbat()) {
    console.log(`🕯️ שבת — הודעת הפתיחה ל-${lead.name || lead.id} תישלח במוצ"ש`);
    return; // runDripCheck ישלים את הפתיחה אחרי שבת (seqStep נשאר -1)
  }
  await sendStep(lead, 0);
}

// בדיקה תקופתית: מי בשל לשלב הבא.
// הגנת איכות מספר (מדיניות אנטי-ספאם):
//   1. תקרה יומית (dailyCap) ותקרה לסבב (runCap) — אין יותר פרצים של מאות תבניות בשעה,
//      וההשלמה של מוצ"ש מתפזרת על פני שעות/ימים אוטומטית.
//   2. ריווח של כמה שניות בין שליחות.
//   3. ליד שמעולם לא ענה עוצר אחרי maxSilentStep — לא ממשיכים לשלוח שיווק למי שמתעלם,
//      כי אלה ההודעות שנחסמות ומדווחות ומורידות את דירוג האיכות.
export async function runDripCheck() {
  if (!config.drip.enabled || isPaused()) return 0;
  if (isShabbat()) return 0; // אין הודעות יזומות בשבת
  if (isQuietHours()) return 0; // אין הודעות יזומות בלילה — השלמה בבוקר
  const now = Date.now();
  const stepMs = config.drip.stepDays * 24 * 60 * 60 * 1000;
  const quietMs = config.drip.quietHours * 60 * 60 * 1000; // לא לשלוח אם ענה לאחרונה

  // התאמת קצב לדירוג האיכות של המספר אצל מטא: RED = עצירה מלאה, YELLOW = חצי קצב
  const quality = await getNumberQuality();
  let dailyCap = config.drip.dailyCap;
  if (quality === "RED") {
    console.log("🛑 דירוג איכות המספר RED — שליחת תבניות מושהית אוטומטית עד התאוששות");
    return 0;
  }
  if (quality === "YELLOW") dailyCap = Math.max(20, Math.floor(config.drip.dailyCap / 2));

  // כמה תבניות כבר נשלחו היום (מאז חצות שעון ישראל)
  const il = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  const midnight = now - (il.getHours() * 3600 + il.getMinutes() * 60 + il.getSeconds()) * 1000;
  const sentToday = allLeads().filter((l) => l.lastDripTs && l.lastDripTs >= midnight).length;
  const budget = Math.min(config.drip.runCap, Math.max(0, dailyCap - sentToday));

  const due = [];
  let pruned = 0;
  for (const lead of allLeads()) {
    if (lead.status !== "in_sequence") continue; // active_chat/hot/unsubscribed/cold לא מקבלים
    if (lead.seqStep < 0) { due.push({ lead, step: 0 }); continue; } // פתיחה שהוחמצה (נכנס בשבת)
    if (lead.seqStep >= SEQUENCE.length - 1) continue; // סיים רצף
    if (now - lead.lastDripTs < stepMs) continue; // עוד לא עברו X ימים
    if (lead.lastInboundTs && now - lead.lastInboundTs < quietMs) continue; // בשיחה פעילה
    if (!lead.lastInboundTs && lead.seqStep + 1 > config.drip.maxSilentStep) {
      updateLead(lead.id, { status: "cold" }); // שקט לאורך כל הדרך — מפסיקים בעדינות
      pruned++;
      continue;
    }
    due.push({ lead, step: lead.seqStep + 1 });
  }
  due.sort((a, b) => a.step - b.step); // עדיפות ללידים טריים (שלבים מוקדמים)

  let sent = 0;
  for (const { lead, step } of due) {
    if (sent >= budget) break;
    await sendStep(lead, step);
    sent++;
    await new Promise((r) => setTimeout(r, 3000)); // ריווח בין שליחות
  }
  if (pruned) console.log(`✂️ הרצף נעצר ל-${pruned} לידים שקטים (לא ענו עד שלב ${config.drip.maxSilentStep})`);
  if (due.length > sent) console.log(`⏳ תקרת קצב: ${due.length - sent} בשלים ימתינו לסבב הבא (נשלחו היום ${sentToday + sent}/${dailyCap}, דירוג ${quality})`);
  if (sent) console.log(`🔥 מנוע חימום: נשלחו ${sent} הודעות`);
  return sent;
}

// תזכורת עדינה: ליד שניהל שיחה עניינית ונעלם — מקבל הודעת המשך אחת
// בתוך חלון ה-24 שעות (18-23 שעות אחרי ההודעה האחרונה שלו), פעם אחת בלבד.
const NUDGE_TEXT =
  "היי 🙂 שמתי לב שעצרנו באמצע. אם נשארה לך שאלה פתוחה או משהו שהיה שווה להרחיב עליו, אני כאן.";

export async function runNudgeCheck() {
  if (!config.drip.enabled || isPaused()) return 0;
  if (isShabbat()) return 0; // אין תזכורות בשבת
  if (isQuietHours()) return 0; // אין תזכורות בלילה
  const now = Date.now();
  let sent = 0;
  for (const lead of allLeads()) {
    if (lead.status !== "active_chat") continue; // לא חם (נציג מטפל) ולא ברצף
    if (lead.nudgedTs) continue; // כבר תוזכר ולא ענה — לא מציקים שוב
    if (lead.lastIntent !== "question") continue; // רק מי שבאמת ניהל שיחה עניינית
    if (!lead.lastInboundTs) continue;
    const hours = (now - lead.lastInboundTs) / 3600000;
    if (hours < config.nudge.afterHours || hours > config.nudge.maxHours) continue;
    const res = await sendText(lead.id, NUDGE_TEXT);
    if (res.ok || res.dryRun) {
      pushAssistantTurn(lead.id, "[השיחה נעצרה ושלחתי תזכורת עדינה: שאלתי אם נשארה שאלה פתוחה]");
      updateLead(lead.id, { nudgedTs: now });
      console.log(`⏰ תזכורת המשך → ${lead.name || lead.id}`);
      sent++;
    }
  }
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
  timer = setInterval(() => {
    runDripCheck().catch((e) => console.error("[drip]", e.message));
    runNudgeCheck().catch((e) => console.error("[nudge]", e.message));
    sweepTwinLeads(3).catch((e) => console.error("[sweep]", e.message)); // ניקוי תאומי-זבל מה-CRM
    import("./watchdog.js").then((w) => w.runWatchdog()).catch((e) => console.error("[watchdog]", e.message));
  }, everyMs);
  console.log(
    `⏰ מנוע חימום פעיל: בדיקה כל ${config.drip.checkMinutes} דק' · מרווח ${config.drip.stepDays} ימים בין הודעות`
  );
}
