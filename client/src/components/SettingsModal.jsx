import { useState, useEffect } from "react";
import { DEFAULT_SETTINGS } from "../utils/settings.js";

export default function SettingsModal({ open, onClose, settings, onSaveSettings, apiKey, onSaveApiKey }) {
  const [local, setLocal] = useState(settings);
  const [key, setKey] = useState(apiKey);

  useEffect(() => { setLocal(settings); }, [settings, open]);
  useEffect(() => { setKey(apiKey); }, [apiKey, open]);

  if (!open) return null;

  const set = (k, v) => setLocal((p) => ({ ...p, [k]: v }));
  const num = (k, v) => set(k, v === "" ? "" : Number(v));

  const save = () => {
    // Guard against empty numerics
    const cleaned = { ...local };
    for (const [k, v] of Object.entries(cleaned)) {
      if (v === "" && k in DEFAULT_SETTINGS && typeof DEFAULT_SETTINGS[k] === "number") {
        cleaned[k] = DEFAULT_SETTINGS[k];
      }
    }
    onSaveSettings(cleaned);
    onSaveApiKey(key.trim());
    onClose();
  };

  const reset = () => setLocal({ ...DEFAULT_SETTINGS });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">Settings</div>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label>Groq API Key <span className="muted">(stored only in your browser)</span></label>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="gsk_…"
              autoComplete="off"
            />
            <div className="hint">Get one at console.groq.com. Your key is sent per-request and never stored on our server.</div>
          </div>

          <div className="field">
            <label>Model</label>
            <input value={local.model} onChange={(e) => set("model", e.target.value)} />
            <div className="hint">Default: openai/gpt-oss-120b. Whisper Large V3 is used for transcription.</div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label>Refresh cadence (seconds)</label>
              <input type="number" min="10" max="120" value={local.refreshSeconds}
                     onChange={(e) => num("refreshSeconds", e.target.value)} />
            </div>
            <div className="field">
              <label>Mic chunk size (seconds)</label>
              <input type="number" min="10" max="60" value={local.chunkSeconds}
                     onChange={(e) => num("chunkSeconds", e.target.value)} />
            </div>
          </div>

          <div className="grid-3">
            <div className="field">
              <label>Suggestion context (chars)</label>
              <input type="number" value={local.suggestionContextChars}
                     onChange={(e) => num("suggestionContextChars", e.target.value)} />
            </div>
            <div className="field">
              <label>Detail context (chars)</label>
              <input type="number" value={local.detailContextChars}
                     onChange={(e) => num("detailContextChars", e.target.value)} />
            </div>
            <div className="field">
              <label>Chat context (chars)</label>
              <input type="number" value={local.chatContextChars}
                     onChange={(e) => num("chatContextChars", e.target.value)} />
            </div>
          </div>

          <div className="grid-3">
            <div className="field">
              <label>Suggestion temp</label>
              <input type="number" step="0.05" min="0" max="1" value={local.suggestionTemperature}
                     onChange={(e) => num("suggestionTemperature", e.target.value)} />
            </div>
            <div className="field">
              <label>Detail temp</label>
              <input type="number" step="0.05" min="0" max="1" value={local.detailTemperature}
                     onChange={(e) => num("detailTemperature", e.target.value)} />
            </div>
            <div className="field">
              <label>Chat temp</label>
              <input type="number" step="0.05" min="0" max="1" value={local.chatTemperature}
                     onChange={(e) => num("chatTemperature", e.target.value)} />
            </div>
          </div>

          <div className="grid-3">
            <div className="field">
              <label>Suggestion max tokens</label>
              <input type="number" value={local.suggestionMaxTokens}
                     onChange={(e) => num("suggestionMaxTokens", e.target.value)} />
            </div>
            <div className="field">
              <label>Detail max tokens</label>
              <input type="number" value={local.detailMaxTokens}
                     onChange={(e) => num("detailMaxTokens", e.target.value)} />
            </div>
            <div className="field">
              <label>Chat max tokens</label>
              <input type="number" value={local.chatMaxTokens}
                     onChange={(e) => num("chatMaxTokens", e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label>Live Suggestion Prompt</label>
            <textarea rows={10} value={local.suggestionPrompt}
                      onChange={(e) => set("suggestionPrompt", e.target.value)} />
          </div>
          <div className="field">
            <label>Detailed Answer (on-click) Prompt</label>
            <textarea rows={8} value={local.detailPrompt}
                      onChange={(e) => set("detailPrompt", e.target.value)} />
          </div>
          <div className="field">
            <label>Chat Prompt</label>
            <textarea rows={6} value={local.chatPrompt}
                      onChange={(e) => set("chatPrompt", e.target.value)} />
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={reset}>Reset to defaults</button>
          <div className="spacer" />
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
