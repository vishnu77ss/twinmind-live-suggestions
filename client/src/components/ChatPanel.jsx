import { useEffect, useRef, useState } from "react";

function fmt(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function ChatPanel({ messages, onSend, streaming }) {
  const [input, setInput] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  const submit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    onSend(text);
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section className="col col-chat">
      <header className="col-header">
        <div className="col-title">
          <span className="col-num">3.</span> Chat (Detailed Answers)
        </div>
        <div className="col-status">SESSION-ONLY</div>
      </header>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty">
            Click a suggestion to get a detailed answer, or type a question below. One continuous chat per session.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg chat-${m.role}`}>
            <div className="chat-meta">
              <span>{m.role === "user" ? "You" : "TwinMind"}</span>
              <span>{fmt(m.timestamp)}</span>
            </div>
            {m.suggestionRef && (
              <div className="chat-suggestion-ref">
                <span className="ref-type">{m.suggestionRef.type.replace("_", " ")}</span>
                <span className="ref-title">{m.suggestionRef.title}</span>
                <div className="ref-preview">{m.suggestionRef.preview}</div>
              </div>
            )}
            <div className="chat-body">{m.content || (m.streaming ? "…" : "")}</div>
          </div>
        ))}
      </div>

      <div className="chat-input-row">
        <textarea
          className="chat-input"
          placeholder="Ask anything…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          disabled={streaming}
        />
        <button className="send-btn" onClick={submit} disabled={streaming || !input.trim()}>
          {streaming ? "…" : "Send"}
        </button>
      </div>
    </section>
  );
}
