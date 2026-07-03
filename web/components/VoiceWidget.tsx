"use client";

import { useRef, useState, useCallback, useEffect } from "react";

const J = {
  bg: "#070B19",
  vault: "#111827",
  surface: "#1A2235",
  border: "#1F2937",
  borderHi: "#374151",
  mercury: "#00E676",
  surya: "#F59E0B",
  chandra: "#F8FAFC",
  textMid: "#9CA3AF",
  textDim: "#4B5563",
};

type CallState = "idle" | "connecting" | "listening" | "error" | "ended";

// Inline AudioWorklet processor — identical logic to the one proven correct
// in voice-pipeline/scripts/test_widget_local.html (resample-math verified
// there with a synthetic signal: 48kHz->16kHz gave exactly 16,000 samples
// at the exact right amplitude). Captures mic audio at whatever the
// AudioContext's native rate is and downsamples to 16kHz — matching
// PIPE_SR exactly, so the backend needs zero resampling on the input side.
const WORKLET_CODE = `
class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.inputRate = sampleRate;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    const ratio = this.inputRate / this.targetRate;
    const outLength = Math.floor(channel.length / ratio);
    const out = new Int16Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const srcIdx = i * ratio;
      const idxLow = Math.floor(srcIdx);
      const idxHigh = Math.min(idxLow + 1, channel.length - 1);
      const frac = srcIdx - idxLow;
      const sample = channel[idxLow] * (1 - frac) + channel[idxHigh] * frac;
      out[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    }
    this.port.postMessage(out.buffer, [out.buffer]);
    return true;
  }
}
registerProcessor('mic-capture-processor', MicCaptureProcessor);
`;

