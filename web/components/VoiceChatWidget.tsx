// components/VoiceChatWidget.tsx
// Hey Nikki — Human-Like Telugu/English Voice Receptionist Widget
// ────────────────────────────────────────────────────────────────
// Voice Rules (from bridge.py):
//   - Always మీరు (respectful). Never నువ్వు.
//   - గారు after caller's name: "Ramesh గారు"
//   - Numbers/times/dates in English inside Telugu sentence frames
//   - Natural fillers: అలాగే, సరే, ఒక్క నిమిషం, బాగుంది
//   - Never machine-translate. Speak natural Tanglish.
// ────────────────────────────────────────────────────────────────
"use client";
import { useState, useEffect, useRef, useCallback } from "react";

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// ── Brand Palette ─────────────────────────────────────────────
const B = {
  teal:       "#12457A",
  tealLight:  "#1D6FA5",
  terracotta: "#E5533D",
  espresso:   "#0F172A",
  vault:      "#F6F8FB",
  card:       "#FFFFFF",
  border:     "#E2E8F0",
  borderHi:   "#CBD5E1",
  textMid:    "#475569",
  textDim:    "#94A3B8",
  green:      "#10B981",
};

interface Msg { role: "nikki" | "user"; text: string; }
interface Booking { name?: string; phone?: string; service?: string; slot?: string; }

const SERVICES = [
  "Doctor Visit", "Dental Checkup", "Property Visit",
  "Business Enquiry", "General Appointment",
];

