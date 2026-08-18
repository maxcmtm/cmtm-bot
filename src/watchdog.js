// כלב שמירה: בודק כל שעה את בריאות המערכת ומתריע למקס בוואטסאפ.
// התראות: קרדיט Anthropic נגמר · טוקן וואטסאפ עומד לפוג (7 ימים מראש) · דירוג מספר ירד.
import { config } from "./config.js";
import { activeToken, sendText, sendTemplate, getNumberQuality } from "./whatsapp.js";
import { getLastAlert, setLastAlert } from "./store.js";

const ADMIN = process.env.ADMIN_PHONE || "972546641264"; // מקס
const APP_ID = process.env.META_APP_ID || "853661220700010";
const APP_SECRET = process.env.META_APP_SECRET || "b2562eb95ce8af11998dec5e8b969363";
const GRAPH = "https://graph.facebook.com/v21.0";

// שולח התראה למקס, עם מניעת הצפה (פעם ב-X שעות לכל סוג תקלה)
export async function alertAdmin(key, text, everyHours = 24) {
  try {
    const last = getLastAlert(key);
    if (last && Date.now() - last < everyHours * 3600000) return;
    let sent = await sendText(ADMIN, `🤖 התראת מערכת מהבוט של תרפיית מימדים:\n\n${text}`);
    if (!sent.ok && !sent.dryRun) {
      // מחוץ לחלון 24ש — מנסים דרך תבנית מאושרת
      sent = await sendTemplate(ADMIN, "system_alert", [text.slice(0, 500)]);
    }
    if (sent.ok || sent.dryRun) {
      setLastAlert(key);
      console.log(`🚨 התראת מערכת נשלחה למקס: ${key}`);
    }
  } catch (e) {
    console.error("[watchdog] alert:", e.message);
  }
}

// תוקף הטוקן דרך debug_token (עם app token שלא פג לעולם)
async function checkWhatsAppToken() {
  const tok = activeToken();
  if (!tok) return;
  const r = await fetch(
    `${GRAPH}/debug_token?input_token=${encodeURIComponent(tok)}&access_token=${APP_ID}|${APP_SECRET}`
  );
  if (!r.ok) return;
  const data = (await r.json())?.data;
  if (!data) return;
  if (data.is_valid === false) {
    await alertAdmin("wa_token_dead",
      "🔴 הטוקן של וואטסאפ פג! הבוט לא יכול לשלוח הודעות בכלל.\nצריך טוקן חדש מ-developers.facebook.com → Chat Bot → API Setup → Temporary token, ולשלוח אותו לקלוד.", 6);
    return;
  }
  const exp = Number(data.expires_at || 0) * 1000;
  if (!exp) return; // טוקן ללא תפוגה
  const daysLeft = (exp - Date.now()) / 86400000;
  if (daysLeft <= 7) {
    await alertAdmin("wa_token_expiring",
      `🟡 הטוקן של וואטסאפ יפוג בעוד ${Math.max(0, Math.round(daysLeft))} ימים.\nכדי שהבוט לא ישתתק: קח טוקן חדש מ-developers.facebook.com → Chat Bot → API Setup, ושלח לקלוד לחידוש.`, 24);
  }
}

// דירוג איכות המספר
async function checkQuality() {
  const q = await getNumberQuality();
  if (q === "RED") {
    await alertAdmin("quality_red", "🔴 דירוג איכות המספר ירד ל-RED! שליחת התבניות נעצרה אוטומטית עד התאוששות.", 12);
  } else if (q === "YELLOW") {
    await alertAdmin("quality_yellow", "🟡 דירוג איכות המספר ירד ל-YELLOW. הבוט עבר אוטומטית לחצי קצב שליחה. שווה לעקוב בדאשבורד.", 24);
  }
}

export async function runWatchdog() {
  await checkWhatsAppToken().catch((e) => console.error("[watchdog] token:", e.message));
  await checkQuality().catch((e) => console.error("[watchdog] quality:", e.message));
}
