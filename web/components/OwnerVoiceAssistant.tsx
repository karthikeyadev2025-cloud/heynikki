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
"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { createClient } from "../lib/supabase";
import { isNativeApp, startHeyNikki, stopHeyNikki, heyNikkiRunning } from "../lib/native";
import { NIKKI } from "../lib/brand";
import { Bot, Mic, Loader2, X, Square, Volume2 } from "lucide-react";

const sb = createClient();
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const C = {
  acc: NIKKI.teal, gbr: NIKKI.tealLight, surf: NIKKI.surface,
  bord: NIKKI.border, txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
  red: NIKKI.red, grn: NIKKI.emerald,
};

type Status = "idle" | "recording" | "thinking" | "speaking" | "error";

export default function OwnerVoiceAssistant() {
  const [open, setOpen]     = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [wakeOn, setWakeOn] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("");
  const [typed, setTyped]   = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

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
  const statusRef      = useRef<Status>("idle");
  const openRef        = useRef(false);
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { openRef.current = open; }, [open]);

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

  const startRecording = useCallback(async () => {
    setErrorMsg("");
    setTranscript("");
    setAnswer("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        handleRecordingComplete(new Blob(chunksRef.current, { type: mimeType }));
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setStatus("recording");
    } catch (e) {
      setStatus("error");
      setErrorMsg("Couldn't access your microphone. Check browser permissions.");
    }
  }, []);

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
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Request failed (${res.status})`);
      }

      const data = await res.json();
      setTranscript(data.transcript || "");
      setAnswer(data.answer || "");

      if (data.audio_base64) {
        playAnswer(data.audio_base64, data.audio_mime || "audio/wav");
      } else {
        setStatus("idle");
      }
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e.message || "Something went wrong — please try again.");
    }
  };

  // Ask by typing. The spoken path needs Sarvam for transcription, so when
  // voice is unavailable — no mic permission, a browser without
  // MediaRecorder, or the speech vendor being down, which has happened —
  // the assistant was completely unusable rather than merely quiet. The
  // answer is the same one the voice path gives; only the way in differs.
  const askTyped = async () => {
    const q = typed.trim();
    if (!q) return;
    setStatus("thinking"); setErrorMsg(""); setAnswer(""); setTranscript(q);
    try {
      const sb = createClient();
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(`${API}/api/admin/voice-query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setAnswer(data.answer || "");
      setTyped("");
      setStatus("idle");
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e.message || "Something went wrong — please try again.");
    }
  };

  const playAnswer = (audioBase64: string, mime: string) => {
    setStatus("speaking");
    const audio = new Audio(`data:${mime};base64,${audioBase64}`);
    audioElRef.current = audio;
    audio.onended = () => setStatus("idle");
    audio.onerror = () => setStatus("idle");
    audio.play().catch(() => setStatus("idle"));
  };

  const toggle = () => {
    if (status === "speaking") {
      audioElRef.current?.pause();
      setStatus("idle");
    }
    setOpen(o => !o);
  };

  return (
    <>
      <style>{`
        @keyframes owner-voice-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.06)} }
        @keyframes owner-voice-ring { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(1.9);opacity:0} }
      `}</style>

      {open && (
        <div style={{
          position: "fixed", bottom: 90, right: 24, zIndex: 9999,
          width: 320, maxWidth: "calc(100vw - 32px)",
          background: C.surf, border: "1px solid " + C.bord, borderRadius: 14,
          boxShadow: "0 12px 32px rgba(15,23,42,0.18)", padding: 16,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%",
                background: `linear-gradient(135deg, ${C.acc}, #06B6D4)`,
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Bot size={15} color="#fff" />
              </div>
              <div style={{ color: C.txt, fontSize: 13, fontWeight: 800 }}>Ask Nikki</div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none",
              color: C.dim, cursor: "pointer", display: "flex" }}><X size={16} /></button>
          </div>

          <div style={{ color: C.mid, fontSize: 11, marginBottom: 12 }}>
            {status === "idle" && !transcript && "మీ వ్యాపారం గురించి అడగండి — తెలుగులో మాట్లాడండి"}
            {status === "recording" && "వింటున్నాను... (Listening...)"}
            {status === "thinking" && "ఆలోచిస్తున్నాను... (Thinking...)"}
            {status === "speaking" && "మాట్లాడుతున్నాను... (Speaking...)"}
            {status === "error" && errorMsg}
          </div>

          {transcript && (
            <div style={{ background: NIKKI.bg, borderRadius: 8, padding: "8px 10px", marginBottom: 8 }}>
              <div style={{ color: C.dim, fontSize: 9, textTransform: "uppercase", marginBottom: 2 }}>You asked</div>
              <div style={{ color: C.txt, fontSize: 12 }}>{transcript}</div>
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") askTyped(); }}
              placeholder="…or type: how many calls today?"
              style={{ flex: 1, padding: "7px 10px", borderRadius: 7, fontSize: 12.5,
                background: NIKKI.vault, color: C.txt, border: `1px solid ${C.bord}` }} />
            <button type="button" onClick={askTyped} disabled={!typed.trim()}
              style={{ padding: "7px 12px", borderRadius: 7, border: "none", fontSize: 12,
                fontWeight: 800, background: C.grn, color: "#04120a",
                cursor: typed.trim() ? "pointer" : "default", opacity: typed.trim() ? 1 : 0.5 }}>
              Ask
            </button>
          </div>

          {answer && (
            <div style={{ background: C.acc + "15", borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
              <div style={{ color: C.acc, fontSize: 9, textTransform: "uppercase", marginBottom: 2 }}>Nikki</div>
              <div style={{ color: C.txt, fontSize: 12 }}>{answer}</div>
            </div>
          )}

          <button
            onClick={status === "recording" ? stopRecording : startRecording}
            disabled={status === "thinking" || status === "speaking"}
            style={{
              width: "100%", padding: "10px 0", borderRadius: 9, border: "none",
              background: status === "recording" ? C.red : `linear-gradient(135deg, ${C.acc}, ${C.gbr})`,
              color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              opacity: (status === "thinking" || status === "speaking") ? 0.6 : 1,
            }}>
            {status === "recording" ? (<><Square size={13} fill="#fff" /> Stop</>) :
             status === "thinking" ? (<><Loader2 size={13} /> Thinking...</>) :
             status === "speaking" ? (<><Volume2 size={13} /> Speaking...</>) :
             (<><Mic size={14} /> Tap to Ask</>)}
          </button>
        </div>
      )}

      {/* Wake-word toggle rides above the FAB. Green dot = she is listening
          for her name on this page; say "Hey Nikki" and the panel opens
          already recording. Off by default — an always-on mic must be the
          owner's explicit choice, made once per session. */}
      <button
        onClick={toggleWake}
        title={wakeOn ? "Voice wake is on — say 'Hey Nikki'" : "Enable 'Hey Nikki' voice wake"}
        style={{
          position: "fixed", bottom: 86, right: 24, zIndex: 9999,
          padding: "6px 12px", borderRadius: 999, border: `1px solid ${wakeOn ? C.grn : C.bord}`,
          background: wakeOn ? "rgba(16,185,129,0.12)" : C.surf,
          color: wakeOn ? C.grn : C.mid, fontSize: 11.5, fontWeight: 700,
          cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
        }}>
        <span style={{
          width: 7, height: 7, borderRadius: "50%",
          background: wakeOn ? C.grn : C.dim,
          boxShadow: wakeOn ? `0 0 0 3px rgba(16,185,129,0.2)` : "none",
        }} />
        {wakeOn ? (native ? "\u201cHey Nikki\u201d always on" : "\u201cHey Nikki\u201d on") : "\u201cHey Nikki\u201d wake"}
      </button>
      {nativeMsg && (
        <div style={{ position: "fixed", bottom: 122, right: 24, zIndex: 9999, maxWidth: 260,
          background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 10, padding: "8px 12px",
          color: C.red, fontSize: 12, fontWeight: 600, boxShadow: "0 8px 24px rgba(15,23,42,0.12)" }}>
          {nativeMsg}
        </div>
      )}

      <button
        onClick={toggle}
        title="Ask Nikki about your business — real Telugu voice"
        style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9999,
          width: 54, height: 54, borderRadius: "50%", border: "none",
          background: open ? C.dim : `linear-gradient(135deg, ${C.acc}, ${NIKKI.terracotta})`,
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: open ? "none" : `0 8px 24px ${C.acc}66, 0 2px 8px rgba(0,0,0,0.3)`,
          animation: !open ? "owner-voice-pulse 3s ease-in-out infinite" : "none",
          transition: "background 0.3s, box-shadow 0.3s",
        }}>
        {open ? <X size={20} color="#fff" /> : <Bot size={22} color="#fff" />}
      </button>
    </>
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
