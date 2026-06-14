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
    },
    required: ["reply", "persona", "intent", "score_delta", "handoff"],
  },
};

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

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const toolUse = (data.content || []).find((b) => b.type === "tool_use");
  if (!toolUse) {
    throw new Error("המודל לא החזיר tool_use — תשובה לא צפויה");
  }
  return toolUse.input;
}
