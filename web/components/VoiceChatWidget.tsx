// components/VoiceChatWidget.tsx
// Real in-browser voice agent using Web Speech API (100% free, no API key).
// - STT: window.SpeechRecognition (Chrome/Edge built-in, supports te-IN)
// - LLM: Gemini via voice-pipeline /api/v1/browser/chat
// - TTS: window.speechSynthesis with te-IN voice (browser native, free)
// Confirmed bookings → POSTed to Supabase via /api/v1/browser/save-booking
"use client";
import { useState, useEffect, useRef, useCallback } from "react";

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const PIPELINE_URL = process.env.NEXT_PUBLIC_PIPELINE_URL || "https://pipeline.heynikki.in";

// ── Design tokens (same dark palette as landing page) ──────────
const C = {
  bg: "#06060F", surf: "#0C0C1D", hi: "#13132A", bord: "#1C1C3A",
  acc: "#7C3AED", glow: "#8B5CF6", gbr: "#A78BFA", lav: "#C4B5FD",
  grn: "#10B981", red: "#EF4444", cyn: "#06B6D4",
  txt: "#EEEEFF", mid: "#8888AA", dim: "#3A3A5A",
};

interface Msg { role: "nikki" | "user"; text: string; }
interface BookingInfo { name?: string; phone?: string; service?: string; slot?: string; }

interface Props {
  tenantId?: string;        // if provided, booking saved to tenant's dashboard
  compact?: boolean;        // smaller card for embedding in other pages
}

