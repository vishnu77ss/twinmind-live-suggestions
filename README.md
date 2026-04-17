# TwinMind — Live Suggestions

Always-on AI meeting copilot. Listens to your mic, transcribes in ~30-second chunks, and continuously surfaces **3 useful suggestions** in real time. Tap a card and a detailed answer streams into the right-hand chat, which you can also type into freely.

> Built for the TwinMind Live Suggestions assignment (April 2026). All suggestion and chat generation runs through **Groq GPT-OSS 120B**; transcription uses **Groq Whisper Large V3**.

---

## Live demo + code

- **Deployed app:** https://twinmind-live-suggestions-liart.vercel.app
- **Repository:** https://github.com/vishnu77ss/twinmind-live-suggestions

The app is BYO-key: paste your own Groq key in Settings. No key is stored on the server; it's forwarded per-request only.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 18 + Vite | Fast dev, tiny bundle, no framework overhead we don't need. |
| Backend (prod) | Vercel serverless functions in `/api` | Matches the hosting target. SSE streaming works via `res.write`. |
| Backend (local dev) | Node 18 + Express in `/server` | Same three endpoints as prod; mirrors the serverless handlers so local dev feels identical. |
| Audio capture | `MediaRecorder` (native) + rolling-chunk hook | No third-party audio lib. Each chunk is a self-contained `webm/opus` file Whisper can decode directly. |
| Models | Groq Whisper V3 + GPT-OSS 120B | Required by the brief. JSON-mode for suggestions, SSE streaming for chat. |
| State | React hooks + `localStorage` for settings/key | Session-only chat/transcript as required; settings persist across reloads. |

The `/server` Express app and the `/api` Vercel functions share the same `prompts.js` (defaults live in `server/src/services/prompts.js` and the client mirrors them in `client/src/utils/settings.js` for the "Reset to defaults" action).

---

## Architecture at a glance

```
┌──────────────────────────────────────────────────────┐
│                      BROWSER                         │
│                                                      │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────┐   │
│  │ Transcript  │   │ Suggestions  │   │  Chat    │   │
│  │   panel     │   │    panel     │   │  panel   │   │
│  └──────┬──────┘   └──────┬───────┘   └────┬─────┘   │
│         │                 │                │         │
│   chunked mic       30s auto-refresh    streaming    │
│         │                 │                │         │
└─────────┼─────────────────┼────────────────┼─────────┘
          ▼                 ▼                ▼
     /api/transcribe  /api/suggestions   /api/chat (SSE)
          │                 │                │
          └──── x-groq-key header (per request) ───┐
                            │                     ▼
                            ▼               Groq API
                      Groq Whisper V3    GPT-OSS 120B
```

**Why a thin server layer instead of calling Groq directly from the browser?**
1. CORS — Groq's API isn't intended to be called from arbitrary origins.
2. Keeps the user's API key out of bundled JS and third-party request logs. We only forward it per request; we never persist it.
3. Lets us do server-side prompt assembly, JSON-mode parsing, and SSE passthrough in one place.

---

## Prompt strategy

Three prompts, each tuned for a different moment in the meeting-copilot loop. All live in `server/src/services/prompts.js` and are **fully editable in Settings**.

### 1. Live-suggestions prompt (the high-value one)

Constraints baked in:
- **Exactly 3 suggestions**, returned in a rigid JSON schema. We use Groq's `response_format: { type: "json_object" }` so parsing is boring and reliable.
- **5 suggestion types**: `question`, `talking_point`, `answer`, `fact_check`, `clarify`. The prompt explicitly tells the model to pick a *mix* based on what the transcript actually needs — don't force one type.
- **Preview self-contained** (≤ 22 words, ≤ 7-word title). The brief says "the preview alone should deliver value even if not clicked", and this is the single rule that enforces that.
- **Recency bias**: the model is told the last 60–90 seconds matter most. We also *truncate from the front* server-side (keep the tail of the transcript, not the head) before sending.
- **Dedup**: the last 15 shown titles are passed in so the model doesn't loop. Without this, the 3rd refresh tends to repeat a reworded version of the 1st.
- **No fabrication**: the prompt explicitly constrains `fact_check` — if the model isn't sure, it should say "worth verifying" rather than invent a correction.

