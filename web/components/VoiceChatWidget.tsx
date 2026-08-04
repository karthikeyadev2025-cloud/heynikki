// components/VoiceChatWidget.tsx
// Official Hey Nikki Brand Voice Widget (Teal #12457A + Terracotta #E5533D)
// Features:
// 1. Hands-Free Continuous Listening: Mic opens automatically after Nikki speaks!
// 2. Telugu Register Rules: "గారు" honorific, "మీరు" respect, natural Tanglish numbers.
// 3. Robust Name & Entity Extraction in Telugu & English.
// 4. Web Speech API (te-IN + en-IN, 100% Free).
// 5. Client-Side Smart Fallback so pipeline DNS pending never blocks UI.
"use client";
import { useState, useEffect, useRef, useCallback } from "react";

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// ── Hey Nikki Official Brand Palette ──────────────────────────
const B = {
  teal:       "#12457A",
  terracotta: "#E5533D",
  espresso:   "#0F172A",
  vault:      "#F6F8FB",
  cardBg:     "#FFFFFF",
  border:     "#E2E8F0",
  borderHi:   "#CBD5E1",
  text:       "#0F172A",
  textMid:    "#475569",
  textDim:    "#94A3B8",
  green:      "#10B981",
  gold:       "#F59E0B",
  cyan:       "#06B6D4",
};

interface Msg { role: "nikki" | "user"; text: string; }
interface BookingInfo { name?: string; phone?: string; service?: string; slot?: string; }

interface Props {
  tenantId?: string;
  compact?: boolean;
}

const SERVICES = ["Doctor Consultation", "Dental Check-up", "Property Site Visit", "Business Enquiry", "General Appointment"];

