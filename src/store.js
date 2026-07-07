// אחסון לידים מתמשך (קובץ JSON על דיסק, שורד ריסטארט).
// כל ליד: phone, name, persona, score, status, seqStep, היסטוריה, חותמות זמן.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.js";

const FILE = join(DATA_DIR, "leads.json");
const MAX_TURNS = 16;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

let state = { leads: {}, seen: [] }; // seen = message ids שטופלו
try {
  if (existsSync(FILE)) state = JSON.parse(readFileSync(FILE, "utf8"));
} catch (e) {
  console.error("[store] קריאת leads.json נכשלה, מתחיל ריק:", e.message);
}
if (!state.leads) state.leads = {};
if (!state.seen) state.seen = [];
if (!state.runtime) state.runtime = {}; // הגדרות שניתן לעדכן בזמן ריצה (למשל טוקן)

// מיגרציה חד-פעמית: תיוג מקור ללידים ישנים (לפני הוספת השדה)
// ליד שנשלחה לו הודעת חימום (lastDripTs) או שממתין ברצף — נכנס דרך הפלואו; אחרת פנייה נכנסת
for (const l of Object.values(state.leads)) {
  if (!l.source) {
    l.source = l.lastDripTs > 0 || l.status === "in_sequence" ? "drip" : "inbound";
  }
}

// טוקן וואטסאפ שעודכן בזמן ריצה (גובר על משתנה הסביבה). שורד ריסטארט (על הדיסק).
export function getRuntimeToken() {
  return state.runtime?.whatsappToken || "";
}
export function setRuntimeToken(t) {
  state.runtime.whatsappToken = t || "";
  save();
}
export function getFireberryToken() {
  return state.runtime?.fireberryToken || "";
}
export function setFireberryToken(t) {
  state.runtime.fireberryToken = t || "";
  save();
}
// יומן כשלים — הודעות שלא קיבלו מענה מלא (נשמר לתחקור והצגה בדאשבורד)
export function logFailure(entry) {
  if (!state.failures) state.failures = [];
  state.failures.push({ ...entry, ts: Date.now() });
  if (state.failures.length > 100) state.failures = state.failures.slice(-50);
  save();
}
export function getFailures() {
  return state.failures || [];
}

// מתג השהיה זמני — כשפעיל, הבוט לא עונה ולא שולח חימום
export function isPaused() {
  return !!state.runtime?.paused;
}
export function setPaused(b) {
  state.runtime.paused = !!b;
  save();
}

let saveTimer = null;
function save() {
  // דחיית כתיבה קצרה כדי לא לכתוב על כל שינוי
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      writeFileSync(FILE, JSON.stringify(state, null, 2));
    } catch (e) {
      console.error("[store] שמירה נכשלה:", e.message);
    }
  }, 300);
}

export function alreadyProcessed(id) {
  if (!id) return false;
  if (state.seen.includes(id)) return true;
  state.seen.push(id);
  if (state.seen.length > 3000) state.seen = state.seen.slice(-1500);
  save();
  return false;
}

export function getLead(phone, name) {
  let l = state.leads[phone];
  if (!l) {
    l = {
      id: phone,
      name: name || "",
      persona: "unknown",
      score: 0,
      status: "active_chat", // ליד שכתב מיוזמתו
      seqStep: 0,
      history: [],
      fireberryId: "",
      source: "inbound", // פנה מיוזמתו בוואטסאפ (לא דרך פלואו החימום)
      lastInboundTs: Date.now(),
      lastDripTs: 0,
      createdTs: Date.now(),
    };
    state.leads[phone] = l;
    save();
  }
  if (name && !l.name) {
    l.name = name;
    save();
  }
  return l;
}

export function getHistory(phone) {
  return state.leads[phone]?.history || [];
}

export function pushTurn(phone, userText, botText) {
  const l = getLead(phone);
  l.history.push({ role: "user", content: userText });
  l.history.push({ role: "assistant", content: botText });
  while (l.history.length > MAX_TURNS) l.history.shift();
  save();
}

// הוספת תור "נציג" בודד להיסטוריה (למשל תוכן תבנית שנשלחה) כדי לשמור רצף שיחה
export function pushAssistantTurn(phone, text) {
  const l = getLead(phone);
  l.history.push({ role: "assistant", content: text });
  while (l.history.length > MAX_TURNS) l.history.shift();
  save();
}

export function updateLead(phone, fields = {}) {
  const l = getLead(phone);
  if (fields.persona && fields.persona !== "unknown") l.persona = fields.persona;
  if (fields.scoreDelta) l.score += fields.scoreDelta;
  for (const k of ["status", "seqStep", "lastInboundTs", "lastDripTs", "name", "fireberryId"]) {
    if (k in fields) l[k] = fields[k];
  }
  save();
  return l;
}

// כל הלידים (למנוע החימום)
export function allLeads() {
  return Object.values(state.leads);
}

// מחיקת ליד (לבדיקות / איפוס)
export function deleteLead(phone) {
  if (state.leads[phone]) {
    delete state.leads[phone];
    save();
    return true;
  }
  return false;
}

// יצירת ליד חדש לרצף החימום (מטופס/CRM) אם לא קיים
export function enrollLead(phone, name, fireberryId = "") {
  let l = state.leads[phone];
  if (!l) {
    l = {
      id: phone,
      name: name || "",
      persona: "unknown",
      score: 0,
      status: "in_sequence",
      seqStep: -1, // -1 = עוד לא נשלחה הודעת פתיחה
      history: [],
      fireberryId: fireberryId || "",
      source: "drip", // נכנס דרך פלואו החימום (Fireberry)
      enrolledTs: Date.now(),
      lastInboundTs: 0,
      lastDripTs: 0,
      createdTs: Date.now(),
    };
    state.leads[phone] = l;
    save();
  } else {
    // ליד קיים — רק משלימים מזהה Fireberry. לא מתייגים מחדש ולא מאתחלים רצף
    // (מונע כפילות כשהאוטומציה נורית שוב על "פנייה חוזרת" שהבוט עצמו עדכן)
    if (fireberryId && !l.fireberryId) l.fireberryId = fireberryId;
    save();
  }
  return l;
}
