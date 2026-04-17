// Thin wrapper around Groq's OpenAI-compatible API.
// The user's key is passed through from the client per-request; we never store it.
// node-fetch is used instead of native fetch — undici (Node 18 native) fails to connect
// to api.groq.com on some Windows/SSL configurations.
import fetch from "node-fetch";

const GROQ_BASE = "https://api.groq.com/openai/v1";

/**
 * Chat completions (non-streaming).
 * Used for live suggestions where we need a parseable JSON response fast.
 */
export async function groqChat({ apiKey, model, messages, temperature = 0.4, maxTokens = 800, responseFormat }) {
  if (!apiKey) {
    const err = new Error("Missing Groq API key. Paste it in Settings.");
    err.status = 400;
    throw err;
  }

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (responseFormat) body.response_format = responseFormat;

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Groq chat error ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Chat completions (streaming SSE passthrough).
 * Used for the detailed answers + chat replies so the first token arrives fast.
 */
export async function groqChatStream({ apiKey, model, messages, temperature = 0.5, maxTokens = 1200 }) {
  if (!apiKey) {
    const err = new Error("Missing Groq API key. Paste it in Settings.");
    err.status = 400;
    throw err;
  }

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
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

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Groq stream error ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.body; // node Readable / web ReadableStream
}

/**
 * Whisper Large V3 transcription.
 * Expects a Buffer or Blob-like audio chunk (webm/opus from MediaRecorder works fine).
 */
export async function groqTranscribe({ apiKey, audioBuffer, filename = "chunk.webm", mimeType = "audio/webm", language }) {
  if (!apiKey) {
    const err = new Error("Missing Groq API key. Paste it in Settings.");
    err.status = 400;
    throw err;
  }

  const RETRY_DELAYS = [500, 1500, 3500];
  const NETWORK_ERRORS = ["TypeError", "ECONNRESET", "ETIMEDOUT", "UND_ERR_SOCKET"];

  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    try {
      const form = new FormData();
      const blob = new Blob([audioBuffer], { type: mimeType });
      form.append("file", blob, filename);
      form.append("model", "whisper-large-v3");
      form.append("response_format", "json");
      form.append("temperature", "0");
      if (language) form.append("language", language);

      const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Groq transcribe error ${res.status}: ${text}`);
        err.status = res.status;
        throw err;
      }
      return await res.json(); // { text: "..." }
    } catch (err) {
      lastErr = err;
      const isNetworkError =
        NETWORK_ERRORS.some((e) => err.name === e || err.code === e || err.message?.includes(e)) ||
        err.name === "AbortError";
      // Don't retry 4xx — bad key or bad audio won't fix on retry
      if (!isNetworkError || (err.status >= 400 && err.status < 500)) throw err;
      if (attempt < RETRY_DELAYS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  const final = new Error(`Groq unreachable after 3 retries — check your network / firewall / VPN. (${lastErr?.message})`);
  final.status = 503;
  throw final;
}
