import { Router } from "express";
import multer from "multer";
import { groqTranscribe } from "../services/groq.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // Whisper hard limit is 25MB
});

router.post("/", upload.single("audio"), async (req, res, next) => {
  try {
    const apiKey = req.header("x-groq-key");
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded (field 'audio')." });
    }
    const { language } = req.body || {};
    const out = await groqTranscribe({
      apiKey,
      audioBuffer: req.file.buffer,
      filename: req.file.originalname || "chunk.webm",
      mimeType: req.file.mimetype || "audio/webm",
      language: language || undefined,
    });
    res.json({ text: (out.text || "").trim() });
  } catch (err) {
    next(err);
  }
});

export default router;