### 2. Detailed-answer prompt (on card click)

- Gets a **wider** transcript context (default 12k chars vs. 4k for suggestions) because the user asked to go deeper.
- Per-type structure: for a `question` card, it explains *why* to ask and gives likely follow-ups. For `answer`, answer-first then reasoning. For `fact_check`, claim → correction → confidence. This matters — without per-type structure, the model produces generic "here are some things to consider" output.
- Capped at ~180 words unless the topic genuinely needs more. A detailed answer that doesn't fit on the screen is useless mid-meeting.
- **Streamed via SSE** so the first token lands fast. This is the user's most latency-sensitive moment.

### 3. Chat prompt (free-form questions)

- Has the **largest** transcript window (16k chars) because the user often asks "what did we decide about X" — that X might be from 10 minutes ago.
- "First sentence is the answer" — no preamble, no "As an AI...", no re-stating the question. These are the tics that feel cheap in a copilot.
- Explicit instruction: if the answer isn't in the transcript, say so in one line and offer the best adjacent answer. Better than hallucinating.

### Why three separate prompts and not one?
A single prompt optimising for "brief real-time cards" conflicts with "expand this into a detailed answer". The context windows, temperatures, and output shapes are genuinely different jobs.

---

## Context strategy

We always pass a **suffix** of the transcript (`.slice(-N)`), not a prefix or a summary:
- Meetings are local — what matters for the next suggestion is the last couple of minutes, not the first.
- Summarising the earlier context would add a whole extra LLM call and latency, for marginal value in a 30-second-loop product.
- If the transcript is longer than the configured char limit, we prepend `[earlier context truncated]` so the model knows it's not seeing the start. This avoids the model hedging with "it's unclear how this started…".

The char budgets (defaults) are conservative on purpose — keeps tokens down, keeps latency down. A user who wants more history can raise them in Settings.

---

## Latency tradeoffs

| Operation | Typical | Why |
|---|---|---|
| Mic chunk → transcript line | ~1–2s after the 30s chunk closes | Whisper V3 on Groq is fast; the dominant cost is upload. |
| Transcript → 3 suggestions rendered | ~1–2s | JSON-mode on GPT-OSS 120B is quick; non-streaming is fine for a 3-card batch. |
| Card click → first token in chat | ~0.5–1s | Streaming via SSE. First token is what matters perceptually. |
| Free-form chat send → first token | ~0.5–1s | Same. |

Things I explicitly did **not** do for latency reasons:
- No client-side VAD or speech-endpointing — adds complexity for marginal gain when chunks are already only 30s.
- No streaming of partial transcripts — chunking at 30s is what the brief asks for and what the prototype shows. A streaming Whisper mode would be a nice v2.
- No prefetching suggestions on every keystroke — the 30s cadence is a product constraint, not a technical one.

---

## Local development

```bash
# 1. Install deps for both workspaces
npm run install:all

# 2. Start both dev servers (Vite on :5173, Express on :8787)
npm run dev

# 3. Open http://localhost:5173
# 4. Click "Add API Key", paste your Groq key, Save.
# 5. Click the mic. Speak. Suggestions appear after ~30s.
```

Vite proxies `/api/*` to the Express server in dev, so the frontend code is identical in dev and prod.

---

## Deployment (Vercel)

```bash
# One-time
npm install -g vercel
vercel link

# Deploy
vercel --prod
```

Vercel builds the client from `/client` into `client/dist` and serves it statically. The three handlers in `/api` become serverless functions at `/api/transcribe`, `/api/suggestions`, `/api/chat`. No env vars are required on the server — the user's Groq key is sent per-request in the `x-groq-key` header.

**Note on SSE on Vercel:** the default Node runtime supports `res.write` streaming and we set `Cache-Control: no-cache, no-transform` + `Connection: keep-alive` so the edge doesn't buffer. Function `maxDuration` is 60s in `vercel.json`, which comfortably covers chat generations.

Other hosts (Render, Fly, Railway) work out of the box — just run `npm --prefix server start` and point the client at it via a proxy or `VITE_API_BASE`.

