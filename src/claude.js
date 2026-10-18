// קריאה ל-Claude API עם tool-use לפלט מובנה ואמין (בלי פענוח טקסט חופשי)
import { config } from "./config.js";
import { SYSTEM_PROMPT } from "./knowledge.js";
import { getRuntimeModel, getRuntimeAnthropicKey, logUsage } from "./store.js";

// המפתח הפעיל: הגדרת זמן-ריצה (POST /admin/token {anthropicKey}) גוברת על ANTHROPIC_API_KEY
export function activeAnthropicKey() {
  return getRuntimeAnthropicKey() || config.anthropicKey;
}

// המודל הפעיל: הגדרת זמן-ריצה (POST /admin/token {model}) גוברת על BOT_MODEL
export function activeModel() {
  return getRuntimeModel() || config.model;
}

// מחירים לדולר למיליון טוקנים (קלט / פלט / קריאת cache / כתיבת cache 1h) — להערכת עלות ב-/admin
export const PRICES = {
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite1h: 6, cacheWrite5m: 3.75 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite1h: 4, cacheWrite5m: 2.5 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.1, cacheWrite1h: 2, cacheWrite5m: 1.25 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite1h: 2, cacheWrite5m: 1.25 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite1h: 0.2, cacheWrite5m: 0.125 },
};
export function estimateCost(u) {
  const p = PRICES[u.model] || PRICES["claude-sonnet-4-6"];
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite1h * p.cacheWrite1h + u.cacheWrite5m * p.cacheWrite5m) / 1e6;
}

// הגדרת הכלי שמכריח את המודל להחזיר JSON בסכימה קבועה
export const RESPOND_TOOL = {
  name: "respond_to_lead",
  description: "החזר את התגובה לליד בוואטסאפ יחד עם מטא-דאטה לניהול הליד.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description: "טקסט התשובה שיישלח לליד בוואטסאפ. עברית, קצר, בטון של נועה.",
      },
      persona: {
        type: "string",
        enum: ["career", "parent", "therapist", "religious", "unknown"],
        description: "הפרסונה שזוהתה לפי השיחה.",
      },
      intent: {
        type: "string",
        enum: [
          "question",
          "buying_signal",
          "request_human",
          "unsubscribe",
          "smalltalk",
        ],
        description: "כוונת ההודעה האחרונה של הליד.",
      },
      score_delta: {
        type: "integer",
        description:
          "שינוי ציון החום: ענה=+10, שאלה עניינית=+15, מחיר/מועד/הרשמה=+30, לחיצה על לינק=+25, בקשת נציג=+40.",
      },
      handoff: {
        type: "boolean",
        description:
          "האם להעביר לנציג אנושי עכשיו (בקשת נציג מפורשת, תסכול, או שאלת מחיר ישירה).",
      },
      handoff_reason: {
        type: "string",
        description: "סיבת ההעברה לנציג (ריק אם handoff=false).",
      },
      lead_summary: {
        type: "string",
        description:
          "סיכום מעודכן של הליד ב-2-3 משפטים בעברית: מי האדם, מה הביא אותו לפנות, מה הוא באמת מחפש, איפה השיחה עומדת, והתנגדויות/חששות אם עלו. כתוב לנציג מכירות שיקרא את זה לפני שיחה.",
      },
    },
    required: ["reply", "persona", "intent", "score_delta", "handoff", "lead_summary"],
  },
};

// סיכום ליד לפי היסטוריה קיימת (ללידים ישנים שאין להם סיכום) — מודל זול
export async function summarizeLead(history, lead) {
  if (!activeAnthropicKey()) throw new Error("אין מפתח API");
  const convo = history
    .map((t) => (t.role === "user" ? "הלקוח: " : "נועה: ") + t.content)
    .join("\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": activeAnthropicKey(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-5-5",
      max_tokens: 600, // כולל מקום לחשיבה אדפטיבית קצרה
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content: `לפניך שיחת וואטסאפ בין ליד לבין נועה, העוזרת של מכללת תרפיית מימדים (לימודי שיטת טיפול). סכם ב-2-3 משפטים בעברית עבור נציג מכירות: מי האדם, מה הביא אותו לפנות, מה הוא באמת מחפש, איפה השיחה עומדת והתנגדויות אם יש. בלי הקדמות, בלי כותרת ובלי הדגשות (**), ישר הסיכום.\n\nשם הליד: ${lead.name || "לא ידוע"}\n\n${convo}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`summarize ${res.status}`);
  const data = await res.json();
  try { logUsage("claude-haiku-5-5", data.usage || {}); } catch { /* מעקב בלבד */ }
  // קוראים לפי type (דור 5.5 יכול להתחיל בבלוק thinking)
  const text = (data.content || []).find((b) => b.type === "text")?.text || "";
  return text.replace(/\*\*/g, "").replace(/^סיכום[^:]*:\s*/, "").trim();
}

/**
 * שולח שיחה ל-Claude ומחזיר אובייקט מובנה.
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @returns {Promise<{reply,persona,intent,score_delta,handoff,handoff_reason}>}
 */
export async function askClaude(messages) {
  if (!activeAnthropicKey()) {
    throw new Error("ANTHROPIC_API_KEY חסר — הגדר אותו ב-.env");
  }

  const model = activeModel();
  const body = {
    model,
    max_tokens: 1024,
    // caching על הפרומפט הגדול (הוראות + בסיס ידע) — חוסך ~90% מעלות הקלט בקריאות חוזרות
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral", ttl: "1h" } }],
    tools: [RESPOND_TOOL],
    tool_choice: { type: "tool", name: "respond_to_lead" },
    messages,
  };
  // דור 5.5 (Haiku/Sonnet): חשיבה אדפטיבית מופעלת כברירת מחדל — effort נמוך לשיחת וואטסאפ קצרה (עלות ומהירות)
  if (/-5-5/.test(model)) body.output_config = { effort: "low" };

  // עד 3 ניסיונות עם המתנה — כדי שתקלה רגעית (עומס/רשת) לא תשאיר ליד בלי מענה
  let res, lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": activeAnthropicKey(),
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (res.ok) break;
      const errText = await res.text();
      lastErr = new Error(`Claude API ${res.status}: ${errText.slice(0, 200)}`);
      // שגיאות זמניות בלבד שוות ניסיון חוזר
      if (![429, 500, 502, 503, 504, 529].includes(res.status)) throw lastErr;
    } catch (e) {
      lastErr = e;
      res = null;
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  if (!res || !res.ok) throw lastErr || new Error("Claude API failed");

  const data = await res.json();
  try { logUsage(model, data.usage || {}); } catch { /* מעקב בלבד */ }
  const toolUse = (data.content || []).find((b) => b.type === "tool_use");
  if (!toolUse) {
    throw new Error("המודל לא החזיר tool_use — תשובה לא צפויה");
  }
  return toolUse.input;
}