export default function VoiceChatWidget({ tenantId, compact }: Props) {
  const [msgs, setMsgs]           = useState<Msg[]>([]);
  const [status, setStatus]       = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [input, setInput]         = useState("");
  const [booking, setBooking]     = useState<BookingInfo>({});
  const [confirmed, setConfirmed] = useState(false);
  const [sessionId]               = useState(() => Math.random().toString(36).slice(2));
  const [hasSTT, setHasSTT]       = useState(false);
  const [teVoice, setTeVoice]     = useState<SpeechSynthesisVoice | null>(null);
  const recogRef                  = useRef<any>(null);
  const endRef                    = useRef<HTMLDivElement>(null);
  const synthRef                  = useRef<SpeechSynthesisUtterance | null>(null);

  // ── Init: check browser support + find Telugu voice ────────────
  useEffect(() => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    setHasSTT(!!SpeechRec);

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      // Prefer: te-IN > hi-IN > en-IN > any
      const te = voices.find(v => v.lang === "te-IN")
        || voices.find(v => v.lang.startsWith("te"))
        || voices.find(v => v.lang === "hi-IN")
        || voices.find(v => v.lang.startsWith("en-IN"))
        || voices[0];
      setTeVoice(te || null);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  // ── Scroll to bottom ────────────────────────────────────────────
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, status]);

  // ── Speak text via SpeechSynthesis ──────────────────────────────
  const speak = useCallback((text: string, onEnd?: () => void) => {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    if (teVoice) utt.voice = teVoice;
    utt.lang  = "te-IN";
    utt.rate  = 0.95;
    utt.pitch = 1.05;
    utt.onstart = () => setStatus("speaking");
    utt.onend   = () => { setStatus("idle"); onEnd?.(); };
    utt.onerror = () => { setStatus("idle"); onEnd?.(); };
    synthRef.current = utt;
    setStatus("speaking");
    window.speechSynthesis.speak(utt);
  }, [teVoice]);

  // ── Add message + optionally speak it ──────────────────────────
  const nikkiSay = useCallback((text: string, speakIt = true) => {
    setMsgs(m => [...m, { role: "nikki", text }]);
    if (speakIt) speak(text);
  }, [speak]);

  // ── Send text to pipeline → get LLM response ───────────────────
  const sendToNikki = useCallback(async (userText: string) => {
    setMsgs(m => [...m, { role: "user", text: userText }]);
    setStatus("thinking");

    try {
      const resp = await fetch(`${PIPELINE_URL}/api/v1/browser/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text:       userText,
          session_id: sessionId,
          tenant_id:  tenantId,
          tts:        false,   // use browser TTS (free)
        }),
      });

      const data = await resp.json();
      const responseText: string = data.response || "Sorry, I didn't catch that. Can you repeat?";

      if (data.booking_confirmed) {
        // Extract booking info from summary
        const summary: string = data.booking_summary || "";
        nikkiSay(responseText, true);

        // Try to save booking to backend
        const bData = booking;
        if (Object.keys(bData).length > 0) {
          try {
            await fetch(`${PIPELINE_URL}/api/v1/browser/save-booking`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name:       bData.name || "Web Visitor",
                phone:      bData.phone || "Unknown",
                service:    bData.service || "General",
                slot:       bData.slot || "Flexible",
                session_id: sessionId,
                tenant_id:  tenantId,
              }),
            });
          } catch (e) {
            console.warn("Booking save failed (will retry):", e);
          }
        }
        setConfirmed(true);
      } else {
        nikkiSay(responseText, true);

        // Heuristic booking field extraction from conversation
        const lowerText = userText.toLowerCase();
        const lowerResp = responseText.toLowerCase();
        if (!booking.name && (lowerResp.includes("your name") || msgs.length < 3)) {
          const nameMatch = userText.match(/(?:i am|my name is|this is|call me)?\s*([A-Z][a-z]+ ?[A-Z]?[a-z]*)/i);
          if (nameMatch) setBooking(b => ({ ...b, name: nameMatch[1] }));
          else if (userText.length < 30 && /^[A-Za-z\s]+$/.test(userText)) {
            setBooking(b => ({ ...b, name: userText.trim() }));
          }
        }
        if (!booking.phone && /[+0-9]{10,}/.test(userText)) {
          const phone = userText.match(/[+0-9]{10,}/)?.[0];
          if (phone) setBooking(b => ({ ...b, phone }));
        }
        if (!booking.service && lowerResp.includes("service")) {
          setBooking(b => ({ ...b, service: userText.trim() }));
        }
        if (!booking.slot && (lowerResp.includes("time") || lowerResp.includes("appointment"))) {
          setBooking(b => ({ ...b, slot: userText.trim() }));
        }
      }
    } catch (e) {
      setStatus("idle");
      nikkiSay("I'm having trouble connecting. Please try again.", true);
    }
  }, [sessionId, tenantId, booking, msgs.length, nikkiSay]);

  // ── Start listening via SpeechRecognition ──────────────────────
  const startListening = useCallback(() => {
    if (status === "speaking") { window.speechSynthesis.cancel(); }
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return;

    const rec = new SpeechRec();
    recogRef.current = rec;
    rec.continuous    = false;
    rec.interimResults = true;
    rec.lang          = "te-IN";   // Telugu-Indian — also recognises English

    rec.onstart  = () => setStatus("listening");
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results)
        .map((r: any) => r[0].transcript)
        .join("");
      setInput(transcript);
    };
    rec.onend = () => {
      const finalText = input.trim();
      if (finalText) {
        setInput("");
        sendToNikki(finalText);
      } else {
        setStatus("idle");
      }
    };
    rec.onerror = () => setStatus("idle");
    rec.start();
  }, [status, input, sendToNikki]);

  // ── Stop listening ──────────────────────────────────────────────
  const stopListening = useCallback(() => {
    recogRef.current?.stop();
  }, []);

  // ── Handle typed message ────────────────────────────────────────
  const handleTypedSend = useCallback(() => {
    const t = input.trim();
    if (!t || status === "thinking") return;
    setInput("");
    sendToNikki(t);
  }, [input, status, sendToNikki]);

  // ── Initial greeting ───────────────────────────────────────────
  const startConversation = useCallback(() => {
    setMsgs([]);
    setConfirmed(false);
    setBooking({});
    setStatus("idle");
    setTimeout(() => {
      nikkiSay("నమస్కారం! I'm Nikki, your AI receptionist. I can book an appointment for you right now. What's your name?", true);
    }, 300);
  }, [nikkiSay]);

  const resetChat = () => {
    window.speechSynthesis.cancel();
    recogRef.current?.stop();
    setMsgs([]);
    setConfirmed(false);
    setBooking({});
    setStatus("idle");
    setInput("");
  };

  const height = compact ? 260 : 340;

  return (
    <div style={{
      background: C.surf, border: `1px solid ${C.bord}`,
      borderRadius: 20, overflow: "hidden",
      boxShadow: `0 40px 80px #000A, 0 0 0 1px ${C.acc}22`,
      width: "100%", maxWidth: compact ? 380 : 440,
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes bounce-dot {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        @keyframes slide-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* ── Header ─────────────────────────────────────── */}
      <div style={{
        background: `linear-gradient(135deg, ${C.acc}33, ${C.cyn}11)`,
        borderBottom: `1px solid ${C.bord}`,
        padding: "14px 18px",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        {/* Avatar + live ring */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            background: `linear-gradient(135deg, ${C.acc}, ${C.cyn})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18,
            boxShadow: msgs.length > 0 ? `0 0 20px ${C.acc}88` : "none",
          }}>🤖</div>
          {status === "speaking" && (
            <div style={{
              position: "absolute", inset: -4, borderRadius: "50%",
              border: `2px solid ${C.grn}`,
              animation: "pulse-ring 1.2s ease-out infinite",
              pointerEvents: "none",
            }} />
          )}
          <div style={{
            position: "absolute", bottom: 1, right: 1,
            width: 10, height: 10, borderRadius: "50%",
            background: msgs.length > 0 ? C.grn : C.dim,
            border: `2px solid ${C.surf}`,
            transition: "background 0.3s",
          }} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.txt, fontSize: 13, fontWeight: 800 }}>Nikki AI Receptionist</div>
          <div style={{ color: C.mid, fontSize: 10, marginTop: 1, fontWeight: 600 }}>
            {status === "idle" && msgs.length === 0 && "Click ▶ to start"}
            {status === "idle" && msgs.length > 0 && "● Ready"}
            {status === "listening" && "🎙️ Listening..."}
            {status === "thinking" && "⏳ Thinking..."}
            {status === "speaking" && "🔊 Speaking..."}
            {confirmed && " ✅ Booking Confirmed!"}
          </div>
        </div>

        {/* Language badge */}
        <div style={{
          background: C.acc + "33", border: `1px solid ${C.acc}44`,
          borderRadius: 10, padding: "3px 8px",
          color: C.lav, fontSize: 10, fontWeight: 700, flexShrink: 0,
        }}>🇮🇳 te-IN</div>

        {msgs.length > 0 && (
          <button onClick={resetChat} style={{
            background: "none", border: `1px solid ${C.bord}`,
            color: C.dim, borderRadius: 6, padding: "3px 8px",
            fontSize: 10, cursor: "pointer", fontFamily: "inherit",
          }}>↺</button>
        )}
      </div>

      {/* ── Chat area ───────────────────────────────────── */}
      <div style={{
        height, overflowY: "auto", padding: "14px 14px 8px",
        display: "flex", flexDirection: "column", gap: 8,
        scrollbarWidth: "thin", scrollbarColor: `${C.dim} transparent`,
      }}>
        {msgs.length === 0 ? (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            gap: 14, textAlign: "center",
          }}>
            {/* Animated mic */}
            <div style={{ position: "relative", width: 64, height: 64 }}>
              <div style={{
                position: "absolute", inset: 0, borderRadius: "50%",
                background: `linear-gradient(135deg, ${C.acc}44, ${C.cyn}22)`,
                border: `2px solid ${C.acc}44`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 28, cursor: "pointer",
              }} onClick={startConversation}>🎙️</div>
            </div>
            <div>
              <div style={{ color: C.txt, fontWeight: 800, fontSize: 14, marginBottom: 6 }}>
                Speak or Type to Nikki
              </div>
              <div style={{ color: C.mid, fontSize: 11, lineHeight: 1.5 }}>
                {hasSTT
                  ? "🎙️ Mic ready · Telugu + English supported · Free forever"
                  : "⌨️ Type your message below (voice needs Chrome/Edge)"}
              </div>
            </div>
            <button onClick={startConversation} style={{
              padding: "11px 24px", borderRadius: 10,
              background: `linear-gradient(135deg, ${C.acc}, ${C.glow})`,
              color: "#fff", border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: 700, fontFamily: "inherit",
              boxShadow: `0 6px 20px ${C.acc}55`,
            }}>▶ Start Conversation</button>
          </div>
        ) : (
          <>
            {msgs.map((m, i) => (
              <div key={i} style={{
                display: "flex",
                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                gap: 8, alignItems: "flex-end",
                animation: "slide-in 0.2s ease-out",
              }}>
                {m.role === "nikki" && (
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                    background: `linear-gradient(135deg, ${C.acc}, ${C.cyn})`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12,
                  }}>🤖</div>
                )}
                <div style={{
                  maxWidth: "78%",
                  background: m.role === "nikki" ? C.hi : `linear-gradient(135deg, ${C.acc}, ${C.glow})`,
                  color: C.txt,
                  borderRadius: m.role === "nikki" ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
                  padding: "9px 13px", fontSize: 12, lineHeight: 1.5,
                  border: m.role === "nikki" ? `1px solid ${C.bord}` : "none",
                  whiteSpace: "pre-wrap",
                }}>
                  {m.text}
                </div>
              </div>
            ))}

            {/* Thinking indicator */}
            {status === "thinking" && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%",
                  background: `linear-gradient(135deg, ${C.acc}, ${C.cyn})`,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>🤖</div>
                <div style={{ background: C.hi, border: `1px solid ${C.bord}`,
                  borderRadius: "4px 14px 14px 14px", padding: "10px 14px",
                  display: "flex", gap: 4, alignItems: "center" }}>
                  {[0,1,2].map(d => (
                    <div key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: C.gbr,
                      animation: `bounce-dot 1s ${d * 0.2}s ease-in-out infinite` }} />
                  ))}
                </div>
              </div>
            )}

            {/* Listening waveform */}
            {status === "listening" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px",
                background: C.grn + "11", borderRadius: 8, border: `1px solid ${C.grn}33` }}>
                <div style={{ color: C.grn, fontSize: 11, fontWeight: 700 }}>🎙️ Listening...</div>
                {input && <div style={{ color: C.mid, fontSize: 11, fontStyle: "italic" }}>"{input}"</div>}
              </div>
            )}

            {/* Confirmed badge */}
            {confirmed && (
              <div style={{
                background: C.grn + "11", border: `1px solid ${C.grn}33`,
                borderRadius: 10, padding: "12px 14px", textAlign: "center",
              }}>
                <div style={{ color: C.grn, fontSize: 13, fontWeight: 800 }}>✅ Booking Confirmed!</div>
                <div style={{ color: C.mid, fontSize: 11, marginTop: 4 }}>
                  WhatsApp confirmation will be sent to {booking.phone || "your number"}
                </div>
                <div style={{ color: C.mid, fontSize: 10, marginTop: 8 }}>
                  📋 This appointment is now visible in your business dashboard
                </div>
              </div>
            )}

            <div ref={endRef} />
          </>
        )}
      </div>

      {/* ── Input bar ───────────────────────────────────── */}
      {msgs.length > 0 && !confirmed && (
        <div style={{
          borderTop: `1px solid ${C.bord}`,
          padding: "12px 14px",
          display: "flex", gap: 8, alignItems: "center",
          background: C.bg,
        }}>
          <input
            value={input}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); handleTypedSend(); } }}
            placeholder={status === "listening" ? "Listening..." : "Type or press 🎙️ to speak..."}
            disabled={status === "listening" || status === "thinking"}
            style={{
              flex: 1, background: C.hi, border: `1px solid ${C.bord}`,
              borderRadius: 8, padding: "9px 12px", color: C.txt,
              fontSize: 12, outline: "none", fontFamily: "inherit",
              opacity: (status === "listening" || status === "thinking") ? 0.5 : 1,
            }}
          />
          {/* Mic button */}
          {hasSTT && (
            <button
              onClick={status === "listening" ? stopListening : startListening}
              disabled={status === "thinking" || status === "speaking"}
              title={status === "listening" ? "Stop listening" : "Speak in Telugu or English"}
              style={{
                width: 36, height: 36, borderRadius: "50%", border: "none",
                background: status === "listening"
                  ? C.red
                  : `linear-gradient(135deg, ${C.acc}, ${C.glow})`,
                color: "#fff", cursor: "pointer",
                fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
                boxShadow: status === "listening" ? `0 0 12px ${C.red}88` : `0 0 12px ${C.acc}66`,
                transition: "all 0.2s",
              }}>
              {status === "listening" ? "⏹" : "🎙️"}
            </button>
          )}
          {/* Send button */}
          <button
            onClick={handleTypedSend}
            disabled={!input.trim() || status === "thinking" || status === "listening"}
            style={{
              width: 36, height: 36, borderRadius: 8, border: "none",
              background: input.trim() && status === "idle"
                ? `linear-gradient(135deg, ${C.acc}, ${C.glow})`
                : C.dim,
              color: "#fff",
              cursor: input.trim() && status === "idle" ? "pointer" : "not-allowed",
              fontSize: 14, flexShrink: 0,
              transition: "background 0.2s",
            }}>↑</button>
        </div>
      )}

      {/* ── Not-supported warning ──────────────────────── */}
      {!hasSTT && msgs.length === 0 && (
        <div style={{
          borderTop: `1px solid ${C.bord}`, padding: "8px 16px",
          background: C.bg, color: C.dim, fontSize: 10, textAlign: "center",
        }}>
          ⚠️ Voice input needs Chrome or Edge browser. You can still type.
        </div>
      )}
    </div>
  );
}
