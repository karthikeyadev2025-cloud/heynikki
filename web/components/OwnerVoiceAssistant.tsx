// components/OwnerVoiceAssistant.tsx
// Floating voice assistant for logged-in business owners — the
// "owner mode" half of the dual-mode voice widget (the public
// landing page's VoiceChatWidget is "visitor mode": a scripted demo
// experience for people checking out the product before signing up).
//
// This one is real, not scripted: ask it "ఈరోజు ఎన్ని కాల్స్ వచ్చాయి?"
// (how many calls today?) and it genuinely transcribes your voice via
// Sarvam Saaras v3, asks Gemini against your own live business data,
// and speaks the answer back via Sarvam Bulbul v3 — same models
// already proven in the live phone pipeline, not the browser's weak
// Web Speech API (which has little to no real Telugu support).
"use client";
import { useState, useRef, useCallback } from "react";
import { createClient } from "../lib/supabase";
import { NIKKI } from "../lib/brand";
import { Bot, Mic, Loader2, X, Square, Volume2 } from "lucide-react";

const sb = createClient();
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const C = {
  acc: NIKKI.teal, gbr: NIKKI.tealLight, surf: NIKKI.surface,
  bord: NIKKI.border, txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
  red: NIKKI.red,
};

type Status = "idle" | "recording" | "thinking" | "speaking" | "error";

export default function OwnerVoiceAssistant() {
  const [open, setOpen]     = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

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