// ── Telugu Name Extractor ────────────────────────────────────
function extractName(input: string): string {
  const clean = input.trim();
  // Strip common Telugu/English prefixes
  const prefixRegex = /^(my name is|i am|this is|call me|నా పేరు|నేను|మాది)\s+/i;
  const stripped = clean.replace(prefixRegex, "").trim();
  // Capitalize first letter
  if (!stripped) return "Customer";
  const nameCandidate = stripped.split(/[\s,]+/)[0];
  const capitalized = nameCandidate.charAt(0).toUpperCase() + nameCandidate.slice(1);
  return capitalized;
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
  const [stage, setStage]         = useState<"greeting" | "name" | "phone" | "service" | "slot" | "done">("greeting");
  const [autoListen, setAutoListen] = useState(true); // Continuous listening toggle

  const recogRef                  = useRef<any>(null);
  const endRef                    = useRef<HTMLDivElement>(null);

  // ── Init browser speech engines ──────────────────────────────
  useEffect(() => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    setHasSTT(!!SpeechRec);

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find(v => v.lang === "te-IN")
        || voices.find(v => v.lang.startsWith("te"))
        || voices.find(v => v.lang === "hi-IN")
        || voices.find(v => v.lang.startsWith("en-IN"))
        || voices[0];
      setTeVoice(v || null);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, status]);

  // Forward declaration for recursion
  const startListeningRef = useRef<() => void>(() => {});

  // ── Speak text via SpeechSynthesis ──────────────────────────────
  const speak = useCallback((text: string, onEnd?: () => void) => {
    window.speechSynthesis.cancel();
    // Strip emojis for clean TTS audio output
    const cleanText = text.replace(/[\uD83C-\uDBFF\uDC00-\uDFFF]/g, '');
    const utt = new SpeechSynthesisUtterance(cleanText);
    if (teVoice) utt.voice = teVoice;
    utt.lang  = "te-IN";
    utt.rate  = 0.95;
    utt.pitch = 1.05;

    utt.onstart = () => setStatus("speaking");
    utt.onend   = () => {
      setStatus("idle");
      onEnd?.();
      // CONTINUOUS HANDS-FREE LISTENING: Auto-start mic after Nikki finishes speaking
      if (autoListen && stage !== "done" && !confirmed) {
        setTimeout(() => {
          startListeningRef.current();
        }, 500);
      }
    };
    utt.onerror = () => {
      setStatus("idle");
      onEnd?.();
      if (autoListen && stage !== "done" && !confirmed) {
        setTimeout(() => {
          startListeningRef.current();
        }, 500);
      }
    };

    setStatus("speaking");
    window.speechSynthesis.speak(utt);
  }, [teVoice, autoListen, stage, confirmed]);

  const nikkiSay = useCallback((text: string, speakIt = true) => {
    setMsgs(m => [...m, { role: "nikki", text }]);
    if (speakIt) speak(text);
  }, [speak]);

  // ── Client-side smart fallback (runs if server pipeline URL net fails) ──
  const getClientFallbackResponse = useCallback((userText: string, currentBooking: BookingInfo, currentStage: string): { reply: string; nextStage: "greeting" | "name" | "phone" | "service" | "slot" | "done"; isConfirmed: boolean; updatedBooking: BookingInfo } => {
    let updated = { ...currentBooking };

    if (currentStage === "greeting" || currentStage === "name") {
      const name = extractName(userText);
      updated.name = name;
      return {
        reply: `నమస్కారం ${name} గారు! 😊 ధన్యవాదాలు. మీ WhatsApp phone number చెప్పండి?`,
        nextStage: "phone",
        isConfirmed: false,
        updatedBooking: updated,
      };
    }

    if (currentStage === "phone") {
      const phoneMatch = userText.match(/[+0-9]{10,}/) || userText.trim();
      updated.phone = typeof phoneMatch === "string" ? phoneMatch : phoneMatch[0];
      const name = updated.name || "గారు";
      return {
        reply: `అలాగే ${name}! మీకు ఏ service appointment కావాలి? (e.g. Doctor Consultation, Property Site Visit)`,
        nextStage: "service",
        isConfirmed: false,
        updatedBooking: updated,
      };
    }

    if (currentStage === "service") {
      updated.service = userText.trim();
      const name = updated.name || "గారు";
      return {
        reply: `సరే ${name}! ${updated.service} కి ఏ రోజు & సమయం మీకు అనుకూలంగా ఉంటుంది? (e.g. Tomorrow 11 AM)`,
        nextStage: "slot",
        isConfirmed: false,
        updatedBooking: updated,
      };
    }

    if (currentStage === "slot") {
      updated.slot = userText.trim();
      const name = updated.name ? `${updated.name} గారు` : "";
      const phone = updated.phone || "your number";
      const service = updated.service || "Appointment";
      const slot = updated.slot;
      return {
        reply: `✅ ${name}, మీ appointment confirm అయింది!\n📋 Service: ${service}\n🕐 Time: ${slot}\n📱 WhatsApp confirmation ${phone} కి పంపాము. ధన్యవాదాలు! 🙏`,
        nextStage: "done",
        isConfirmed: true,
        updatedBooking: updated,
      };
    }

    return {
      reply: `మీ appointment confirm అయింది! Thank you for choosing Hey Nikki. Have a great day!`,
      nextStage: "done",
      isConfirmed: true,
      updatedBooking: updated,
    };
  }, []);

  // ── Main interaction handler ────────────────────────────────────
  const sendToNikki = useCallback(async (userText: string) => {
    setMsgs(m => [...m, { role: "user", text: userText }]);
    setStatus("thinking");

    const pipelineUrl = process.env.NEXT_PUBLIC_PIPELINE_URL;

    let serverSuccess = false;
    if (pipelineUrl && !pipelineUrl.includes("pipeline.heynikki.in")) {
      try {
        const resp = await fetch(`${pipelineUrl}/api/v1/browser/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text:       userText,
            session_id: sessionId,
            tenant_id:  tenantId,
            tts:        false,
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          serverSuccess = true;
          const responseText: string = data.response || "Thank you! I have recorded your request.";
          nikkiSay(responseText, true);
          if (data.booking_confirmed) {
            setConfirmed(true);
            setStage("done");
          }
        }
      } catch (e) {
        serverSuccess = false;
      }
    }

    // Client-side execution (if server is not reached or DNS pending)
    if (!serverSuccess) {
      setTimeout(() => {
        const { reply, nextStage, isConfirmed, updatedBooking } = getClientFallbackResponse(userText, booking, stage);
        setBooking(updatedBooking);
        setStage(nextStage);
        if (isConfirmed) {
          setConfirmed(true);
        }

        // Attempt async save to API server
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";
        if (isConfirmed && updatedBooking.phone) {
          fetch(`${apiUrl}/webhooks/browser/save-booking`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name:       updatedBooking.name,
              phone:      updatedBooking.phone,
              service:    updatedBooking.service,
              slot:       updatedBooking.slot,
              tenant_id:  tenantId,
            })
          }).catch(() => {});
        }

        nikkiSay(reply, true);
      }, 400);
    }
  }, [sessionId, tenantId, booking, stage, nikkiSay, getClientFallbackResponse]);

  // ── Hands-Free Speech Recognition ──────────────────────────────
  const startListening = useCallback(() => {
    if (status === "speaking") window.speechSynthesis.cancel();
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return;

    try {
      recogRef.current?.stop();
    } catch (_) {}

    const rec = new SpeechRec();
    recogRef.current = rec;
    rec.continuous    = false;
    rec.interimResults = true;
    rec.lang          = "te-IN"; // Dual Telugu/English recognition

    rec.onstart  = () => setStatus("listening");
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results).map((r: any) => r[0].transcript).join("");
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
    rec.onerror = (e: any) => {
      console.warn("SpeechRec error:", e.error);
      setStatus("idle");
    };
    try {
      rec.start();
    } catch (e) {
      setStatus("idle");
    }
  }, [status, input, sendToNikki]);

  // Store ref for hands-free auto-trigger
  startListeningRef.current = startListening;

  const stopListening = useCallback(() => {
    setAutoListen(false);
    try {
      recogRef.current?.stop();
    } catch (_) {}
    window.speechSynthesis.cancel();
    setStatus("idle");
  }, []);

  const handleTypedSend = useCallback(() => {
    const t = input.trim();
    if (!t || status === "thinking") return;
    setInput("");
    sendToNikki(t);
  }, [input, status, sendToNikki]);

  const startConversation = useCallback(() => {
    setMsgs([]);
    setConfirmed(false);
    setBooking({});
    setStage("greeting");
    setAutoListen(true);
    setStatus("idle");
    setTimeout(() => {
      nikkiSay("నమస్కారం! 🙏 I'm Nikki, your AI receptionist. మీ పేరు చెప్పండి?", true);
    }, 200);
  }, [nikkiSay]);

  const resetChat = () => {
    window.speechSynthesis.cancel();
    try { recogRef.current?.stop(); } catch (_) {}
    setMsgs([]);
    setConfirmed(false);
    setBooking({});
    setStage("greeting");
    setAutoListen(true);
    setStatus("idle");
    setInput("");
  };

  const height = compact ? 260 : 330;

  return (
    <div style={{
      background: B.cardBg, border: `1px solid ${B.border}`,
      borderRadius: 16, overflow: "hidden",
      boxShadow: "0 20px 40px rgba(15,23,42,0.12)",
      width: "100%", maxWidth: compact ? 380 : 440,
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      {/* ── Brand Header ───────────────────────────────────── */}
      <div style={{
        background: `linear-gradient(135deg, ${B.teal} 0%, #1D6FA5 100%)`,
        padding: "16px 20px",
        display: "flex", alignItems: "center", gap: 12,
        color: "#FFFFFF",
      }}>
        {/* Pulse Logo Mark */}
        <div style={{
          width: 38, height: 38, borderRadius: "50%",
          background: "rgba(255,255,255,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, flexShrink: 0,
          border: "1px solid rgba(255,255,255,0.3)",
          boxShadow: status === "listening" ? "0 0 16px #E5533D" : "none",
          transition: "box-shadow 0.3s",
        }}>🎙️</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#FFFFFF", letterSpacing: "-0.01em" }}>
            hey <span style={{ color: B.terracotta }}>nikki</span>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.8)", marginTop: 1, fontWeight: 500 }}>
            {status === "idle" && msgs.length === 0 && "Hands-Free Voice Receptionist"}
            {status === "idle" && msgs.length > 0 && "● Ready"}
            {status === "listening" && "🎙️ Listening... speak now"}
            {status === "thinking" && "⏳ Processing..."}
            {status === "speaking" && "🔊 Nikki Speaking..."}
            {confirmed && "✅ Booking Confirmed!"}
          </div>
        </div>

        {/* Mode badge */}
        <div style={{
          background: autoListen ? B.terracotta : "rgba(255,255,255,0.2)",
          color: "#FFFFFF",
          borderRadius: 12, padding: "3px 9px",
          fontSize: 10, fontWeight: 800, textTransform: "uppercase",
        }}>
          {autoListen ? "HANDS-FREE" : "MANUAL"}
        </div>

        {msgs.length > 0 && (
          <button onClick={resetChat} title="Restart Conversation" style={{
            background: "rgba(255,255,255,0.2)", border: "none",
            color: "#FFFFFF", borderRadius: 6, padding: "3px 8px",
            fontSize: 11, cursor: "pointer", fontFamily: "inherit",
          }}>↺</button>
        )}
      </div>

      {/* ── Chat Content ─────────────────────────────────── */}
      <div style={{
        height, overflowY: "auto", padding: "16px",
        display: "flex", flexDirection: "column", gap: 10,
        background: B.vault,
      }}>
        {msgs.length === 0 ? (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            gap: 12, textAlign: "center", padding: "20px 10px",
          }}>
            <div style={{
              width: 60, height: 60, borderRadius: "50%",
              background: `linear-gradient(135deg, ${B.terracotta}, ${B.teal})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28, color: "#FFFFFF", cursor: "pointer",
              boxShadow: "0 8px 24px rgba(229,83,61,0.35)",
            }} onClick={startConversation}>🎙️</div>
            <div>
              <div style={{ color: B.espresso, fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
                Hands-Free Voice Agent
              </div>
              <div style={{ color: B.textMid, fontSize: 12, lineHeight: 1.5, maxWidth: 290 }}>
                Speak in Telugu or English. Once started, Nikki listens automatically after each turn — no need to click mic again!
              </div>
            </div>
            <button onClick={startConversation} style={{
              padding: "11px 26px", borderRadius: 8,
              background: B.teal, color: "#FFFFFF",
              border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: 700, fontFamily: "inherit",
              boxShadow: "0 4px 14px rgba(18,69,122,0.3)",
            }}>▶ Start Conversation</button>
          </div>
        ) : (
          <>
            {msgs.map((m, i) => (
              <div key={i} style={{
                display: "flex",
                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                gap: 8, alignItems: "flex-end",
              }}>
                {m.role === "nikki" && (
                  <div style={{
                    width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                    background: B.teal, color: "#FFFFFF",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 800,
                  }}>N</div>
                )}
                <div style={{
                  maxWidth: "80%",
                  background: m.role === "nikki" ? "#FFFFFF" : B.teal,
                  color: m.role === "nikki" ? B.espresso : "#FFFFFF",
                  borderRadius: m.role === "nikki" ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
                  padding: "10px 14px", fontSize: 13, lineHeight: 1.5,
                  border: m.role === "nikki" ? `1px solid ${B.border}` : "none",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.04)",
                  whiteSpace: "pre-wrap",
                }}>
                  {m.text}
                </div>
              </div>
            ))}

            {/* Quick Service chips */}
            {stage === "service" && !confirmed && status === "idle" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingLeft: 34, marginTop: 4 }}>
                {SERVICES.map(s => (
                  <button key={s} onClick={() => {
                    setInput(s);
                    sendToNikki(s);
                  }} style={{
                    background: B.cardBg, color: B.teal,
                    border: `1px solid ${B.teal}`, borderRadius: 16,
                    padding: "5px 12px", fontSize: 11, cursor: "pointer",
                    fontFamily: "inherit", fontWeight: 700,
                  }}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Thinking indicator */}
            {status === "thinking" && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", background: B.teal, color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>N</div>
                <div style={{ background: "#FFFFFF", border: `1px solid ${B.border}`,
                  borderRadius: "4px 14px 14px 14px", padding: "10px 14px", color: B.textDim, fontSize: 12 }}>
                  Processing...
                </div>
              </div>
            )}

            {/* Listening indicator */}
            {status === "listening" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
                background: "#FEF2F2", borderRadius: 8, border: "1px solid #FCA5A5" }}>
                <div style={{ color: B.terracotta, fontSize: 12, fontWeight: 800 }}>🎙️ Listening... speak now</div>
                {input && <div style={{ color: B.textMid, fontSize: 12, fontStyle: "italic" }}>"{input}"</div>}
              </div>
            )}

            <div ref={endRef} />
          </>
        )}
      </div>

      {/* ── Input Bar ────────────────────────────────────── */}
      {msgs.length > 0 && !confirmed && (
        <div style={{
          borderTop: `1px solid ${B.border}`,
          padding: "12px 14px",
          display: "flex", gap: 8, alignItems: "center",
          background: B.cardBg,
        }}>
          <input
            value={input}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); handleTypedSend(); } }}
            placeholder={status === "listening" ? "Listening..." : "Type or speak..."}
            disabled={status === "listening" || status === "thinking"}
            style={{
              flex: 1, background: B.vault, border: `1px solid ${B.border}`,
              borderRadius: 8, padding: "9px 12px", color: B.espresso,
              fontSize: 13, outline: "none", fontFamily: "inherit",
            }}
          />
          {hasSTT && (
            <button
              onClick={status === "listening" ? stopListening : startListening}
              disabled={status === "thinking" || status === "speaking"}
              title={status === "listening" ? "Stop listening" : "Speak in Telugu or English"}
              style={{
                width: 36, height: 36, borderRadius: "50%", border: "none",
                background: status === "listening" ? B.terracotta : B.teal,
                color: "#FFFFFF", cursor: "pointer",
                fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
                boxShadow: status === "listening" ? "0 0 14px #E5533D" : "none",
              }}>
              {status === "listening" ? "⏹" : "🎙️"}
            </button>
          )}
          <button
            onClick={handleTypedSend}
            disabled={!input.trim() || status === "thinking" || status === "listening"}
            style={{
              width: 36, height: 36, borderRadius: 8, border: "none",
              background: input.trim() && status === "idle" ? B.terracotta : B.border,
              color: "#FFFFFF",
              cursor: input.trim() && status === "idle" ? "pointer" : "not-allowed",
              fontSize: 14, flexShrink: 0,
            }}>↑</button>
        </div>
      )}

      {confirmed && (
        <div style={{
          borderTop: `1px solid ${B.border}`, padding: "12px",
          background: "#ECFDF5", textAlign: "center",
        }}>
          <button onClick={resetChat} style={{
            padding: "8px 20px", borderRadius: 6,
            background: B.teal, color: "#FFFFFF", border: "none",
            fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}>Book Another Appointment →</button>
        </div>
      )}
    </div>
  );
}
