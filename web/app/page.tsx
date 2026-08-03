"use client";
import { useState, useEffect, useRef } from "react";
import NikkiLogo from "../components/NikkiLogo";
import VoiceChatWidget from "../components/VoiceChatWidget";

// ─── Design Tokens ───────────────────────────────────────────
const P = {
  bg:    "#06060F",
  surf:  "#0C0C1D",
  hi:    "#13132A",
  bord:  "#1C1C3A",
  acc:   "#7C3AED",
  glow:  "#8B5CF6",
  gbr:   "#A78BFA",
  lav:   "#C4B5FD",
  gold:  "#F59E0B",
  grn:   "#10B981",
  red:   "#EF4444",
  cyn:   "#06B6D4",
  org:   "#F97316",
  txt:   "#EEEEFF",
  mid:   "#8888AA",
  dim:   "#3A3A5A",
};

// ─── Helpers ─────────────────────────────────────────────────
function useScrollY() {
  const [y, setY] = useState(0);
  useEffect(() => {
    const h = () => setY(window.scrollY);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);
  return y;
}

// ─── Subcomponents ───────────────────────────────────────────
function NavBar({ scrollY }: { scrollY: number }) {
  const solid = scrollY > 60;
  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 5vw", height: 64,
      background: solid ? P.surf + "F0" : "transparent",
      backdropFilter: solid ? "blur(20px)" : "none",
      borderBottom: solid ? `1px solid ${P.bord}` : "none",
      transition: "background 0.3s, border 0.3s",
    }}>
      <NikkiLogo size={36} showText variant="horizontal" dark />
      <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
        {["Features", "How it works", "Pricing", "Demo"].map(l => (
          <a key={l} href={`#${l.toLowerCase().replace(/ /g,"-")}`}
            style={{ color: P.mid, fontSize: 14, textDecoration: "none", fontWeight: 500,
              transition: "color 0.2s" }}
            onMouseEnter={e => (e.currentTarget.style.color = P.lav)}
            onMouseLeave={e => (e.currentTarget.style.color = P.mid)}>
            {l}
          </a>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <a href="/login" style={{
          padding: "8px 18px", borderRadius: 8, border: `1px solid ${P.bord}`,
          color: P.mid, fontSize: 13, fontWeight: 600, textDecoration: "none",
          transition: "border-color 0.2s, color 0.2s",
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = P.glow; e.currentTarget.style.color = P.lav; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = P.bord; e.currentTarget.style.color = P.mid; }}>
          Sign in
        </a>
        <a href="/signup" style={{
          padding: "8px 18px", borderRadius: 8,
          background: `linear-gradient(135deg, ${P.acc}, ${P.glow})`,
          color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none",
          boxShadow: `0 4px 20px ${P.acc}55`,
        }}>
          Start Free Trial
        </a>
      </div>
    </nav>
  );
}

// ─── Live Voice Agent Widget ──────────────────────────────────
type Stage = "idle" | "greeting" | "name" | "phone" | "service" | "time" | "confirmed";

const SERVICES = ["Doctor Consultation", "Dental Check-up", "Property Site Visit", "Business Enquiry", "General Appointment"];

interface BookingData {
  name: string;
  phone: string;
  service: string;
  time: string;
}

// LiveVoiceAgent replaced by real VoiceChatWidget (Web Speech API)
function _removed() {
  const [stage, setStage]       = useState<Stage>("idle");
  const [messages, setMessages] = useState<{ role: "nikki" | "user"; text: string }[]>([]);
  const [input, setInput]       = useState("");
  const [booking, setBooking]   = useState<Partial<BookingData>>({});
  const [thinking, setThinking] = useState(false);
  const [pulse, setPulse]       = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const addMsg = useCallback((role: "nikki" | "user", text: string) => {
    setMessages(m => [...m, { role, text }]);
  }, []);

  const nikkiSay = useCallback((text: string, delay = 600) => {
    setThinking(true);
    setTimeout(() => {
      setThinking(false);
      setPulse(true);
      addMsg("nikki", text);
      setTimeout(() => setPulse(false), 800);
    }, delay);
  }, [addMsg]);

  const startConversation = () => {
    if (stage !== "idle") return;
    setStage("greeting");
    setMessages([]);
    nikkiSay("నమస్కారం! 🙏 I'm Nikki, your AI receptionist. I can help you book an appointment right now. What's your name?", 800);
    setTimeout(() => setStage("name"), 1400);
  };

  const handleSend = () => {
    const val = input.trim();
    if (!val || thinking) return;
    setInput("");
    addMsg("user", val);

    if (stage === "name") {
      setBooking(b => ({ ...b, name: val }));
      setStage("phone");
      nikkiSay(`Nice to meet you, ${val}! 😊 Please share your WhatsApp number so we can send your confirmation.`);
    } else if (stage === "phone") {
      setBooking(b => ({ ...b, phone: val }));
      setStage("service");
      nikkiSay("Great! Which service would you like to book today?");
    } else if (stage === "service") {
      setBooking(b => ({ ...b, service: val }));
      setStage("time");
      nikkiSay(`Perfect! When would you like the ${val} appointment? (e.g. "Tomorrow 11 AM" or "Monday morning")`);
    } else if (stage === "time") {
      setBooking(b => ({ ...b, time: val }));
      setStage("confirmed");
      nikkiSay(
        `✅ Booking confirmed! Here's your summary:\n📋 Service: ${booking.service}\n🕐 Time: ${val}\n📱 We'll send a WhatsApp confirmation to ${booking.phone}. See you soon, ${booking.name}! 🙏`,
        1200
      );
    } else if (stage === "confirmed") {
      nikkiSay("Your appointment is already confirmed! Is there anything else I can help you with? 😊");
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const reset = () => {
    setStage("idle");
    setMessages([]);
    setBooking({});
    setInput("");
    setThinking(false);
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const serviceChips = stage === "service";

  return (
    <div style={{
      background: P.surf, border: `1px solid ${P.bord}`,
      borderRadius: 20, overflow: "hidden",
      boxShadow: `0 40px 80px #000A, 0 0 0 1px ${P.acc}22`,
      width: "100%", maxWidth: 440,
    }}>
      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${P.acc}33, ${P.cyn}11)`,
        borderBottom: `1px solid ${P.bord}`,
        padding: "16px 20px",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <div style={{ position: "relative" }}>
          <div style={{
            width: 42, height: 42, borderRadius: "50%",
            background: `linear-gradient(135deg, ${P.acc}, ${P.cyn})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20,
            boxShadow: stage !== "idle" ? `0 0 20px ${P.acc}88` : "none",
            transition: "box-shadow 0.3s",
          }}>🤖</div>
          <div style={{
            position: "absolute", bottom: 1, right: 1,
            width: 10, height: 10, borderRadius: "50%",
            background: stage !== "idle" ? P.grn : P.dim,
            border: `2px solid ${P.surf}`,
            transition: "background 0.3s",
          }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: P.txt, fontSize: 14, fontWeight: 800 }}>Nikki AI Receptionist</div>
          <div style={{ color: stage !== "idle" ? P.grn : P.mid, fontSize: 11, marginTop: 1, fontWeight: 600 }}>
            {stage === "idle" ? "Click to start demo" :
             stage === "confirmed" ? "✓ Booking confirmed!" :
             thinking ? "Thinking..." : "● Live"}
          </div>
        </div>
        {stage !== "idle" && (
          <button onClick={reset} style={{
            background: "none", border: `1px solid ${P.bord}`,
            color: P.dim, borderRadius: 6, padding: "4px 10px",
            fontSize: 11, cursor: "pointer", fontFamily: "inherit",
          }}>Reset</button>
        )}
      </div>

      {/* Chat area */}
      <div style={{
        height: 320, overflowY: "auto", padding: "16px 16px 8px",
        display: "flex", flexDirection: "column", gap: 10,
        scrollbarWidth: "thin", scrollbarColor: P.dim + " transparent",
      }}>
        {stage === "idle" ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 12, textAlign: "center" }}>
            <div style={{
              width: 64, height: 64, borderRadius: "50%",
              background: `linear-gradient(135deg, ${P.acc}33, ${P.cyn}22)`,
              border: `2px solid ${P.acc}44`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28,
              animation: "gentlePulse 2s ease-in-out infinite",
            }}>🎙️</div>
            <div style={{ color: P.txt, fontWeight: 700, fontSize: 14 }}>
              Talk to Nikki Live
            </div>
            <div style={{ color: P.mid, fontSize: 12, lineHeight: 1.5, maxWidth: 280 }}>
              Experience our AI receptionist in action. She'll greet you in Telugu/English, collect your details, and confirm your booking — just like a real call.
            </div>
            <button onClick={startConversation} style={{
              padding: "12px 28px", borderRadius: 10,
              background: `linear-gradient(135deg, ${P.acc}, ${P.glow})`,
              color: "#fff", border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: 700, fontFamily: "inherit",
              boxShadow: `0 8px 24px ${P.acc}55`,
              transform: "scale(1)", transition: "transform 0.15s",
            }}
              onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.05)")}
              onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}>
              ▶ Start Conversation
            </button>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                gap: 8, alignItems: "flex-end",
              }}>
                {m.role === "nikki" && (
                  <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                    background: `linear-gradient(135deg, ${P.acc}, ${P.cyn})`,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>🤖</div>
                )}
                <div style={{
                  maxWidth: "78%",
                  background: m.role === "nikki"
                    ? P.hi
                    : `linear-gradient(135deg, ${P.acc}, ${P.glow})`,
                  color: P.txt,
                  borderRadius: m.role === "nikki" ? "4px 16px 16px 16px" : "16px 4px 16px 16px",
                  padding: "10px 14px", fontSize: 13, lineHeight: 1.5,
                  border: m.role === "nikki" ? `1px solid ${P.bord}` : "none",
                  whiteSpace: "pre-wrap",
                  boxShadow: m.role === "nikki" && pulse && i === messages.length - 1
                    ? `0 0 16px ${P.acc}44` : "none",
                  animation: `slideIn 0.25s ease-out`,
                }}>
                  {m.text}
                </div>
              </div>
            ))}
            {thinking && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%",
                  background: `linear-gradient(135deg, ${P.acc}, ${P.cyn})`,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>🤖</div>
                <div style={{ background: P.hi, border: `1px solid ${P.bord}`,
                  borderRadius: "4px 16px 16px 16px", padding: "12px 16px",
                  display: "flex", gap: 4 }}>
                  {[0,1,2].map(d => (
                    <div key={d} style={{
                      width: 6, height: 6, borderRadius: "50%", background: P.gbr,
                      animation: `bounce 1.2s ${d * 0.2}s ease-in-out infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}
            {/* Service chips */}
            {serviceChips && !thinking && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingLeft: 36 }}>
                {SERVICES.map(s => (
                  <button key={s} onClick={() => {
                    setInput(s);
                    setTimeout(() => {
                      addMsg("user", s);
                      setInput("");
                      setBooking(b => ({ ...b, service: s }));
                      setStage("time");
                      nikkiSay(`Perfect! When would you like the ${s}? (e.g. "Tomorrow 11 AM")`);
                    }, 50);
                  }} style={{
                    background: P.acc + "22", color: P.gbr,
                    border: `1px solid ${P.acc}44`, borderRadius: 20,
                    padding: "5px 12px", fontSize: 11, cursor: "pointer",
                    fontFamily: "inherit", fontWeight: 600,
                    transition: "background 0.15s",
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = P.acc + "44")}
                    onMouseLeave={e => (e.currentTarget.style.background = P.acc + "22")}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div ref={endRef} />
          </>
        )}
      </div>

      {/* Input */}
      {stage !== "idle" && stage !== "confirmed" && (
        <div style={{
          borderTop: `1px solid ${P.bord}`,
          padding: "12px 14px",
          display: "flex", gap: 8, alignItems: "center",
        }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={
              stage === "name" ? "Your name..." :
              stage === "phone" ? "+91 XXXXX XXXXX" :
              stage === "service" ? "Or type a service..." :
              stage === "time" ? "e.g. Tomorrow 11 AM" : "Type a message..."
            }
            style={{
              flex: 1, background: P.hi, border: `1px solid ${P.bord}`,
              borderRadius: 8, padding: "10px 12px", color: P.txt,
              fontSize: 13, outline: "none", fontFamily: "inherit",
            }}
            autoFocus
          />
          <button onClick={handleSend} disabled={!input.trim() || thinking}
            style={{
              width: 38, height: 38, borderRadius: 8, border: "none",
              background: input.trim() && !thinking
                ? `linear-gradient(135deg, ${P.acc}, ${P.glow})`
                : P.dim,
              color: "#fff", cursor: input.trim() && !thinking ? "pointer" : "not-allowed",
              fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.2s",
            }}>↑</button>
        </div>
      )}
      {stage === "confirmed" && (
        <div style={{
          borderTop: `1px solid ${P.bord}`, padding: "14px 16px",
          background: P.grn + "11", textAlign: "center",
        }}>
          <div style={{ color: P.grn, fontSize: 12, fontWeight: 700 }}>
            ✅ WhatsApp confirmation sent to {booking.phone}
          </div>
          <button onClick={reset} style={{
            marginTop: 8, padding: "6px 18px", borderRadius: 6,
            background: P.acc + "22", color: P.gbr, border: `1px solid ${P.acc}44`,
            fontSize: 12, cursor: "pointer", fontFamily: "inherit",
          }}>Try Again →</button>
        </div>
      )}
    </div>
  );
}

// ─── Feature Card ─────────────────────────────────────────────
function FeatureCard({ icon, title, desc, color = P.glow }: {
  icon: string; title: string; desc: string; color?: string;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? P.hi : P.surf,
        border: `1px solid ${hov ? color + "55" : P.bord}`,
        borderRadius: 14, padding: "24px 22px",
        transition: "all 0.25s",
        boxShadow: hov ? `0 8px 32px ${color}22` : "none",
        cursor: "default",
      }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: color + "22", border: `1px solid ${color}44`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 20, marginBottom: 14,
        boxShadow: hov ? `0 0 16px ${color}44` : "none",
        transition: "box-shadow 0.25s",
      }}>{icon}</div>
      <div style={{ color: P.txt, fontSize: 14, fontWeight: 800, marginBottom: 6 }}>{title}</div>
      <div style={{ color: P.mid, fontSize: 13, lineHeight: 1.6 }}>{desc}</div>
    </div>
  );
}

// ─── Stats Counter ────────────────────────────────────────────
function StatItem({ value, label, color = P.gbr }: { value: string; label: string; color?: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color, fontSize: 36, fontWeight: 900, lineHeight: 1 }}>{value}</div>
      <div style={{ color: P.mid, fontSize: 13, marginTop: 6, fontWeight: 500 }}>{label}</div>
    </div>
  );
}

// ─── Step Card ────────────────────────────────────────────────
function StepCard({ num, title, desc, icon }: { num: string; title: string; desc: string; icon: string }) {
  return (
    <div style={{
      background: P.surf, border: `1px solid ${P.bord}`, borderRadius: 16,
      padding: "28px 24px", position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: 16, right: 16,
        color: P.dim, fontSize: 48, fontWeight: 900, lineHeight: 1,
        fontFamily: "monospace", userSelect: "none",
      }}>{num}</div>
      <div style={{ fontSize: 28, marginBottom: 14 }}>{icon}</div>
      <div style={{ color: P.txt, fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{title}</div>
      <div style={{ color: P.mid, fontSize: 13, lineHeight: 1.6 }}>{desc}</div>
    </div>
  );
}

// ─── Pricing Card ─────────────────────────────────────────────
function PricingCard({ plan, price, features, highlight = false, badge }: {
  plan: string; price: string; features: string[]; highlight?: boolean; badge?: string;
}) {
  return (
    <div style={{
      background: highlight ? `linear-gradient(160deg, ${P.acc}22, ${P.surf})` : P.surf,
      border: `1px solid ${highlight ? P.acc + "66" : P.bord}`,
      borderRadius: 16, padding: "28px 24px",
      position: "relative",
      boxShadow: highlight ? `0 20px 60px ${P.acc}33` : "none",
      transform: highlight ? "scale(1.03)" : "scale(1)",
    }}>
      {badge && (
        <div style={{
          position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)",
          background: `linear-gradient(135deg, ${P.gold}, ${P.org})`,
          color: "#fff", fontSize: 11, fontWeight: 800, padding: "4px 14px",
          borderRadius: 20, whiteSpace: "nowrap",
        }}>{badge}</div>
      )}
      <div style={{ color: highlight ? P.lav : P.mid, fontSize: 12, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>{plan}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, marginBottom: 20 }}>
        <span style={{ color: P.txt, fontSize: 34, fontWeight: 900 }}>{price}</span>
        {price !== "Custom" && <span style={{ color: P.mid, fontSize: 13, marginBottom: 6 }}>/month</span>}
      </div>
      {features.map(f => (
        <div key={f} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 10 }}>
          <span style={{ color: P.grn, fontSize: 14, flexShrink: 0, marginTop: 1 }}>✓</span>
          <span style={{ color: P.mid, fontSize: 13, lineHeight: 1.4 }}>{f}</span>
        </div>
      ))}
      <a href="/signup" style={{
        display: "block", marginTop: 24,
        padding: "12px 0", borderRadius: 10, textAlign: "center",
        background: highlight ? `linear-gradient(135deg, ${P.acc}, ${P.glow})` : "transparent",
        border: highlight ? "none" : `1px solid ${P.bord}`,
        color: highlight ? "#fff" : P.mid,
        fontSize: 13, fontWeight: 700, textDecoration: "none",
        boxShadow: highlight ? `0 8px 24px ${P.acc}44` : "none",
        transition: "all 0.2s",
      }}>
        {highlight ? "Start Free Trial →" : "Get Started"}
      </a>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────
export default function LandingPage() {
  const scrollY = useScrollY();

  return (
    <div style={{
      background: P.bg, minHeight: "100vh",
      fontFamily: "'Inter', -apple-system, sans-serif",
      color: P.txt, overflowX: "hidden",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: ${P.dim}; border-radius: 3px; }
        @keyframes gentlePulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 ${P.acc}44; }
          50% { transform: scale(1.05); box-shadow: 0 0 0 12px ${P.acc}00; }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-12px); }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <NavBar scrollY={scrollY} />

      {/* ── HERO ──────────────────────────────────────── */}
      <section style={{
        minHeight: "100vh", display: "flex", alignItems: "center",
        padding: "100px 5vw 60px",
        position: "relative", overflow: "hidden",
      }}>
        {/* Background glow blobs */}
        <div style={{
          position: "absolute", top: "10%", left: "5%",
          width: 500, height: 500, borderRadius: "50%",
          background: `radial-gradient(circle, ${P.acc}22 0%, transparent 70%)`,
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", bottom: "10%", right: "5%",
          width: 400, height: 400, borderRadius: "50%",
          background: `radial-gradient(circle, ${P.cyn}18 0%, transparent 70%)`,
          pointerEvents: "none",
        }} />

        <div style={{
          maxWidth: 1200, margin: "0 auto", width: "100%",
          display: "grid", gridTemplateColumns: "1fr 1fr",
          gap: 60, alignItems: "center",
        }}>
          {/* Left copy */}
          <div style={{ animation: "fadeUp 0.7s ease-out" }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: P.acc + "22", border: `1px solid ${P.acc}44`,
              borderRadius: 20, padding: "6px 14px", marginBottom: 24,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: P.grn,
                boxShadow: `0 0 8px ${P.grn}`, animation: "gentlePulse 2s infinite" }} />
              <span style={{ color: P.lav, fontSize: 12, fontWeight: 700 }}>
                AI Receptionist — Live Now
              </span>
            </div>

            <h1 style={{
              fontSize: "clamp(32px, 4.5vw, 56px)",
              fontWeight: 900, lineHeight: 1.1, margin: "0 0 20px",
            }}>
              <span style={{ color: P.txt }}>Never Miss a{" "}</span>
              <span style={{
                background: `linear-gradient(135deg, ${P.gbr}, ${P.cyn})`,
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              }}>Business Call</span>
              <br />
              <span style={{ color: P.txt }}>Again</span>
            </h1>

            <p style={{
              color: P.mid, fontSize: 17, lineHeight: 1.7, marginBottom: 32,
              maxWidth: 500,
            }}>
              Hey Nikki is your AI-powered Telugu/English voice receptionist that answers every call, books appointments, and follows up on WhatsApp — <strong style={{ color: P.lav }}>24/7, in your language.</strong>
            </p>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 40 }}>
              <a href="/signup" style={{
                padding: "14px 28px", borderRadius: 10,
                background: `linear-gradient(135deg, ${P.acc}, ${P.glow})`,
                color: "#fff", fontSize: 15, fontWeight: 700, textDecoration: "none",
                boxShadow: `0 8px 32px ${P.acc}55`,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                🚀 Start 14-Day Free Trial
              </a>
              <a href="#demo" style={{
                padding: "14px 24px", borderRadius: 10,
                border: `1px solid ${P.bord}`, color: P.mid,
                fontSize: 15, fontWeight: 600, textDecoration: "none",
                display: "flex", alignItems: "center", gap: 8,
                transition: "border-color 0.2s, color 0.2s",
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = P.glow; e.currentTarget.style.color = P.lav; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = P.bord; e.currentTarget.style.color = P.mid; }}>
                🎙️ Try Live Demo
              </a>
            </div>

            {/* Trust badges */}
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {["✅ No credit card needed", "✅ Telugu + English AI", "✅ WhatsApp integration", "✅ TRAI compliant"].map(t => (
                <span key={t} style={{ color: P.dim, fontSize: 12, fontWeight: 600 }}>{t}</span>
              ))}
            </div>
          </div>

          {/* Right: Live Voice Agent */}
          <div id="demo" style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
            animation: "fadeUp 0.9s ease-out",
          }}>
            <div style={{ color: P.mid, fontSize: 12, fontWeight: 700,
              textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
              ⬇ Try Nikki Right Here
            </div>
            <VoiceChatWidget />
            <div style={{ color: P.dim, fontSize: 11, textAlign: "center", maxWidth: 340 }}>
              This is a live demo of the AI conversation flow. On real calls, Nikki speaks in Telugu/English via your business phone number.
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS ─────────────────────────────────────── */}
      <section style={{
        padding: "60px 5vw",
        background: `linear-gradient(135deg, ${P.acc}0D, ${P.surf})`,
        borderTop: `1px solid ${P.bord}`, borderBottom: `1px solid ${P.bord}`,
      }}>
        <div style={{
          maxWidth: 1000, margin: "0 auto",
          display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 32,
        }}>
          <StatItem value="< 1s"  label="Answer time (sub-second)" color={P.gbr} />
          <StatItem value="24/7"  label="Always available"          color={P.grn} />
          <StatItem value="3×"    label="More leads captured"       color={P.gold} />
          <StatItem value="₹4"    label="Per AI-handled call"       color={P.cyn} />
        </div>
      </section>

      {/* ── FEATURES ──────────────────────────────────── */}
      <section id="features" style={{ padding: "100px 5vw" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <div style={{ color: P.gbr, fontSize: 12, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.15em", marginBottom: 12 }}>PLATFORM FEATURES</div>
            <h2 style={{ fontSize: "clamp(24px, 3vw, 40px)", fontWeight: 900, margin: "0 0 16px" }}>
              Two Brains. Two Eyes.{" "}
              <span style={{
                background: `linear-gradient(135deg, ${P.gbr}, ${P.cyn})`,
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              }}>One Brand Number.</span>
            </h2>
            <p style={{ color: P.mid, fontSize: 15, maxWidth: 600, margin: "0 auto", lineHeight: 1.7 }}>
              AI handles 95% of calls autonomously. Your team takes over the hot 5%.
              Every interaction — AI or human — shows your one business number.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            <FeatureCard icon="🎙️" color={P.glow}
              title="Telugu/English AI Voice"
              desc="Answers in < 1 second with natural Tanglish conversation. TRAI disclosure automatic. No robotic tone." />
            <FeatureCard icon="📅" color={P.grn}
              title="Instant Appointment Booking"
              desc="Captures name, service, time preference and confirms the booking — all in one call without human intervention." />
            <FeatureCard icon="💬" color={P.cyn}
              title="WhatsApp Follow-ups"
              desc="Missed call? Interested lead? Appointment confirmed? Auto-send pre-approved templates via WhatsApp instantly." />
            <FeatureCard icon="📞" color={P.gold}
              title="Click-to-Call (CTC)"
              desc="Your agents click a lead card and the call starts — masked CLI, disposition logging, and recording auto-saved." />
            <FeatureCard icon="🔄" color={P.org}
              title="Jio + Vi Active-Active Failover"
              desc="Primary trunk on Jio. Instant fallback to Vi. Your business number never goes silent, even during outages." />
            <FeatureCard icon="🧠" color={P.gbr}
              title="Business Knowledge Base"
              desc="Feed Nikki your FAQs, pricing, timings, doctor roster. She answers them instantly on every call." />
            <FeatureCard icon="📊" color={P.grn}
              title="ROI Analytics Dashboard"
              desc="See exactly how much human cost Nikki saved, lead conversion rates, WA delivery stats, and peak call hours." />
            <FeatureCard icon="⚙️" color={P.mid}
              title="Full Self-Service Setup"
              desc="No vendor calls needed. Configure voice profile, missed call guard, WhatsApp templates from your dashboard." />
            <FeatureCard icon="🔒" color={P.red}
              title="AES-256 Encrypted Recordings"
              desc="Every call recorded, encrypted client-side, and stored on Cloudflare R2. Zero egress cost. GDPR-ready." />
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────────── */}
      <section id="how-it-works" style={{
        padding: "100px 5vw",
        background: P.surf, borderTop: `1px solid ${P.bord}`, borderBottom: `1px solid ${P.bord}`,
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <div style={{ color: P.gbr, fontSize: 12, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.15em", marginBottom: 12 }}>HOW IT WORKS</div>
            <h2 style={{ fontSize: "clamp(24px, 3vw, 40px)", fontWeight: 900, margin: 0 }}>
              Live in{" "}
              <span style={{
                background: `linear-gradient(135deg, ${P.gold}, ${P.org})`,
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              }}>4 Simple Steps</span>
            </h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
            <StepCard num="01" icon="📋"
              title="Set Up Profile"
              desc="Enter your business name, services, working hours, and FAQs. Takes 5 minutes. No technical knowledge needed." />
            <StepCard num="02" icon="📱"
              title="Get Your DID Number"
              desc="We assign you a Jio enterprise virtual number — your permanent 'Hey Nikki' business contact number." />
            <StepCard num="03" icon="🤖"
              title="Nikki Goes Live"
              desc="Every call to your number is answered by Nikki in < 1 second. Telugu, English, Tanglish — your caller's preference." />
            <StepCard num="04" icon="💼"
              title="Your Team Closes"
              desc="Hot leads with high scores appear in your dashboard. One click to call back. Disposition logged automatically." />
          </div>

          {/* Flow diagram */}
          <div style={{
            marginTop: 48, background: P.hi, border: `1px solid ${P.bord}`,
            borderRadius: 16, padding: "28px 32px",
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: 0, flexWrap: "wrap",
          }}>
            {[
              { icon: "📞", label: "Caller dials" },
              { icon: "→", label: "", arrow: true },
              { icon: "🤖", label: "Nikki answers < 1s" },
              { icon: "→", label: "", arrow: true },
              { icon: "💬", label: "WA confirmation" },
              { icon: "→", label: "", arrow: true },
              { icon: "📊", label: "Lead in CRM" },
              { icon: "→", label: "", arrow: true },
              { icon: "👨‍💼", label: "Agent closes" },
            ].map((s, i) => s.arrow ? (
              <span key={i} style={{ color: P.dim, fontSize: 18, margin: "0 12px" }}>→</span>
            ) : (
              <div key={i} style={{ textAlign: "center", padding: "0 12px" }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>{s.icon}</div>
                <div style={{ color: P.mid, fontSize: 11, fontWeight: 600 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── DEMO SECTION (repeated CTA) ─────────────── */}
      <section id="Demo" style={{ padding: "100px 5vw" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", textAlign: "center" }}>
          <div style={{ color: P.gbr, fontSize: 12, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.15em", marginBottom: 12 }}>LIVE DEMO</div>
          <h2 style={{ fontSize: "clamp(24px, 3vw, 40px)", fontWeight: 900, margin: "0 0 16px" }}>
            See Nikki Book an{" "}
            <span style={{
              background: `linear-gradient(135deg, ${P.grn}, ${P.cyn})`,
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>Appointment Live</span>
          </h2>
          <p style={{ color: P.mid, fontSize: 15, lineHeight: 1.7, marginBottom: 48, maxWidth: 520, margin: "0 auto 48px" }}>
            No phone needed. Chat with Nikki right here — she'll greet you, collect your details, and send a WhatsApp booking confirmation. Exactly what your customers experience on a real call.
          </p>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <VoiceChatWidget />
          </div>
        </div>
      </section>

      {/* ── PRICING ───────────────────────────────────── */}
      <section id="pricing" style={{
        padding: "100px 5vw",
        background: P.surf, borderTop: `1px solid ${P.bord}`,
      }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <div style={{ color: P.gbr, fontSize: 12, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.15em", marginBottom: 12 }}>PRICING</div>
            <h2 style={{ fontSize: "clamp(24px, 3vw, 40px)", fontWeight: 900, margin: "0 0 16px" }}>
              Simple, Honest Pricing
            </h2>
            <p style={{ color: P.mid, fontSize: 15, maxWidth: 500, margin: "0 auto" }}>
              No hidden fees. No per-call surprises. Cancel anytime.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, alignItems: "center" }}>
            <PricingCard
              plan="Starter"
              price="₹2,999"
              features={[
                "1 AI Voice Profile",
                "500 AI-handled calls/month",
                "WhatsApp follow-ups",
                "Appointment booking",
                "Lead CRM dashboard",
                "Email support",
              ]} />
            <PricingCard
              plan="Growth"
              price="₹5,999"
              highlight
              badge="Most Popular"
              features={[
                "3 AI Voice Profiles",
                "2,000 AI-handled calls/month",
                "Click-to-Call + Disposition",
                "WhatsApp campaign dispatch",
                "ROI analytics dashboard",
                "Jio + Vi failover",
                "n8n automation engine",
                "Priority support",
              ]} />
            <PricingCard
              plan="Enterprise"
              price="Custom"
              features={[
                "Unlimited voice profiles",
                "Unlimited call minutes",
                "Dedicated SIP trunk",
                "Custom dialplan & IVR",
                "White-label option",
                "SLA + dedicated support",
                "On-prem deployment",
              ]} />
          </div>

          <div style={{ textAlign: "center", marginTop: 40,
            color: P.dim, fontSize: 13 }}>
            All plans include 14-day free trial · No credit card required · Cancel anytime
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ──────────────────────────────── */}
      <section style={{ padding: "100px 5vw" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <div style={{ color: P.gbr, fontSize: 12, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.15em", marginBottom: 12 }}>EARLY CUSTOMERS</div>
            <h2 style={{ fontSize: "clamp(22px, 2.5vw, 36px)", fontWeight: 900, margin: 0 }}>
              What businesses say
            </h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            {[
              { quote: "Nikki answers in Telugu before I even reach my phone. My after-hours missed calls dropped to zero.", name: "Dr. Ravi Kumar", role: "Clinic Owner, Banjara Hills", color: P.grn },
              { quote: "Our site-visit bookings went up 40% in the first month. Nikki qualifies leads better than our old receptionist did.", name: "Suresh Reddy", role: "Real Estate, Hyderabad", color: P.gold },
              { quote: "The WhatsApp follow-up is automatic. Customers get a confirmation message instantly. They love it.", name: "Priya Sharma", role: "Retail Store, Vijayawada", color: P.cyn },
            ].map(t => (
              <div key={t.name} style={{
                background: P.surf, border: `1px solid ${P.bord}`,
                borderRadius: 14, padding: "24px 22px",
              }}>
                <div style={{ fontSize: 20, color: P.gold, marginBottom: 12 }}>★★★★★</div>
                <div style={{ color: P.txt, fontSize: 14, lineHeight: 1.6, marginBottom: 20,
                  fontStyle: "italic" }}>"{t.quote}"</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%",
                    background: t.color + "33", border: `1px solid ${t.color}44`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: t.color, fontSize: 16, fontWeight: 700 }}>
                    {t.name[0]}
                  </div>
                  <div>
                    <div style={{ color: P.txt, fontSize: 13, fontWeight: 700 }}>{t.name}</div>
                    <div style={{ color: P.dim, fontSize: 11 }}>{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────── */}
      <section style={{
        padding: "100px 5vw",
        background: `linear-gradient(135deg, ${P.acc}22, ${P.surf})`,
        borderTop: `1px solid ${P.bord}`,
        textAlign: "center",
      }}>
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <div style={{ fontSize: 48, marginBottom: 20 }}>🚀</div>
          <h2 style={{ fontSize: "clamp(26px, 3.5vw, 48px)", fontWeight: 900, margin: "0 0 20px" }}>
            Ready to Never Miss a{" "}
            <span style={{
              background: `linear-gradient(135deg, ${P.gbr}, ${P.cyn})`,
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>Business Call?</span>
          </h2>
          <p style={{ color: P.mid, fontSize: 16, lineHeight: 1.7, marginBottom: 40 }}>
            Join hundreds of Telugu businesses using Nikki to answer every call, book more appointments, and grow revenue — without hiring another receptionist.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <a href="/signup" style={{
              padding: "16px 36px", borderRadius: 12,
              background: `linear-gradient(135deg, ${P.acc}, ${P.glow})`,
              color: "#fff", fontSize: 16, fontWeight: 800, textDecoration: "none",
              boxShadow: `0 12px 40px ${P.acc}55`,
            }}>
              Start Free Trial — No Card Needed
            </a>
            <a href="/contact" style={{
              padding: "16px 28px", borderRadius: 12,
              border: `1px solid ${P.bord}`, color: P.mid,
              fontSize: 15, fontWeight: 600, textDecoration: "none",
            }}>
              Talk to Sales
            </a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────── */}
      <footer style={{
        padding: "40px 5vw", borderTop: `1px solid ${P.bord}`,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: 20,
      }}>
        <NikkiLogo size={28} showText variant="horizontal" dark />
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {[
            ["Privacy Policy", "/privacy"],
            ["Terms of Service", "/terms"],
            ["Refund Policy", "/refund-policy"],
            ["Contact", "/contact"],
          ].map(([l, h]) => (
            <a key={l} href={h} style={{
              color: P.dim, fontSize: 12, textDecoration: "none",
              transition: "color 0.2s",
            }}
              onMouseEnter={e => (e.currentTarget.style.color = P.mid)}
              onMouseLeave={e => (e.currentTarget.style.color = P.dim)}>
              {l}
            </a>
          ))}
        </div>
        <div style={{ color: P.dim, fontSize: 12 }}>
          © 2026 Hey Nikki · Made with ❤️ in Hyderabad
        </div>
      </footer>
    </div>
  );
}
