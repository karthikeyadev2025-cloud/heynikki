// components/OwnerVoiceAssistant.tsx
// Floating voice assistant for logged-in business owners — the
// "owner mode" half of the dual-mode voice experience. The public
// landing page's CallConsole is "visitor mode".
//
// Both halves are now real. Visitor mode used to be a scripted demo
// (a 4-stage state machine speaking transliterated Telugu through the
// browser's speechSynthesis, in the since-deleted VoiceChatWidget);
// it now runs the same Sarvam + Gemini stack this one does, via
// /api/public/voice-turn.
//
// This one: ask it "ఈరోజు ఎన్ని కాల్స్ వచ్చాయి?" (how many calls today?)
// and it transcribes your voice via Sarvam Saaras v3, asks Gemini
// against your own live business data, and speaks the answer back via
// Sarvam Bulbul v3 — the same models proven in the live phone
// pipeline, not the browser's Web Speech API (which has little to no
// real Telugu support).
//
// It is a CONVERSATION, not a lookup box. One question at a time meant
// the owner re-stated context on every turn ("and yesterday?" was
// unanswerable). Turns live in memory only — nothing here survives a
// reload, because the answers are about a moving business and a stale
// thread reads as a wrong one.
//
// Answers may arrive with structure attached:
//   cards[]  — a summary stat grid or a list of rows she can tap through
//   confirm  — an action Nikki is PROPOSING (ring a customer, send a
//              WhatsApp, cancel a booking) and has deliberately not done.
// Nothing in this file ever confirms on the owner's behalf. The confirm
// endpoint is the only place a side effect happens, and only a finger on
// that button reaches it.
"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { createClient } from "../lib/supabase";
import { isNativeApp, startHeyNikki, stopHeyNikki, heyNikkiRunning } from "../lib/native";
import { NIKKI } from "../lib/brand";
import {
  Bot, Mic, Loader2, X, Square, Volume2, VolumeX, Send, Trash2,
  ArrowRight, Check, AlertCircle,
} from "lucide-react";

const sb = createClient();
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const C = {
  acc: NIKKI.teal, gbr: NIKKI.tealLight, surf: NIKKI.surface,
  bord: NIKKI.border, txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
  red: NIKKI.red, grn: NIKKI.emerald, gold: NIKKI.gold, vault: NIKKI.vault,
  terra: NIKKI.terracotta,
};

type Status = "idle" | "recording" | "thinking" | "speaking" | "error";

// ── The answer contract ───────────────────────────────────────────────
// Fixed on the server side. Everything below is normalised before it is
// drawn: a malformed card must not take the dashboard down, and a row's
// href arrives from a model, so it is checked before it becomes a link.
type Tone = "good" | "warn" | "bad";
type Stat = { label: string; value: string | number; tone?: Tone };
type Row  = { title: string; subtitle?: string; meta?: string; tone?: Tone; href?: string };
type Card =
  | { type: "summary"; title: string; stats: Stat[] }
  | { type: "list";    title: string; rows: Row[] };
type Confirm = { id: string; label: string; description: string; danger?: boolean };

// "open" is the only state with live buttons. The other three are outcomes
// and are drawn as a settled line, never as something still pressable.
type ConfirmState = "open" | "busy" | "done" | "cancelled" | "expired";

type Turn = {
  id: number;                 // local only — React key + the handle a confirm updates
  role: "you" | "nikki";
  text: string;
  at: number;
  cards?: Card[];
  confirm?: Confirm;
  confirmState?: ConfirmState;
  confirmError?: string;      // local only — an inline retryable failure
};

let turnSeq = 0;
function mkTurn(role: Turn["role"], text: string, cards?: Card[], confirm?: Confirm): Turn {
  return {
    id: ++turnSeq, role, text, at: Date.now(), cards, confirm,
    confirmState: confirm ? "open" : undefined,
  };
}

function toneOf(t: any): Tone | undefined {
  return t === "good" || t === "warn" || t === "bad" ? t : undefined;
}
function toneColor(t?: Tone): string {
  return t === "good" ? C.grn : t === "warn" ? C.gold : t === "bad" ? C.red : C.txt;
}

/** Only same-origin paths and plain http(s). A model-authored `javascript:`
 *  href would otherwise be one tap from running in the owner's session. */
function safeHref(h: any): string | undefined {
  if (typeof h !== "string") return undefined;
  const v = h.trim();
  if (!v) return undefined;
  return /^\/(?!\/)/.test(v) || /^https?:\/\//i.test(v) ? v : undefined;
}

