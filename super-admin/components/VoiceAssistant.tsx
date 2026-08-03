// super-admin/components/VoiceAssistant.tsx
// Floating voice assistant for the Super Admin panel.
// Ask Nikki questions about your business data:
//   "Hey Nikki, what are today's appointments?"
//   "How many calls did we handle today?"
//   "Who are the hot leads right now?"
//
// Cost: ₹0 — uses browser Web Speech API for mic + TTS.
// Backend: /api/admin/voice-query (Gemini + Supabase).
"use client";
import { useState, useEffect, useRef, useCallback } from "react";

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const API = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

const C = {
  bg:   "#07070D", surf: "#0F0F1A", hi: "#161625", bord: "#1E1E35",
  acc:  "#8B5CF6", gbr:  "#A78BFA", lav: "#C4B5FD",
  grn:  "#10B981", red:  "#EF4444", gold: "#F59E0B",
  txt:  "#EEEEFF", mid:  "#8888AA", dim:  "#44445A",
};

const SUGGESTED = [
  "What are today's appointments?",
  "How many calls today?",
  "Who are the hot leads?",
  "How many active calls right now?",
  "What's this month's performance?",
  "Any missed calls today?",
];

interface Msg { role: "nikki" | "user"; text: string; time: string; }

export default function VoiceAssistant({ tenantId }: { tenantId?: string }) {
  const [open, setOpen]           = useState(false);
  const [msgs, setMsgs]           = useState<Msg[]>([]);
  const [status, setStatus]       = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [input, setInput]         = useState("");
  const [hasSTT, setHasSTT]       = useState(false);
  const [teVoice, setTeVoice]     = useState<SpeechSynthesisVoice | null>(null);
  const [pulseCount, setPulseCount] = useState(0);  // badge for new messages
  const recogRef                  = useRef<any>(null);
  const endRef                    = useRef<HTMLDivElement>(null);

  // ── Init ────────────────────────────────────────────────────
  useEffect(() => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    setHasSTT(!!SpeechRec);

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find(v => v.lang === "te-IN")
        || voices.find(v => v.lang.startsWith("te"))
        || voices.find(v => v.lang === "hi-IN")
        || voices.find(v => v.lang.startsWith("en"))
        || voices[0];
      setTeVoice(v || null);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  // ── Scroll ──────────────────────────────────────────────────
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, status]);

  // ── Speak ───────────────────────────────────────────────────
  const speak = useCallback((text: string) => {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    if (teVoice) utt.voice = teVoice;
    utt.lang  = "en-IN";   // admin responses in English
    utt.rate  = 1.0;
    utt.pitch = 1.0;
    utt.onstart = () => setStatus("speaking");
    utt.onend   = () => setStatus("idle");
    utt.onerror = () => setStatus("idle");
    setStatus("speaking");
    window.speechSynthesis.speak(utt);
  }, [teVoice]);

  const now = () => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  // ── Query API ───────────────────────────────────────────────
  const askNikki = useCallback(async (question: string) => {
    setMsgs(m => [...m, { role: "user", text: question, time: now() }]);
    setStatus("thinking");

    try {
      const token = typeof window !== "undefined"
        ? localStorage.getItem("sb-access-token") || sessionStorage.getItem("sb-access-token") || ""
        : "";

      const resp = await fetch(`${API}/api/admin/voice-query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ question, tenant_id: tenantId }),
      });

      const data = await resp.json();
      const answer: string = data.answer || "I couldn't get that data right now.";

      setMsgs(m => [...m, { role: "nikki", text: answer, time: now() }]);
      if (!open) setPulseCount(c => c + 1);
      speak(answer);
    } catch (err) {
      const errMsg = "Sorry, I couldn't connect to the server. Please try again.";
      setMsgs(m => [...m, { role: "nikki", text: errMsg, time: now() }]);
      setStatus("idle");
    }
  }, [tenantId, speak, open]);

  // ── Mic input ───────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (status === "speaking") window.speechSynthesis.cancel();
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return;

    const rec = new SpeechRec();
    recogRef.current = rec;
    rec.continuous    = false;
    rec.interimResults = true;
    rec.lang          = "en-IN";   // admin usually speaks English

    rec.onstart  = () => setStatus("listening");
    rec.onresult = (e: any) => {
      const t = Array.from(e.results).map((r: any) => r[0].transcript).join("");
      setInput(t);
    };
    rec.onend = () => {
      const q = input.trim();
      if (q) { setInput(""); askNikki(q); }
      else setStatus("idle");
    };
    rec.onerror = () => setStatus("idle");
    rec.start();
  }, [status, input, askNikki]);

  const stopListening = () => recogRef.current?.stop();

  // ── Typed send ───────────────────────────────────────────────
  const handleSend = () => {
    const q = input.trim();
    if (!q || status === "thinking") return;
    setInput("");
    askNikki(q);
  };

  // ── Toggle open + clear badge ────────────────────────────────
  const toggle = () => {
    setOpen(o => !o);
    setPulseCount(0);
    if (!open && msgs.length === 0) {
      // Greet on first open
      setTimeout(() => {
        const greet = "Hello! I'm Nikki, your admin assistant. Ask me anything about today's calls, appointments, or leads.";
        setMsgs([{ role: "nikki", text: greet, time: now() }]);
        speak(greet);
      }, 400);
    }
  };

  return (
    <>
      <style>{`
        @keyframes nikki-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }
        @keyframes nikki-slide-up { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes nikki-bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        @keyframes nikki-ring { 0%{transform:scale(1);opacity:.8} 100%{transform:scale(1.8);opacity:0} }
      `}</style>

      {/* ── Chat panel ──────────────────────────────────────── */}
      {open && (
        <div style={{
          position: "fixed", bottom: 90, right: 24, zIndex: 9999,
          width: 360, background: C.surf, border: `1px solid ${C.bord}`,
          borderRadius: 18, overflow: "hidden",
          boxShadow: `0 24px 60px #000C, 0 0 0 1px ${C.acc}22`,
          animation: "nikki-slide-up 0.25s ease-out",
          fontFamily: "'Inter', -apple-system, sans-serif",
        }}>
          {/* Header */}
          <div style={{
            background: `linear-gradient(135deg, ${C.acc}44, ${C.bord})`,
            borderBottom: `1px solid ${C.bord}`,
            padding: "12px 16px",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%",
                background: `linear-gradient(135deg, ${C.acc}, #06B6D4)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16,
                boxShadow: status === "speaking" ? `0 0 18px ${C.acc}99` : "none",
              }}>🤖</div>
              {status === "speaking" && (
                <div style={{
                  position: "absolute", inset: -4, borderRadius: "50%",
                  border: `2px solid ${C.grn}`,
                  animation: "nikki-ring 1.2s infinite",
                }} />
              )}
              <div style={{
                position: "absolute", bottom: 1, right: 1,
                width: 8, height: 8, borderRadius: "50%",
                background: status !== "idle" ? C.grn : C.dim,
                border: `2px solid ${C.surf}`,
              }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: C.txt, fontSize: 13, fontWeight: 800 }}>Nikki Assistant</div>
              <div style={{ color: C.mid, fontSize: 10, fontWeight: 600 }}>
                {status === "idle" && "● Ready · Ask me anything"}
                {status === "listening" && "🎙️ Listening... speak now"}
                {status === "thinking" && "⏳ Querying your data..."}
                {status === "speaking" && "🔊 Speaking..."}
              </div>
            </div>
            <button onClick={() => setOpen(false)} style={{
              background: "none", border: "none", color: C.dim,
              cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0,
            }}>✕</button>
          </div>

          {/* Chat messages */}
          <div style={{
            height: 280, overflowY: "auto", padding: "12px 14px",
            display: "flex", flexDirection: "column", gap: 8,
            scrollbarWidth: "thin", scrollbarColor: `${C.dim} transparent`,
          }}>
            {msgs.map((m, i) => (
              <div key={i} style={{
                display: "flex",
                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                gap: 6, alignItems: "flex-end",
              }}>
                {m.role === "nikki" && (
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                    background: `linear-gradient(135deg, ${C.acc}, #06B6D4)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11,
                  }}>🤖</div>
                )}
                <div>
                  <div style={{
                    maxWidth: 260,
                    background: m.role === "nikki" ? C.hi : `linear-gradient(135deg, ${C.acc}, ${C.gbr})`,
                    color: C.txt, borderRadius: m.role === "nikki" ? "4px 12px 12px 12px" : "12px 4px 12px 12px",
                    padding: "9px 12px", fontSize: 12, lineHeight: 1.5,
                    border: m.role === "nikki" ? `1px solid ${C.bord}` : "none",
                  }}>{m.text}</div>
                  <div style={{ color: C.dim, fontSize: 9, marginTop: 2,
                    textAlign: m.role === "user" ? "right" : "left" }}>{m.time}</div>
                </div>
              </div>
            ))}
            {status === "thinking" && (
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%",
                  background: `linear-gradient(135deg, ${C.acc}, #06B6D4)`,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>🤖</div>
                <div style={{ background: C.hi, border: `1px solid ${C.bord}`,
                  borderRadius: "4px 12px 12px 12px", padding: "9px 12px",
                  display: "flex", gap: 4 }}>
                  {[0,1,2].map(d => (
                    <div key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: C.gbr,
                      animation: `nikki-bounce 1s ${d * 0.2}s infinite` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Suggestions */}
          {msgs.length <= 1 && status === "idle" && (
            <div style={{
              padding: "0 14px 10px",
              display: "flex", flexWrap: "wrap", gap: 5,
            }}>
              {SUGGESTED.map(s => (
                <button key={s} onClick={() => askNikki(s)} style={{
                  background: C.acc + "22", color: C.gbr,
                  border: `1px solid ${C.acc}44`, borderRadius: 12,
                  padding: "4px 10px", fontSize: 10, cursor: "pointer",
                  fontFamily: "inherit", fontWeight: 600,
                }}>{s}</button>
              ))}
            </div>
          )}

          {/* Listening transcript */}
          {status === "listening" && input && (
            <div style={{
              margin: "0 14px 8px", background: C.grn + "11",
              border: `1px solid ${C.grn}33`, borderRadius: 8,
              padding: "6px 10px", color: C.mid, fontSize: 11, fontStyle: "italic",
            }}>
              "{input}"
            </div>
          )}

          {/* Input bar */}
          <div style={{
            borderTop: `1px solid ${C.bord}`,
            padding: "10px 12px",
            display: "flex", gap: 6, alignItems: "center",
            background: C.bg,
          }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleSend(); } }}
              placeholder={status === "listening" ? "Listening..." : "Ask Nikki..."}
              disabled={status === "listening" || status === "thinking"}
              style={{
                flex: 1, background: C.hi, border: `1px solid ${C.bord}`,
                borderRadius: 7, padding: "8px 10px", color: C.txt,
                fontSize: 12, outline: "none", fontFamily: "inherit",
                opacity: (status === "listening" || status === "thinking") ? 0.5 : 1,
              }}
            />
            {hasSTT && (
              <button
                onClick={status === "listening" ? stopListening : startListening}
                disabled={status === "thinking" || status === "speaking"}
                style={{
                  width: 32, height: 32, borderRadius: "50%", border: "none",
                  background: status === "listening" ? C.red : `linear-gradient(135deg, ${C.acc}, ${C.gbr})`,
                  color: "#fff", cursor: "pointer", fontSize: 13,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: status === "listening" ? `0 0 10px ${C.red}88` : "none",
                  transition: "all 0.2s",
                }}>
                {status === "listening" ? "⏹" : "🎙️"}
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={!input.trim() || status !== "idle"}
              style={{
                width: 32, height: 32, borderRadius: 7, border: "none",
                background: input.trim() && status === "idle" ? `linear-gradient(135deg, ${C.acc}, ${C.gbr})` : C.dim,
                color: "#fff", cursor: input.trim() && status === "idle" ? "pointer" : "not-allowed",
                fontSize: 13, transition: "background 0.2s",
              }}>↑</button>
          </div>
        </div>
      )}

      {/* ── Floating Action Button ──────────────────────────── */}
      <button
        onClick={toggle}
        title="Ask Nikki about your business data"
        style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9999,
          width: 56, height: 56, borderRadius: "50%", border: "none",
          background: open
            ? C.dim
            : `linear-gradient(135deg, ${C.acc}, #8B5CF6)`,
          cursor: "pointer",
          fontSize: 24, display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: open ? "none" : `0 8px 24px ${C.acc}77, 0 2px 8px #0006`,
          animation: !open && pulseCount === 0 ? "nikki-pulse 3s ease-in-out infinite" : "none",
          transition: "background 0.3s, box-shadow 0.3s",
        }}>
        {open ? "✕" : "🤖"}
        {/* Unread badge */}
        {!open && pulseCount > 0 && (
          <div style={{
            position: "absolute", top: -2, right: -2,
            width: 18, height: 18, borderRadius: "50%",
            background: C.red, color: "#fff", fontSize: 10, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: `2px solid ${C.bg}`,
          }}>{pulseCount}</div>
        )}
      </button>
    </>
  );
}
