"use client";

// ─────────────────────────────────────────────────────────────────────────
// "Hey Nikki" — wake-word assistant for the landing page.
//
//   idle → (user enables once) → listening for the wake word
//        → wake detected → record one turn → /api/public/voice-turn
//        → speak the reply → back to listening
//
// WHY A CLICK IS UNAVOIDABLE
// Chrome, Safari and Firefox all require a user gesture before
// getUserMedia. There is no flag or library that bypasses it — it is a core
// browser security rule. What we CAN do is make it a one-time cost: mic
// permission persists per-origin on HTTPS, and the choice is remembered in
// localStorage, so a returning visitor goes straight to listening.
//
// WHY WEB SPEECH AND NOT ALWAYS-ON STT
// Streaming every second of mic audio to a paid STT endpoint would be slow
// and expensive. SpeechRecognition does wake detection for free. The real
// trade-off, stated plainly because it affects users: in Chrome this API
// sends audio to Google for recognition. For production, an on-device
// detector (Porcupine/WASM) keeps pre-wake audio on the machine and works
// in Safari too — swap _startWakeListener and nothing else changes.
// ─────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from "react";

const BARS = 28;
const WAKE_PATTERNS = [
  "hey nikki", "hey niki", "hey nicky", "heynikki", "hey nikkie",
  "hi nikki", "hey neeki", "hey nikhi",
];
const ROTATING = [
  "welcome to heynikki",
  'say "hey nikki" to start',
  "she answers your business calls",
  "in telugu, hindi and english",
];
const STORAGE_KEY = "heynikki.voice.enabled";
// Must be absolute. A relative "/api/..." resolves against the Vercel domain,
// where no such route exists — the agent would 404 in production while
// working perfectly in local dev. CallConsole already does this; this did not.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

type Phase = "idle" | "listening" | "recording" | "thinking" | "speaking";
type Line  = { who: "you" | "nikki"; text: string };

