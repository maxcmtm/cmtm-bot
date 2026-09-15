// אירועי CRM → תבניות שירות. האוטומציה ב-Fireberry שולחת רק {event, accountId|phone, ...קישורים},
// והבוט שולף מה-CRM את השם, סוג הקורס, מין, מחזור, תאריך, שעות ומיקום, ובוחר את התבנית הנכונה.
import { config } from "./config.js";
import { getFireberryToken } from "./store.js";
import { sendTemplate } from "./whatsapp.js";

const BASE = "https://api.fireberry.com";
const token = () => getFireberryToken() || config.fireberry.token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtDate = (iso) => { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}.${m}.${y}`; };
const toIntl = (p) => { p = String(p || "").replace(/\D/g, ""); return p.startsWith("0") ? "972" + p.slice(1) : p; };
const DEFAULT_LOCATION = "המגשימים 20, פתח תקווה (בניין מטלון A, קומה 1)";

async function fb(method, path, body) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${BASE}${path}`, {
      method, headers: { tokenid: token(), "content-type": "application/json", accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 429) { await sleep(15000); continue; }
    if (!r.ok) return null;
    return (await r.json())?.data;
  }
  return null;
}

// כרטיס תלמיד + ההרשמה האחרונה + המחזור
export async function loadStudentContext({ accountId, phone }) {
  let acc = null;
  if (accountId) acc = (await fb("GET", `/api/record/1/${accountId}`))?.Record || null;
  if (!acc && phone) {
    const local = "0" + toIntl(phone).slice(3);
    const d = await fb("POST", "/api/query", { objecttype: 1, page_size: 1, fields: "accountid,accountname,firstname,telephone1", query: `(telephone1 = '${local}')` });
    acc = (d?.Data || [])[0] || null;
  }
  if (!acc) return null;
  const regs = (await fb("POST", "/api/query", {
    objecttype: 33, page_size: 3, fields: "accountproductid,pcfsystemfield251,pcfsystemfield53,pcfsystemfield205,pcfsystemfield129",
    query: `(accountid = '${acc.accountid}')`, sort_by: "createdon", sort_type: "desc",
  }))?.Data || [];
  const reg = regs[0] || null;
  let cycle = null;
  if (reg?.pcfsystemfield53) cycle = (await fb("GET", `/api/record/1000/${reg.pcfsystemfield53}`))?.Record || null;
  const firstName = (acc.firstname || acc.accountname || "").trim().split(/\s+/)[0] || "";
  const course = reg?.pcfsystemfield251 || "";
  const gender = String(reg?.pcfsystemfield205 || "").includes("גבר") || reg?.pcfsystemfield205 === 2 ? "men" : "women";
  const isDigital = /דיגיטל/.test(course) && !/זום|פרונטל/.test(course);
  const hoursLabel = cycle ? (String(cycle.pcfsystemfield212) === "2" ? "ערב" : String(cycle.pcfsystemfield212) === "1" ? "בוקר" : String(cycle.pcfsystemfield212 || "")) : "";
  return {
    accountId: acc.accountid, phone: toIntl(acc.telephone1), firstName, course, gender, isDigital,
    cycleName: cycle?.name || "", startDate: fmtDate(cycle?.pcfsystemfield33), hours: [cycle?.name?.match(/יום\s\S+/)?.[0], hoursLabel].filter(Boolean).join(" "),
    location: cycle?.pcfsystemfield197 || DEFAULT_LOCATION,
  };
}

// אירוע → תבנית + משתנים
export function pickTemplate(event, ctx, extra = {}) {
  const name = ctx.firstName || "";
  switch (event) {
    case "registered": // הרשמה אושרה → ברוכים הבאים לפי סוג קורס ומין
      if (ctx.isDigital) return { template: ctx.gender === "men" ? "welcome_digital_men_updated" : "digital_women_welcome", params: [name] };
      return { template: ctx.gender === "men" ? "frontal_men_welcome_updated" : "frontal_women_welcome_updated", params: [name, ctx.startDate || "יעודכן", ctx.hours || "יעודכן", ctx.location] };
    case "registered_year2": return { template: ctx.gender === "men" ? "welcome_digital_men_last" : "welcome_digital_women_last", params: [name] };
    case "paid": return { template: "payment_accepted", params: [name, extra.link || ""] };
    case "invoice": return { template: "invoice_sent", params: [name, extra.link || ""] };
    case "document": return { template: "document_ready", params: [name, extra.doc || "המסמך"] };
    case "certificate": return { template: "study_certificate", params: [name] };
    case "books": return { template: "books_shipped", params: [name, extra.note || ""] };
    case "course_update": return { template: "course_update_generic", params: [name, extra.course || ctx.course || "הקורס", extra.oldDate || "", extra.newDate || ""] };
    case "class_reminder": return { template: "class_reminder_generic", params: [name, extra.course || ctx.course || "השיעור", extra.when || "", extra.details || ""] };
    case "service_open": return { template: "service_open", params: [name] };
    case "followup": return { template: "followup_reply", params: [name] };
    default: return null;
  }
}

export async function handleCrmEvent(body) {
  const ctx = await loadStudentContext({ accountId: body.accountId || body.accountid, phone: body.phone || body.telephone });
  if (!ctx || !ctx.phone) return { ok: false, error: "לא נמצא תלמיד ב-CRM" };
  const pick = pickTemplate(String(body.event || "").trim(), ctx, body);
  if (!pick) return { ok: false, error: `אירוע לא מוכר: ${body.event}` };
  if (pick.params.some((p) => p === "")) return { ok: false, error: `חסר משתנה לתבנית ${pick.template}: ${JSON.stringify(pick.params)}`, ctx };
  const r = await sendTemplate(ctx.phone, pick.template, pick.params);
  return { ok: !!(r.ok || r.dryRun), template: pick.template, params: pick.params, phone: ctx.phone, ctx };
}
