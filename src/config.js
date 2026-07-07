// טעינת קונפיגורציה מ-.env (בלי תלות חיצונית — פרסר קטן משלנו)
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..");
// תיקיית נתונים (לידים). בענן מצביעים על דיסק קבוע דרך DATA_DIR.
export const DATA_DIR = process.env.DATA_DIR || join(ROOT, "data");

// פרסר .env מינימלי — תומך KEY=VALUE, מתעלם מהערות ושורות ריקות
function loadDotenv() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotenv();

// מפתח נחשב אמיתי רק אם הוא תקני (לא ה-placeholder מ-.env.example)
function realKey(k) {
  if (!k) return "";
  if (k.includes("...") || k.length < 20) return ""; // placeholder
  return k;
}

export const config = {
  anthropicKey: realKey(process.env.ANTHROPIC_API_KEY),
  model: process.env.BOT_MODEL || "claude-haiku-4-5-20251001",
  port: Number(process.env.PORT || 3000),
  webhookSecret: process.env.WEBHOOK_SECRET || "",
  fireberry: {
    token: process.env.FIREBERRY_API_TOKEN || "",
    baseUrl: process.env.FIREBERRY_BASE_URL || "https://api.fireberry.com",
  },
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "cmtm-verify-7421",
  },
  groqKey: process.env.GROQ_API_KEY || "", // לתמלול הודעות קוליות (Whisper)
  nudge: {
    afterHours: Number(process.env.NUDGE_AFTER_HOURS || 18), // תזכורת לליד שנעלם באמצע שיחה
    maxHours: Number(process.env.NUDGE_MAX_HOURS || 23), // עד סגירת חלון ה-24 שעות
  },
  drip: {
    enabled: process.env.DRIP_ENABLED !== "false", // מתג כיבוי לשליחת תבניות חימום
    stepDays: Number(process.env.DRIP_STEP_DAYS || 3), // מרווח בין הודעות חימום
    quietHours: Number(process.env.DRIP_QUIET_HOURS || 48), // לא לשלוח אם ענה לאחרונה
    checkMinutes: Number(process.env.DRIP_CHECK_MINUTES || 60), // תדירות בדיקת הסקדולר
  },
  links: {
    tasteLesson: process.env.LINK_TASTE_LESSON || "https://cmtm.co.il/free-lessons/",
    webinar: process.env.LINK_WEBINAR || "https://cmtm.co.il/free-lessons/",
    introA: process.env.LINK_INTRO_A || "",
    introB: process.env.LINK_INTRO_B || "",
  },
};