---

## What's in Settings

Everything the brief asked for, editable live:

- **Groq API key** (stored in `localStorage`, sent per-request)
- **Model** (default `openai/gpt-oss-120b`)
- **Refresh cadence** (default 30s) and **mic chunk size** (default 30s)
- **Three independent context budgets** (suggestions / detail / chat) in characters
- **Three independent temperatures** (suggestions / detail / chat)
- **Three independent max-token caps**
- **All three prompts as full-text editors** with a "Reset to defaults" button

---

## Export

Click **Export** at the top right. You get a JSON file with:

```jsonc
{
  "exportedAt": "...",
  "model": "...",
  "transcript":        [{ "timestamp", "text" }, ...],
  "suggestionBatches": [{ "batch", "timestamp", "suggestions": [...] }, ...],
  "chat":              [{ "timestamp", "role", "content", "suggestionRef" }, ...]
}
```

Every artefact has an ISO timestamp. `suggestionRef` links a chat assistant reply back to the card that triggered it.

---

## Things I deliberately did not over-engineer

The brief explicitly says *don't over-engineer, we're not evaluating production-readiness at scale*. With that in mind, I skipped:

- Multi-user anything. Single session, single tab.
- Persistence across reloads for transcript/chat (the brief says "no data persistence needed when reloading the page").
- A queue / retry system for failed Whisper chunks. On error we surface a banner and keep recording; the next chunk will succeed.
- Auth / rate limiting / key proxying. The user brings their own Groq key.
- A speaker-diarisation step. Whisper V3 doesn't do it natively on Groq and a second-pass model would blow the latency budget.

---

## File layout

```
.
├── api/                          # Vercel serverless functions (prod)
│   ├── chat.js                   # SSE streaming for detail + chat
│   ├── health.js
│   ├── suggestions.js            # JSON-mode, 3 cards
│   └── transcribe.js             # Whisper passthrough
├── client/                       # React + Vite frontend
│   ├── index.html
│   ├── src/
│   │   ├── App.jsx               # Main orchestrator
│   │   ├── components/
│   │   │   ├── ChatPanel.jsx
│   │   │   ├── SettingsModal.jsx
│   │   │   ├── SuggestionsPanel.jsx
│   │   │   └── TranscriptPanel.jsx
│   │   ├── hooks/
│   │   │   └── useChunkedRecorder.js   # Rolling 30s MediaRecorder chunks
│   │   ├── utils/
│   │   │   ├── api.js                  # transcribe / suggestions / streamChat
│   │   │   └── settings.js             # Defaults + localStorage
│   │   ├── main.jsx
│   │   └── styles.css
│   └── vite.config.js
├── server/                       # Node + Express (local dev)
│   ├── src/
│   │   ├── index.js
│   │   ├── routes/
│   │   │   ├── chat.js
│   │   │   ├── suggestions.js
│   │   │   └── transcribe.js
│   │   └── services/
│   │       ├── groq.js
│   │       └── prompts.js        # Source of truth for default prompts
│   └── package.json
├── package.json                  # Root scripts (dev/build/start)
├── vercel.json
└── README.md
```

---

## Tradeoffs I'd revisit with more time

1. **Chunk boundary clipping.** Restarting the `MediaRecorder` every 30s gives us self-contained `webm` files per chunk, but a word said *exactly* on the boundary can be split. A production version would use a sliding-window overlap (send last 2s of prev chunk with next chunk) and dedupe on the text side.
2. **Suggestion dedup** is currently "pass last 15 titles into the prompt". A stronger version would embed each title and filter by cosine similarity before rendering — but that's another model call and for a 30s loop it's not worth it.
3. **Fact-check provenance.** When the model fact-checks a claim, it doesn't cite. A v2 would add a `web_search` tool call for that type only, behind a Settings toggle.
4. **Partial streaming for suggestions.** I kept suggestions as a single JSON response because streaming 3 cards character-by-character adds UX complexity (which card is being written?) for no perceivable gain on Groq's speeds.
5. **Scroll-to-top vs. pin-newest.** The prototype shows older batches pushed *down* and faded — I match that. A power-user version might let you pin a batch.