// ── Smart Name Extraction ─────────────────────────────────────
function extractName(raw: string): string {
  let s = raw.trim();
  // Strip Telugu & English name prefixes
  s = s.replace(/^(my name is|i am|this is|call me|it's|i'm|నా పేరు|నేను|మాది|మా పేరు)\s+/i, "").trim();
  // Remove trailing punctuation
  s = s.replace(/[.!?,]+$/, "").trim();
  if (!s) return "";
  // Take first 1-2 words as name
  const words = s.split(/\s+/).slice(0, 2);
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

// ── Human-like Telugu Responses ───────────────────────────────
// These follow the exact register rules from bridge.py:
// - గారు honorific, మీరు respect, Tanglish numbers, natural fillers
function humanResponse(stage: string, booking: Booking, userText: string): {
  reply: string; nextStage: string; done: boolean; updated: Booking;
} {
  const updated = { ...booking };

  if (stage === "name") {
    const name = extractName(userText);
    if (!name || name.length < 2) {
      return {
        reply: "సరే, మీ name ఒకసారి clear గా చెప్పండి please?",
        nextStage: "name",
        done: false,
        updated,
      };
    }
    updated.name = name;
    // Randomize greeting for human feel
    const greetings = [
      `${name} గారు, నమస్కారం! మీరు call చేసినందుకు thank you 🙏\nమీ WhatsApp number ఇవ్వగలరా? confirmation message పంపిస్తాను.`,
      `అలాగే ${name} గారు! Nice to meet you 😊\nమీ phone number చెప్పండి, WhatsApp లో booking details పంపుతాను.`,
      `బాగుంది ${name} గారు! ధన్యవాదాలు 🙏\nConfirmation కోసం మీ WhatsApp number ఇవ్వండి please.`,
    ];
    return {
      reply: greetings[Math.floor(Math.random() * greetings.length)],
      nextStage: "phone",
      done: false,
      updated,
    };
  }

  if (stage === "phone") {
    const digits = userText.replace(/[^0-9+]/g, "");
    if (digits.length < 10) {
      return {
        reply: `${updated.name} గారు, ఒక్క నిమిషం — number properly catch అవ్వలేదు. మీ 10 digit phone number ఒకసారి repeat చేయండి?`,
        nextStage: "phone",
        done: false,
        updated,
      };
    }
    updated.phone = digits.slice(-10);
    const responses = [
      `సరే ${updated.name} గారు, ${updated.phone} note చేసుకున్నాను!\nఇప్పుడు చెప్పండి — ఏ service కోసం appointment book చేయాలి?`,
      `అలాగే, got it! ${updated.phone} 👍\n${updated.name} గారు, మీకు ఏ type of appointment కావాలి?`,
    ];
    return {
      reply: responses[Math.floor(Math.random() * responses.length)],
      nextStage: "service",
      done: false,
      updated,
    };
  }

  if (stage === "service") {
    updated.service = userText.trim();
    const responses = [
      `${updated.service} — noted ${updated.name} గారు! 📋\nమీకు ఏ day and time convenient? For example, "tomorrow 11 AM" or "Monday afternoon" చెప్పండి.`,
      `అలాగే, ${updated.service} కి book చేద్దాం!\n${updated.name} గారు, ఏ రోజు & ఏ time మీకు suit అవుతుంది?`,
    ];
    return {
      reply: responses[Math.floor(Math.random() * responses.length)],
      nextStage: "slot",
      done: false,
      updated,
    };
  }

  if (stage === "slot") {
    updated.slot = userText.trim();
    return {
      reply: `✅ Done ${updated.name} గారు! మీ appointment confirm అయింది:\n\n` +
        `📋 Service: ${updated.service}\n` +
        `📅 Time: ${updated.slot}\n` +
        `📱 WhatsApp: ${updated.phone}\n\n` +
        `Confirmation message మీ WhatsApp కి send చేస్తున్నాను. Thank you so much! 🙏\nమీకు ఏదైనా doubt ఉంటే ఎప్పుడైనా call చేయండి.`,
      nextStage: "done",
      done: true,
      updated,
    };
  }

  return {
    reply: `${updated.name || ""} గారు, మీ booking already confirmed అయింది! ఇంకేదైనా help కావాలా?`,
    nextStage: "done",
    done: true,
    updated,
  };
}

// ══════════════════════════════════════════════════════════════
// WIDGET COMPONENT
// ══════════════════════════════════════════════════════════════
export default function VoiceChatWidget({ tenantId, compact }: {
  tenantId?: string; compact?: boolean;
}) {
  const [msgs, setMsgs]             = useState<Msg[]>([]);
  const [status, setStatus]         = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [input, setInput]           = useState("");
  const [booking, setBooking]       = useState<Booking>({});
  const [confirmed, setConfirmed]   = useState(false);
  const [stage, setStage]           = useState("name");
  const [autoListen, setAutoListen] = useState(true);
  const [hasSTT, setHasSTT]         = useState(false);
  const [teVoice, setTeVoice]       = useState<SpeechSynthesisVoice | null>(null);
  const [started, setStarted]       = useState(false);
  const recogRef  = useRef<any>(null);
  const endRef    = useRef<HTMLDivElement>(null);
  const listenRef = useRef<() => void>(() => {});

  // ── Init voices ─────────────────────────────────────────────
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setHasSTT(!!SR);
    const load = () => {
      const v = window.speechSynthesis.getVoices();
      setTeVoice(
        v.find(x => x.lang === "te-IN") ||
        v.find(x => x.lang.startsWith("te")) ||
        v.find(x => x.lang === "hi-IN") ||
        v.find(x => x.lang.startsWith("en-IN")) ||
        v[0] || null
      );
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, status]);

  // ── TTS with auto-listen after ──────────────────────────────
  const speak = useCallback((text: string) => {
    window.speechSynthesis.cancel();
    const clean = text.replace(/[\uD83C-\uDBFF\uDC00-\uDFFF]/g, "");
    const utt = new SpeechSynthesisUtterance(clean);
    if (teVoice) utt.voice = teVoice;
    utt.lang  = "te-IN";
    utt.rate  = 0.92;
    utt.pitch = 1.08;
    utt.onstart = () => setStatus("speaking");
    utt.onend = () => {
      setStatus("idle");
      if (autoListen && !confirmed) {
        setTimeout(() => listenRef.current(), 600);
      }
    };
    utt.onerror = () => {
      setStatus("idle");
      if (autoListen && !confirmed) {
        setTimeout(() => listenRef.current(), 600);
      }
    };
    setStatus("speaking");
    window.speechSynthesis.speak(utt);
  }, [teVoice, autoListen, confirmed]);

  // ── Add message + speak ─────────────────────────────────────
  const nikkiSay = useCallback((text: string) => {
    setMsgs(m => [...m, { role: "nikki", text }]);
    speak(text);
  }, [speak]);

  // ── Send user message ───────────────────────────────────────
  const sendToNikki = useCallback((userText: string) => {
    setMsgs(m => [...m, { role: "user", text: userText }]);
    setStatus("thinking");

    setTimeout(() => {
      const { reply, nextStage, done, updated } = humanResponse(stage, booking, userText);
      setBooking(updated);
      setStage(nextStage);
      if (done) {
        setConfirmed(true);
        setAutoListen(false);
        // Try to save booking to API (async, non-blocking)
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
        if (apiUrl && updated.phone) {
          fetch(`${apiUrl}/webhooks/browser/save-booking`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...updated, tenant_id: tenantId }),
          }).catch(() => {});
        }
      }
      nikkiSay(reply);
    }, 500 + Math.random() * 400); // Human-like thinking delay
  }, [stage, booking, tenantId, nikkiSay]);

  // ── Hands-free Speech Recognition ───────────────────────────
  const startListening = useCallback(() => {
    if (status === "speaking") window.speechSynthesis.cancel();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try { recogRef.current?.stop(); } catch (_) {}

    const rec = new SR();
    recogRef.current = rec;
    rec.continuous     = false;
    rec.interimResults = true;
    rec.lang           = "te-IN";

    let finalTranscript = "";

    rec.onstart  = () => { setStatus("listening"); setInput(""); };
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) { finalTranscript += t; }
        else { interim += t; }
      }
      setInput(finalTranscript || interim);
    };
    rec.onend = () => {
      const text = (finalTranscript || input).trim();
      finalTranscript = "";
      if (text.length >= 2) {
        setInput("");
        sendToNikki(text);
      } else {
        setStatus("idle");
      }
    };
    rec.onerror = () => setStatus("idle");
    try { rec.start(); } catch (_) { setStatus("idle"); }
  }, [status, input, sendToNikki]);

  listenRef.current = startListening;

  const stopAll = useCallback(() => {
    setAutoListen(false);
    try { recogRef.current?.stop(); } catch (_) {}
    window.speechSynthesis.cancel();
    setStatus("idle");
  }, []);

  const handleTypedSend = useCallback(() => {
    const t = input.trim();
    if (!t || status === "thinking") return;
    setInput("");
    sendToNikki(t);
  }, [input, status, sendToNikki]);

  // ── Start conversation ──────────────────────────────────────
  const start = useCallback(() => {
    setMsgs([]);
    setConfirmed(false);
    setBooking({});
    setStage("name");
    setAutoListen(true);
    setStarted(true);
    setStatus("idle");
    setTimeout(() => {
      nikkiSay("నమస్కారం! 🙏 I'm Nikki — మీ AI receptionist.\nమీ పేరు చెప్పండి, appointment book చేద్దాం!");
    }, 300);
  }, [nikkiSay]);

  const reset = () => {
    window.speechSynthesis.cancel();
    try { recogRef.current?.stop(); } catch (_) {}
    setMsgs([]); setConfirmed(false); setBooking({});
    setStage("name"); setAutoListen(true); setStarted(false);
    setStatus("idle"); setInput("");
  };

  // ── Pulse animation for listening ───────────────────────────
  const isActive = status === "listening" || status === "speaking";

  return (
    <div style={{
      background: B.card, border: `1px solid ${B.border}`,
      borderRadius: 20, overflow: "hidden",
      boxShadow: "0 24px 48px rgba(15,23,42,0.12), 0 0 0 1px rgba(18,69,122,0.06)",
      width: "100%", maxWidth: compact ? 380 : 440,
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      <style>{`
        @keyframes nk-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(229,83,61,0.4)} 50%{box-shadow:0 0 0 12px rgba(229,83,61,0)} }
        @keyframes nk-wave { 0%,100%{transform:scaleY(0.4)} 50%{transform:scaleY(1)} }
        @keyframes nk-fade { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* ── Header ─────────────────────────────────────── */}
      <div style={{
        background: `linear-gradient(135deg, ${B.teal}, ${B.tealLight})`,
        padding: "18px 20px", display: "flex", alignItems: "center", gap: 14,
      }}>
        {/* Animated mic orb */}
        <div style={{
          width: 42, height: 42, borderRadius: "50%",
          background: isActive ? "rgba(229,83,61,0.9)" : "rgba(255,255,255,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center",
          border: "2px solid rgba(255,255,255,0.3)",
          animation: status === "listening" ? "nk-pulse 1.5s infinite" : "none",
          transition: "background 0.3s",
          flexShrink: 0,
        }}>
          {status === "listening" ? (
            <div style={{ display: "flex", gap: 2, alignItems: "center", height: 16 }}>
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} style={{
                  width: 3, background: "#fff", borderRadius: 2,
                  animation: `nk-wave 0.8s ${i * 0.1}s ease-in-out infinite`,
                }} />
              ))}
            </div>
          ) : (
            <span style={{ fontSize: 18 }}>🎙️</span>
          )}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em" }}>
            hey <span style={{ color: "#FCA5A5" }}>nikki</span>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.8)", marginTop: 2, fontWeight: 500 }}>
            {!started && "Telugu & English Voice AI"}
            {started && status === "idle" && !confirmed && "● Waiting for you..."}
            {status === "listening" && "🎙️ Listening — speak naturally"}
            {status === "thinking" && "💭 Thinking..."}
            {status === "speaking" && "🗣️ Nikki is speaking..."}
            {confirmed && "✅ Booking confirmed!"}
          </div>
        </div>

        {/* Hands-free badge */}
        {started && (
          <button onClick={() => setAutoListen(a => !a)} style={{
            background: autoListen ? B.terracotta : "rgba(255,255,255,0.15)",
            color: "#fff", border: "none", borderRadius: 12,
            padding: "4px 10px", fontSize: 9, fontWeight: 800,
            cursor: "pointer", textTransform: "uppercase",
            transition: "background 0.2s",
          }}>
            {autoListen ? "🎙️ AUTO" : "MANUAL"}
          </button>
        )}

        {started && (
          <button onClick={reset} title="Restart" style={{
            background: "rgba(255,255,255,0.15)", border: "none",
            color: "#fff", borderRadius: "50%", width: 28, height: 28,
            cursor: "pointer", fontSize: 12, display: "flex",
            alignItems: "center", justifyContent: "center",
          }}>↺</button>
        )}
      </div>

      {/* ── Chat Area ──────────────────────────────────── */}
      <div style={{
        height: compact ? 270 : 340, overflowY: "auto", padding: 16,
        display: "flex", flexDirection: "column", gap: 10,
        background: B.vault,
      }}>
        {!started ? (
          /* ── Welcome screen ──────────────────────────── */
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            gap: 16, textAlign: "center", padding: "16px 12px",
          }}>
            <div onClick={start} style={{
              width: 72, height: 72, borderRadius: "50%",
              background: `linear-gradient(135deg, ${B.terracotta}, ${B.teal})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 32, color: "#fff", cursor: "pointer",
              boxShadow: "0 12px 32px rgba(229,83,61,0.35)",
              transition: "transform 0.2s, box-shadow 0.2s",
            }}
              onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.transform = "scale(1.08)"; }}
              onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.transform = "scale(1)"; }}
            >🎙️</div>

            <div>
              <div style={{ color: B.espresso, fontWeight: 900, fontSize: 17, marginBottom: 6 }}>
                Talk to Nikki — Live
              </div>
              <div style={{ color: B.textMid, fontSize: 13, lineHeight: 1.6, maxWidth: 300 }}>
                Speak in <strong>Telugu</strong> or <strong>English</strong>. Nikki listens hands-free — no need to click mic again after each reply.
              </div>
            </div>

            <button onClick={start} style={{
              padding: "12px 28px", borderRadius: 10,
              background: B.teal, color: "#fff", border: "none",
              cursor: "pointer", fontSize: 14, fontWeight: 800,
              fontFamily: "inherit",
              boxShadow: "0 6px 18px rgba(18,69,122,0.3)",
              transition: "transform 0.15s",
            }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.transform = "translateY(0)"; }}
            >
              ▶ Start Conversation
            </button>

            <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
              {["100% Free", "No Sign-Up", "Real Voice AI"].map(t => (
                <span key={t} style={{ color: B.textDim, fontSize: 10, fontWeight: 600 }}>✓ {t}</span>
              ))}
            </div>
          </div>
        ) : (
          /* ── Messages ────────────────────────────────── */
          <>
            {msgs.map((m, i) => (
              <div key={i} style={{
                display: "flex",
                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                gap: 8, alignItems: "flex-end",
                animation: "nk-fade 0.3s ease-out",
              }}>
                {m.role === "nikki" && (
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                    background: `linear-gradient(135deg, ${B.teal}, ${B.tealLight})`,
                    color: "#fff", display: "flex", alignItems: "center",
                    justifyContent: "center", fontSize: 11, fontWeight: 900,
                  }}>N</div>
                )}
                <div style={{
                  maxWidth: "80%",
                  background: m.role === "nikki" ? "#fff" : B.teal,
                  color: m.role === "nikki" ? B.espresso : "#fff",
                  borderRadius: m.role === "nikki" ? "4px 16px 16px 16px" : "16px 4px 16px 16px",
                  padding: "11px 15px", fontSize: 13, lineHeight: 1.55,
                  border: m.role === "nikki" ? `1px solid ${B.border}` : "none",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                  whiteSpace: "pre-wrap",
                }}>
                  {m.text}
                </div>
              </div>
            ))}

            {/* Service quick-picks */}
            {stage === "service" && !confirmed && status === "idle" && (
              <div style={{
                display: "flex", flexWrap: "wrap", gap: 6,
                paddingLeft: 36, animation: "nk-fade 0.3s ease-out",
              }}>
                {SERVICES.map(s => (
                  <button key={s} onClick={() => sendToNikki(s)} style={{
                    background: "#fff", color: B.teal,
                    border: `1.5px solid ${B.teal}`, borderRadius: 20,
                    padding: "5px 14px", fontSize: 11, cursor: "pointer",
                    fontFamily: "inherit", fontWeight: 700,
                    transition: "background 0.15s, color 0.15s",
                  }}
                    onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                      e.currentTarget.style.background = B.teal;
                      e.currentTarget.style.color = "#fff";
                    }}
                    onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                      e.currentTarget.style.background = "#fff";
                      e.currentTarget.style.color = B.teal;
                    }}
                  >{s}</button>
                ))}
              </div>
            )}

            {/* Thinking */}
            {status === "thinking" && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", animation: "nk-fade 0.2s" }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: `linear-gradient(135deg, ${B.teal}, ${B.tealLight})`,
                  color: "#fff", display: "flex", alignItems: "center",
                  justifyContent: "center", fontSize: 11, fontWeight: 900,
                }}>N</div>
                <div style={{
                  background: "#fff", border: `1px solid ${B.border}`,
                  borderRadius: "4px 16px 16px 16px", padding: "12px 16px",
                  color: B.textDim, fontSize: 12, fontStyle: "italic",
                }}>
                  ఒక్క నిమిషం...
                </div>
              </div>
            )}

            {/* Listening transcript */}
            {status === "listening" && (
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", borderRadius: 10,
                background: "rgba(229,83,61,0.06)",
                border: "1px solid rgba(229,83,61,0.2)",
                animation: "nk-fade 0.2s",
              }}>
                <div style={{ display: "flex", gap: 2, alignItems: "center", height: 14 }}>
                  {[0,1,2,3].map(i => (
                    <div key={i} style={{
                      width: 3, background: B.terracotta, borderRadius: 2,
                      animation: `nk-wave 0.6s ${i * 0.12}s ease-in-out infinite`,
                    }} />
                  ))}
                </div>
                <div style={{ color: B.terracotta, fontSize: 12, fontWeight: 700 }}>
                  Listening...
                </div>
                {input && (
                  <div style={{ color: B.textMid, fontSize: 12, fontStyle: "italic", flex: 1 }}>
                    {input}
                  </div>
                )}
              </div>
            )}

            <div ref={endRef} />
          </>
        )}
      </div>

      {/* ── Input Bar ──────────────────────────────────── */}
      {started && !confirmed && (
        <div style={{
          borderTop: `1px solid ${B.border}`, padding: "12px 14px",
          display: "flex", gap: 8, alignItems: "center", background: B.card,
        }}>
          <input
            value={input}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") { e.preventDefault(); handleTypedSend(); }
            }}
            placeholder={status === "listening" ? "Listening..." : "Type in Telugu or English..."}
            disabled={status === "listening" || status === "thinking" || status === "speaking"}
            style={{
              flex: 1, background: B.vault, border: `1px solid ${B.border}`,
              borderRadius: 10, padding: "10px 14px", color: B.espresso,
              fontSize: 13, outline: "none", fontFamily: "inherit",
              transition: "border-color 0.2s",
            }}
            onFocus={(e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = B.teal; }}
            onBlur={(e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = B.border; }}
          />
          {hasSTT && (
            <button
              onClick={status === "listening" ? stopAll : startListening}
              disabled={status === "thinking" || status === "speaking"}
              title={status === "listening" ? "Stop" : "Speak in Telugu/English"}
              style={{
                width: 38, height: 38, borderRadius: "50%", border: "none",
                background: status === "listening" ? B.terracotta : B.teal,
                color: "#fff", cursor: "pointer", fontSize: 16,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
                boxShadow: status === "listening" ? "0 0 16px rgba(229,83,61,0.5)" : "none",
                transition: "all 0.2s",
              }}>
              {status === "listening" ? "⏹" : "🎙️"}
            </button>
          )}
          <button
            onClick={handleTypedSend}
            disabled={!input.trim() || status !== "idle"}
            style={{
              width: 38, height: 38, borderRadius: 10, border: "none",
              background: input.trim() && status === "idle" ? B.terracotta : B.border,
              color: "#fff", cursor: input.trim() && status === "idle" ? "pointer" : "not-allowed",
              fontSize: 15, flexShrink: 0, transition: "background 0.2s",
            }}>↑</button>
        </div>
      )}

      {/* ── Confirmed footer ───────────────────────────── */}
      {confirmed && (
        <div style={{
          borderTop: `1px solid ${B.border}`, padding: "14px",
          background: "#ECFDF5", textAlign: "center",
        }}>
          <div style={{ color: B.green, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
            ✅ WhatsApp confirmation sent to {booking.phone}
          </div>
          <button onClick={reset} style={{
            padding: "9px 24px", borderRadius: 8,
            background: B.teal, color: "#fff", border: "none",
            fontSize: 12, fontWeight: 700, cursor: "pointer",
            fontFamily: "inherit",
          }}>Book Another Appointment →</button>
        </div>
      )}
    </div>
  );
}
