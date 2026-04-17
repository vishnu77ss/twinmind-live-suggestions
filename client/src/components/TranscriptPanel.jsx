import { useEffect, useRef } from "react";

function formatTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function TranscriptPanel({ recording, pending, chunks, onToggleMic }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chunks.length, pending]);

  return (
    <section className="col col-transcript">
      <header className="col-header">
        <div className="col-title">
          <span className="col-num">1.</span> Mic & Transcript
        </div>
        <div className={`col-status ${recording ? "live" : ""}`}>
          {recording ? "REC" : "IDLE"}
        </div>
      </header>

      <div className="mic-row">
        <button
          className={`mic-btn ${recording ? "on" : ""}`}
          onClick={onToggleMic}
          aria-label={recording ? "Stop recording" : "Start recording"}
          title={recording ? "Stop" : "Start"}
        >
          <span className="mic-dot" />
        </button>
        <div className="mic-hint">
          {recording
            ? "Listening. Transcript appends every ~30s."
            : "Click mic to start. Transcript appends every ~30s."}
        </div>
      </div>

      <div className="transcript-scroll" ref={scrollRef}>
        {chunks.length === 0 && !pending && (
          <div className="empty">No transcript yet — start the mic.</div>
        )}
        {chunks.map((c, i) => (
          <div className="transcript-line" key={i}>
            <span className="transcript-time">{formatTime(c.timestamp)}</span>
            <span className="transcript-text">{c.text}</span>
          </div>
        ))}
        {pending && (
          <div className="transcript-line pending">
            <span className="transcript-time">…</span>
            <span className="transcript-text">transcribing last chunk</span>
          </div>
        )}
      </div>
    </section>
  );
}
