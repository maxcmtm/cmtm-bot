// חיבור ישיר ל-Meta WhatsApp Cloud API — אימות webhook, פענוח הודעות, ושליחה.
import { config } from "./config.js";
import { getRuntimeToken } from "./store.js";

const GRAPH = "https://graph.facebook.com/v21.0";

// הטוקן הפעיל: עדכון בזמן ריצה גובר על משתנה הסביבה
export function activeToken() {
  return getRuntimeToken() || config.whatsapp.token;
}

// אימות ה-webhook מול Meta (הקריאה הראשונה כשמגדירים את הכתובת)
export function verifyWebhook(query) {
  const mode = query.get("hub.mode");
  const token = query.get("hub.verify_token");
  const challenge = query.get("hub.challenge");
  if (mode === "subscribe" && token === config.whatsapp.verifyToken) {
    return { ok: true, challenge };
  }
  return { ok: false };
}

// פענוח גוף ה-webhook של Meta → רשימת הודעות {from, name, text, id, type}
export function parseIncoming(body) {
  const out = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const nameByWa = {};
      for (const c of value.contacts || []) nameByWa[c.wa_id] = c.profile?.name;
      for (const m of value.messages || []) {
        out.push({
          from: m.from,
          name: nameByWa[m.from] || "",
          id: m.id,
          type: m.type,
          text: m.type === "text" ? m.text?.body || "" : "",
        });
      }
    }
  }
  return out;
}

// שליחת תבנית מאושרת (Marketing) ללקוח. params = מערך ערכים ל-{{1}}, {{2}}...
export async function sendTemplate(to, templateName, params = []) {
  if (!activeToken() || !config.whatsapp.phoneNumberId) {
    console.log(`[whatsapp:DRY] תבנית ${templateName} → ${to} (${params.join(",")})`);
    return { dryRun: true };
  }
  const components = params.length
    ? [{ type: "body", parameters: params.map((t) => ({ type: "text", text: String(t) })) }]
    : [];
  const res = await fetch(`${GRAPH}/${config.whatsapp.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${activeToken()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: templateName, language: { code: "he" }, components },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error(`[whatsapp] template ${templateName} → ${res.status}: ${t}`);
    return { ok: false, status: res.status };
  }
  return { ok: true };
}

// שליחת הודעת טקסט (session) ללקוח דרך Meta. יבש אם אין טוקן.
export async function sendText(to, text) {
  if (!activeToken() || !config.whatsapp.phoneNumberId) {
    console.log(`[whatsapp:DRY] → ${to}: ${text}`);
    return { dryRun: true };
  }
  const res = await fetch(`${GRAPH}/${config.whatsapp.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${activeToken()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: text },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error(`[whatsapp] send ${res.status}: ${t}`);
    return { ok: false, status: res.status };
  }
  return { ok: true };
}
