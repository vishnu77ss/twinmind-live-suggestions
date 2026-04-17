import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A hook that records mic audio in ~N-second chunks and emits each chunk as a Blob
 * via onChunk. We achieve chunking by fully stopping + restarting the MediaRecorder
 * each interval — this gives each chunk a valid, self-contained webm header, which
 * matters because Whisper needs a decodable file per request.
 *
 * Restart gaps are on the order of a few milliseconds — acceptable for meeting-copilot use.
 */
export function useChunkedRecorder({ chunkSeconds = 30, onChunk, onError } = {}) {
  const [recording, setRecording] = useState(false);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const stoppingRef = useRef(false);
  const wantRunningRef = useRef(false);

  const pickMimeType = () => {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    for (const t of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(t)) return t;
    }
    return "";
  };

  const startRecorder = useCallback(() => {
    if (!streamRef.current) return;
    const mimeType = pickMimeType();
    const rec = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const type = mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      if (blob.size > 1024) {
        onChunk?.(blob);
      }
      // If the user still wants to record, start the next chunk.
      if (wantRunningRef.current && !stoppingRef.current) {
        try {
          startRecorder();
        } catch (err) {
          onError?.(err);
        }
      }
    };
    rec.onerror = (e) => onError?.(e.error || new Error("Recorder error"));

    recorderRef.current = rec;
    rec.start();

    // Schedule the stop for this chunk. onstop handler will relaunch the next.
    timerRef.current = setTimeout(() => {
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch (err) {
        onError?.(err);
      }
    }, chunkSeconds * 1000);
  }, [chunkSeconds, onChunk, onError]);

  const start = useCallback(async () => {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;
      wantRunningRef.current = true;
      stoppingRef.current = false;
      setRecording(true);
      startRecorder();
    } catch (err) {
      onError?.(err);
    }
  }, [recording, startRecorder, onError]);

  const stop = useCallback(() => {
    wantRunningRef.current = false;
    stoppingRef.current = true;
    setRecording(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop(); // flushes the final chunk via onstop
      }
    } catch {
      /* ignore */
    }
    // Release mic shortly after the last chunk flushes
    setTimeout(() => {
      streamRef.current?.getTracks()?.forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      stoppingRef.current = false;
    }, 200);
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { recording, start, stop };
}
