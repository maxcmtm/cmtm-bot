// צ'אט אינטראקטיבי לבדיקת הבוט בטרמינל.
// הרצה: npm run chat   (עם ANTHROPIC_API_KEY ב-.env לשיחה אמיתית)
// שומר היסטוריה, מציג ציון חום מצטבר, פרסונה ודגלי handoff.
import readline from "node:readline";
import { config } from "../src/config.js";
import { handleMessage } from "../src/brain.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lead = { name: "מיכל", persona: "unknown", score: 0 };
const history = [];

console.log(`\n🤖 צ'אט עם נועה — מצב: ${config.anthropicKey ? "LIVE" : "MOCK"}`);
if (!config.anthropicKey) {
  console.log("⚠️  אין מפתח — תגובות דמה. הכנס ANTHROPIC_API_KEY ל-.env לשיחה אמיתית.");
}
console.log("הקלד הודעה (או 'exit' ליציאה):\n");

function ask() {
  rl.question("אתה: ", async (line) => {
    const text = line.trim();
    if (text === "exit" || text === "יציאה") {
      rl.close();
      return;
    }
    try {
      const r = await handleMessage(lead, history, text);
      // עדכון מצב מקומי כמו בשרת
      lead.score += r.score_delta || 0;
      if (r.persona && r.persona !== "unknown") lead.persona = r.persona;
      history.push({ role: "user", content: text });
      history.push({ role: "assistant", content: r.reply });

      console.log(`\nנועה: ${r.reply}`);
      console.log(
        `  [פרסונה: ${lead.persona} · ציון: ${lead.score} · intent: ${r.intent}` +
          (r.handoff ? ` · ⚠️ HANDOFF: ${r.handoff_reason}` : "") +
          (r._guardrail ? ` · 🛡️ ${r._guardrail}` : "") +
          `]\n`
      );
    } catch (err) {
      console.log(`\n❌ שגיאה: ${err.message}\n`);
    }
    ask();
  });
}
ask();
