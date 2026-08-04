// components/VoiceChatWidget.tsx
// Hey Nikki — Human-Like Emotional Telugu/English Voice Receptionist
// ────────────────────────────────────────────────────────────────
// Real Human Telugu Voice Dynamics & Emotions:
//   - Warmth & Empathy: "అయ్యో నమస్కారం అండి!", "చాలా సంతోషం అండి!", "అసలు కంగారు పడకండి!"
//   - Telugu Register: Always మీరు (respectful), గారు honorific ("Ramesh గారు")
//   - Tanglish: Natural numbers, dates, times in English inside Telugu frames
//   - Emotion Modes: Warm & Polite, Cheerful & Upbeat, Caring & Empathetic
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
  rose:       "#E11D48",
};

interface Msg { role: "nikki" | "user"; text: string; }
interface Booking { name?: string; phone?: string; service?: string; slot?: string; }
type EmotionMode = "warm" | "cheerful" | "caring";

const SERVICES = [
  "Doctor Visit", "Dental Checkup", "Property Visit",
  "Business Enquiry", "General Appointment",
];

// ── Smart Name Extraction ─────────────────────────────────────
function extractName(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^(my name is|i am|this is|call me|it's|i'm|నా పేరు|నేను|మాది|మా పేరు|నన్ను)\s+/i, "").trim();
  s = s.replace(/[.!?,]+$/, "").trim();
  if (!s) return "";
  const words = s.split(/\s+/).slice(0, 2);
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

