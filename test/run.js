// בדיקות הבוט. רץ בשני מצבים:
//   - בלי ANTHROPIC_API_KEY: מצב MOCK — בודק את הגרדריילים הדטרמיניסטיים בלבד.
//   - עם מפתח: מצב LIVE — בודק גם את התנהגות המודל האמיתי מול תרחישים.
import { config } from "../src/config.js";
import { handleMessage, humanizeTone, detectAttendance } from "../src/brain.js";
import { askClaude } from "../src/claude.js";
import { matchAutomation } from "../src/automation-skip.js";
import { parseIncoming } from "../src/whatsapp.js";

const live = Boolean(config.anthropicKey);
let pass = 0,
  fail = 0;

function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${detail ? "— " + detail : ""}`);
  }
}

// ---------- Mock של המודל (כשאין מפתח) ----------
// מדמה תשובה מובנית סבירה לפי תוכן ההודעה, כדי לבדוק את שכבת ה-brain.
async function mockAsk(messages) {
  const last = messages[messages.length - 1].content;
  const text = last.split("הודעת הליד:").pop();
  let persona = "unknown";
  if (/ילד|בן שלי|בת שלי|הרטבה|קשב/.test(text)) persona = "parent";
  else if (/NLP|מטפל|רפלקס|קואצ/.test(text)) persona = "therapist";
  else if (/הסבה|מקצוע|קריירה/.test(text)) persona = "career";
  // mock "טועה" בכוונה ונוקב מחיר — כדי לבדוק שרשת הביטחון תופסת
  if (/כמה עולה|מחיר/.test(text)) {
    return {
      reply: "שנה א' עולה 9,900 ₪.",
      persona,
      intent: "buying_signal",
      score_delta: 30,
      handoff: false,
      handoff_reason: "",
    };
  }
  return {
    reply: "תשובה לדוגמה 🙂 רוצה שאספר עוד?",
    persona,
    intent: "question",
    score_delta: 15,
    handoff: false,
    handoff_reason: "",
  };
}

const ask = live ? askClaude : mockAsk;
const lead = { name: "מיכל", persona: "unknown", score: 0 };

console.log(`\n=== מצב: ${live ? "LIVE (מודל אמיתי)" : "MOCK (גרדריילים בלבד)"} ===\n`);

// ---------- בדיקות גרדריילים (עובדות בכל מצב) ----------
console.log("גרדריילים דטרמיניסטיים:");
{
  const r = await handleMessage(lead, [], "הסר", ask);
  check("הסרה מזוהה כ-unsubscribe", r.intent === "unsubscribe");
  check("הסרה לא מעבירה לנציג", r.handoff === false);
  check("הסרה לא קוראת למודל (תשובה קבועה)", r._guardrail === "unsubscribe" && /הסרנו|הוסרת/.test(r.reply));
}
{
  // זיהוי הסרה = מילה שלמה בלבד ("הסרטון" הוריד אדם מרשימת הדיוור בטעות)
  const yes = ["הסר", "הסר בבקשה!", "תסירו אותי מהרשימה", "אני לא מעוניינת", "תפסיקו לשלוח לי", "STOP"];
  const no = ["הסרטון לא נפתח לי", "איפה הסרט על השיטה?", "מעוניינת בפרטים", "ההסרה של הכאב הייתה מדהימה"];
  const all = [];
  for (const t of yes) all.push((await handleMessage(lead, [], t, ask)).intent === "unsubscribe" ? "" : `"${t}" לא זוהה`);
  for (const t of no) all.push((await handleMessage(lead, [], t, ask)).intent !== "unsubscribe" ? "" : `"${t}" זוהה בטעות`);
  const bad = all.filter(Boolean);
  check("הסרה: מילה שלמה בלבד (הסרטון ≠ הסר)", bad.length === 0, bad.join(", "));
}
{
  // דילוג על הודעות שאוטומציית n8n עונה עליהן (מניעת תשובה כפולה)
  const m = (t, h = []) => matchAutomation(t, h)?.group || null;
  const askedTime = [{ role: "assistant", content: "[נשלחה תבנית שירות check_lead_what_time_contact: דנה]" }];
  const cases = [
    ["אישור לימודים", "study_cert"], ["אני צריכה אישור לימודים בבקשה", "study_cert"],
    ["הזמנת ספרים", "order_books"], ["סטטוס משלוח", "books_shipping"],
    ["מעוניין", "promo_1800"], ["מעוניינת 🙂", "promo_1800"],
    // "מעוניין" בתוך משפט = ליד חם לנועה (11/10: 7 לידים חמים הושתקו)
    ["אני מעוניינת", null], ["אני מעוניינת בלימודים", null], ["הייתי אצלכם ביום פתוח, התרשמתי ואני מעוניין לבדוק אפשרות להירשם", null],
    // הודעה ארוכה עם מילת מפתח = שיחה אמיתית, לא כפתור
    ["במידה ואחליט לא להבחן אקבל מכם תעודת השתתפות עם ציון ושעות הלמידה?", null], ["יש לי תקלה עם הקישור לזום של השיעור, מה עושים?", null],
    ["אני לא מעוניינת, בבקשה להפסיק לשלוח לי הודעות כאלה יותר", "unsubscribe"],
    ["אני רוצה לשמור מקום", "save_seat"], ["שריינו לי את ההטבה", "reserve_benefit"], ["שריינו לי את ההטבה בבקשה 🙏", "reserve_benefit"],
    ["הסר", "unsubscribe"], ["תורידו אותי מרשימת התפוצה", "unsubscribe"],
    ["בוקר", "contact_time"], ["אחה\"צ", "contact_time"],
    ["בוקר טוב", null], ["בוקר טוב", "contact_time", askedTime], ["אחרי הצהריים יותר נוח", "contact_time", askedTime],
    ["הסרטון לא נפתח", null], ["ציונים", "grades"], ["אני צריך חשבונית בבקשה", "invoices"], ["יש לי שאלה על החשבונית", null], ["תקלה", "tech_support"],
    ["מה המסלולים ללימודים?", null], ["אשמח לפרטים נוספים", null], ["להרשמה לקורס", null],
    // תפריט: רק הודעה מדויקת. משפט חופשי שמכיל את הביטוי שייך לנועה
    ["שנה א'", "menu"], ["שנה א׳", "menu"], ["מידע מסלולי לימודים", "menu"], ["חזרה לתפריט הראשי", "menu"], ["להרשמה לשנה ב'", "menu"],
    ["כמה עולה שנה א'?", null], ["אני רוצה מידע מסלולי לימודים בבקשה", null], ["מתאים לי לימודים דיגיטלים או פרונטלים?", null],
    // כפתורי WizUp עם אימוג'י
    ["ייעוץ והרשמה 📝", "menu"], ["שירות לסטודנט 🎓", "menu"], ["אודות המכללה 🏫", "menu"], ["שאלות תשובות 📋", "menu"],
    ["לימודים פרונטלים 🏛️", "menu"], ["שנה ב' 🌱", "menu"], ["תנו לי מידע נוסף ℹ️", "menu"], ["שעות פעילות 🕒", "menu"],
    ["פרטי יצירת קשר 📞", "menu"], ["כתובת המכללה 📍", "menu"], ["הנהלת חשבונות 💰", "finance_dept"], ["קבלות וחשבוניות 🧾", "invoices"],
    ["מה שעות הפעילות של המזכירות?", null], ["איפה כתובת המכללה בפתח תקווה?", null],
    // 1/2/3: תפריט של n8n, אלא אם נועה עצמה ביקשה לבחור 1/2/3 בהודעת הפתיחה
    ["1", "menu_digits"], ["2", "menu_digits"], ["3", "menu_digits"], ["1.", "menu_digits"], ["12", null],
    ["1", null, [{ role: "assistant", content: "[שלחתי הודעת פתיחה והצעתי לבחור: 1 = מקצוע טיפולי חדש, 2 = עזרה לילד או בן משפחה, 3 = מטפל קיים שרוצה כלי לקליניקה]" }]],
  ];
  const bad = cases.filter(([t, exp, h]) => m(t, h) !== exp).map(([t, exp, h]) => `"${t}" → ${m(t, h)} (צפוי ${exp})`);
  check(`דילוג לאוטומציות n8n: ${cases.length} מקרים`, bad.length === 0, bad.join(" | "));
}
{
  // אישור/ביטול הגעה ליום פתוח: כפתורי התבניות + ניסוחים חופשיים קצרים; "כן"/"לא" לבד רק בהקשר של תזכורת
  const evt = [{ role: "assistant", content: "[נשלחה תבנית שירות openday_1910_invite]" }];
  const chat = [{ role: "user", content: "מה המסלולים?" }, { role: "assistant", content: "יש כמה. רוצה שאתאם לך שיחה עם יועצת?" }];
  const cases = [
    ["אישור הגעה", "yes", []], ["כן, מגיע/ה", "yes", []], ["מאשר/ת הגעה", "yes", []], ["מאשרת הגעה!", "yes", []], ["מגיע", "yes", []],
    ["אני מגיעה 🙂", "yes", []], ["נגיע בעז\"ה", "yes", []], ["אהיה שם", "yes", []], ["אני רוצה להגיע", "yes", []],
    ["לא מגיע/ה", "no", []], ["לא אגיע", "no", []], ["אגיע בפעם אחרת", "no", []], ["לצערי לא אוכל", "no", []], ["לא מתאים לי הפעם", "no", []],
    ["כן", "yes", []], ["כן", "yes", evt], ["לא", "no", evt], ["בטח", "yes", evt],
    ["כן", null, chat], ["לא", null, chat], ["בשמחה", null, chat],
    ["מגיעה עם חברה, יש מקום?", null, []], ["כמה עולה שנה א'?", null, []], ["אני מגיע מירושלים, כמה זמן נסיעה?", null, []],
  ];
  const bad = cases.filter(([t, exp, h]) => detectAttendance(t, h) !== exp).map(([t, exp, h]) => `"${t}" → ${detectAttendance(t, h)} (צפוי ${exp})`);
  check(`אישור הגעה: ${cases.length} מקרים`, bad.length === 0, bad.join(" | "));
  const r = await handleMessage(lead, [], "אישור הגעה", ask);
  check("אישור הגעה: תשובה קבועה בלי מודל", r._guardrail === "event_confirm" && r.reply.includes("נתראה"), r.reply);
  const r2 = await handleMessage(lead, [], "לא מגיע/ה", ask);
  check("ביטול הגעה: תשובה קבועה בלי מודל", r2._guardrail === "event_decline", r2.reply);
}
{
  // ניקוי טון דטרמיניסטי: הבטחות זמן, מספר ישן, שם פרטי חוזר
  const hist = [{ role: "user", content: "היי" }, { role: "assistant", content: "היי תניא 🙂 מה מעניין אותך?" }];
  const t1 = humanizeTone("מעבירה אותך ליועצת שלנו, היא תחזור אליך עוד היום 🙂", { name: "שקד" }, []);
  check("טון: 'עוד היום' → 'בהקדם'", t1 === "מעבירה אותך ליועצת שלנו, היא תחזור אליך בהקדם 🙂", t1);
  const t2 = humanizeTone("אפשר לפנות למכללה בוואטסאפ: 052-288-4221 🙏", {}, []);
  check("טון: מספר 052 ישן → 077-412-1443", t2.includes("077-412-1443") && !t2.includes("4221"), t2);
  const t3 = humanizeTone("תניא, אני ממש מבינה שזה מתסכל. הפנייה שלך מסומנת כדחופה.", { name: "תניא ביטון" }, hist);
  check("טון: שם שכבר נאמר מוסר מתחילת משפט", t3 === "אני ממש מבינה שזה מתסכל. הפנייה שלך מסומנת כדחופה.", t3);
  const t4 = humanizeTone("מעולה, תניא 🙂 היועצת תחזור אליך בהקדם", { name: "תניא ביטון" }, hist);
  check("טון: ', תניא 🙂' מוסר", t4 === "מעולה 🙂 היועצת תחזור אליך בהקדם", t4);
  const t5 = humanizeTone("היי תניא 🙂 איך אפשר לעזור?", { name: "תניא ביטון" }, []);
  check("טון: שם בפעם הראשונה נשאר", t5 === "היי תניא 🙂 איך אפשר לעזור?", t5);
  const t6 = humanizeTone("את רשומה למחזור של מיטל אברהמי, יום ג' ערב.", { name: "מיטל" }, hist);
  check("טון: שם זהה בתוך משפט (לא פנייה) לא נפגע", t6.includes("מיטל אברהמי"), t6);
}
{
  // פענוח הודעות מתפריט WizUp: interactive נשאר interactive (נועה שותקת), כפתור תבנית הופך לטקסט
  const body = { entry: [{ changes: [{ value: { contacts: [{ wa_id: "972500000001", profile: { name: "דנה" } }], messages: [
    { from: "972500000001", id: "w1", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "x", title: "אודות המכללה 🏫" } } },
    { from: "972500000001", id: "w2", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "y", title: "ייעוץ והרשמה 📝" } } },
    { from: "972500000001", id: "w3", type: "button", button: { payload: "p", text: "כן, מעניין אותי" } },
    { from: "972500000001", id: "w4", type: "text", text: { body: "היי" } },
  ] } }] }] };
  const p = parseIncoming(body);
  check("parseIncoming: list_reply/button_reply → type interactive עם הכיתוב",
    p[0].type === "interactive" && p[0].text === "אודות המכללה 🏫" && p[1].type === "interactive" && p[1].text === "ייעוץ והרשמה 📝",
    JSON.stringify(p.slice(0, 2)));
  check("parseIncoming: כפתור תבנית → טקסט רגיל", p[2].type === "text" && p[2].text === "כן, מעניין אותי" && p[3].text === "היי");
}
{
  const r = await handleMessage(lead, [], "כמה עולה שנה א'?", ask);
  check("שאלת מחיר: לא נוקב סכום לימוד בתשובה", !/(\d[\d,]{2,})\s*(₪|שקל|ש"ח)/.test(r.reply) || !/(9,900|9900)/.test(r.reply), r.reply);
  check("שאלת מחיר: מועבר לנציג (handoff)", r.handoff === true);
  check("שאלת מחיר: intent=buying_signal", r.intent === "buying_signal");
}
{
  const r = await handleMessage(lead, [], "אני רוצה לדבר עם נציג", ask);
  check("בקשת נציג: handoff=true", r.handoff === true);
}
{
  const r = await handleMessage({ ...lead }, [], "יש לי ילד עם בעיות קשב", ask);
  check("זיהוי פרסונת הורה", r.persona === "parent", `קיבלנו: ${r.persona}`);
}

// ---------- בדיקות LIVE בלבד (מודל אמיתי) ----------
if (live) {
  console.log("\nהתנהגות מודל אמיתי:");
  {
    const r = await handleMessage(lead, [], "כמה עולה הקורס של שנה ראשונה?", askClaude);
    check("מודל לא נוקב מחיר שנה א'", !/(\d[\d,]{3,})\s*(₪|שקל|ש"ח)/.test(r.reply), r.reply);
    check("מודל מציע שיחת התאמה", /שיח|יועצת|התאמה/.test(r.reply), r.reply);
  }
  {
    const r = await handleMessage(lead, [], "אני בלי שום רקע, אפשר ללמוד?", askClaude);
    check("עונה עניינית על 'בלי רקע'", r.reply.length > 10 && !r.handoff, r.reply);
  }
  {
    const r = await handleMessage(lead, [], "השיטה הזאת זה לא סתם שטויות?", askClaude);
    check("מתמודד עם ספקנות בלי להגן בתוקפנות", r.reply.length > 10, r.reply);
    console.log(`     ↳ דוגמת תשובה: ${r.reply}`);
  }
}

console.log(`\n=== סיכום: ${pass} עברו, ${fail} נכשלו ===\n`);
process.exit(fail > 0 ? 1 : 0);
