import { Router } from "express";
import { groqChat } from "../services/groq.js";
import { DEFAULTS } from "../services/prompts.js";

const router = Router();

/**
 * POST /api/suggestions
 * body: {
 *   transcript: string,                 // full transcript so far
 *   shownTitles?: string[],             // titles already shown this session (dedup hint)
 *   settings?: {
 *     model, suggestionPrompt, suggestionContextChars,
 *     suggestionTemperature, suggestionMaxTokens
 *   }
 * }
 * header: x-groq-key
 */
router.post("/", async (req, res, next) => {
  try {
    const apiKey = req.header("x-groq-key");
    const { transcript = "", shownTitles = [], settings = {} } = req.body || {};

    const model = settings.model || DEFAULTS.model;
    const sysPrompt = settings.suggestionPrompt || DEFAULTS.suggestionPrompt;
    const ctxChars = Number(settings.suggestionContextChars || DEFAULTS.suggestionContextChars);
    const temperature = Number(settings.suggestionTemperature ?? DEFAULTS.suggestionTemperature);
    const maxTokens = Number(settings.suggestionMaxTokens || DEFAULTS.suggestionMaxTokens);

    const clean = String(transcript || "").trim();
    if (!clean) {
      return res.json({ suggestions: [] });
    }

    // Recency-biased slice: take the tail of the transcript.
    const recent = clean.length > ctxChars ? clean.slice(-ctxChars) : clean;
    const hadEarlier = clean.length > ctxChars;

    const userMsg = [
      hadEarlier ? "[earlier context truncated]\n" : "",
      "=== RECENT TRANSCRIPT ===",
      recent,
      "=== END TRANSCRIPT ===",
      "",
      shownTitles.length
        ? `Suggestions already shown this session (avoid repeating semantically):\n- ${shownTitles.slice(-15).join("\n- ")}`
        : "No suggestions shown yet this session.",
      "",
      "Return exactly 3 suggestions as JSON per the schema.",
    ].join("\n");

    const messages = [
      { role: "system", content: sysPrompt },
      { role: "user", content: userMsg },
    ];

    let out;
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        out = await groqChat({ apiKey, model, temperature, maxTokens, responseFormat: { type: "json_object" }, messages });
        break;
      } catch (err) {
        const isJsonFail = err.message?.includes("json_validate_failed") || err.message?.includes("Failed to validate JSON");
        if (!isJsonFail || attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }

    const raw = out?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Last-ditch: try to pull JSON object out of the string
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { suggestions: [] };
    }

    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : [];
    const normalised = suggestions.map((s) => ({
      type: ["question", "talking_point", "answer", "fact_check", "clarify"].includes(s.type) ? s.type : "talking_point",
      title: String(s.title || "").slice(0, 80),
      preview: String(s.preview || "").slice(0, 300),
    }));

    res.json({ suggestions: normalised });
  } catch (err) {
    next(err);
  }
});

export default router;
