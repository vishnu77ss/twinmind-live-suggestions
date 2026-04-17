// Small API client for the three backend endpoints.
// The Groq API key is passed per-request in x-groq-key; we never store it server-side.

export async function transcribeChunk({ apiKey, blob, language }) {
  const form = new FormData();
  form.append("audio", blob, `chunk-${Date.now()}.webm`);
  if (language) form.append("language", language);

  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "x-groq-key": apiKey || "" },
    body: form,
  });
  if (!res.ok) {
    const err = await safeErr(res);
    throw new Error(err);
  }
  return res.json(); // { text }
}

export async function fetchSuggestions({ apiKey, transcript, shownTitles, settings }) {
  const res = await fetch("/api/suggestions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-groq-key": apiKey || "",
    },
    body: JSON.stringify({ transcript, shownTitles, settings }),
  });
  if (!res.ok) {
    throw new Error(await safeErr(res));
  }
  return res.json(); // { suggestions: [...] }
}

/**
 * Streams a chat/detail response. onDelta fires with each token chunk.
 * Returns a promise that resolves with the full text when done.
 */
export async function streamChat({ apiKey, mode, transcript, suggestion, history, message, settings, onDelta, signal }) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-groq-key": apiKey || "",
    },
    body: JSON.stringify({ mode, transcript, suggestion, history, message, settings }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(await safeErr(res));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";

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
      if (!payload) continue;
      try {
        const obj = JSON.parse(payload);
        if (obj.delta) {
          full += obj.delta;
          onDelta?.(obj.delta, full);
        } else if (obj.error) {
          throw new Error(obj.error);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
  return full;
}

async function safeErr(res) {
  try {
    const j = await res.json();
    return j.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
