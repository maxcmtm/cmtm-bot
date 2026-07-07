// קריאה ל-Claude API עם tool-use לפלט מובנה ואמין (בלי פענוח טקסט חופשי)
import { config } from "./config.js";
import { SYSTEM_PROMPT } from "./knowledge.js";

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
  if (!config.anthropicKey) throw new Error("אין מפתח API");
  const convo = history
    .map((t) => (t.role === "user" ? "הלקוח: " : "נועה: ") + t.content)
    .join("\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
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
  return (data.content?.[0]?.text || "").replace(/\*\*/g, "").replace(/^סיכום[^:]*:\s*/, "").trim();
}

/**
 * שולח שיחה ל-Claude ומחזיר אובייקט מובנה.
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @returns {Promise<{reply,persona,intent,score_delta,handoff,handoff_reason}>}
 */
export async function askClaude(messages) {
  if (!config.anthropicKey) {
    throw new Error("ANTHROPIC_API_KEY חסר — הגדר אותו ב-.env");
  }

  const body = {
    model: config.model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [RESPOND_TOOL],
    tool_choice: { type: "tool", name: "respond_to_lead" },
    messages,
  };

  // עד 3 ניסיונות עם המתנה — כדי שתקלה רגעית (עומס/רשת) לא תשאיר ליד בלי מענה
  let res, lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": config.anthropicKey,
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
  const toolUse = (data.content || []).find((b) => b.type === "tool_use");
  if (!toolUse) {
    throw new Error("המודל לא החזיר tool_use — תשובה לא צפויה");
  }
  return toolUse.input;
}
