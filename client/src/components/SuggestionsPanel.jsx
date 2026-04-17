import { useEffect, useState } from "react";

const TYPE_META = {
  question: { label: "question to ask", cls: "type-question" },
  talking_point: { label: "talking point", cls: "type-talking" },
  answer: { label: "answer", cls: "type-answer" },
  fact_check: { label: "fact-check", cls: "type-fact" },
  clarify: { label: "clarify", cls: "type-clarify" },
};

function fmt(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function SuggestionsPanel({
  batches,
  onRefresh,
  onCardClick,
  refreshing,
  secondsUntilRefresh,
  autoRefresh,
}) {
  return (
    <section className="col col-suggestions">
      <header className="col-header">
        <div className="col-title">
          <span className="col-num">2.</span> Live Suggestions
        </div>
        <div className="col-status">{batches.length} BATCH{batches.length === 1 ? "" : "ES"}</div>
      </header>

      <div className="refresh-row">
        <button className="refresh-btn" onClick={onRefresh} disabled={refreshing}>
          <span className="refresh-icon">⟳</span>
          {refreshing ? "Refreshing…" : "Reload suggestions"}
        </button>
        <div className="auto-refresh">
          {autoRefresh && secondsUntilRefresh != null
            ? `auto-refresh in ${secondsUntilRefresh}s`
            : "manual refresh"}
        </div>
      </div>

      <div className="suggestions-scroll">
        {batches.length === 0 && (
          <div className="empty">
            Suggestions appear here once recording starts. Each refresh produces 3 fresh cards based on recent transcript context.
          </div>
        )}

        {batches.map((batch, bIdx) => (
          <div className={`batch ${bIdx === 0 ? "batch-current" : "batch-older"}`} key={batch.id}>
            <div className="batch-header">
              <span>Batch {batches.length - bIdx}</span>
              <span>{fmt(batch.timestamp)}</span>
            </div>
            {batch.suggestions.map((s, sIdx) => {
              const meta = TYPE_META[s.type] || TYPE_META.talking_point;
              return (
                <button
                  key={sIdx}
                  className="suggestion-card"
                  onClick={() => onCardClick(s)}
                >
                  <div className="suggestion-head">
                    <span className={`type-badge ${meta.cls}`}>{meta.label}</span>
                    <span className="suggestion-title">{s.title}</span>
                  </div>
                  <div className="suggestion-preview">{s.preview}</div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
