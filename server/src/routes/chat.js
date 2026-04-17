import { Router } from "express";
import { groqChatStream } from "../services/groq.js";
import { DEFAULTS } from "../services/prompts.js";

const router = Router();

/**
 * POST /api/chat  (streaming SSE)
 *
 * Two modes:
 *
 * 1) Detailed answer for a tapped suggestion:
 *    body: {
 *      mode: "detail",
 *      transcript: string,
 *      suggestion: { type, title, preview },
 *      history: [{role, content}, ...],   // prior chat turns (so the reply lands in context)
 *      settings?: { ... }
 *    }
 *
 * 2) Free-form chat turn:
 *    body: {
 *      mode: "chat",
 *      transcript: string,
 *      history: [{role, content}, ...],
 *      message: string,
 *      settings?: { ... }
 *    }
 *
 * Response: text/event-stream. Events:
 *   data: {"delta": "token chunk"}
 *   data: {"done": true}
 *   data: {"error": "..."}
 */
router.post("/", async (req, res, next) => {
  try {
    const apiKey = req.header("x-groq-key");
    const { mode, transcript = "", suggestion, history = [], message = "", settings = {} } = req.body || {};

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
    const sliced = clean.length > ctxChars ? `[earlier context truncated]\n${clean.slice(-ctxChars)}` : clean;

    const transcriptBlock = sliced
      ? `=== SESSION TRANSCRIPT (most recent first may be truncated from the top) ===\n${sliced}\n=== END TRANSCRIPT ===`
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
      finalUser = [
        transcriptBlock,
        "",
        `User's question: ${message}`,
      ].join("\n");
    }

    const messages = [
      { role: "system", content: sysPrompt },
      ...history
        .filter((m) => m && m.role && m.content)
        .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content) })),
      { role: "user", content: finalUser },
    ];

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const stream = await groqChatStream({ apiKey, model, messages, temperature, maxTokens });

    // Groq returns OpenAI-style SSE chunks. We re-emit them as simplified events.
    const decoder = new TextDecoder();
    let buf = "";

    const onChunk = (chunk) => {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          continue;
        }
        try {
          const obj = JSON.parse(payload);
          const delta = obj?.choices?.[0]?.delta?.content;
          if (delta) {
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          }
        } catch {
          /* ignore keep-alives & malformed lines */
        }
      }
    };

    // Support both Node Readable and Web ReadableStream
    if (typeof stream.getReader === "function") {
      const reader = stream.getReader();
      req.on("close", () => reader.cancel().catch(() => {}));
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) onChunk(value);
      }
    } else {
      for await (const chunk of stream) onChunk(chunk);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      next(err);
    } else {
      try {
        res.write(`data: ${JSON.stringify({ error: err.message || "stream error" })}\n\n`);
        res.end();
      } catch {
        /* socket gone */
      }
    }
  }
});

export default router;
