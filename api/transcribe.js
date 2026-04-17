// Vercel serverless function: /api/transcribe
// Accepts multipart/form-data with field "audio", forwards to Groq Whisper Large V3.

export const config = {
  api: {
    bodyParser: false,
  },
};

const GROQ_BASE = "https://api.groq.com/openai/v1";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }
  const apiKey = req.headers["x-groq-key"];
  if (!apiKey) return res.status(400).json({ error: "Missing Groq API key." });

  try {
    // Pass the raw request body straight through to Groq — both endpoints accept multipart.
    // We do need to set Content-Length correctly and rebuild the form since serverless
    // may not give us the raw request as a readable; so we reconstruct.
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);

    // Groq Whisper accepts the original multipart body as-is because we forward the
    // Content-Type (including boundary) from the incoming request.
    const upstream = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": req.headers["content-type"],
      },
      body: buf,
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).json({ error: `Groq: ${text}` });
    }
    const json = await upstream.json();
    return res.status(200).json({ text: (json.text || "").trim() });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Transcription failed" });
  }
}
