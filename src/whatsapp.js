// חיבור ישיר ל-Meta WhatsApp Cloud API — אימות webhook, פענוח הודעות, ושליחה.
import { config } from "./config.js";
import { getRuntimeToken, getGroqToken } from "./store.js";

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
          audioId: m.type === "audio" ? m.audio?.id || "" : "",
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

// הורדת מדיה (הודעה קולית וכו') מ-Meta: קודם מקבלים URL זמני, ואז את הקובץ עצמו
export async function downloadMedia(mediaId) {
  try {
    const meta = await fetch(`${GRAPH}/${mediaId}`, {
      headers: { authorization: `Bearer ${activeToken()}` },
    });
    if (!meta.ok) return null;
    const { url, mime_type } = await meta.json();
    const bin = await fetch(url, { headers: { authorization: `Bearer ${activeToken()}` } });
    if (!bin.ok) return null;
    return { buffer: Buffer.from(await bin.arrayBuffer()), mime: mime_type || "audio/ogg" };
  } catch (e) {
    console.error("[whatsapp] downloadMedia:", e.message);
    return null;
  }
}

// תמלול הודעה קולית בעברית (Groq Whisper). מחזיר null אם אין מפתח או שנכשל.
export async function transcribeAudio(buffer, mime) {
  const gk = getGroqToken() || config.groqKey;
  if (!gk) return null;
  try {
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mime }), "voice.ogg");
    form.append("model", "whisper-large-v3");
    form.append("language", "he");
    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${gk}` },
      body: form,
    });
    if (!r.ok) {
      console.error(`[transcribe] ${r.status}: ${(await r.text()).slice(0, 120)}`);
      return null;
    }
    const text = (await r.json()).text?.trim();
    return text || null;
  } catch (e) {
    console.error("[transcribe]", e.message);
    return null;
  }
}

// חיווי "מקליד..." + סימון ההודעה כנקראה. נמשך עד ~25 שניות או עד שליחת תשובה.
export async function sendTypingIndicator(messageId) {
  if (!activeToken() || !config.whatsapp.phoneNumberId || !messageId) return;
  try {
    await fetch(`${GRAPH}/${config.whatsapp.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${activeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: { type: "text" },
      }),
    });
  } catch {
    /* לא קריטי אם נכשל */
  }
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
