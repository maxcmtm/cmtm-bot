// אינטגרציה עם Fireberry: שמירת שיחות (אובייקט 1012 "וואטסאפ") + חיפוש תלמיד לפי טלפון.
import { config } from "./config.js";
import { getFireberryToken } from "./store.js";

const BASE = "https://api.fireberry.com";
function token() {
  return getFireberryToken() || config.fireberry.token;
}

// 972546641264 -> 0546641264 (פורמט ישראלי כפי שנשמר ב-Fireberry)
export function waToIsraeli(phone) {
  let p = String(phone || "").replace(/\D/g, "");
  if (p.startsWith("972")) p = "0" + p.slice(3);
  else if (!p.startsWith("0")) p = "0" + p;
  return p;
}

// מציאת מזהה תלמיד (Account) לפי טלפון. מחזיר accountid או null.
export async function findAccountByPhone(phone) {
  if (!token()) return null;
  const local = waToIsraeli(phone);
  try {
    const r = await fetch(`${BASE}/api/query`, {
      method: "POST",
      headers: { tokenid: token(), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        objecttype: 1,
        page_size: 1,
        fields: "accountid,firstname,telephone1",
        query: `(telephone1 = '${local}')`,
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const recs = d?.data?.Data || d?.data?.data || [];
    return recs[0]?.accountid || null;
  } catch {
    return null;
  }
}

// רישום תור שיחה ב-Fireberry (אובייקט 1012): הודעה נכנסת + יוצאת, מקושר לתלמיד.
export async function logConversation(accountId, incoming, outgoing, name = "") {
  if (!token()) {
    console.log(`[fireberry:DRY] שיחה: «${incoming}» → «${(outgoing || "").slice(0, 40)}»`);
    return { dryRun: true };
  }
  const body = {
    name: name || "שיחת בוט וואטסאפ",
    pcfsystemfield111: incoming || "", // הודעה נכנסת txt
    pcfsystemfield112: outgoing || "", // הודעה יוצאת txt
  };
  if (accountId) body.pcfsystemfield102 = accountId; // קישור ללקוח/תלמיד
  try {
    const r = await fetch(`${BASE}/api/record/1012`, {
      method: "POST",
      headers: { tokenid: token(), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.error(`[fireberry] רישום שיחה נכשל ${r.status}: ${(await r.text()).slice(0, 150)}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error("[fireberry] שגיאת רישום:", e.message);
    return { ok: false };
  }
}

// שמירת לגאסי לתאימות עם /webhook הישן (לא בשימוש פעיל)
export async function updateLead() {
  return { dryRun: true };
}