export default function VoiceWidget() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CallState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextPlayTimeRef = useRef(0);

  const cleanup = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close();
    }
    audioCtxRef.current = null;
    workletRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startCall = useCallback(async () => {
    setState("connecting");
    setErrorMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      const workletBlob = new Blob([WORKLET_CODE], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(workletBlob);
      await audioCtx.audioWorklet.addModule(workletUrl);

      const source = audioCtx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioCtx, "mic-capture-processor");
      workletRef.current = workletNode;
      source.connect(workletNode);
      // Deliberately not connected to destination — don't play the
      // caller's own mic input back to them.

      const base = process.env.NEXT_PUBLIC_API_URL || "https://api.jovio.in";
      const wsUrl = base.replace(/^https:/, "wss:").replace(/^http:/, "ws:") + "/ws/widget";
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        setState("listening");
        nextPlayTimeRef.current = audioCtx.currentTime;
        workletNode.port.onmessage = (event: MessageEvent) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(event.data);
          }
        };
      };

      ws.onmessage = (event: MessageEvent) => {
        const int16 = new Int16Array(event.data);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
        const buffer = audioCtx.createBuffer(1, float32.length, 8000);
        buffer.getChannelData(0).set(float32);
        const src = audioCtx.createBufferSource();
        src.buffer = buffer;
        src.connect(audioCtx.destination);
        const startAt = Math.max(nextPlayTimeRef.current, audioCtx.currentTime);
        src.start(startAt);
        nextPlayTimeRef.current = startAt + buffer.duration;
      };

      ws.onerror = () => {
        setState("error");
        setErrorMsg("Connection failed — check your internet and try again.");
      };
      ws.onclose = () => {
        setState((prev) => (prev === "error" ? prev : "ended"));
      };
    } catch (err) {
      setState("error");
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("permission") || message.toLowerCase().includes("denied")) {
        setErrorMsg("Microphone access denied — allow it in your browser to try Nikki live.");
      } else {
        setErrorMsg("Couldn't start the demo — try again in a moment.");
      }
    }
  }, []);

  const endCall = useCallback(() => {
    cleanup();
    setState("ended");
  }, [cleanup]);

  const closePanel = useCallback(() => {
    cleanup();
    setOpen(false);
    setState("idle");
  }, [cleanup]);

  return (
    <>
      {/* Floating launcher button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Talk to Nikki live"
          style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 1000,
            display: "flex", alignItems: "center", gap: 10,
            background: J.mercury, color: J.bg, border: "none",
            borderRadius: 999, padding: "14px 22px", fontSize: 15, fontWeight: 700,
            cursor: "pointer", boxShadow: `0 4px 24px ${J.mercury}55`,
            fontFamily: "var(--font-body), sans-serif",
          }}
        >
          <span style={{
            width: 10, height: 10, borderRadius: "50%", background: J.bg,
            animation: "pulse 2s infinite",
          }} />
          Talk to Nikki — live
        </button>
      )}

      {/* Expanded call panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Live voice demo with Nikki"
          style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 1000,
            width: 320, background: J.vault, border: `1px solid ${J.borderHi}`,
            borderRadius: 16, padding: 20, boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
            fontFamily: "var(--font-body), sans-serif",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%",
                background: state === "listening" ? J.mercury : state === "error" ? "#EF4444" : J.textDim,
                animation: state === "listening" ? "pulse 1.5s infinite" : undefined,
              }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: J.chandra, fontFamily: "var(--font-mono)" }}>
                {state === "idle" && "Ready"}
                {state === "connecting" && "Connecting..."}
                {state === "listening" && "Live — speak now"}
                {state === "error" && "Error"}
                {state === "ended" && "Call ended"}
              </span>
            </div>
            <button
              onClick={closePanel}
              aria-label="Close"
              style={{
                background: "none", border: "none", color: J.textMid,
                fontSize: 20, cursor: "pointer", lineHeight: 1, padding: 4,
              }}
            >
              ×
            </button>
          </div>

          {state === "idle" && (
            <>
              <p style={{ fontSize: 13, color: J.textMid, marginBottom: 16, lineHeight: 1.5 }}>
                Talk to Nikki directly through your microphone — a real, live
                conversation, not a recording. Telugu, Hindi, or English, switch
                anytime mid-call.
              </p>
              <button
                onClick={startCall}
                style={{
                  width: "100%", background: J.mercury, color: J.bg, border: "none",
                  borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Start live demo
              </button>
            </>
          )}

          {state === "connecting" && (
            <p style={{ fontSize: 13, color: J.textMid }}>
              Requesting microphone access — allow it when your browser asks.
            </p>
          )}

          {state === "listening" && (
            <>
              <p style={{ fontSize: 13, color: J.textMid, marginBottom: 16, lineHeight: 1.5 }}>
                Nikki is listening. Say hello, ask about appointments, or
                switch languages mid-sentence — she'll follow.
              </p>
              <button
                onClick={endCall}
                style={{
                  width: "100%", background: "transparent", color: "#EF4444",
                  border: "1px solid #EF444455", borderRadius: 10, padding: "12px",
                  fontSize: 14, fontWeight: 700, cursor: "pointer",
                }}
              >
                End call
              </button>
            </>
          )}

          {state === "error" && (
            <>
              <p style={{ fontSize: 13, color: "#F87171", marginBottom: 16, lineHeight: 1.5 }}>
                {errorMsg}
              </p>
              <button
                onClick={startCall}
                style={{
                  width: "100%", background: J.surface, color: J.chandra,
                  border: `1px solid ${J.borderHi}`, borderRadius: 10, padding: "12px",
                  fontSize: 14, fontWeight: 700, cursor: "pointer",
                }}
              >
                Try again
              </button>
            </>
          )}

          {state === "ended" && (
            <>
              <p style={{ fontSize: 13, color: J.textMid, marginBottom: 16 }}>
                Call ended. Want to try it again?
              </p>
              <button
                onClick={startCall}
                style={{
                  width: "100%", background: J.mercury, color: J.bg, border: "none",
                  borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Start new demo
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
