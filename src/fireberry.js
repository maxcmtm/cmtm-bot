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

// מציאת מזהה תלמיד (Account) לפי טלפון — בודק כמה פורמטים נפוצים
// (05..., 972..., +972..., עם מקף) כדי לא לפספס כרטיס קיים וליצור כפול.
export async function findAccountByPhone(phone) {
  if (!token()) return null;
  const local = waToIsraeli(phone); // 0546641264
  const intl = "972" + local.slice(1);
  const candidates = [local, intl, "+" + intl, local.slice(0, 3) + "-" + local.slice(3)];
  for (const cand of candidates) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(`${BASE}/api/query`, {
          method: "POST",
          headers: { tokenid: token(), "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            objecttype: 1,
            page_size: 1,
            fields: "accountid,firstname,telephone1,statuscode",
            query: `(telephone1 = '${cand}')`,
          }),
        });
        if (r.status === 429) { await new Promise((x) => setTimeout(x, 15000)); continue; } // עומס — מנסים שוב, לא מוותרים
        if (!r.ok) break;
        const recs = (await r.json())?.data?.Data || [];
        if (recs[0]?.accountid) return recs[0].accountid;
        break; // תשובה תקינה בלי תוצאה — עוברים לפורמט הבא
      } catch {
        await new Promise((x) => setTimeout(x, 5000));
      }
    }
  }
  return null;
}

// סטטוסים "מוגנים" שלא דורסים: בתהליך רישום(18), מעוניין בשיעור התנסות(21),
// תלמיד פעיל(22), נשר-פעיל לשעבר(27), ERN נכשל(28)
const PROTECTED_STATUSES = new Set([18, 21, 22, 27, 28]);
const STATUS_RETURNING = 23; // פנייה חוזרת

