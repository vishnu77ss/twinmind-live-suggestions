// Vercel serverless function: /api/suggestions
// Builds the prompt, calls Groq chat completions (JSON mode), returns 3 suggestions.

import { DEFAULTS } from "../server/src/services/prompts.js";

const GROQ_BASE = "https://api.groq.com/openai/v1";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = req.headers["x-groq-key"];
  if (!apiKey) return res.status(400).json({ error: "Missing Groq API key." });

  try {
    const { transcript = "", shownTitles = [], settings = {} } = req.body || {};

    const model = settings.model || DEFAULTS.model;
    const sysPrompt = settings.suggestionPrompt || DEFAULTS.suggestionPrompt;
    const ctxChars = Number(settings.suggestionContextChars || DEFAULTS.suggestionContextChars);
    const temperature = Number(settings.suggestionTemperature ?? DEFAULTS.suggestionTemperature);
    const maxTokens = Number(settings.suggestionMaxTokens || DEFAULTS.suggestionMaxTokens);

    const clean = String(transcript || "").trim();
    if (!clean) return res.status(200).json({ suggestions: [] });

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

    const upstream = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userMsg },
        ],
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).json({ error: `Groq: ${text}` });
    }

    const out = await upstream.json();
    const raw = out?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { suggestions: [] };
    }

    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : [];
    const normalised = suggestions.map((s) => ({
      type: ["question", "talking_point", "answer", "fact_check", "clarify"].includes(s.type)
        ? s.type
        : "talking_point",
      title: String(s.title || "").slice(0, 80),
      preview: String(s.preview || "").slice(0, 300),
    }));

    return res.status(200).json({ suggestions: normalised });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Suggestions failed" });
  }
}