function normalizeCards(raw: any): Card[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Card[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    if (c.type === "summary" && Array.isArray(c.stats)) {
      const stats: Stat[] = c.stats
        .filter((s: any) => s && typeof s === "object" && s.label != null)
        .map((s: any) => ({
          label: String(s.label),
          value: typeof s.value === "number" ? s.value : String(s.value ?? "—"),
          tone: toneOf(s.tone),
        }));
      if (stats.length) out.push({ type: "summary", title: String(c.title ?? ""), stats });
    } else if (c.type === "list" && Array.isArray(c.rows)) {
      const rows: Row[] = c.rows
        .filter((r: any) => r && typeof r === "object" && r.title != null)
        .map((r: any) => ({
          title: String(r.title),
          subtitle: r.subtitle != null ? String(r.subtitle) : undefined,
          meta: r.meta != null ? String(r.meta) : undefined,
          tone: toneOf(r.tone),
          href: safeHref(r.href),
        }));
      if (rows.length) out.push({ type: "list", title: String(c.title ?? ""), rows });
    }
  }
  return out.length ? out : undefined;
}

function normalizeConfirm(raw: any): Confirm | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  if (typeof raw.id !== "string" || !raw.id.trim()) return undefined;
  return {
    id: raw.id,
    label: String(raw.label ?? "Yes, do it"),
    description: String(raw.description ?? ""),
    danger: !!raw.danger,
  };
}

// A person is sitting looking at this. Past half a minute the honest thing
// is to say it did not work, not to keep the dots moving.
const ASK_TIMEOUT_MS = 30_000;
const SPEAK_CAP_MS   = 60_000;

function askError(e: any): string {
  const name = String(e?.name || "");
  if (name === "TimeoutError" || name === "AbortError") {
    return "That took too long — check your connection and ask again.";
  }
  return e?.message || "Something went wrong — please try again.";
}

// Her own words, the way she actually says them in the shop. These are only
// the six things the answer layer can genuinely do today — a chip that leads
// to "I don't know" is worse than no chip.
const CHIPS = [
  "ఈరోజు ఎన్ని కాల్స్ వచ్చాయి?",
  "Missed calls ఏమైనా ఉన్నాయా?",
  "ఈరోజు bookings ఎన్ని ఉన్నాయి?",
  "ఎవరికి call back చెయ్యాలి?",
  "Orders ఏమైనా pending ఉన్నాయా?",
  "This month ఎలా ఉంది?",
];

