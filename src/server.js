// שרת webhook. מסלולים:
//   GET  /health         — בדיקת חיים
//   GET  /whatsapp       — אימות webhook מול Meta
//   POST /whatsapp       — הודעות נכנסות מ-Meta (הבוט עונה ושולח דרך Meta)
//   POST /webhook        — נקודת קצה גנרית (Make/Wizup/בדיקות) — מחזירה reply ב-JSON
import http from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config, ROOT } from "./config.js";
import { handleMessage } from "./brain.js";
import { updateLead as fireberryUpdate, findAccountByPhone, logConversation, touchReturningLead } from "./fireberry.js";
import { verifyWebhook, parseIncoming, sendText, activeToken, sendTypingIndicator, downloadMedia, transcribeAudio } from "./whatsapp.js";
import {
  alreadyProcessed,
  getHistory,
  pushTurn,
  getLead,
  updateLead,
  enrollLead,
  allLeads,
  setRuntimeToken,
  setFireberryToken,
  setGroqToken,
  isPaused,
  setPaused,
  deleteLead,
  logFailure,
  getFailures,
  saveReport,
  latestReport,
} from "./store.js";
import { startSequence, startDripScheduler } from "./drip.js";

// המרת טלפון לפורמט וואטסאפ בינלאומי: 0546641264 → 972546641264
const normalizePhone = (p) => {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("972")) return d;
  if (d.startsWith("0")) return "972" + d.slice(1);
  if (d.length === 9) return "972" + d; // חסר 0 מוביל
  return d;
};

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
  if (isPaused()) {
    console.log(`⏸️ הבוט מושהה — מתעלם מהודעה מ-${msg.name || msg.from}`);
    return;
  }
  // הודעה קולית: מורידים ומתמללים, וממשיכים כאילו נכתבה בטקסט
  if (msg.type === "audio" && msg.audioId) {
    sendTypingIndicator(msg.id);
    const media = await downloadMedia(msg.audioId);
    const transcript = media ? await transcribeAudio(media.buffer, media.mime) : null;
    if (transcript) {
      msg.text = transcript;
      msg.type = "text";
      console.log(`🎤 תומלל (${msg.from}): ${transcript}`);
    } else {
      await sendText(msg.from, "שמעתי שהשארת הודעה קולית 🙂 כרגע נוח לי יותר עם טקסט, אפשר לכתוב לי כאן? ואם נוח לך יותר לדבר, אשמח לתאם שיחה עם יועצת.");
      return;
    }
  }
  if (msg.type !== "text" || !msg.text) {
    await sendText(msg.from, "היי 🙂 כרגע אני יודעת לקרוא הודעות טקסט, כתבו לי ואשמח לעזור בכל שאלה על הלימודים!");
    return;
  }
  console.log(`📩 ${msg.name || msg.from} (${msg.from}): ${msg.text}`);
  sendTypingIndicator(msg.id); // "מקליד..." בזמן שנועה חושבת
  const lead = getLead(msg.from, msg.name);
  const history = getHistory(msg.from); // ההיסטוריה לפני התור הנוכחי
  let decision;
  try {
    decision = await handleMessage(lead, history, msg.text);
  } catch (err) {
    // גם אחרי ניסיונות חוזרים נכשל — הליד לא נשאר בלי מענה
    console.error(`❌ עיבוד נכשל ל-${msg.from}:`, err.message);
    logFailure({ phone: msg.from, name: msg.name, text: msg.text, error: err.message });
    await sendText(
      msg.from,
      "היי 🙂 קיבלתי את ההודעה שלך ומשהו קטן השתבש לי בדרך. אשמח אם תוכל/י לכתוב שוב, או שפשוט אעביר אותך ליועצת שלנו שתחזור אליך. מה נוח לך?"
    );
    return;
  }
  // עדכון מצב: ליד שענה משהה את רצף החימום
  const l = updateLead(msg.from, {
    persona: decision.persona,
    scoreDelta: decision.score_delta,
    lastInboundTs: Date.now(),
    lastIntent: decision.intent,
    nudgedTs: 0, // ענה — אפשר יהיה לתזכר שוב אם ייעלם שוב
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
  // שמירת השיחה ב-Fireberry (אסינכרוני, לא חוסם את המענה ללקוח)
  (async () => {
    let accId = l.fireberryId;
    if (!accId) {
      accId = await findAccountByPhone(msg.from);
      if (accId) updateLead(msg.from, { fireberryId: accId });
    }
    await logConversation(accId, msg.text, decision.reply, msg.name);
    // "פנייה חוזרת" לנציגים — רק כשהליד באמת רוצה שידברו איתו
    // (ביקש נציג / סימן קנייה / הועבר), לא על כל תגובה סתמית
    const wantsContact =
      decision.handoff || ["buying_signal", "request_human"].includes(decision.intent);
    if (accId && wantsContact) await touchReturningLead(accId);
  })().catch((e) => console.error("[fireberry] log:", e.message));
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

  // דאשבורד — דף מעקב לידים (HTML)
  if (req.method === "GET" && path === "/dashboard") {
    try {
      const html = readFileSync(join(ROOT, "dashboard.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    } catch {
      return send(res, 500, { error: "dashboard.html חסר" });
    }
  }

  // נתוני דאשבורד (JSON) — מוגן בסוד
  if (req.method === "GET" && path === "/admin/data") {
    if (url.searchParams.get("secret") !== config.webhookSecret) {
      return send(res, 401, { error: "unauthorized" });
    }
    const leads = allLeads().map((l) => ({
      phone: l.id,
      name: l.name || "",
      persona: l.persona || "unknown",
      score: l.score || 0,
      status: l.status,
      seqStep: l.seqStep,
      source: l.source || "inbound",
      msgCount: Math.floor((l.history?.length || 0) / 2),
      createdTs: l.createdTs || 0,
      lastInboundTs: l.lastInboundTs || 0,
      lastDripTs: l.lastDripTs || 0,
    }));
    return send(res, 200, {
      now: Date.now(),
      dripEnabled: config.drip.enabled,
      paused: isPaused(),
      failures: getFailures().slice(-20),
      report: latestReport(),
      leads,
    });
  }

  // אבחון (מוגן בסוד): ?secret=...
  if (req.method === "GET" && path === "/admin") {
    if (url.searchParams.get("secret") !== config.webhookSecret) {
      return send(res, 401, { error: "unauthorized" });
    }
    let tokenValid = false, tokenErr = "";
    try {
      const r = await fetch(
        `https://graph.facebook.com/v21.0/${config.whatsapp.phoneNumberId}?fields=display_phone_number`,
        { headers: { authorization: `Bearer ${activeToken()}` } }
      );
      tokenValid = r.ok;
      if (!r.ok) tokenErr = (await r.text()).slice(0, 200);
    } catch (e) {
      tokenErr = e.message;
    }
    const leads = allLeads().map((l) => ({
      phone: l.id, name: l.name, status: l.status, step: l.seqStep, lastInboundTs: l.lastInboundTs,
    }));
    return send(res, 200, {
      tokenValid,
      tokenErr,
      phoneNumberId: config.whatsapp.phoneNumberId,
      dripEnabled: config.drip.enabled,
      paused: isPaused(),
      leadCount: leads.length,
      leads,
    });
  }

  // שמירת דוח סקירה שבועית (נכתב ע"י הסוכן המתוזמן)
  if (req.method === "POST" && path === "/admin/report") {
    let body;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return send(res, 400, { error: "invalid json" });
    }
    if (body.secret !== config.webhookSecret) {
      return send(res, 401, { error: "unauthorized" });
    }
    if (!body.text || body.text.length < 20) return send(res, 400, { error: "text חסר" });
    saveReport(String(body.text).slice(0, 8000));
    return send(res, 200, { saved: true });
  }

  // איפוס ליד (לבדיקות) — מוחק כדי שאפשר להתחיל רצף מחדש
  if (req.method === "POST" && path === "/admin/reset") {
    let body;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return send(res, 400, { error: "invalid json" });
    }
    if (body.secret !== config.webhookSecret) {
      return send(res, 401, { error: "unauthorized" });
    }
    const phone = normalizePhone(body.phone);
    const deleted = deleteLead(phone);
    return send(res, 200, { deleted, phone });
  }

  // השהיה/הפעלה של הבוט מרחוק (מוגן בסוד)
  if (req.method === "POST" && path === "/admin/pause") {
    let body;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return send(res, 400, { error: "invalid json" });
    }
    if (body.secret !== config.webhookSecret) {
      return send(res, 401, { error: "unauthorized" });
    }
    setPaused(!!body.paused);
    return send(res, 200, { paused: isPaused() });
  }

  // עדכון טוקן וואטסאפ מרחוק (מוגן בסוד) — מעדכן בלי לגעת ב-Render
  if (req.method === "POST" && path === "/admin/token") {
    let body;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return send(res, 400, { error: "invalid json" });
    }
    if (body.secret !== config.webhookSecret) {
      return send(res, 401, { error: "unauthorized" });
    }
    const updated = [];
    if (body.token && body.token.length >= 30) {
      setRuntimeToken(body.token);
      updated.push("whatsapp");
    }
    if (body.fireberryToken && body.fireberryToken.length >= 10) {
      setFireberryToken(body.fireberryToken);
      updated.push("fireberry");
    }
    if (body.groqToken && body.groqToken.length >= 10) {
      setGroqToken(body.groqToken);
      updated.push("groq");
    }
    if (!updated.length) return send(res, 400, { error: "לא סופק טוקן תקין" });
    return send(res, 200, { updated });
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
    // קולט גם מ-body (JSON) וגם מ-query string (telephone/firstname/accountid)
    const q = url.searchParams;
    const phone = normalizePhone(body.phone || q.get("phone") || q.get("telephone") || "");
    if (phone.length < 9) return send(res, 400, { error: "טלפון לא תקין" });
    const name = body.name || q.get("name") || q.get("firstname") || "";
    const accId = body.accountId || body.fireberryId || q.get("accountId") || q.get("accountid") || "";
    const lead = enrollLead(phone, name, accId);
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
