// Vercel serverless function: /api/chat
// Streams chat completions from Groq as SSE. Handles both "detail" (card click)
// and "chat" (free-form) modes.

import { DEFAULTS } from "../server/src/services/prompts.js";

export const config = {
  // Node runtime (edge would work too but we keep it simple + consistent with server/)
  runtime: "nodejs",
};

const GROQ_BASE = "https://api.groq.com/openai/v1";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = req.headers["x-groq-key"];
  if (!apiKey) return res.status(400).json({ error: "Missing Groq API key." });

  try {
    const {
      mode,
      transcript = "",
      suggestion,
      history = [],
      message = "",
      settings = {},
    } = req.body || {};

    const model = settings.model || DEFAULTS.model;
    const isDetail = mode === "detail";

    const sysPrompt = isDetail
      ? settings.detailPrompt || DEFAULTS.detailPrompt
      : settings.chatPrompt || DEFAULTS.chatPrompt;

    const ctxChars = Number(
      isDetail
        ? settings.detailContextChars || DEFAULTS.detailContextChars
        : settings.chatContextChars || DEFAULTS.chatContextChars
    );
    const temperature = Number(
      isDetail
        ? settings.detailTemperature ?? DEFAULTS.detailTemperature
        : settings.chatTemperature ?? DEFAULTS.chatTemperature
    );
    const maxTokens = Number(
      isDetail
        ? settings.detailMaxTokens || DEFAULTS.detailMaxTokens
        : settings.chatMaxTokens || DEFAULTS.chatMaxTokens
    );

    const clean = String(transcript || "").trim();
    const sliced =
      clean.length > ctxChars ? `[earlier context truncated]\n${clean.slice(-ctxChars)}` : clean;

    const transcriptBlock = sliced
      ? `=== SESSION TRANSCRIPT ===\n${sliced}\n=== END TRANSCRIPT ===`
      : "=== SESSION TRANSCRIPT === (empty — the mic has not captured speech yet) ===";

    let finalUser;
    if (isDetail) {
      const s = suggestion || {};
      finalUser = [
        transcriptBlock,
        "",
        "The user tapped this suggestion card:",
        `- type: ${s.type || "unknown"}`,
        `- title: ${s.title || ""}`,
        `- preview: ${s.preview || ""}`,
        "",
        "Write the detailed response now.",
      ].join("\n");
    } else {
      finalUser = [transcriptBlock, "", `User's question: ${message}`].join("\n");
    }

    const messages = [
      { role: "system", content: sysPrompt },
      ...history
        .filter((m) => m && m.role && m.content)
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content),
        })),
      { role: "user", content: finalUser },
    ];

    const upstream = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      return res.status(upstream.status).json({ error: `Groq: ${text}` });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    const write = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    req.on("close", () => {
      reader.cancel().catch(() => {});
    });

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") {
          write({ done: true });
          continue;
        }
        try {
          const obj = JSON.parse(payload);
          const delta = obj?.choices?.[0]?.delta?.content;
          if (delta) write({ delta });
        } catch {
          /* skip malformed */
        }
      }
    }

    write({ done: true });
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message || "Chat failed" });
    }
    try {
      res.write(`data: ${JSON.stringify({ error: err.message || "stream error" })}\n\n`);
      res.end();
    } catch {
      /* socket gone */
    }
  }
}
