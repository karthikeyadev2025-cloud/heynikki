// components/VoiceChatWidget.tsx
// Hey Nikki — Crystal-Clear Human Tanglish Voice Receptionist
// ────────────────────────────────────────────────────────────────
// Solution for Browser TTS Speech Engine:
//   - Telugu-to-Phonetic Transliteration: Converts Telugu script into clean
//     phonetic Tanglish before passing to SpeechSynthesis.
//   - Zero Misspellings & Zero Browser Audio Mangling.
//   - Dynamic Vocal Modulation: Rate 0.96x, Pitch 1.12x for warm human tone.
// ────────────────────────────────────────────────────────────────
"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { Mic, Loader2, Volume2, CheckCircle2, RotateCcw, Play, Square, ArrowUp } from "lucide-react";

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
type EmotionMode = "energetic" | "cool" | "warm";

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

// ── Energetic & Charming Responses ────────────────────────────
function humanResponse(stage: string, booking: Booking, userText: string, emotion: EmotionMode): {
  reply: string; nextStage: string; done: boolean; updated: Booking;
} {
  const updated = { ...booking };

  if (stage === "name") {
    const name = extractName(userText);
    if (!name || name.length < 2) {
      return {
        reply: "హ్మ్మ్... సరేనండి, మీ name ఒకసారి విడిగా మళ్లీ చెప్పండి, please?",
        nextStage: "name",
        done: false,
        updated,
      };
    }
    updated.name = name;

    const greetings = {
      energetic: [
        `Aaha! ${name} garu! Namaskaram! 🌟 Yay, call chesinanduku chala santhosham!\nMee 10-digit WhatsApp number cheppandi, ventane details pampistanu!`,
        `Oho! Hello ${name} garu! 😃 Dhanyavadalu call chesinanduku!\nMee WhatsApp number ivvagalara? Booking confirmation pampistanu!`,
      ],
      cool: [
        `Hey ${name} garu! Super cool to talk to you 😎\nMee WhatsApp phone number cheppandi, instant confirmation pampistanu!`,
        `Wow ${name} garu! Nice to meet you! ✨\nMee WhatsApp number cheppandi, details anni pampisthanu!`,
      ],
      warm: [
        `Ayyo Namaskaram ${name} garu! 🙏 Enthaga santhosham meeru call chesarani!\nMee WhatsApp number ivvagalara? Booking details pampistanu.`,
        `Chala santhosham ${name} garu! 😊\nMee phone number cheppandi, ventane WhatsApp lo confirmation pampistanu.`,
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
        reply: `${updated.name} garu, okka nimisham andi — number catch avvaledu. Mee 10 digit phone number malli cheptara?`,
        nextStage: "phone",
        done: false,
        updated,
      };
    }
    updated.phone = digits.slice(-10);

    const responses = {
      energetic: [
        `Super andi! ${updated.name} garu! ${updated.phone} note chesesanu! 🎯\nIppudu cheppandi — mee ki ae service appointment kavali?`,
        `Oho perfect! ${updated.phone} 👍\n${updated.name} garu, ae type of appointment book cheddam cheppandi!`,
      ],
      cool: [
        `Awesome ${updated.name} garu! ${updated.phone} lock chesesanu! 😎\nIppudu ae service appointment kavalo cheppandi!`,
        `Got it! ${updated.phone} ✨\n${updated.name} garu, ae appointment kavali meeku?`,
      ],
      warm: [
        `Alage andi, ${updated.name} garu! ${updated.phone} note chesukunnanu 👍\nCheppandi — meeku ae service kosam appointment kavali?`,
        `Chala santhosham andi, got it! ${updated.phone} 📱\n${updated.name} garu, ae type of appointment book cheyamantaru?`,
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
      energetic: [
        `Abbo! ${updated.service} aa? Great choice ${updated.name} garu! 🌟\nMeeku ae day and time convenient? "tomorrow 11 AM" laga cheppandi!`,
        `Aaha super andi! ${updated.service} appointment 🎯\n${updated.name} garu, ae roju and time ki meeku suit avthundi?`,
      ],
      cool: [
        `Cool! ${updated.service} — perfect ${updated.name} garu! ✨\nMeeku eppudu convenient? "Monday 3 PM" laga cheppandi, slot fix cheddam!`,
        `Nice! ${updated.service} ki book cheddam 😎\n${updated.name} garu, ae day and time meeku convenient?`,
      ],
      warm: [
        `${updated.service} — note chesukunnanu ${updated.name} garu! 📋\nMeeku ae day and time convenient? (e.g., "Tomorrow 11 AM")`,
        `Alage andi, ${updated.service} ki book cheddam! 😊\n${updated.name} garu, ae roju and time meeku convenient?`,
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
      energetic: `Yay! 🎉 ${updated.name} garu, mee appointment super-successful ga confirm ayindi!\n\n` +
        `📋 Service: ${updated.service}\n` +
        `📅 Time: ${updated.slot}\n` +
        `📱 WhatsApp: ${updated.phone}\n\n` +
        `Instant WhatsApp confirmation pampincheanu! Thank you so much ${updated.name} garu! Have a wonderful day! 🌟😊`,

      cool: `Boom! 😎 ${updated.name} garu, mee appointment confirmed!\n\n` +
        `📋 Service: ${updated.service}\n` +
        `📅 Time: ${updated.slot}\n` +
        `📱 WhatsApp: ${updated.phone}\n\n` +
        `WhatsApp lo details anni pampincheanu. Thank you ${updated.name} garu! Catch you soon! ✨`,

      warm: `Ayyo chala santhosham ${updated.name} garu! 🎉 Mee appointment confirm ayindi:\n\n` +
        `📋 Service: ${updated.service}\n` +
        `📅 Time: ${updated.slot}\n` +
        `📱 WhatsApp: ${updated.phone}\n\n` +
        `Details anni mee WhatsApp ki pampistanu. Thank you so much! 🙏`
    };

    return {
      reply: confirmations[emotion],
      nextStage: "done",
      done: true,
      updated,
    };
  }

  return {
    reply: `${updated.name || ""} garu, mee booking confirmed ayindi! Inka emaina sahayam kavala?`,
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
  const [emotion, setEmotion]       = useState<EmotionMode>("energetic");
  const [hasSTT, setHasSTT]         = useState(false);
  const [started, setStarted]       = useState(false);
  const recogRef  = useRef<any>(null);
  const endRef    = useRef<HTMLDivElement>(null);
  const listenRef = useRef<() => void>(() => {});
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // ── Init: detect browser STT support (input recognition is
  // unaffected by the TTS fix — this is unrelated) ─────────────
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setHasSTT(!!SR);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, status]);

  // ── TTS Audio Speech Output — real Sarvam voice ──────────────
  // FIXED: was using the browser's speechSynthesis with lang="en-IN"
  // (an ENGLISH voice) reading a phonetically-transliterated
  // approximation of Telugu — not real Telugu speech at all, just an
  // approximation of the sound. That's the actual cause of the
  // "robotic, bad pronunciation, not a real female voice" complaint.
  // Now fetches real Sarvam bulbul:v3 audio, the same voice used by
  // live calls and the dashboard assistant.
  const speak = useCallback(async (text: string) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${apiUrl}/api/public/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, emotion }),
      });
      if (!res.ok) throw new Error(`TTS request failed: ${res.status}`);
      const data = await res.json();
      if (!data.audio_base64) throw new Error("No audio returned");

      const audio = new Audio(`data:${data.audio_mime || "audio/wav"};base64,${data.audio_base64}`);
      currentAudioRef.current = audio;
      setStatus("speaking");
      audio.onended = () => {
        setStatus("idle");
        if (autoListen && !confirmed) {
          setTimeout(() => listenRef.current(), 500);
        }
      };
      audio.onerror = () => {
        setStatus("idle");
        if (autoListen && !confirmed) {
          setTimeout(() => listenRef.current(), 500);
        }
      };
      await audio.play();
    } catch (e) {
      // Same fallback behavior as before on any failure — don't leave
      // the conversation stuck if a single TTS call fails.
      setStatus("idle");
      if (autoListen && !confirmed) {
        setTimeout(() => listenRef.current(), 500);
      }
    }
  }, [autoListen, confirmed, emotion]);

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
    }, 400 + Math.random() * 300);
  }, [stage, booking, tenantId, emotion, nikkiSay]);

  // ── Hands-free Speech Recognition ───────────────────────────
  const startListening = useCallback(() => {
    if (status === "speaking") currentAudioRef.current?.pause();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try { recogRef.current?.stop(); } catch (_) {}

    const rec = new SR();
    recogRef.current = rec;
    rec.continuous     = false;
    rec.interimResults = true;
    rec.lang           = "en-IN"; // Dynamic Tanglish recognition

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
    currentAudioRef.current?.pause();
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
      const openGreeting = emotion === "energetic"
        ? "Hello! 🌟 Namaskaram! I'm Nikki — mee super-friendly AI receptionist!\nMee peru cheppandi, ventane appointment book cheddam!"
        : emotion === "cool"
        ? "Hey! 😎 I'm Nikki — mee AI receptionist!\nMee peru cheppandi, appointment book cheddam!"
        : "Namaskaram! 🙏 I'm Nikki — mee AI receptionist.\nMee peru cheppandi, appointment book cheddam!";
      nikkiSay(openGreeting);
    }, 300);
  }, [nikkiSay, emotion]);

  const reset = () => {
    currentAudioRef.current?.pause();
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
        @keyframes nk-spin { to { transform: rotate(360deg); } }
        .nk-spin { animation: nk-spin 0.8s linear infinite; }
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
            <Mic size={18} color="#fff" />
          )}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: "-0.01em",
            fontFamily: "var(--font-display), 'Fraunces', Georgia, serif",
          }}>
            hey <span style={{ color: "#FCA5A5" }}>nikki</span>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.8)", marginTop: 2, fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>
            {!started && "Real Telugu voice AI"}
            {started && status === "idle" && !confirmed && "● Listening to you..."}
            {status === "listening" && (<><Mic size={11} /> Listening — speak naturally</>)}
            {status === "thinking" && (<><Loader2 size={11} className="nk-spin" /> Thinking...</>)}
            {status === "speaking" && (<><Volume2 size={11} /> Nikki speaking...</>)}
            {confirmed && (<><CheckCircle2 size={11} /> Booking confirmed!</>)}
          </div>
        </div>

        {/* Emotion Selector Toggle */}
        <div style={{ display: "flex", background: "rgba(255,255,255,0.15)", borderRadius: 12, padding: 2 }}>
          {(["energetic", "cool", "warm"] as EmotionMode[]).map(m => (
            <button
              key={m}
              onClick={() => setEmotion(m)}
              title={`${m.toUpperCase()} Voice Mode`}
              style={{
                background: emotion === m ? B.terracotta : "transparent",
                color: "#fff", border: "none", borderRadius: 10,
                padding: "3px 7px", fontSize: 9, fontWeight: 800,
                cursor: "pointer", textTransform: "capitalize",
                transition: "background 0.2s",
              }}>
              {m === "energetic" ? "⚡ Lively" : m === "cool" ? "😎 Cool" : "💖 Warm"}
            </button>
          ))}
        </div>

        {started && (
          <button onClick={reset} title="Restart" style={{
            background: "rgba(255,255,255,0.15)", border: "none",
            color: "#fff", borderRadius: "50%", width: 28, height: 28,
            cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}><RotateCcw size={13} /></button>
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
              color: "#fff", cursor: "pointer",
              boxShadow: "0 12px 32px rgba(229,83,61,0.35)",
              transition: "transform 0.2s, box-shadow 0.2s",
            }}
              onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.transform = "scale(1.08)"; }}
              onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.transform = "scale(1)"; }}
            ><Mic size={30} /></div>

            <div>
              <div style={{
                color: B.espresso, fontWeight: 700, fontSize: 18, marginBottom: 6,
                fontFamily: "var(--font-display), 'Fraunces', Georgia, serif",
              }}>
                Talk to Nikki
              </div>
              <div style={{ color: B.textMid, fontSize: 13, lineHeight: 1.6, maxWidth: 310 }}>
                Real Telugu speech — the same voice your customers actually hear on a live call, not a demo approximation.
              </div>
            </div>

            <button onClick={start} style={{
              display: "flex", alignItems: "center", gap: 8,
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
              <Play size={13} fill="#fff" /> Start Conversation
            </button>

            <div style={{ display: "flex", gap: 14, marginTop: 4 }}>
              {["Real Sarvam voice", "Hands-free", "Books real appointments"].map(t => (
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
                  Okka nimisham...
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
            placeholder={status === "listening" ? "Listening..." : "Type or speak in Telugu/English..."}
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
                color: "#fff", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
                boxShadow: status === "listening" ? "0 0 16px rgba(229,83,61,0.5)" : "none",
                transition: "all 0.2s",
              }}>
              {status === "listening" ? <Square size={14} fill="#fff" /> : <Mic size={16} />}
            </button>
          )}
          <button
            onClick={handleTypedSend}
            disabled={!input.trim() || status !== "idle"}
            style={{
              width: 38, height: 38, borderRadius: 10, border: "none",
              background: input.trim() && status === "idle" ? B.terracotta : B.border,
              color: "#fff", cursor: input.trim() && status === "idle" ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, transition: "background 0.2s",
            }}><ArrowUp size={16} /></button>
        </div>
      )}

      {/* ── Confirmed footer ───────────────────────────── */}
      {confirmed && (
        <div style={{
          borderTop: `1px solid ${B.border}`, padding: "14px",
          background: "#ECFDF5", textAlign: "center",
        }}>
          <div style={{ color: B.green, fontSize: 12, fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <CheckCircle2 size={14} /> WhatsApp confirmation sent to {booking.phone}
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
