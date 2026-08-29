"use client";
// web/components/CallConsole.tsx
// ────────────────────────────────────────────────────────────────
// THE REAL THING. Not a demo of the product — the product, running.
//
//   your mic → MediaRecorder (webm/opus)
//            → /api/public/voice-turn
//                → Sarvam Saaras v3   (real Telugu STT)
//                → Gemini 2.5 Flash   (real LLM, real session memory)
//                → Sarvam Bulbul v3   (real Telugu neural TTS)
//            → <AudioContext> playback
//
// What made the old widget sound like a bot reading aloud, and what
// changed here:
//
//   1. It ran a 4-stage hardcoded script (name → phone → service →
//      slot). Ask it anything else and it either ignored you or
//      stored your question as your name. Now: real Gemini, real
//      conversation, it can be interrupted and asked something else.
//
//   2. It spoke through the browser's speechSynthesis with Telugu
//      transliterated to Latin — "Namaskaram", not నమస్కారం. That is
//      an English voice doing an impression of Telugu. Now: actual
//      Sarvam Bulbul Telugu neural TTS, same voice as live calls.
//
//   3. It was push-to-talk. Real calls have no button. Now: after
//      Nikki finishes, the mic opens by itself, and silence ends
//      your turn — energy-based endpointing, same idea as the VAD
//      in the phone pipeline.
//
//   4. It could not be interrupted. Now: barge-in. Start talking
//      over Nikki and she stops mid-word, like a person would.
// ────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Phone, PhoneOff, Mic, Loader2, Check, RotateCcw, MessageCircle, AlertCircle,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

const K = {
  ink:      "#0B1F33",
  inkSoft:  "#12293F",
  hairline: "rgba(255,255,255,0.10)",
  teal:     "#12457A",
  tealLit:  "#3D8FC4",
  live:     "#22C55E",
  marigold: "#E9A72C",
  red:      "#E5533D",
  dim:      "rgba(255,255,255,0.52)",
  dimmer:   "rgba(255,255,255,0.32)",
};

type CallState = "ringing" | "connecting" | "live" | "ended";
type Voice     = "idle" | "listening" | "thinking" | "speaking";

interface Line { who: "nikki" | "caller"; text: string; }

const BARS = 28;

// ── Endpointing constants ─────────────────────────────────────
// Tuned the way the phone pipeline's VAD is: long enough that a
// natural pause mid-sentence doesn't cut you off, short enough that
// the reply doesn't feel late.
const SILENCE_RMS       = 0.020;  // below this counts as silence
const BARGE_IN_RMS      = 0.055;  // louder — avoids Nikki's own echo tripping it
const END_SILENCE_MS    = 950;    // silence that ends your turn
const MIN_SPEECH_MS     = 320;    // ignore coughs, clicks, door slams
const MAX_TURN_MS       = 20_000; // hard stop

