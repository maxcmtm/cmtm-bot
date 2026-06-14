// עדכון כרטיס ליד ב-Fireberry. כברירת מחדל "יבש" (לוג בלבד) עד שמוזן טוקן.
// כשמוזן FIREBERRY_API_TOKEN — מעדכן את שדות ה-wa_* האמיתיים.
import { config } from "./config.js";

// מיפוי שמות לוגיים → שמות שדה ב-Fireberry (לעדכן לפי השדות שתיצרו בפועל)
const FIELD_MAP = {
  wa_status: "wa_status",
  wa_persona: "wa_persona",
  wa_score: "wa_score",
  wa_last_reply: "wa_last_reply",
  wa_summary: "wa_summary",
  wa_seq_step: "wa_seq_step",
  wa_last_sent: "wa_last_sent",
};

/**
 * מעדכן שדות על ליד ב-Fireberry.
 * @param {string} leadId - מזהה הרשומה ב-Fireberry
 * @param {object} fields - שדות לוגיים לעדכון, למשל { wa_score: 45, wa_status: 'hot' }
 */
export async function updateLead(leadId, fields) {
  const mapped = {};
  for (const [k, v] of Object.entries(fields)) {
    mapped[FIELD_MAP[k] || k] = v;
  }

  if (!config.fireberry.token) {
    console.log(`[fireberry:DRY] עדכון ליד ${leadId}:`, JSON.stringify(mapped));
    return { dryRun: true };
  }

  // Fireberry Object API — עדכון רשומה (סוג אובייקט "ליד"/Lead).
  // התאם את ה-path/objectType לפי החשבון שלך (ראו תיעוד Fireberry / api.fireberry.com).
  const res = await fetch(`${config.fireberry.baseUrl}/api/record/Lead/${leadId}`, {
    method: "PUT",
    headers: {
      tokenid: config.fireberry.token,
      "content-type": "application/json",
    },
    body: JSON.stringify(mapped),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error(`[fireberry] שגיאת עדכון ${res.status}: ${t}`);
    return { ok: false, status: res.status };
  }
  return { ok: true };
}
