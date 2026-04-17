import express from "express";
import cors from "cors";
import "dotenv/config";

import transcribeRouter from "./routes/transcribe.js";
import suggestionsRouter from "./routes/suggestions.js";
import chatRouter from "./routes/chat.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "4mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/transcribe", transcribeRouter);
app.use("/api/suggestions", suggestionsRouter);
app.use("/api/chat", chatRouter);

// Central error handler
app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error("[server error]", err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Internal error" });
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`TwinMind server listening on :${PORT}`);
});
