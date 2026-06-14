// שרת webhook. מסלולים:
//   GET  /health         — בדיקת חיים
//   GET  /whatsapp       — אימות webhook מול Meta
//   POST /whatsapp       — הודעות נכנסות מ-Meta (הבוט עונה ושולח דרך Meta)
//   POST /webhook        — נקודת קצה גנרית (Make/Wizup/בדיקות) — מחזירה reply ב-JSON
import http from "node:http";
import { config } from "./config.js";
import { handleMessage } from "./brain.js";
import { updateLead as fireberryUpdate } from "./fireberry.js";
import { verifyWebhook, parseIncoming, sendText } from "./whatsapp.js";
import {
  alreadyProcessed,
  getHistory,
  pushTurn,
  getLead,
  updateLead,
  enrollLead,
} from "./store.js";
import { startSequence, startDripScheduler } from "./drip.js";

const normalizePhone = (p) => String(p || "").replace(/\D/g, "");

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(typeof obj === "string" ? obj : JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
    req.on("error", reject);
  });
}
function statusFromScore(score) {
  return score >= 70 ? "hot" : "active_chat";
}

// מעבד הודעת וואטסאפ אחת מ-Meta: מריץ את הבוט, שולח תשובה, מעדכן מצב
async function processWhatsApp(msg) {
  if (alreadyProcessed(msg.id)) return;
  if (msg.type !== "text" || !msg.text) {
    await sendText(msg.from, "היי 🙂 כרגע אני יודעת לקרוא הודעות טקסט — כתוב לי ואשמח לעזור בכל שאלה על הלימודים!");
    return;
  }
  console.log(`📩 ${msg.name || msg.from} (${msg.from}): ${msg.text}`);
  const lead = getLead(msg.from, msg.name);
  const history = getHistory(msg.from); // ההיסטוריה לפני התור הנוכחי
  const decision = await handleMessage(lead, history, msg.text);
  // עדכון מצב: ליד שענה משהה את רצף החימום
  const l = updateLead(msg.from, {
    persona: decision.persona,
    scoreDelta: decision.score_delta,
    lastInboundTs: Date.now(),
  });
  let status = "active_chat";
  if (decision.intent === "unsubscribe") status = "unsubscribed";
  else if (decision.handoff || l.score >= 70) status = "hot";
  updateLead(msg.from, { status });
  pushTurn(msg.from, msg.text, decision.reply);
  const sent = await sendText(msg.from, decision.reply);
  console.log(`💬 → ${msg.from}: ${decision.reply}  ${sent.ok ? "[נשלח✓]" : sent.dryRun ? "[יבש]" : "[שגיאת שליחה]"}`);
  if (decision.handoff || lead.score >= 70) {
    console.log(
      `🔥 ליד חם — ${lead.name || msg.from} (${msg.from}) | ציון=${lead.score} | פרסונה=${lead.persona} | סיבה=${decision.handoff_reason || "ציון גבוה"}`
    );
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${config.port}`);
  const path = url.pathname;
  if (path !== "/health") console.log(`→ ${req.method} ${path}${url.search}`);

  // בריאות
  if (req.method === "GET" && path === "/health") {
    return send(res, 200, {
      ok: true,
      model: config.model,
      mode: config.anthropicKey ? "live" : "mock",
      whatsapp: config.whatsapp.phoneNumberId ? "connected" : "not-configured",
    });
  }

  // אימות webhook של Meta
  if (req.method === "GET" && path === "/whatsapp") {
    const v = verifyWebhook(url.searchParams);
    if (v.ok) {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end(v.challenge);
    }
    return send(res, 403, { error: "verify token mismatch" });
  }

  // הודעות נכנסות מ-Meta
  if (req.method === "POST" && path === "/whatsapp") {
    let body;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return send(res, 400, { error: "invalid json" });
    }
    // עונים ל-Meta מיד (200) ומעבדים ברקע — מונע retries כפולים
    send(res, 200, { received: true });
    const messages = parseIncoming(body);
    for (const m of messages) {
      processWhatsApp(m).catch((e) => console.error("[whatsapp] process error:", e.message));
    }
    return;
  }

  // כניסת ליד חדש לרצף החימום (טופס אתר / Fireberry / Make)
  if (req.method === "POST" && path === "/lead") {
    if (config.webhookSecret && req.headers["x-bot-secret"] !== config.webhookSecret) {
      return send(res, 401, { error: "unauthorized" });
    }
    let body;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return send(res, 400, { error: "invalid json" });
    }
    const phone = normalizePhone(body.phone);
    if (phone.length < 9) return send(res, 400, { error: "טלפון לא תקין" });
    const lead = enrollLead(phone, body.name || "");
    startSequence(lead).catch((e) => console.error("[lead] startSequence:", e.message));
    return send(res, 200, { enrolled: true, phone, name: lead.name });
  }

  // נקודת קצה גנרית (Make/Wizup/בדיקות)
  if (req.method === "POST" && path === "/webhook") {
    if (config.webhookSecret && req.headers["x-bot-secret"] !== config.webhookSecret) {
      return send(res, 401, { error: "unauthorized" });
    }
    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return send(res, 400, { error: "invalid json" });
    }
    const lead = payload.lead || {};
    const incoming = payload.message || "";
    const history = Array.isArray(payload.history) ? payload.history : [];
    if (!incoming) return send(res, 400, { error: "message חסר" });
    try {
      const decision = await handleMessage(lead, history, incoming);
      const newScore = (lead.score ?? 0) + (decision.score_delta || 0);
      if (lead.id) {
        const fields = {
          wa_score: newScore,
          wa_persona: decision.persona,
          wa_last_reply: new Date().toISOString(),
        };
        if (decision.intent === "unsubscribe") fields.wa_status = "unsubscribed";
        else if (decision.handoff || newScore >= 70) fields.wa_status = "hot";
        else fields.wa_status = statusFromScore(newScore);
        if (decision.handoff) fields.wa_summary = decision.handoff_reason || "ליד חם";
        await fireberryUpdate(lead.id, fields);
      }
      return send(res, 200, {
        reply: decision.reply,
        persona: decision.persona,
        intent: decision.intent,
        new_score: newScore,
        handoff: decision.handoff,
        handoff_reason: decision.handoff_reason || "",
        status: lead.id
          ? decision.intent === "unsubscribe"
            ? "unsubscribed"
            : decision.handoff || newScore >= 70
            ? "hot"
            : statusFromScore(newScore)
          : undefined,
      });
    } catch (err) {
      console.error("[webhook] error:", err.message);
      return send(res, 500, { error: "bot failed", detail: err.message });
    }
  }

  return send(res, 404, { error: "not found" });
});

server.listen(config.port, () => {
  console.log(
    `🤖 בוט נועה רץ על http://localhost:${config.port}  (מודל: ${
      config.anthropicKey ? "LIVE" : "MOCK"
    } · WhatsApp: ${config.whatsapp.phoneNumberId ? "מחובר" : "לא מוגדר"})`
  );
  console.log("   GET /health · GET|POST /whatsapp · POST /webhook · POST /lead");
  startDripScheduler();
});