export default function WakeWordNikki() {
  const [phase,   setPhase]   = useState<Phase>("idle");
  const [enabled, setEnabled] = useState(false);
  const [levels,  setLevels]  = useState<number[]>(() => new Array(BARS).fill(0.06));
  const [lines,   setLines]   = useState<Line[]>([]);
  const [caption, setCaption] = useState(ROTATING[0]);
  const [error,   setError]   = useState("");
  const [supported, setSupported] = useState(true);
  const [reduced, setReduced] = useState(false);

  const streamRef   = useRef<MediaStream | null>(null);
  const ctxRef      = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recogRef    = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const rafRef      = useRef<number | null>(null);
  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const sessionRef  = useRef<string>("");
  const phaseRef    = useRef<Phase>("idle");
  const stoppingRef = useRef(false);
  // Pending wake-listener restart. Held so teardown can cancel it —
  // otherwise a queued restart fires after the mic tracks are stopped and
  // Chrome re-prompts for the microphone on a page the user just left.
  const restartTimerRef = useRef<number | null>(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on(); mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) setSupported(false);
    if (!sessionRef.current) {
      sessionRef.current = `web-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    }
  }, []);

  // Rotating caption — pauses entirely once a conversation starts, so it
  // never competes with what she is actually saying.
  useEffect(() => {
    if (lines.length || reduced) return;
    let i = 0;
    const t = setInterval(() => { i = (i + 1) % ROTATING.length; setCaption(ROTATING[i]); }, 3200);
    return () => clearInterval(t);
  }, [lines.length, reduced]);

  // ── Meter ─────────────────────────────────────────────────────────────
  const runMeter = useCallback(() => {
    const tick = () => {
      const a = analyserRef.current;
      if (a) {
        const buf = new Uint8Array(a.frequencyBinCount);
        a.getByteFrequencyData(buf);
        const step = Math.floor(buf.length / BARS) || 1;
        const next = new Array(BARS).fill(0).map((_, i) => {
          const v = buf[i * step] / 255;
          return Math.max(0.06, Math.min(1, v * 1.7));
        });
        setLevels(next);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // ── Teardown ──────────────────────────────────────────────────────────
  const teardown = useCallback(() => {
    stoppingRef.current = true;
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    try { recogRef.current?.stop(); } catch {}
    try { recorderRef.current?.state === "recording" && recorderRef.current.stop(); } catch {}
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    try { ctxRef.current?.close(); } catch {}
    streamRef.current = null; analyserRef.current = null; ctxRef.current = null;
    recogRef.current = null; recorderRef.current = null; rafRef.current = null;
    setLevels(new Array(BARS).fill(0.06));
    setPhase("idle");
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  // ── One conversational turn ───────────────────────────────────────────
  const runTurn = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream) return;
    setPhase("recording");

    const chunks: BlobPart[] = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus" : "audio/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime });
    recorderRef.current = rec;
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);

    const stopped = new Promise<void>(res => { rec.onstop = () => res(); });
    rec.start();

    // Stop on ~1.1s of quiet, or 12s hard cap so a noisy room cannot hang it.
    await new Promise<void>(resolve => {
      const started = Date.now();
      let quietSince: number | null = null;
      const poll = () => {
        const a = analyserRef.current;
        if (!a || rec.state !== "recording") return resolve();
        const buf = new Uint8Array(a.frequencyBinCount);
        a.getByteFrequencyData(buf);
        const level = buf.reduce((s, v) => s + v, 0) / buf.length / 255;
        const now = Date.now();
        if (level < 0.045) { quietSince ??= now; } else { quietSince = null; }
        if ((quietSince && now - quietSince > 1100 && now - started > 1200) ||
            now - started > 12000) return resolve();
        setTimeout(poll, 90);
      };
      setTimeout(poll, 400);
    });

    try { rec.state === "recording" && rec.stop(); } catch {}
    await stopped;
    setPhase("thinking");

    const blob = new Blob(chunks, { type: mime });
    if (blob.size < 1200) { setPhase("listening"); return; }

    const b64: string = await new Promise(res => {
      const fr = new FileReader();
      fr.onloadend = () => res(String(fr.result).split(",")[1] || "");
      fr.readAsDataURL(blob);
    });

    try {
      const r = await fetch(`${API_URL}/api/public/voice-turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio_base64: b64, mime_type: mime,
          session_id: sessionRef.current,
          persona: "product",       // she talks about Hey Nikki, nothing else
        }),
      });
      if (r.status === 429) { setError("Demo limit reached for this session."); teardown(); return; }
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();

      if (d.transcript) setLines(l => [...l, { who: "you", text: d.transcript }]);
      if (d.reply)      setLines(l => [...l, { who: "nikki", text: d.reply }]);

      if (d.audio_base64) {
        setPhase("speaking");
        const el = audioRef.current ?? new Audio();
        audioRef.current = el;
        el.src = `data:${d.audio_mime || "audio/wav"};base64,${d.audio_base64}`;
        await new Promise<void>(res => { el.onended = () => res(); el.onerror = () => res(); el.play().catch(() => res()); });
      }
    } catch {
      setError("Nikki could not answer just now.");
    }
    setPhase(p => (p === "idle" ? p : "listening"));
  }, [teardown]);

  // ── Wake listener ─────────────────────────────────────────────────────
  const startWakeListener = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-IN";
    recogRef.current = rec;

    const restart = () => {
      if (stoppingRef.current || phaseRef.current === "idle") return;
      if (restartTimerRef.current) return;
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null;
        if (stoppingRef.current || phaseRef.current === "idle") return;
        try { rec.start(); } catch { /* already running — nothing to do */ }
      }, 300);
    };

    rec.onresult = (e: any) => {
      if (phaseRef.current !== "listening") return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const said = String(e.results[i][0].transcript || "").toLowerCase().replace(/[^a-z ]/g, "");
        if (WAKE_PATTERNS.some(w => said.includes(w))) {
          try { rec.stop(); } catch {}
          runTurn().finally(() => {
            // Goes through the same deferred restart as everything else.
            // Calling rec.start() directly here raced the stop() above —
            // the session had not finished ending, start() threw
            // InvalidStateError, and the catch swallowed it, so the listener
            // died silently after the very first wake.
            restart();
          });
          return;
        }
      }
    };
    // Chrome ends recognition every few seconds and after every result, so
    // the listener only survives if it is restarted. Restarting SYNCHRONOUSLY
    // is what broke it: the previous session is still tearing down, start()
    // throws InvalidStateError, the empty catch swallowed it, and wake-word
    // detection was dead from then on with the UI still showing "listening".
    // A tick of delay lets the old session finish, and the guard stops two
    // timers from racing a double start() — which throws the same way.
    rec.onend = restart;
    rec.onerror = (e: any) => {
      // not-allowed / service-not-allowed are terminal: the user or the
      // browser refused the mic, and retrying just loops.
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Microphone blocked in your browser settings.");
        teardown();
        return;
      }
      // Everything else is routine. "no-speech" fires whenever someone is
      // simply quiet, and "aborted"/"network" on a flaky connection — none
      // of them mean stop listening, but none of them fire onend reliably
      // either, so the restart has to be driven from here too.
      restart();
    };
    try { rec.start(); } catch { restart(); }
  }, [runTurn, teardown]);

  // ── Enable (the one required user gesture) ────────────────────────────
  const enable = useCallback(async () => {
    setError("");
    stoppingRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 128; an.smoothingTimeConstant = 0.72;
      src.connect(an); analyserRef.current = an;

      setEnabled(true);
      try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
      setPhase("listening");
      runMeter();
      startWakeListener();
    } catch {
      setError("Microphone access is needed to talk to Nikki.");
    }
  }, [runMeter, startWakeListener]);

  // Stand down while the call console owns the page's voice. Both widgets
  // holding open mics meant one utterance got TWO answers at once — and this
  // widget could hear the console's Nikki speaking and answer HER. While a
  // console call is live this one suspends completely; when the call ends it
  // resumes only if the visitor had it on.
  const wasOnRef = useRef(false);
  useEffect(() => {
    const onConsole = (e: Event) => {
      const active = !!(e as CustomEvent).detail?.active;
      if (active) {
        wasOnRef.current = phaseRef.current !== "idle";
        if (wasOnRef.current) teardown();
      } else if (wasOnRef.current) {
        wasOnRef.current = false;
        enable();
      }
    };
    window.addEventListener("nikki:console", onConsole);
    return () => window.removeEventListener("nikki:console", onConsole);
  }, [teardown]);   // enable is stable via its own useCallback

  const disable = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setEnabled(false);
    teardown();
  }, [teardown]);

  const label =
    phase === "recording" ? "listening to you"
    : phase === "thinking" ? "thinking"
    : phase === "speaking" ? "nikki is speaking"
    : phase === "listening" ? 'say "hey nikki"'
    : caption;

  return (
    <div className="wwn">
      <div className={`wwn-bars ${phase}`} aria-hidden="true">
        {levels.map((v, i) => (
          <span key={i} style={{
            transform: `scaleY(${reduced ? 0.3 : Math.max(0.06, v)})`,
            animationDelay: `${(i % 7) * 90}ms`,
          }} />
        ))}
      </div>

      <p className="wwn-caption" aria-live="polite">{label}</p>

      {!enabled && (
        <button className="wwn-cta" onClick={enable}>
          {supported ? "Turn on voice" : "Talk to Nikki"}
        </button>
      )}
      {enabled && <button className="wwn-off" onClick={disable}>turn off voice</button>}

      {!supported && (
        <p className="wwn-note">
          Wake word needs Chrome or Edge. You can still talk to Nikki using the call demo below.
        </p>
      )}
      {error && <p className="wwn-err">{error}</p>}

      {lines.length > 0 && (
        <div className="wwn-lines">
          {lines.slice(-4).map((l, i) => (
            <p key={i} className={l.who}><span>{l.who === "you" ? "you" : "nikki"}</span>{l.text}</p>
          ))}
        </div>
      )}
    </div>
  );
}