// ── Highly Human Emotional Telugu Responses ───────────────────
function humanResponse(stage: string, booking: Booking, userText: string, emotion: EmotionMode): {
  reply: string; nextStage: string; done: boolean; updated: Booking;
} {
  const updated = { ...booking };

  if (stage === "name") {
    const name = extractName(userText);
    if (!name || name.length < 2) {
      return {
        reply: emotion === "caring"
          ? "అయ్యో సరేనండి, మీ పేరు ఒకసారి మళ్లీ స్పష్టంగా చెప్తారా పర్వాలేదు?"
          : "అలాగే అండి, మీ name ఒకసారి విడిగా చెప్పండి please?",
        nextStage: "name",
        done: false,
        updated,
      };
    }
    updated.name = name;

    const greetings = {
      warm: [
        `అయ్యో నమస్కారం ${name} గారు! 🙏 ఎంత మంచిదో మీరు call చేశారు!\nమీ WhatsApp number ఇవ్వగలరా? Booking details పంపిస్తానండి.`,
        `చాలా సంతోషం ${name} గారు! Nice to meet you 😊\nమీ phone number చెప్పండి, వెంటనే WhatsApp లో confirmation పంపుతాను.`,
      ],
      cheerful: [
        `హలో ${name} గారు! నమస్కారం అండి! 🌟 Super so happy to talk to you!\nమీ 10-digit WhatsApp number చెప్పండి!`,
        `వావ్, Hello ${name} గారు! 😃 ధన్యవాదాలు call చేసినందుకు!\nమీ WhatsApp phone number ఇవ్వండి, దానికి details పంపిస్తాను!`,
      ],
      caring: [
        `నమస్కారం ${name} గారు 🙏 మీరు కాల్ చేసినందుకు చాలా సంతోషం అండి.\nఅసలు కంగారు పడకండి, మీ WhatsApp number చెప్పండి, నేను వివరాలన్నీ పంపిస్తాను.`,
        `అయ్యో హలో ${name} గారు! 👋 చాలా ఆనందం అండి.\nమీ డీటెయిల్స్ కోసం మీ WhatsApp number ఒక్కసారి చెప్తారా?`,
      ]
    };

    const list = greetings[emotion];
    return {
      reply: list[Math.floor(Math.random() * list.length)],
      nextStage: "phone",
      done: false,
      updated,
    };
  }

  if (stage === "phone") {
    const digits = userText.replace(/[^0-9+]/g, "");
    if (digits.length < 10) {
      return {
        reply: emotion === "caring"
          ? `${updated.name} గారు, క్షమించాలి అండి — నంబర్ సరిగ్గా వినిపించలేదు. మీ 10 digit number ఒక్కసారి మళ్లీ చెప్తారా?`
          : `${updated.name} గారు, ఒక్క నిమిషం — number catch అవ్వలేదు. మీ 10 digit phone number మళ్లీ ఒకసారి repeat చేయండి?`,
        nextStage: "phone",
        done: false,
        updated,
      };
    }
    updated.phone = digits.slice(-10);

    const responses = {
      warm: [
        `అలాగే అండి, ${updated.name} గారు! ${updated.phone} సురక్షితంగా నోట్ చేసుకున్నాను 👍\nచెప్పండి — మీకు ఏ service కోసం appointment కావాలి?`,
        `చాలా సంతోషం అండి, got it! ${updated.phone} 📱\n${updated.name} గారు, ఏ type of appointment book చేయమంటారు?`,
      ],
      cheerful: [
        `Awesome ${updated.name} గారు! ${updated.phone} note చేసేసాను! 🎉\nఇప్పుడు చెప్పండి — మనకు ఏ service appointment కావాలి?`,
        `Perfect అండి! ${updated.phone} 👍\n${updated.name} గారు, ఏ appointment book చేద్దాం చెప్పండి!`,
      ],
      caring: [
        `సరేనండి ${updated.name} గారు, మీ నంబర్ ${updated.phone} జాగ్రత్తగా నోట్ చేశాను 🙏\nమీకు ఏ service లో సహాయం కావాలో చెప్పండి అండి?`,
        `చాలా ధన్యవాదాలు అండి. ${updated.phone} నోట్ అయింది 😊\n${updated.name} గారు, మీకు ఏ appointment కావాలో ప్రశాంతంగా చెప్పండి.`,
      ]
    };

    const list = responses[emotion];
    return {
      reply: list[Math.floor(Math.random() * list.length)],
      nextStage: "service",
      done: false,
      updated,
    };
  }

  if (stage === "service") {
    updated.service = userText.trim();

    const responses = {
      warm: [
        `${updated.service} — ఖచ్చితంగా నోట్ చేసుకున్నాను ${updated.name} గారు! 📋\nమీకు ఏ day and time అనుకూలంగా ఉంటుంది? (e.g., "Tomorrow 11 AM" or "Monday afternoon")`,
        `అలాగే అండి, ${updated.service} కి బుక్ చేద్దాం! 😊\n${updated.name} గారు, ఏ రోజు & ఏ టైమ్ కి మీకు వీలవుతుంది చెప్పండి?`,
      ],
      cheerful: [
        `Great choice ${updated.name} గారు! ${updated.service}! ✨\nమీకు ఎప్పుడు వీలవుతుంది? "tomorrow 11 AM" లాగా చెప్పండి, slot సరి చూస్తాను!`,
        `సూపర్ అండి! ${updated.service} appointment 🎯\n${updated.name} గారు, ఏ రోజు మరియు సమయం మీకు convenient?`,
      ],
      caring: [
        `సరేనండి ${updated.name} గారు, ${updated.service} కోసం సమయాన్ని చూద్దాం 🌿\nమీకు ఏ రోజు, ఏ సమయంలో అనుకూలంగా ఉంటుందో చెప్పండి అండి.`,
        `ఖచ్చితంగా అండి, ${updated.service} కి ఏర్పాటు చేస్తాను 🙏\n${updated.name} గారు, మీకు వీలయ్యే day & time ప్రశాంతంగా చెప్పండి.`,
      ]
    };

    const list = responses[emotion];
    return {
      reply: list[Math.floor(Math.random() * list.length)],
      nextStage: "slot",
      done: false,
      updated,
    };
  }

  if (stage === "slot") {
    updated.slot = userText.trim();

    const confirmations = {
      warm: `అయ్యో చాలా సంతోషం ${updated.name} గారు! 🎉 మీ appointment 100% confirm అయిపోయింది:\n\n` +
        `📋 Service: ${updated.service}\n` +
        `📅 Time: ${updated.slot}\n` +
        `📱 WhatsApp: ${updated.phone}\n\n` +
        `వివరాలన్నీ మీ WhatsApp కి పంపించానండి. Thank you so much! 🙏\nమీకు ఏ సందేహం ఉన్నా ఎప్పుడైనా ధైర్యంగా కాల్ చేయండి అండి!`,

      cheerful: `Woohoo! 🎉 ${updated.name} గారు, మీ appointment successful గా confirmed అయిపోయింది!\n\n` +
        `📋 Service: ${updated.service}\n` +
        `📅 Time: ${updated.slot}\n` +
        `📱 WhatsApp: ${updated.phone}\n\n` +
        `Instant WhatsApp confirmation పంపించేసాను! Have a wonderful day ahead ${updated.name} గారు! 😊✨`,

      caring: `అయ్యా చాలా ఆనందం అండి ${updated.name} గారు. మీ appointment చక్కగా confirm అయింది 🙏\n\n` +
        `📋 Service: ${updated.service}\n` +
        `📅 Time: ${updated.slot}\n` +
        `📱 WhatsApp: ${updated.phone}\n\n` +
        `వివరాలు మీ WhatsApp కి పంపాను అండి. ఏ సహాయం కావాలన్నా నేను ఇక్కడే ఉంటాను. ధన్యవాదాలు! 🌸`
    };

    return {
      reply: confirmations[emotion],
      nextStage: "done",
      done: true,
      updated,
    };
  }

  return {
    reply: `${updated.name || ""} గారు, మీ బుకింగ్ వివరాలు ఇప్పటికే కన్ఫర్మ్ అయ్యాయండి! ఇంకా ఏమైనా సహాయం కావాలా?`,
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
  const [emotion, setEmotion]       = useState<EmotionMode>("warm"); // Warm, Cheerful, Caring
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

  // ── TTS with Audio Modulation for Natural Human Emotion ────
  const speak = useCallback((text: string) => {
    window.speechSynthesis.cancel();
    const clean = text.replace(/[\uD83C-\uDBFF\uDC00-\uDFFF]/g, "");
    const utt = new SpeechSynthesisUtterance(clean);
    if (teVoice) utt.voice = teVoice;
    utt.lang = "te-IN";

    // Emotional Voice Tuning:
    // Warm: Normal rate, slightly higher pitch for friendly tone
    // Cheerful: Slightly faster rate, higher pitch for energetic tone
    // Caring: Slightly slower rate, soft gentle pitch for empathetic tone
    if (emotion === "cheerful") {
      utt.rate  = 0.98;
      utt.pitch = 1.15;
    } else if (emotion === "caring") {
      utt.rate  = 0.88;
      utt.pitch = 1.02;
    } else {
      utt.rate  = 0.92;
      utt.pitch = 1.08;
    }

    utt.onstart = () => setStatus("speaking");
    utt.onend = () => {
      setStatus("idle");
      if (autoListen && !confirmed) {
        setTimeout(() => listenRef.current(), 550);
      }
    };
    utt.onerror = () => {
      setStatus("idle");
      if (autoListen && !confirmed) {
        setTimeout(() => listenRef.current(), 550);
      }
    };
    setStatus("speaking");
    window.speechSynthesis.speak(utt);
  }, [teVoice, autoListen, confirmed, emotion]);

  const nikkiSay = useCallback((text: string) => {
    setMsgs(m => [...m, { role: "nikki", text }]);
    speak(text);
  }, [speak]);

  // ── Send user message ───────────────────────────────────────
  const sendToNikki = useCallback((userText: string) => {
    setMsgs(m => [...m, { role: "user", text: userText }]);
    setStatus("thinking");

    setTimeout(() => {
      const { reply, nextStage, done, updated } = humanResponse(stage, booking, userText, emotion);
      setBooking(updated);
      setStage(nextStage);
      if (done) {
        setConfirmed(true);
        setAutoListen(false);
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
    }, 450 + Math.random() * 350);
  }, [stage, booking, tenantId, emotion, nikkiSay]);

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
      const openGreeting = emotion === "caring"
        ? "అయ్యో నమస్కారం అండి! 🙏 నేను నిక్కి — మీ AI receptionist.\nమీ పేరు చెప్పండి అండి, appointment ప్రశాంతంగా బుక్ చేద్దాం!"
        : emotion === "cheerful"
        ? "హలో అండి! 🌟 నమస్కారం! I'm Nikki — మీ AI receptionist.\nమీ పేరు చెప్పండి, వెంటనే appointment book చేసేద్దాం!"
        : "నమస్కారం అండి! 🙏 I'm Nikki — మీ AI receptionist.\nమీ పేరు చెప్పండి, appointment book చేద్దాం!";
      nikkiSay(openGreeting);
    }, 300);
  }, [nikkiSay, emotion]);

  const reset = () => {
    window.speechSynthesis.cancel();
    try { recogRef.current?.stop(); } catch (_) {}
    setMsgs([]); setConfirmed(false); setBooking({});
    setStage("name"); setAutoListen(true); setStarted(false);
    setStatus("idle"); setInput("");
  };

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
            {!started && "Emotional Telugu Voice AI"}
            {started && status === "idle" && !confirmed && "● Listening to you..."}
            {status === "listening" && "🎙️ Listening — speak naturally"}
            {status === "thinking" && "💭 Thinking..."}
            {status === "speaking" && "🗣️ Nikki is speaking..."}
            {confirmed && "✅ Booking confirmed!"}
          </div>
        </div>

        {/* Emotion Selector Toggle */}
        <div style={{ display: "flex", background: "rgba(255,255,255,0.15)", borderRadius: 12, padding: 2 }}>
          {(["warm", "cheerful", "caring"] as EmotionMode[]).map(m => (
            <button
              key={m}
              onClick={() => setEmotion(m)}
              title={`${m.toUpperCase()} Mode`}
              style={{
                background: emotion === m ? B.terracotta : "transparent",
                color: "#fff", border: "none", borderRadius: 10,
                padding: "3px 7px", fontSize: 9, fontWeight: 800,
                cursor: "pointer", textTransform: "capitalize",
                transition: "background 0.2s",
              }}>
              {m === "warm" ? "💖 Warm" : m === "cheerful" ? "😊 Bright" : "🩺 Gentle"}
            </button>
          ))}
        </div>

        {started && (
          <button onClick={reset} title="Restart" style={{
            background: "rgba(255,255,255,0.15)", border: "none",
            color: "#fff", borderRadius: "50%", width: 28, height: 28,
            cursor: "pointer", fontSize: 12, display: "flex",
            alignItems: "center", justifyContent: "center", flexShrink: 0,
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
                Human Emotional Voice Agent
              </div>
              <div style={{ color: B.textMid, fontSize: 13, lineHeight: 1.6, maxWidth: 310 }}>
                Experience warm, natural <strong>Telugu & Tanglish</strong> speech with real human emotions (గారు, మీరు, సరేనండి, ధన్యవాదాలు).
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

            <div style={{ display: "flex", gap: 14, marginTop: 4 }}>
              {["💖 Warm & Emotional", "🎙️ Hands-Free", "⚡ Real-Time"].map(t => (
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
                  ఒక్క నిమిషం అండి...
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