// ליד קיים שכתב שוב: מעדכנים את אותה רשומה — תאריך פנייה אחרונה=עכשיו,
// וסטטוס "פנייה חוזרת" (אלא אם הוא בסטטוס מוגן). לא יוצרים ליד חדש!
export async function touchReturningLead(accountId) {
  if (!token() || !accountId) return { skipped: true };
  try {
    // שליפת הסטטוס הנוכחי
    const r = await fetch(`${BASE}/api/record/1/${accountId}`, {
      headers: { tokenid: token(), accept: "application/json" },
    });
    if (!r.ok) return { ok: false };
    const rec = (await r.json())?.data?.Record || {};
    const cur = Number(rec.statuscode);

    // תאריך פנייה אחרונה = עכשיו (שעון ישראל, פורמט Fireberry)
    const now = new Date()
      .toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" })
      .replace(" ", "T");
    const body = { pcfsystemfield241: now };
    let statusChanged = false;
    if (!PROTECTED_STATUSES.has(cur) && cur !== STATUS_RETURNING) {
      body.statuscode = STATUS_RETURNING;
      statusChanged = true;
    }

    const u = await fetch(`${BASE}/api/record/1/${accountId}`, {
      method: "PUT",
      headers: { tokenid: token(), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!u.ok) {
      console.error(`[fireberry] עדכון פנייה חוזרת נכשל ${u.status}: ${(await u.text()).slice(0, 120)}`);
      return { ok: false };
    }
    if (statusChanged) console.log(`🔁 פנייה חוזרת עודכנה ב-Fireberry (${accountId})`);
    return { ok: true, statusChanged };
  } catch (e) {
    console.error("[fireberry] touchReturningLead:", e.message);
    return { ok: false };
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

// סיכום שיחת הבוט ב-CRM: רשומת "וואטסאפ" אחת פר-ליד שמתעדכנת (במקום רשומה לכל הודעה)
export async function upsertBotSummary(accountId, summaryText, existingRecordId) {
  if (!token() || !accountId || !summaryText) return existingRecordId || null;
  try {
    if (existingRecordId) {
      const u = await fetch(`${BASE}/api/record/1012/${existingRecordId}`, {
        method: "PUT",
        headers: { tokenid: token(), "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ pcfsystemfield112: summaryText }),
      });
      if (u.ok) return existingRecordId;
      // אם הרשומה נמחקה — ניצור חדשה
    }
    const c = await fetch(`${BASE}/api/record/1012`, {
      method: "POST",
      headers: { tokenid: token(), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        name: "🤖 סיכום שיחת וואטסאפ (בוט, מתעדכן)",
        pcfsystemfield102: accountId,
        pcfsystemfield112: summaryText,
      }),
    });
    if (!c.ok) return null;
    return (await c.json())?.data?.Record?.customobject1012id || null;
  } catch (e) {
    console.error("[fireberry] upsertBotSummary:", e.message);
    return existingRecordId || null;
  }
}

// יצירת כרטיס תלמיד חדש ב-CRM (לליד וואטסאפ ישיר שנהיה חם ואין לו כרטיס)
export async function createAccount(name, phone) {
  if (!token()) return null;
  // בדיקה אחרונה לפני יצירה — לעולם לא יוצרים כפול
  const existing = await findAccountByPhone(phone);
  if (existing) return existing;
  try {
    const r = await fetch(`${BASE}/api/record/1`, {
      method: "POST",
      headers: { tokenid: token(), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        accountname: name || waToIsraeli(phone),
        telephone1: waToIsraeli(phone),
        statuscode: 23, // פנייה חוזרת — נכנס ישר לתור הנציגים
      }),
    });
    if (!r.ok) {
      console.error(`[fireberry] יצירת כרטיס נכשלה ${r.status}: ${(await r.text()).slice(0, 120)}`);
      return null;
    }
    const id = (await r.json())?.data?.Record?.accountid || null;
    if (id) console.log(`🆕 נפתח כרטיס ב-Fireberry לליד וואטסאפ ישיר: ${name || phone}`);
    return id;
  } catch (e) {
    console.error("[fireberry] createAccount:", e.message);
    return null;
  }
}

// ===== "הוסר מרשימת דיוור" (pcfsystemfield274) — ציות דיוור =====

// בדיקה לפי טלפון: האם הליד מסומן ב-CRM כמי שאסור לשווק אליו
export async function isOptedOutByPhone(phone) {
  if (!token()) return { accountId: null, optedOut: false };
  const local = waToIsraeli(phone);
  try {
    const r = await fetch(`${BASE}/api/query`, {
      method: "POST",
      headers: { tokenid: token(), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        objecttype: 1,
        page_size: 1,
        fields: "accountid,pcfsystemfield274",
        query: `(telephone1 = '${local}')`,
      }),
    });
    if (!r.ok) return { accountId: null, optedOut: false };
    const recs = (await r.json())?.data?.Data || [];
    if (!recs.length) return { accountId: null, optedOut: false };
    const v = recs[0].pcfsystemfield274;
    return { accountId: recs[0].accountid, optedOut: v === "1" || v === 1 || v === "כן" };
  } catch {
    return { accountId: null, optedOut: false };
  }
}

// סימון "הוסר מרשימת דיוור = כן" ב-CRM (כשמישהו מבקש הסרה בבוט)
export async function markOptedOut(accountId) {
  if (!token() || !accountId) return { skipped: true };
  try {
    const r = await fetch(`${BASE}/api/record/1/${accountId}`, {
      method: "PUT",
      headers: { tokenid: token(), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ pcfsystemfield274: "1" }),
    });
    if (r.ok) console.log(`🚫 סומן "הוסר מרשימת דיוור" ב-Fireberry (${accountId})`);
    return { ok: r.ok };
  } catch (e) {
    console.error("[fireberry] markOptedOut:", e.message);
    return { ok: false };
  }
}

// שמירת לגאסי לתאימות עם /webhook הישן (לא בשימוש פעיל)
export async function updateLead() {
  return { dryRun: true };
}

// ===== מנקה תאומים: מוחק כרטיסי-זבל שנוצרים ע"י אינטגרציה פגומה =====
// חתימת התאום (כל התנאים חייבים להתקיים — בטיחות לפני הכל):
//   1. בלי שם (ריק או "ללא שם")  2. סטטוס עדיין "חדש" (11)
//   3. הטלפון זהה לכרטיס אחר עם שם שנוצר באותן 2 דקות, או טלפון פגום (15+ ספרות)
export async function sweepTwinLeads(sinceHours = 3) {
  if (!token()) return { deleted: 0 };
  const cutoff = new Date(Date.now() - sinceHours * 3600000)
    .toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" }).replace(" ", "T");
  const recent = [];
  for (let page = 1; page <= 20; page++) {
    let recs = null;
    for (let att = 0; att < 4; att++) {
      try {
        const r = await fetch(`${BASE}/api/query`, {
          method: "POST",
          headers: { tokenid: token(), "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ objecttype: 1, page_size: 100, page_number: page,
            fields: "accountid,accountname,telephone1,createdon,statuscode",
            sort_by: "createdon", sort_type: "desc" }),
        });
        if (r.status === 429) { await new Promise((x) => setTimeout(x, 30000)); continue; }
        if (!r.ok) return { deleted: 0 };
        recs = (await r.json())?.data?.Data || [];
        break;
      } catch { await new Promise((x) => setTimeout(x, 10000)); }
    }
    if (!recs) return { deleted: 0 };
    let reachedCutoff = false;
    for (const x of recs) {
      if (x.createdon < cutoff) { reachedCutoff = true; break; }
      recent.push(x);
    }
    if (reachedCutoff || recs.length < 100) break;
    await new Promise((x) => setTimeout(x, 1500));
  }

  const nameless = (x) => !x.accountname || x.accountname.trim() === "" || x.accountname.trim() === "ללא שם";
  // בשאילתות statuscode חוזר כטקסט ("חדש ✨"), ב-GET כמספר — תומכים בשניהם
  const isNew = (x) => {
    const s = String(x.statuscode ?? "").trim();
    return s === "11" || s === "23" || s.startsWith("חדש") || s.startsWith("פנייה חוזרת");
  };
  const toDelete = [];
  for (const x of recent) {
    if (!nameless(x) || !isNew(x)) continue;
    const phone = String(x.telephone1 || "");
    if (phone.replace(/\D/g, "").length >= 15) { toDelete.push({ ...x, reason: "טלפון פגום" }); continue; }
    // תאום של כרטיס שמי עם אותו טלפון, שנוצר עד 2 דקות לפניו — והכרטיס השמי עדיין קיים
    const keeper = recent.find((k) => k.accountid !== x.accountid && !nameless(k) &&
      String(k.telephone1 || "") === phone &&
      Math.abs(new Date(x.createdon) - new Date(k.createdon)) < 120000);
    if (keeper) toDelete.push({ ...x, reason: `תאום של "${keeper.accountname}"` });
  }

  let deleted = 0;
  for (const x of toDelete) {
    try {
      const d = await fetch(`${BASE}/api/record/1/${x.accountid}`, {
        method: "DELETE", headers: { tokenid: token() } });
      if (d.ok) { deleted++; console.log(`🧹 נמחק תאום-זבל: טל ${x.telephone1} (${x.reason})`); }
    } catch {}
    await new Promise((r) => setTimeout(r, 1200));
  }
  if (deleted) console.log(`🧹 מנקה התאומים: נמחקו ${deleted} כרטיסי זבל`);
  return { deleted, scanned: recent.length };
}
