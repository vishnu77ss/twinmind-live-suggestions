// Vercel serverless function: /api/transcribe
// Accepts multipart/form-data with field "audio", forwards to Groq Whisper Large V3.
// Uses busboy to parse the multipart stream and rebuilds a fresh FormData for Groq,
// because forwarding the raw multipart body on Vercel drops the boundary.

import busboy from "busboy";

export const config = {
  api: {
    bodyParser: false,
  },
};

const GROQ_BASE = "https://api.groq.com/openai/v1";

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers });
    let fileBuffer = null;
    let filename = "chunk.webm";
    let mimeType = "audio/webm";

    bb.on("file", (fieldname, stream, info) => {
      if (fieldname !== "audio") {
        stream.resume();
        return;
      }
      filename = info.filename || "chunk.webm";
      mimeType = info.mimeType || "audio/webm";
      const chunks = [];
      stream.on("data", (d) => chunks.push(d));
      stream.on("end", () => { fileBuffer = Buffer.concat(chunks); });
    });

    bb.on("finish", () => {
      if (!fileBuffer) return reject(new Error("No audio field in form"));
      resolve({ fileBuffer, filename, mimeType });
    });

    bb.on("error", reject);
    req.pipe(bb);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }
  const apiKey = req.headers["x-groq-key"];
  if (!apiKey) return res.status(400).json({ error: "Missing Groq API key." });

  try {
    const { fileBuffer, filename, mimeType } = await parseMultipart(req);

    const form = new FormData();
    form.append("file", new Blob([fileBuffer], { type: mimeType }), filename);
    form.append("model", "whisper-large-v3");
    form.append("response_format", "json");
    form.append("temperature", "0");

    const upstream = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!upstream.ok) {
      const body = await upstream.json().catch(() => upstream.text());
      return res.status(upstream.status).json({ error: body });
    }
    const json = await upstream.json();
    return res.status(200).json({ text: (json.text || "").trim() });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Transcription failed" });
  }
}
