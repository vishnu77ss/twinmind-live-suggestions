import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TranscriptPanel from "./components/TranscriptPanel.jsx";
import SuggestionsPanel from "./components/SuggestionsPanel.jsx";
import ChatPanel from "./components/ChatPanel.jsx";
import SettingsModal from "./components/SettingsModal.jsx";
import { useChunkedRecorder } from "./hooks/useChunkedRecorder.js";
import { fetchSuggestions, streamChat, transcribeChunk } from "./utils/api.js";
import { loadApiKey, loadSettings, saveApiKey, saveSettings } from "./utils/settings.js";

const uid = () => Math.random().toString(36).slice(2, 10);

export default function App() {
  const [settings, setSettings] = useState(() => loadSettings());
  const [apiKey, setApiKey] = useState(() => loadApiKey());
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Transcript state — array of { id, timestamp, text }
  const [transcriptChunks, setTranscriptChunks] = useState([]);
  const [transcribing, setTranscribing] = useState(false);

  // Suggestions state — array of batches, newest first. Each batch: { id, timestamp, suggestions }
  const [batches, setBatches] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(null);

  // Chat state — array of { id, role, content, timestamp, suggestionRef?, streaming? }
  const [chatMessages, setChatMessages] = useState([]);
  const [chatStreaming, setChatStreaming] = useState(false);
  const chatAbortRef = useRef(null);

  // Banner for errors
  const [banner, setBanner] = useState(null);

  // Track titles we've already shown this session, so the prompt can dedup.
  const shownTitles = useMemo(
    () => batches.flatMap((b) => b.suggestions.map((s) => s.title)),
    [batches]
  );

  // Full transcript string, used as context for suggestions + chat.
  const fullTranscript = useMemo(
    () => transcriptChunks.map((c) => c.text).join(" ").trim(),
    [transcriptChunks]
  );

  // ───── Mic + transcription ─────
  const onAudioChunk = useCallback(
    async (blob) => {
      if (!apiKey) {
        setBanner("Paste your Groq API key in Settings to enable transcription.");
        return;
      }
      setTranscribing(true);
      try {
        const { text } = await transcribeChunk({ apiKey, blob });
        if (text && text.trim()) {
          setTranscriptChunks((prev) => [
            ...prev,
            { id: uid(), timestamp: Date.now(), text: text.trim() },
          ]);
        }
      } catch (err) {
        // Show the error but keep recording — next chunk will retry automatically
        setBanner(`Transcription failed: ${err.message}`);
      } finally {
        setTranscribing(false);
      }
    },
    [apiKey]
  );

  const { recording, start, stop } = useChunkedRecorder({
    chunkSeconds: Number(settings.chunkSeconds) || 30,
    onChunk: onAudioChunk,
    onError: (err) => setBanner(`Mic error: ${err.message || err}`),
  });

  const toggleMic = () => {
    if (recording) stop();
    else start();
  };

  // ───── Suggestions refresh ─────
  const refreshSuggestions = useCallback(async () => {
    if (refreshing) return;
    if (!apiKey) {
      setBanner("Paste your Groq API key in Settings to enable suggestions.");
      return;
    }
    if (!fullTranscript) return; // nothing to suggest on yet
    setRefreshing(true);
    try {
      const { suggestions } = await fetchSuggestions({
        apiKey,
        transcript: fullTranscript,
        shownTitles,
        settings,
      });
      if (suggestions && suggestions.length) {
        setBatches((prev) => [
          { id: uid(), timestamp: Date.now(), suggestions },
          ...prev,
        ]);
      }
    } catch (err) {
      setBanner(`Suggestions failed: ${err.message}`);
    } finally {
      setRefreshing(false);
    }
  }, [apiKey, fullTranscript, refreshing, settings, shownTitles]);

  // Keep the latest refresh fn in a ref so the timer effect doesn't re-subscribe
  // every time shownTitles/transcript change (which would reset the countdown and,
  // under React StrictMode in dev, cause double-fires).
  const refreshRef = useRef(refreshSuggestions);
  useEffect(() => {
    refreshRef.current = refreshSuggestions;
  }, [refreshSuggestions]);

  // Auto-refresh timer — runs while recording.
  useEffect(() => {
    if (!recording) {
      setSecondsUntilRefresh(null);
      return;
    }
    const cadence = Math.max(10, Number(settings.refreshSeconds) || 30);
    setSecondsUntilRefresh(cadence);

    const tick = setInterval(() => {
      setSecondsUntilRefresh((s) => {
        if (s == null) return s;
        if (s <= 1) {
          // fire refresh via ref so this effect's identity is stable
          refreshRef.current?.();
          return cadence;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [recording, settings.refreshSeconds]);

  // ───── Chat streaming ─────
  const runStream = useCallback(
    async ({ mode, suggestion, message }) => {
      if (!apiKey) {
        setBanner("Paste your Groq API key in Settings to use chat.");
        return;
      }
      if (chatStreaming) return;

      // Compose the user-facing message bubble(s)
      const userTs = Date.now();
      const userMsg =
        mode === "detail"
          ? {
              id: uid(),
              role: "user",
              timestamp: userTs,
              content: `Tell me more: ${suggestion.title}`,
              suggestionRef: suggestion,
            }
          : { id: uid(), role: "user", timestamp: userTs, content: message };

      const assistantId = uid();
      const assistantMsg = {
        id: assistantId,
        role: "assistant",
        timestamp: userTs + 1,
        content: "",
        streaming: true,
      };

      // history for the model = prior messages (excluding the one we're about to send)
      const history = chatMessages.map((m) => ({
        role: m.role,
        content:
          m.role === "user" && m.suggestionRef
            ? `[tapped suggestion — ${m.suggestionRef.type}] ${m.suggestionRef.title}: ${m.suggestionRef.preview}`
            : m.content,
      }));

      setChatMessages((prev) => [...prev, userMsg, assistantMsg]);
      setChatStreaming(true);

      const controller = new AbortController();
      chatAbortRef.current = controller;

      try {
        await streamChat({
          apiKey,
          mode,
          transcript: fullTranscript,
          suggestion,
          history,
          message,
          settings,
          signal: controller.signal,
          onDelta: (_delta, full) => {
            setChatMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: full } : m))
            );
          },
        });
      } catch (err) {
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content || `[error: ${err.message}]` }
              : m
          )
        );
        if (err.name !== "AbortError") setBanner(`Chat failed: ${err.message}`);
      } finally {
        setChatMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m))
        );
        setChatStreaming(false);
        chatAbortRef.current = null;
      }
    },
    [apiKey, chatMessages, chatStreaming, fullTranscript, settings]
  );

  const onSuggestionClick = (s) => runStream({ mode: "detail", suggestion: s });
  const onChatSend = (text) => runStream({ mode: "chat", message: text });

  // ───── Export session ─────
  const exportSession = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      model: settings.model,
      transcript: transcriptChunks.map((c) => ({
        timestamp: new Date(c.timestamp).toISOString(),
        text: c.text,
      })),
      suggestionBatches: [...batches]
        .slice()
        .reverse() // oldest first in export for readability
        .map((b, i) => ({
          batch: i + 1,
          timestamp: new Date(b.timestamp).toISOString(),
          suggestions: b.suggestions,
        })),
      chat: chatMessages.map((m) => ({
        timestamp: new Date(m.timestamp).toISOString(),
        role: m.role,
        content: m.content,
        suggestionRef: m.suggestionRef || null,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `twinmind-session-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ───── Save handlers ─────
  const handleSaveSettings = (s) => {
    setSettings(s);
    saveSettings(s);
  };
  const handleSaveApiKey = (k) => {
    setApiKey(k);
    saveApiKey(k);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◎</span>
          <span className="brand-name">TwinMind</span>
          <span className="brand-sub">— Live Suggestions</span>
        </div>
        <div className="top-actions">
          <div className="layout-hint">3-column layout · Transcript · Live Suggestions · Chat</div>
          <button className="btn btn-ghost" onClick={exportSession} title="Export full session as JSON">
            Export
          </button>
          <button
            className={`btn ${apiKey ? "btn-ghost" : "btn-primary"}`}
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            {apiKey ? "Settings" : "Add API Key"}
          </button>
        </div>
      </header>

      {banner && (
        <div className="banner">
          <span>{banner}</span>
          <button className="icon-btn" onClick={() => setBanner(null)}>×</button>
        </div>
      )}

      <main className="columns">
        <TranscriptPanel
          recording={recording}
          pending={transcribing}
          chunks={transcriptChunks}
          onToggleMic={toggleMic}
        />
        <SuggestionsPanel
          batches={batches}
          onRefresh={refreshSuggestions}
          onCardClick={onSuggestionClick}
          refreshing={refreshing}
          secondsUntilRefresh={secondsUntilRefresh}
          autoRefresh={recording}
        />
        <ChatPanel
          messages={chatMessages}
          onSend={onChatSend}
          streaming={chatStreaming}
        />
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
        apiKey={apiKey}
        onSaveApiKey={handleSaveApiKey}
      />
    </div>
  );
}