function clockOf(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

export default function OwnerVoiceAssistant() {
  const [open, setOpen]     = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [wakeOn, setWakeOn] = useState(false);
  const [turns, setTurns]   = useState<Turn[]>([]);
  const [typed, setTyped]   = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [level, setLevel]   = useState(0);   // 0..1 mic energy while recording

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  // ── "Hey Nikki" wake word, everywhere in the dashboard ──────────────
  // The panel existed on every page through Shell but only opened by click.
  // A voice product whose own dashboard cannot be woken by voice is arguing
  // against itself — this is the same continuous-recognition pattern the
  // landing page's widget already proved, including its two hard-won rules:
  // restart recognition on a DELAY (Chrome ends it after every result, and
  // an immediate restart loops the last transcript), and never listen while
  // she is answering (she would wake herself).
  const recogRef       = useRef<any>(null);
  const wakeStopRef    = useRef(false);
  const restartRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Last resort, the same idea as the phone app's overlay watchdog: if a
  // busy state has not moved on well after everything above should have
  // timed out, something failed in a way nobody predicted. Say so rather
  // than spin.
  useEffect(() => {
    if (status !== "thinking" && status !== "speaking") return;
    const t = setTimeout(() => {
      setStatus("error");
      setErrorMsg("Nikki stopped responding — please ask again.");
    }, status === "thinking" ? ASK_TIMEOUT_MS + 5_000 : SPEAK_CAP_MS + 5_000);
    return () => clearTimeout(t);
  }, [status]);
  const statusRef      = useRef<Status>("idle");
  const openRef        = useRef(false);
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { openRef.current = open; }, [open]);

  // Newest at the bottom, and the bottom is where her eyes are.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, status, open]);

  const startWake = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return false;
    wakeStopRef.current = false;
    const r = new SR();
    r.lang = "en-IN"; r.continuous = true; r.interimResults = true;
    r.onresult = (ev: any) => {
      if (openRef.current || statusRef.current !== "idle") return;
      const text = Array.from(ev.results as any)
        .map((x: any) => x[0]?.transcript || "").join(" ").toLowerCase();
      if (/\b(hey|hai|hi)?\s*nik+i+\b|నిక్కి/.test(text)) {
        try { r.stop(); } catch { /* noop */ }
        setOpen(true);
        // Straight into listening — saying her name twice is the failure.
        setTimeout(() => { startRecording(); }, 250);
      }
    };
    r.onend = () => {
      if (wakeStopRef.current) return;
      // Deferred restart. Chrome ends recognition constantly; restarting in
      // the same tick replays the final transcript and she wakes herself.
      restartRef.current = setTimeout(() => {
        if (!wakeStopRef.current && !openRef.current) {
          try { r.start(); } catch { /* already running */ }
        }
      }, 400);
    };
    r.onerror = () => { /* onend follows and handles restart */ };
    try { r.start(); } catch { return false; }
    recogRef.current = r;
    return true;
  }, []);

  const stopWake = useCallback(() => {
    wakeStopRef.current = true;
    if (restartRef.current) clearTimeout(restartRef.current);
    try { recogRef.current?.stop(); } catch { /* noop */ }
    recogRef.current = null;
  }, []);

  // Inside the phone app the pill runs the phone's own listener — a
  // foreground service with the mic open, screen off, "Hey Nikki" → she
  // says చెప్పండి and answers out loud — not the browser's recognizer,
  // which dies the moment the WebView sleeps.
  const native = isNativeApp();
  const [nativeMsg, setNativeMsg] = useState("");
  // In the app the listener is on from first launch; opening the dashboard
  // signed in hands it this phone's device token so answers are about the
  // owner's own business rather than the product guide.
  useEffect(() => {
    if (!native) return;
    heyNikkiRunning().then(async r => {
      if (r) { const s = await startHeyNikki(); setWakeOn(s.ok || r); } else setWakeOn(false);
    });
  }, [native]);

  const toggleWake = useCallback(() => {
    if (native) {
      if (wakeOn) { stopHeyNikki().then(() => setWakeOn(false)); return; }
      startHeyNikki().then(r => {
        setWakeOn(r.ok);
        setNativeMsg(r.ok ? "" : (r.reason || "Could not start"));
        if (!r.ok) setTimeout(() => setNativeMsg(""), 5000);
      }).catch(e => { setNativeMsg(e?.message || "Could not start"); setTimeout(() => setNativeMsg(""), 5000); });
      return;
    }
    setWakeOn(on => {
      if (on) { stopWake(); return false; }
      const ok = startWake();
      return ok;
    });
  }, [native, wakeOn, startWake, stopWake]);

  // The panel closing resumes the wake listener; unmount kills it.
  useEffect(() => {
    if (native) return;
    if (wakeOn && !open && statusRef.current === "idle") {
      const t = setTimeout(() => { if (!openRef.current) startWake(); }, 500);
      return () => clearTimeout(t);
    }
  }, [open, wakeOn, startWake, native]);
  useEffect(() => () => { if (!native) stopWake(); }, [stopWake, native]);

  // ── Mic level ───────────────────────────────────────────────────────
  // The old panel said "recording" and showed nothing moving, so a muted
  // mic and a working one looked identical until the answer came back
  // empty. This is real energy off the same stream, not a fake animation.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopMeter = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try { audioCtxRef.current?.close(); } catch { /* already closed */ }
    audioCtxRef.current = null;
    setLevel(0);
  }, []);
  useEffect(() => () => stopMeter(), [stopMeter]);

  const startMeter = useCallback((stream: MediaStream) => {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx: AudioContext = new AC();
      audioCtxRef.current = ctx;
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      let smoothed = 0;
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i] - 128) / 128;
          if (v > peak) peak = v;
        }
        smoothed = smoothed * 0.65 + Math.min(1, peak * 2.4) * 0.35;
        // Re-rendering at 60fps for a 1px change is not worth it.
        setLevel(prev => (Math.abs(prev - smoothed) > 0.045 ? smoothed : prev));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch { /* the meter is a courtesy; the recording is the product */ }
  }, []);

  const startRecording = useCallback(async () => {
    setErrorMsg("");
    // She is allowed to talk over the answer. Left playing, the mic records
    // Nikki's own voice and asks her a question she just answered.
    try { audioElRef.current?.pause(); } catch { /* nothing playing */ }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stopMeter();
        stream.getTracks().forEach(t => t.stop());
        handleRecordingComplete(new Blob(chunksRef.current, { type: mimeType }));
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      startMeter(stream);
      setStatus("recording");
    } catch (e) {
      stopMeter();
      setStatus("error");
      setErrorMsg("Couldn't access your microphone. Check browser permissions.");
    }
  }, [startMeter, stopMeter]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
  }, []);

  const handleRecordingComplete = async (blob: Blob) => {
    setStatus("thinking");
    try {
      const audioBase64 = await blobToBase64(blob);
      const { data: { session } } = await sb.auth.getSession();

      const res = await fetch(`${API}/api/tenant/voice-query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ audio_base64: audioBase64, mime_type: blob.type }),
        // Without this the panel could sit on "ఆలోచిస్తున్నాము..." until the
        // tab was closed: fetch has no timeout of its own, so a stalled
        // request is indistinguishable from a slow one, forever.
        signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Request failed (${res.status})`);
      }

      const data = await res.json();
      const heard = String(data.transcript || "").trim();
      const said  = String(data.answer || "").trim();
      // Nothing at all came back. Silence after she spoke reads as broken,
      // so say what happened instead of returning quietly to idle.
      if (!heard && !said && !data.cards && !data.confirm) {
        throw new Error("I didn't catch that — please say it again.");
      }
      setTurns(ts => {
        const next = [...ts];
        if (heard) next.push(mkTurn("you", heard));
        if (said || data.cards || data.confirm) {
          next.push(mkTurn("nikki", said, normalizeCards(data.cards), normalizeConfirm(data.confirm)));
        }
        return next;
      });

      if (data.audio_base64) {
        playAnswer(data.audio_base64, data.audio_mime || "audio/wav");
      } else {
        setStatus("idle");
      }
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(askError(e));
    }
  };

  // Ask by typing. The spoken path needs Sarvam for transcription, so when
  // voice is unavailable — no mic permission, a browser without
  // MediaRecorder, or the speech vendor being down, which has happened —
  // the assistant was completely unusable rather than merely quiet. The
  // answer is the same one the voice path gives; only the way in differs.
  const askTyped = async (override?: string) => {
    const q = (override ?? typed).trim();
    if (!q || status === "thinking" || status === "recording") return;
    if (status === "speaking") stopSpeaking();
    setStatus("thinking"); setErrorMsg("");
    setTurns(ts => [...ts, mkTurn("you", q)]);
    if (override === undefined) setTyped("");
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(`${API}/api/admin/voice-query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
        signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setTurns(ts => [...ts, mkTurn(
        "nikki",
        String(data.answer || "").trim(),
        normalizeCards(data.cards),
        normalizeConfirm(data.confirm),
      )]);
      setStatus("idle");
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(askError(e));
    }
  };

  // ── Confirming a proposed action ────────────────────────────────────
  // The only call in this file that changes anything in the world. It runs
  // on a press and on nothing else: no retry loop, no effect, no "she
  // probably meant yes". Same timeout discipline as the ask paths, because
  // an action that may or may not have fired is worse than one that plainly
  // failed.
  const runConfirm = async (turnId: number, c: Confirm) => {
    setTurns(ts => ts.map((t): Turn =>
      t.id === turnId ? { ...t, confirmState: "busy", confirmError: "" } : t));
    setStatus("thinking");
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(`${API}/api/tenant/assistant/confirm`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id }),
        signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);

      // ok:false is the server's considered answer (usually the five-minute
      // expiry), not a transport failure — it gets shown as a reply, and the
      // buttons go, because that id will never work again.
      const ok = data?.ok !== false;
      const answer = String(data?.answer || "").trim()
        || (ok ? "Done." : "That request is no longer valid — please ask again.");
      setTurns(ts => [
        ...ts.map((t): Turn => t.id === turnId
          ? { ...t, confirmState: ok ? "done" : "expired", confirmError: "" }
          : t),
        mkTurn("nikki", answer, normalizeCards(data?.cards)),
      ]);
      setStatus("idle");
    } catch (e: any) {
      // Buttons stay. She can press again once the connection is back.
      setTurns(ts => ts.map((t): Turn =>
        t.id === turnId ? { ...t, confirmState: "open", confirmError: askError(e) } : t));
      setStatus("idle");
    }
  };

  const cancelConfirm = (turnId: number) => {
    setTurns(ts => ts.map((t): Turn =>
      t.id === turnId ? { ...t, confirmState: "cancelled", confirmError: "" } : t));
  };

  const playAnswer = (audioBase64: string, mime: string) => {
    setStatus("speaking");
    const audio = new Audio(`data:${mime};base64,${audioBase64}`);
    audioElRef.current = audio;
    // onended does not always arrive — a clip the browser cannot seek in, a
    // tab backgrounded mid-answer — and without a floor under it the panel
    // stayed on "speaking" with nothing playing.
    let settled = false;
    // Always settles — but only out of the state it owns. The 60s cap can
    // fire long after she has moved on to recording the next question, and
    // a blanket setStatus("idle") there wiped a live recording indicator.
    const finish = () => {
      if (settled) return;
      settled = true;
      setStatus(s => (s === "speaking" ? "idle" : s));
    };
    audio.onended = finish;
    audio.onerror = finish;
    audio.onloadedmetadata = () => {
      const ms = Number.isFinite(audio.duration) ? audio.duration * 1000 + 1500 : SPEAK_CAP_MS;
      window.setTimeout(finish, Math.min(SPEAK_CAP_MS, ms));
    };
    window.setTimeout(finish, SPEAK_CAP_MS);
    audio.play().catch(finish);
  };

  const stopSpeaking = () => {
    try { audioElRef.current?.pause(); } catch { /* nothing playing */ }
    setStatus("idle");
  };

  const clearThread = () => {
    if (status === "speaking") stopSpeaking();
    setTurns([]);
    setErrorMsg("");
    if (status === "error") setStatus("idle");
  };

  const toggle = () => {
    if (status === "speaking") stopSpeaking();
    setOpen(o => !o);
  };

  const busy = status === "thinking";
  const micDisabled = busy;

  const stateLine =
    status === "recording" ? "వింటున్నాను… Listening" :
    status === "thinking"  ? "ఆలోచిస్తున్నాను… Thinking" :
    status === "speaking"  ? "మాట్లాడుతున్నాను… Speaking" :
    status === "error"     ? "Something went wrong" :
    turns.length           ? "సిద్ధం — ఇంకేమైనా అడగండి" :
                             "మీ వ్యాపారం గురించి అడగండి — Telugu or English";
  const stateColor =
    status === "error" ? C.red :
    status === "recording" ? C.terra :
    status === "idle" ? C.mid : C.acc;

  return (
    <>
      <style>{`
        .nkv-panel{
          position:fixed; bottom:92px; right:24px; z-index:9999;
          width:420px; max-width:calc(100vw - 32px);
          max-height:min(640px, calc(100vh - 132px));
          display:flex; flex-direction:column; overflow:hidden;
          background:${C.surf}; border:1px solid ${C.bord}; border-radius:16px;
          box-shadow:0 18px 48px rgba(15,23,42,0.18), 0 2px 6px rgba(15,23,42,0.06);
          animation:nkv-rise 180ms cubic-bezier(.2,.8,.3,1);
        }
        .nkv-fab{ position:fixed; bottom:24px; right:24px; z-index:10000; }
        .nkv-wake{ position:fixed; bottom:88px; right:24px; z-index:9998; }
        .nkv-note{ position:fixed; bottom:132px; right:24px; z-index:9998; max-width:260px; }
        @media (max-width:480px){
          /* Near-full width on a 390px phone, and the FAB stays clear of it. */
          .nkv-panel{ left:10px; right:10px; width:auto; max-width:none;
                      bottom:82px; max-height:calc(100dvh - 104px); border-radius:14px; }
          .nkv-fab{ bottom:16px; right:16px; }
          .nkv-wake{ bottom:80px; right:16px; }
          .nkv-note{ bottom:124px; right:16px; left:16px; max-width:none; }
        }
        .nkv-turn{ animation:nkv-rise 200ms ease; }
        .nkv-row:hover{ background:${C.vault}; }
        .nkv-chip:hover{ border-color:${C.acc}; color:${C.acc}; }
        .nkv-icon:hover{ color:${C.txt}; }
        .nkv-thread::-webkit-scrollbar{ width:8px; }
        .nkv-thread::-webkit-scrollbar-thumb{ background:${C.bord}; border-radius:8px; }
        @keyframes nkv-rise{ from{opacity:0; transform:translateY(8px) scale(.985)} to{opacity:1; transform:none} }
        @keyframes nkv-ring{ 0%{transform:scale(1);opacity:.5} 100%{transform:scale(1.75);opacity:0} }
        @keyframes nkv-dot{ 0%,70%,100%{opacity:.25;transform:translateY(0)} 35%{opacity:1;transform:translateY(-3px)} }
        @keyframes nkv-breathe{ 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
        @keyframes nkv-spin{ to{transform:rotate(360deg)} }
        @media (prefers-reduced-motion: reduce){
          .nkv-panel,.nkv-turn,.nkv-anim,.nkv-ring{ animation:none !important; transition:none !important; }
        }
      `}</style>

      {open && (
        <div className="nkv-panel" role="dialog" aria-label="Ask Nikki">
          {/* ── Header ─────────────────────────────────────────────── */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10, padding: "12px 12px 12px 14px",
            borderBottom: `1px solid ${C.bord}`, background: C.vault,
          }}>
            <div style={{
              position: "relative", width: 34, height: 34, borderRadius: "50%",
              background: NIKKI.gradient, display: "flex", alignItems: "center",
              justifyContent: "center", flexShrink: 0,
            }}>
              <Bot size={17} color="#fff" />
              <span style={{
                position: "absolute", right: -1, bottom: -1, width: 10, height: 10,
                borderRadius: "50%", border: `2px solid ${C.vault}`,
                background: status === "error" ? C.red
                  : status === "recording" ? C.terra
                  : status === "idle" ? C.grn : C.acc,
              }} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: C.txt, fontSize: 14, fontWeight: 800, lineHeight: 1.2 }}>Nikki</div>
              <div style={{
                color: stateColor, fontSize: 11.5, marginTop: 2, lineHeight: 1.3,
                display: "flex", alignItems: "center", gap: 6,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {status === "thinking" && (
                  <span style={{ display: "inline-flex", gap: 2 }} aria-hidden>
                    {[0, 1, 2].map(i => (
                      <span key={i} className="nkv-anim" style={{
                        width: 4, height: 4, borderRadius: "50%", background: C.acc,
                        animation: `nkv-dot 1.1s ${i * 0.15}s infinite ease-in-out`,
                      }} />
                    ))}
                  </span>
                )}
                {stateLine}
              </div>
            </div>
            {status === "speaking" && (
              <button
                onClick={stopSpeaking}
                title="Stop speaking"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
                  padding: "5px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                  border: `1px solid ${C.bord}`, background: C.surf, color: C.mid, cursor: "pointer",
                }}>
                <VolumeX size={12} /> Stop
              </button>
            )}
            {turns.length > 0 && (
              <button
                onClick={clearThread}
                className="nkv-icon"
                title="Clear this conversation"
                aria-label="Clear this conversation"
                style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", display: "flex", padding: 4 }}>
                <Trash2 size={15} />
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="nkv-icon"
              aria-label="Close"
              style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", display: "flex", padding: 4 }}>
              <X size={17} />
            </button>
          </div>

          {/* ── Thread ─────────────────────────────────────────────── */}
          <div
            ref={threadRef}
            className="nkv-thread"
            role="log"
            aria-live="polite"
            style={{
              flex: "1 1 auto", minHeight: 120, overflowY: "auto", padding: "14px 14px 6px",
              display: "flex", flexDirection: "column", gap: 12, background: C.surf,
            }}>
            {turns.length === 0 ? (
              <div>
                <div style={{ color: C.mid, fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
                  Tap the mic and talk to me like you talk on the phone — or pick one:
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {CHIPS.map(q => (
                    <button
                      key={q}
                      className="nkv-chip"
                      onClick={() => askTyped(q)}
                      disabled={busy || status === "recording"}
                      style={{
                        background: C.vault, color: C.mid, border: `1px solid ${C.bord}`,
                        borderRadius: 999, padding: "7px 12px", fontSize: 12.5, fontWeight: 600,
                        cursor: busy || status === "recording" ? "not-allowed" : "pointer",
                        opacity: busy || status === "recording" ? 0.55 : 1, textAlign: "left",
                        transition: "border-color 120ms ease, color 120ms ease",
                      }}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : turns.map(t => (
              <TurnView
                key={t.id}
                turn={t}
                onConfirm={() => t.confirm && runConfirm(t.id, t.confirm)}
                onCancel={() => cancelConfirm(t.id)}
              />
            ))}
          </div>

          {/* ── Error line ─────────────────────────────────────────── */}
          {status === "error" && errorMsg && (
            <div style={{
              margin: "0 14px 8px", display: "flex", gap: 8, alignItems: "flex-start",
              background: C.red + "12", border: `1px solid ${C.red}33`, borderRadius: 10,
              padding: "9px 11px", color: C.red, fontSize: 12, lineHeight: 1.45,
            }}>
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* ── Composer ───────────────────────────────────────────── */}
          <div style={{
            borderTop: `1px solid ${C.bord}`, background: C.vault,
            padding: "10px 12px", display: "flex", alignItems: "center", gap: 9,
          }}>
            <div style={{ position: "relative", flexShrink: 0, width: 44, height: 44 }}>
              {status === "recording" && (
                <span className="nkv-ring" aria-hidden style={{
                  position: "absolute", inset: 0, borderRadius: "50%",
                  border: `2px solid ${C.terra}`, animation: "nkv-ring 1.4s infinite ease-out",
                }} />
              )}
              <button
                onClick={status === "recording" ? stopRecording : startRecording}
                disabled={micDisabled}
                title={status === "recording" ? "Stop and send" : "Hold a question and tap — she listens in Telugu or English"}
                aria-label={status === "recording" ? "Stop recording" : "Record a question"}
                style={{
                  position: "relative", width: 44, height: 44, borderRadius: "50%", border: "none",
                  background: status === "recording" ? C.terra : NIKKI.gradient,
                  color: "#fff", cursor: micDisabled ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  opacity: micDisabled ? 0.55 : 1,
                  // The button itself grows with her voice: proof the mic is live.
                  transform: status === "recording" ? `scale(${1 + level * 0.16})` : "none",
                  transition: "transform 90ms linear, background 200ms ease",
                  boxShadow: status === "recording"
                    ? `0 0 0 ${4 + level * 8}px ${C.terra}22`
                    : `0 4px 14px ${C.acc}44`,
                }}>
                {status === "recording" ? <Square size={15} fill="#fff" />
                  : status === "thinking" ? <Loader2 size={17} className="nkv-anim" style={{ animation: "nkv-spin 900ms linear infinite" }} />
                  : status === "speaking" ? <Volume2 size={17} />
                  : <Mic size={18} />}
              </button>
            </div>

            <input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") askTyped(); }}
              disabled={busy}
              placeholder={status === "recording" ? "Listening…" : "…or type your question"}
              aria-label="Type a question for Nikki"
              style={{
                flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 10, fontSize: 13,
                background: C.surf, color: C.txt, border: `1px solid ${C.bord}`,
                outline: "none",
              }} />

            <button
              type="button"
              onClick={() => askTyped()}
              disabled={!typed.trim() || busy}
              aria-label="Send"
              style={{
                flexShrink: 0, width: 38, height: 38, borderRadius: 10, border: "none",
                background: typed.trim() && !busy ? C.acc : C.bord,
                color: typed.trim() && !busy ? "#fff" : C.dim,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: typed.trim() && !busy ? "pointer" : "default",
                transition: "background 150ms ease",
              }}>
              <Send size={15} />
            </button>
          </div>

          {/* Wake toggle lives in the panel while it is open — as a floating
              pill it sat on top of the panel and covered the thread. */}
          <div style={{
            borderTop: `1px solid ${C.bord}`, background: C.vault,
            padding: "8px 12px 10px", display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: 10,
          }}>
            <button
              onClick={toggleWake}
              title={wakeOn ? "Voice wake is on — say 'Hey Nikki'" : "Enable 'Hey Nikki' voice wake"}
              style={{
                padding: "5px 10px", borderRadius: 999,
                border: `1px solid ${wakeOn ? C.grn : C.bord}`,
                background: wakeOn ? C.grn + "1F" : C.surf,
                color: wakeOn ? C.grn : C.mid, fontSize: 11, fontWeight: 700,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
              }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: wakeOn ? C.grn : C.dim,
                boxShadow: wakeOn ? `0 0 0 3px ${C.grn}33` : "none",
              }} />
              {wakeOn ? (native ? "“Hey Nikki” always on" : "“Hey Nikki” on") : "“Hey Nikki” wake"}
            </button>
            <span style={{ color: C.dim, fontSize: 10.5, textAlign: "right" }}>
              {nativeMsg
                ? <span style={{ color: C.red, fontWeight: 600 }}>{nativeMsg}</span>
                : "This chat clears when you leave the page"}
            </span>
          </div>
        </div>
      )}

      {/* Wake-word toggle rides above the FAB. Green dot = she is listening
          for her name on this page; say "Hey Nikki" and the panel opens
          already recording. Off by default — an always-on mic must be the
          owner's explicit choice, made once per session. */}
      {!open && (
        <button
          onClick={toggleWake}
          className="nkv-wake"
          title={wakeOn ? "Voice wake is on — say 'Hey Nikki'" : "Enable 'Hey Nikki' voice wake"}
          style={{
            padding: "6px 12px", borderRadius: 999,
            border: `1px solid ${wakeOn ? C.grn : C.bord}`,
            background: wakeOn ? C.grn + "1F" : C.surf,
            color: wakeOn ? C.grn : C.mid, fontSize: 11.5, fontWeight: 700,
            cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
            boxShadow: "0 4px 14px rgba(15,23,42,0.10)",
          }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: wakeOn ? C.grn : C.dim,
            boxShadow: wakeOn ? `0 0 0 3px ${C.grn}33` : "none",
          }} />
          {wakeOn ? (native ? "“Hey Nikki” always on" : "“Hey Nikki” on") : "“Hey Nikki” wake"}
        </button>
      )}
      {nativeMsg && !open && (
        <div className="nkv-note" style={{
          background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 10, padding: "8px 12px",
          color: C.red, fontSize: 12, fontWeight: 600, boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
        }}>
          {nativeMsg}
        </div>
      )}

      <button
        onClick={toggle}
        className="nkv-fab"
        title="Ask Nikki about your business — real Telugu voice"
        aria-label={open ? "Close Nikki" : "Ask Nikki"}
        style={{
          width: 54, height: 54, borderRadius: "50%", border: "none",
          background: open ? C.dim : `linear-gradient(135deg, ${C.acc}, ${NIKKI.terracotta})`,
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: open ? "none" : `0 10px 26px ${C.acc}55, 0 2px 8px rgba(15,23,42,0.18)`,
          animation: !open ? "nkv-breathe 3.4s ease-in-out infinite" : "none",
          transition: "background 250ms ease, box-shadow 250ms ease",
        }}>
        {open ? <X size={20} color="#fff" /> : <Bot size={22} color="#fff" />}
      </button>
    </>
  );
}

// ── One turn ──────────────────────────────────────────────────────────
function TurnView({ turn, onConfirm, onCancel }: {
  turn: Turn; onConfirm: () => void; onCancel: () => void;
}) {
  const you = turn.role === "you";
  return (
    <div className="nkv-turn" style={{
      display: "flex", flexDirection: "column",
      alignItems: you ? "flex-end" : "flex-start", gap: 5,
    }}>
      <div style={{
        maxWidth: you ? "86%" : "100%", width: you ? undefined : "100%",
        background: you ? C.acc : C.vault,
        color: you ? "#fff" : C.txt,
        border: you ? "none" : `1px solid ${C.bord}`,
        borderRadius: 12,
        borderBottomRightRadius: you ? 4 : 12,
        borderBottomLeftRadius: you ? 12 : 4,
        padding: "9px 12px", fontSize: 13, lineHeight: 1.55,
        whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>
        {turn.text || (turn.cards || turn.confirm ? "" : "…")}

        {turn.cards?.map((card, i) => <CardView key={i} card={card} />)}

        {turn.confirm && <ConfirmView turn={turn} onConfirm={onConfirm} onCancel={onCancel} />}
      </div>
      <div style={{ color: C.dim, fontSize: 10, padding: "0 4px" }}>
        {you ? "You" : "Nikki"} · {clockOf(turn.at)}
      </div>
    </div>
  );
}

// ── Cards ─────────────────────────────────────────────────────────────
// Both kinds sit inside .nk-scroll: a wide stat row or a long lead name
// scrolls within the card. The panel's own width is fixed, and a card that
// pushed it wider would push the composer off a 390px screen.
function CardView({ card }: { card: Card }) {
  return (
    <div style={{
      marginTop: 10, border: `1px solid ${C.bord}`, borderRadius: 10,
      background: C.surf, overflow: "hidden",
    }}>
      {card.title && (
        <div style={{
          padding: "7px 10px", borderBottom: `1px solid ${C.bord}`,
          color: C.dim, fontSize: 9.5, fontWeight: 800,
          textTransform: "uppercase", letterSpacing: "0.08em",
        }}>
          {card.title}
        </div>
      )}
      {card.type === "summary" ? (
        <div className="nk-scroll" style={{ padding: 2 }}>
          <div style={{
            display: "grid", gridAutoFlow: "column",
            gridAutoColumns: "minmax(96px, 1fr)", gap: 1, background: C.bord,
          }}>
            {card.stats.map((s, i) => (
              <div key={i} style={{ background: C.surf, padding: "9px 10px", minWidth: 96 }}>
                <div style={{
                  color: toneColor(s.tone), fontSize: 17, fontWeight: 800,
                  lineHeight: 1.15, whiteSpace: "nowrap",
                }}>{s.value}</div>
                <div style={{
                  color: C.mid, fontSize: 10.5, marginTop: 3, whiteSpace: "nowrap",
                  overflow: "hidden", textOverflow: "ellipsis",
                }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="nk-scroll">
          <div style={{ minWidth: 0 }}>
            {card.rows.map((r, i) => <ListRow key={i} row={r} first={i === 0} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ListRow({ row, first }: { row: Row; first: boolean }) {
  const body = (
    <>
      {row.tone && (
        <span style={{
          width: 4, alignSelf: "stretch", borderRadius: 3,
          background: toneColor(row.tone), flexShrink: 0,
        }} />
      )}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{
          display: "block", color: C.txt, fontSize: 12.5, fontWeight: 700, lineHeight: 1.35,
        }}>{row.title}</span>
        {row.subtitle && (
          <span style={{
            display: "block", color: C.mid, fontSize: 11, marginTop: 1, lineHeight: 1.35,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{row.subtitle}</span>
        )}
      </span>
      {row.meta && (
        <span style={{
          color: C.dim, fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
        }}>{row.meta}</span>
      )}
      {row.href && <ArrowRight size={13} color={C.acc} style={{ flexShrink: 0 }} />}
    </>
  );

  const style: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 9,
    padding: "9px 10px", borderTop: first ? "none" : `1px solid ${C.bord}`,
    textDecoration: "none", color: "inherit",
    transition: "background 120ms ease",
  };

  return row.href
    ? <a className="nkv-row" href={row.href} style={{ ...style, cursor: "pointer" }}>{body}</a>
    : <div className="nkv-row" style={style}>{body}</div>;
}

// ── A proposed action ─────────────────────────────────────────────────
// Nikki has NOT done this. She has written it down and is waiting. The
// outcome states replace the buttons entirely so a completed action can
// never be fired twice by a second tap.
function ConfirmView({ turn, onConfirm, onCancel }: {
  turn: Turn; onConfirm: () => void; onCancel: () => void;
}) {
  const c = turn.confirm!;
  const st = turn.confirmState || "open";
  const danger = !!c.danger;
  const accent = danger ? C.red : C.acc;

  if (st === "done" || st === "cancelled" || st === "expired") {
    const meta = st === "done"
      ? { color: C.grn, text: `Done — ${c.label}` }
      : st === "cancelled"
        ? { color: C.mid, text: "Cancelled — nothing was done." }
        : { color: C.gold, text: "This request expired — nothing was done." };
    return (
      <div style={{
        marginTop: 10, display: "flex", alignItems: "center", gap: 6,
        color: meta.color, fontSize: 11.5, fontWeight: 700,
      }}>
        {st === "done" ? <Check size={13} /> : <AlertCircle size={13} />}
        {meta.text}
      </div>
    );
  }

  const busy = st === "busy";
  return (
    <div style={{
      marginTop: 10, border: `1px solid ${accent}44`, borderRadius: 10,
      background: accent + "0F", padding: "10px 11px",
    }}>
      <div style={{
        color: accent, fontSize: 9.5, fontWeight: 800,
        textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4,
      }}>
        {danger ? "Needs your OK" : "Shall I?"}
      </div>
      {c.description && (
        <div style={{ color: C.txt, fontSize: 12.5, lineHeight: 1.5, marginBottom: 9 }}>
          {c.description}
        </div>
      )}
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <button
          onClick={onConfirm}
          disabled={busy}
          style={{
            padding: "7px 13px", borderRadius: 8, border: "none",
            background: accent, color: "#fff", fontSize: 12, fontWeight: 700,
            cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1,
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
          {busy
            ? <><Loader2 size={12} className="nkv-anim" style={{ animation: "nkv-spin 900ms linear infinite" }} /> Working…</>
            : <><Check size={13} /> {c.label}</>}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          style={{
            padding: "7px 13px", borderRadius: 8,
            border: `1px solid ${C.bord}`, background: C.surf, color: C.mid,
            fontSize: 12, fontWeight: 700, cursor: busy ? "wait" : "pointer",
          }}>
          No, cancel
        </button>
      </div>
      {turn.confirmError && (
        <div style={{
          marginTop: 8, color: C.red, fontSize: 11.5, lineHeight: 1.4,
          display: "flex", gap: 6, alignItems: "flex-start",
        }}>
          <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{turn.confirmError}</span>
        </div>
      )}
    </div>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