export default function CallConsole() {
  const [callState, setCallState] = useState<CallState>("ringing");
  const [voice, setVoice]         = useState<Voice>("idle");
  const [lines, setLines]         = useState<Line[]>([]);
  const [seconds, setSeconds]     = useState(0);
  const [typed, setTyped]         = useState("");
  const [levels, setLevels]       = useState<number[]>(() => new Array(BARS).fill(0.05));
  const [reduced, setReduced]     = useState(false);
  const [booking, setBooking]     = useState<string>("");
  const [error, setError]         = useState<string>("");
  const [turnsLeft, setTurnsLeft] = useState<number | null>(null);
  const [micReady, setMicReady]   = useState(false);

  // Refs — callbacks below run outside React's render cycle and would
  // otherwise close over stale state.
  const sessionRef  = useRef<string>("");
  const streamRef   = useRef<MediaStream | null>(null);
  const ctxRef      = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const rafRef      = useRef<number | null>(null);
  const srcRef      = useRef<AudioBufferSourceNode | null>(null);
  const playAnalyRef= useRef<AnalyserNode | null>(null);
  const voiceRef    = useRef<Voice>("idle");
  const endedRef    = useRef(false);
  const logRef      = useRef<HTMLDivElement>(null);
  const autoStopRef = useRef<number | null>(null);
  // Guards answer() against re-entry. A ref, not state: answer() is a
  // useCallback and reading callState inside it would capture a stale
  // value unless callState were in the deps array — which would
  // recreate the callback on every state change and defeat the point.
  const answeringRef = useRef(false);

  useEffect(() => { voiceRef.current = voice; }, [voice]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    sessionRef.current = `web-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    return () => mq.removeEventListener?.("change", on);
  }, []);

  useEffect(() => {
    if (callState !== "live") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [callState]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [lines, reduced]);

  // ── Teardown ────────────────────────────────────────────────
  const teardown = useCallback(() => {
    endedRef.current = true;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    rafRef.current = null;
    autoStopRef.current = null;
    try { recorderRef.current?.state === "recording" && recorderRef.current.stop(); } catch {}
    try { srcRef.current?.stop(); } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    analyserRef.current = null;
    playAnalyRef.current = null;
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  // ── Meter loop: drives the waveform AND the endpointing ─────
  // One rAF loop reads whichever analyser is live — your mic while
  // you're talking, Nikki's playback while she is. The bars are never
  // decorative; they're always showing real audio.
  const startMeterLoop = useCallback(() => {
    if (rafRef.current) return;

    let speechMs   = 0;
    let silenceMs  = 0;
    let lastT      = performance.now();

    const tick = () => {
      const now = performance.now();
      const dt  = now - lastT;
      lastT = now;

      const speaking = voiceRef.current === "speaking";
      const analyser = speaking ? playAnalyRef.current : analyserRef.current;

      if (analyser) {
        const buf = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(buf);

        const next: number[] = [];
        const step = Math.floor(buf.length / BARS) || 1;
        for (let i = 0; i < BARS; i++) next.push(Math.max(0.05, buf[i * step] / 255));
        if (!reduced) setLevels(next);

        // RMS from the mic, used for both endpointing and barge-in.
        const mic = analyserRef.current;
        if (mic) {
          const t = new Uint8Array(mic.fftSize);
          mic.getByteTimeDomainData(t);
          let sum = 0;
          for (let i = 0; i < t.length; i++) {
            const v = (t[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / t.length);

          if (voiceRef.current === "listening") {
            if (rms > SILENCE_RMS) { speechMs += dt; silenceMs = 0; }
            else if (speechMs > 0) { silenceMs += dt; }

            // Turn ends when you stop talking — not when you press a button.
            if (speechMs >= MIN_SPEECH_MS && silenceMs >= END_SILENCE_MS) {
              speechMs = 0; silenceMs = 0;
              stopAndSend();
            }
          } else if (voiceRef.current === "speaking" && rms > BARGE_IN_RMS) {
            // Barge-in: talking over her cuts her off, like a real call.
            speechMs = 0; silenceMs = 0;
            interruptNikki();
          } else {
            speechMs = 0; silenceMs = 0;
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  // ── Play Nikki's real Sarvam audio ──────────────────────────
  const playReply = useCallback(async (b64: string | null, onDone: () => void) => {
    const ctx = ctxRef.current;
    if (!b64 || !ctx) { onDone(); return; }

    try {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const buf   = await ctx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);

      const src      = ctx.createBufferSource();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.72;
      src.buffer = buf;
      src.connect(analyser);
      analyser.connect(ctx.destination);

      srcRef.current      = src;
      playAnalyRef.current = analyser;

      src.onended = () => {
        srcRef.current = null;
        playAnalyRef.current = null;
        onDone();
      };
      setVoice("speaking");
      src.start();
    } catch {
      onDone();
    }
  }, []);

  const interruptNikki = useCallback(() => {
    try { srcRef.current?.stop(); } catch {}
    srcRef.current = null;
    playAnalyRef.current = null;
    // onended fires from stop(), which hands control to beginListening.
  }, []);

  // ── Send one turn to the real pipeline ──────────────────────
  const sendTurn = useCallback(async (payload: { audio_base64?: string; mime_type?: string; text?: string }) => {
    setVoice("thinking");
    setError("");

    try {
      const r = await fetch(`${API}/api/public/voice-turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // persona:"product" — without it the pipeline falls back to
        // _DEMO_PROFILE, a pretend clinic whose services are "Doctor
        // Consultation" and "Dental Check-up". So the console on OUR landing
        // page answered "which service do you want an appointment for?" and
        // tried to book a hospital visit for a visitor who came to find out
        // what HeyNikki is. Same Nikki as the wake-word widget now: she talks
        // about this product, and books a demo or a callback.
        body: JSON.stringify({ ...payload, session_id: sessionRef.current, persona: "product" }),
        // A turn does STT + Gemini + TTS server-side and normally lands
        // in under 4s. Without a ceiling, a stalled mobile connection
        // leaves the caller watching the thinking dots forever with no
        // way back — the fetch never settles, so neither does the UI.
        // 45s is generous for a slow 3G upload and still recovers.
        signal: AbortSignal.timeout(45_000),
      });
      const data = await r.json();

      if (data.transcript) setLines((l) => [...l, { who: "caller", text: data.transcript }]);

      if (!r.ok) {
        if (data.error === "demo_turn_limit") {
          setLines((l) => [...l, { who: "nikki", text: data.reply }]);
          setTimeout(() => setCallState("ended"), 1200);
          return;
        }
        setError(data.reply || "Connection trouble — try again.");
        setVoice("idle");
        beginListening();
        return;
      }

      if (typeof data.turns_left === "number") setTurnsLeft(data.turns_left);
      if (data.booking_confirmed && data.booking_summary) setBooking(data.booking_summary);

      setLines((l) => [...l, { who: "nikki", text: data.reply }]);

      playReply(data.audio_base64, () => {
        if (endedRef.current) return;
        if (data.booking_confirmed) {
          setVoice("idle");
          setTimeout(() => setCallState("ended"), 1100);
        } else {
          beginListening();
        }
      });
    } catch (err: any) {
      // AbortError means our own timeout fired, which is worth saying
      // differently: "slow" is actionable, "unreachable" is not.
      setError(err?.name === "TimeoutError" || err?.name === "AbortError"
        ? "That took too long — the line may be slow. Try again."
        : "Couldn't reach Nikki. Check your connection.");
      setVoice("idle");
      // Reopen the mic so the caller can simply retry by speaking,
      // rather than being stranded on an error with no next step.
      if (!endedRef.current) beginListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playReply]);

  // ── Recording ───────────────────────────────────────────────
  const stopAndSend = useCallback(() => {
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
    const rec = recorderRef.current;
    if (rec && rec.state === "recording") rec.stop();   // onstop does the send
  }, []);

  const beginListening = useCallback(() => {
    if (endedRef.current) return;
    const stream = streamRef.current;
    if (!stream) return;

    chunksRef.current = [];
    // Opus in webm is what every Chromium and Firefox build produces,
    // and Sarvam's STT accepts it directly — no client-side re-encode.
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      setError("This browser can't record audio — type instead.");
      setVoice("idle");
      return;
    }

    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      chunksRef.current = [];
      if (blob.size < 1200 || endedRef.current) {   // effectively silence
        if (!endedRef.current) beginListening();
        return;
      }
      const b64 = await blobToBase64(blob);
      sendTurn({ audio_base64: b64, mime_type: rec.mimeType || "audio/webm" });
    };

    recorderRef.current = rec;
    rec.start();
    setVoice("listening");

    // Hard ceiling so a stuck-open mic can't record forever.
    autoStopRef.current = window.setTimeout(stopAndSend, MAX_TURN_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendTurn, stopAndSend]);

  // ── Answer ──────────────────────────────────────────────────
  const answer = useCallback(async () => {
    // Guard against a second invocation. Without this, a double-tap —
    // ordinary behaviour on a phone — starts TWO calls: two getUserMedia
    // grants, two AudioContexts, two __CALL_START__ turns, and the
    // second run overwrites the refs so the first stream and context
    // leak with no way to close them. The visible symptom is a mic
    // indicator that stays lit after the call ends.
    if (answeringRef.current) return;
    answeringRef.current = true;

    setCallState("connecting");
    endedRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,   // stops Nikki's own voice re-entering the mic
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      await ctx.resume();
      ctxRef.current = ctx;

      const src = ctx.createMediaStreamSource(stream);
      const an  = ctx.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.7;
      src.connect(an);
      analyserRef.current = an;
      setMicReady(true);
      startMeterLoop();
    } catch {
      // No mic is a normal state, not a failure — typing still works.
      setMicReady(false);
      setError("Mic blocked. You can still type to Nikki.");
    }

    setCallState("live");
    // Empty first turn: the pipeline's own opening line, generated by
    // Gemini from the business profile — not a hardcoded greeting.
    sendTurn({ text: "__CALL_START__" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendTurn, startMeterLoop]);

  const endCall = useCallback(() => { teardown(); setVoice("idle"); setCallState("ended"); }, [teardown]);

  const reset = useCallback(() => {
    teardown();
    endedRef.current = false;
    answeringRef.current = false;
    sessionRef.current = `web-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setCallState("ringing"); setVoice("idle"); setLines([]);
    setSeconds(0); setTyped(""); setBooking(""); setError("");
    setTurnsLeft(null); setLevels(new Array(BARS).fill(0.05));
  }, [teardown]);

  const sendTyped = () => {
    const t = typed.trim();
    if (!t) return;
    setTyped("");
    if (voiceRef.current === "speaking") interruptNikki();
    if (recorderRef.current?.state === "recording") {
      try { recorderRef.current.stop(); } catch {}
    }
    sendTurn({ text: t });
  };

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  const statusLine =
    voice === "listening" ? "Listening — just stop talking when you're done"
    : voice === "thinking" ? "Thinking…"
    : voice === "speaking" ? "Nikki is speaking — talk over her to interrupt"
    : "";

  // ══════════════════════════════════════════════════════════════
  return (
    <div style={{
      background: `linear-gradient(168deg, ${K.ink} 0%, ${K.inkSoft} 100%)`,
      border: `1px solid ${K.hairline}`, borderRadius: 20, overflow: "hidden",
      boxShadow: "0 32px 80px -24px rgba(11,31,51,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset",
      display: "flex", flexDirection: "column",
      // 560 fixed was taller than the usable viewport on a small phone
      // (an iPhone SE has ~560px left after browser chrome), which
      // pushed the answer button below the fold on the one screen where
      // it has to be visible. min() lets it shrink on short screens and
      // keeps the roomier layout on a laptop.
      minHeight: "min(560px, 78vh)",
    }}>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 18px", borderBottom: `1px solid ${K.hairline}`,
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: K.dim }}>
          <span aria-hidden style={{
            width: 7, height: 7, borderRadius: "50%",
            background: callState === "live" ? K.live : callState === "ringing" ? K.marigold : K.dimmer,
            boxShadow: callState === "live" ? "0 0 0 4px rgba(34,197,94,0.18)" : "none",
            animation: callState === "ringing" && !reduced ? "nk-pulse 1.4s ease-in-out infinite" : "none",
          }} />
          {callState === "ringing"    && "Incoming call"}
          {callState === "connecting" && "Connecting"}
          {callState === "live"       && "Live · Telugu"}
          {callState === "ended"      && "Call ended"}
        </span>
        <span style={{ color: K.dimmer, fontVariantNumeric: "tabular-nums" }}>
          {callState === "live" || callState === "ended" ? mmss : "+91 40 4895 6986"}
        </span>
      </div>

      {/* ══ RINGING ══ */}
      {callState === "ringing" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px", textAlign: "center" }}>
          <div style={{ position: "relative", marginBottom: 26 }}>
            {!reduced && [0, 1, 2].map((i) => (
              <span key={i} aria-hidden style={{
                position: "absolute", inset: 0, margin: "auto", width: 76, height: 76,
                borderRadius: "50%", border: `1px solid ${K.marigold}`,
                animation: `nk-ring 2.4s cubic-bezier(0.2,0.6,0.3,1) ${i * 0.8}s infinite`,
              }} />
            ))}
            <div style={{
              width: 76, height: 76, borderRadius: "50%", background: "rgba(233,167,44,0.12)",
              border: "1px solid rgba(233,167,44,0.4)", display: "grid", placeItems: "center", position: "relative",
            }}>
              <Phone size={28} color={K.marigold} />
            </div>
          </div>

          <p style={{ margin: "0 0 6px", color: "#fff", fontSize: 19, fontWeight: 600, fontFamily: "var(--font-display), system-ui" }}>
            A customer is calling. You&apos;re busy.
          </p>
          <p style={{ margin: "0 0 26px", color: K.dim, fontSize: 14, lineHeight: 1.6, maxWidth: 340 }}>
            This is the call you&apos;d normally miss. Answer it and talk to Nikki in Telugu —
            no buttons, just speak like you would on the phone.
          </p>

          <button onClick={answer} style={{
            display: "inline-flex", alignItems: "center", gap: 10, padding: "14px 26px",
            borderRadius: 999, border: "none", background: K.live, color: "#04240F",
            cursor: "pointer", fontSize: 15, fontWeight: 700,
            fontFamily: "var(--font-body), system-ui",
            boxShadow: "0 10px 30px -8px rgba(34,197,94,0.5)",
          }}>
            <Phone size={17} /> Answer with Nikki
          </button>
          <span style={{ marginTop: 14, color: K.dimmer, fontSize: 12, fontFamily: "var(--font-mono), monospace" }}>
            Uses your mic · Sound on
          </span>
        </div>
      )}

      {/* ══ CONNECTING ══ */}
      {callState === "connecting" && (
        <div style={{ flex: 1, display: "grid", placeItems: "center", gap: 14, padding: 40 }}>
          <Loader2 size={26} color={K.tealLit} style={{ animation: reduced ? "none" : "nk-spin 1s linear infinite" }} />
          <span style={{ color: K.dim, fontSize: 13, fontFamily: "var(--font-mono), monospace", letterSpacing: "0.06em" }}>
            Connecting you to Nikki…
          </span>
        </div>
      )}

      {/* ══ LIVE ══ */}
      {callState === "live" && (
        <>
          {/* Waveform — real audio, both directions */}
          <div aria-hidden style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
            height: 62, padding: "0 18px", borderBottom: `1px solid ${K.hairline}`,
            background: "rgba(0,0,0,0.16)",
          }}>
            {levels.map((v, i) => (
              <span key={i} style={{
                flex: 1, maxWidth: 5, borderRadius: 3,
                height: `${Math.round(v * 42) + 3}px`,
                background: voice === "listening" ? K.live : voice === "speaking" ? K.tealLit : "rgba(255,255,255,0.16)",
                transition: reduced ? "none" : "height 80ms linear, background 200ms",
              }} />
            ))}
          </div>

          {/* Transcript */}
          <div ref={logRef} role="log" aria-live="polite" aria-label="Call transcript"
            style={{
              flex: 1, overflowY: "auto", padding: 18,
              display: "flex", flexDirection: "column", gap: 12,
              maxHeight: "min(250px, 34vh)",
              // -webkit-overflow-scrolling gives iOS momentum scrolling;
              // without it the transcript feels stuck on an iPhone.
              WebkitOverflowScrolling: "touch",
            }}>
            {lines.map((l, i) => (
              <div key={i} style={{
                alignSelf: l.who === "nikki" ? "flex-start" : "flex-end", maxWidth: "86%",
                background: l.who === "nikki" ? "rgba(255,255,255,0.06)" : K.teal,
                border: `1px solid ${l.who === "nikki" ? K.hairline : "transparent"}`,
                borderRadius: l.who === "nikki" ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
                padding: "10px 13px", color: l.who === "nikki" ? "rgba(255,255,255,0.92)" : "#fff",
                fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap",
                fontFamily: "var(--font-telugu), var(--font-body), system-ui",
              }}>
                <span style={{
                  display: "block", marginBottom: 4, fontSize: 10, letterSpacing: "0.1em",
                  textTransform: "uppercase", opacity: 0.5, fontFamily: "var(--font-mono), monospace",
                }}>
                  {l.who === "nikki" ? "Nikki" : "You"}
                </span>
                {l.text}
              </div>
            ))}
            {voice === "thinking" && (
              <div style={{ alignSelf: "flex-start", display: "inline-flex", gap: 5, padding: "12px 14px" }}>
                {[0, 1, 2].map((i) => (
                  <span key={i} aria-hidden style={{
                    width: 6, height: 6, borderRadius: "50%", background: K.dimmer,
                    animation: reduced ? "none" : `nk-bounce 1.1s ease-in-out ${i * 0.14}s infinite`,
                  }} />
                ))}
              </div>
            )}
          </div>

          {/* Controls */}
          <div style={{ borderTop: `1px solid ${K.hairline}`, padding: "12px 16px", background: "rgba(0,0,0,0.2)" }}>
            {statusLine && (
              <div style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
                color: voice === "listening" ? K.live : K.dim, fontSize: 12,
                fontFamily: "var(--font-mono), monospace", letterSpacing: "0.03em",
              }}>
                {voice === "listening" && <Mic size={13} />}
                {statusLine}
              </div>
            )}

            {error && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, color: K.marigold, fontSize: 12.5 }}>
                <AlertCircle size={13} /> {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendTyped()}
                placeholder={micReady ? "Or type instead…" : "Type to Nikki…"}
                aria-label="Type your reply to Nikki"
                style={{
                  flex: 1, padding: "11px 14px", borderRadius: 999,
                  border: `1px solid ${K.hairline}`, background: "rgba(255,255,255,0.05)",
                  color: "#fff", fontSize: 14, outline: "none",
                  fontFamily: "var(--font-telugu), var(--font-body), system-ui",
                }}
              />
              <button onClick={endCall} aria-label="End call" style={{
                width: 42, height: 42, borderRadius: "50%", flexShrink: 0, border: "none",
                cursor: "pointer", display: "grid", placeItems: "center",
                background: "rgba(229,83,61,0.16)", color: K.red,
              }}>
                <PhoneOff size={17} />
              </button>
            </div>

            {turnsLeft !== null && turnsLeft <= 4 && (
              <p style={{ margin: "9px 2px 0", color: K.dimmer, fontSize: 11.5, fontFamily: "var(--font-mono), monospace" }}>
                {turnsLeft} demo turns left · unlimited on a real number
              </p>
            )}
          </div>
        </>
      )}

      {/* ══ ENDED ══ */}
      {callState === "ended" && (
        <div style={{ flex: 1, padding: "26px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 9, color: K.live, fontSize: 13,
            fontWeight: 700, fontFamily: "var(--font-mono), monospace",
            letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            <Check size={15} /> Handled in {mmss}
          </div>

          {booking ? (
            <>
              <div style={{
                background: "rgba(255,255,255,0.05)", border: `1px solid ${K.hairline}`,
                borderRadius: 14, padding: "16px 17px", color: "#fff", fontSize: 14.5,
                lineHeight: 1.65, whiteSpace: "pre-wrap",
                fontFamily: "var(--font-telugu), var(--font-body), system-ui",
              }}>
                {booking}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, color: K.dim, fontSize: 12.5 }}>
                <MessageCircle size={14} color={K.live} />
                On a live number, this confirmation reaches them on WhatsApp before they hang up.
              </div>
            </>
          ) : (
            <p style={{ color: K.dim, fontSize: 14, lineHeight: 1.65, margin: 0 }}>
              Call ended. On a real line, Nikki would have logged this call with its full
              transcript, and fired the missed-call follow-up if nobody had picked up.
            </p>
          )}

          <div style={{ display: "flex", gap: 9, marginTop: "auto", paddingTop: 8, flexWrap: "wrap" }}>
            <button onClick={reset} style={{
              display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 18px",
              borderRadius: 999, border: `1px solid ${K.hairline}`, background: "transparent",
              color: "#fff", cursor: "pointer", fontSize: 13.5, fontWeight: 600,
            }}>
              <RotateCcw size={14} /> Call again
            </button>
            <a href="/signup" style={{
              display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 20px",
              borderRadius: 999, border: "none", background: K.marigold, color: "#2A1B00",
              textDecoration: "none", fontSize: 13.5, fontWeight: 700,
            }}>
              Put Nikki on my number
            </a>
          </div>
        </div>
      )}

      <style>{`
        @keyframes nk-pulse  { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
        @keyframes nk-spin   { to { transform: rotate(360deg) } }
        @keyframes nk-bounce { 0%,60%,100% { transform: translateY(0); opacity: .4 } 30% { transform: translateY(-5px); opacity: 1 } }
        @keyframes nk-ring   { 0% { transform: scale(1); opacity: .8 } 100% { transform: scale(2.1); opacity: 0 } }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
      `}</style>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(blob);
  });
}
