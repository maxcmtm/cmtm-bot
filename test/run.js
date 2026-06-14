// בדיקות הבוט. רץ בשני מצבים:
//   - בלי ANTHROPIC_API_KEY: מצב MOCK — בודק את הגרדריילים הדטרמיניסטיים בלבד.
//   - עם מפתח: מצב LIVE — בודק גם את התנהגות המודל האמיתי מול תרחישים.
import { config } from "../src/config.js";
import { handleMessage } from "../src/brain.js";
import { askClaude } from "../src/claude.js";

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
  check("הסרה לא קוראת למודל (תשובה קבועה)", r.reply.includes("הוסרת"));
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
