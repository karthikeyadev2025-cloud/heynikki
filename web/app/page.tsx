"use client";
import { useState, useEffect } from "react";
import NikkiLogo from "../components/NikkiLogo";
import VoiceChatWidget from "../components/VoiceChatWidget";

// ── Brand Palette ─────────────────────────────────────────────
const C = {
  bg:         "#FFFFFF",
  vault:      "#F6F8FB",
  surface:    "#FFFFFF",
  border:     "#E2E8F0",
  borderHi:   "#CBD5E1",
  teal:       "#12457A",
  tealLight:  "#1D6FA5",
  terracotta: "#E5533D",
  espresso:   "#0F172A",
  textMid:    "#475569",
  textDim:    "#94A3B8",
  gold:       "#F59E0B",
  emerald:    "#10B981",
  cyan:       "#06B6D4",
};

// ── Custom Vector SVG Icons (No AI Emojis!) ──────────────────
function IconVoiceWave({ size = 24, color = C.teal }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20M17 5v14M7 5v14M2 9v6M22 9v6" />
    </svg>
  );
}

function IconBrain({ size = 24, color = C.teal }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-5.04z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-5.04z" />
    </svg>
  );
}

function IconCalendar({ size = 24, color = C.teal }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
    </svg>
  );
}

function IconWhatsApp({ size = 24, color = C.emerald }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function IconPhoneCall({ size = 24, color = C.teal }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function IconShield({ size = 24, color = C.teal }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function IconRefresh({ size = 24, color = C.teal }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 4v6h-6M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function IconAnalytics({ size = 24, color = C.teal }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function IconSparkles({ size = 24, color = C.terracotta }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" />
      <path d="M5 3v4M3 5h4M19 17v4M17 19h4" />
    </svg>
  );
}

function IconChevronDown({ size = 20, color = C.textMid }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function useScrollY() {
  const [y, setY] = useState(0);
  useEffect(() => {
    const h = () => setY(window.scrollY);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);
  return y;
}

// ══════════════════════════════════════════════════════════════
// LANDING PAGE
// ══════════════════════════════════════════════════════════════
export default function LandingPage() {
  const scrollY = useScrollY();
  const solid = scrollY > 40;

  // Interactive ROI Calculator State
  const [dailyCalls, setDailyCalls] = useState(40);
  const monthlyHumanCost = Math.round(dailyCalls * 30 * 35); // ₹35 per human handled call
  const monthlyAICost    = Math.round(dailyCalls * 30 * 4);  // ₹4 per AI handled call
  const monthlySavings   = monthlyHumanCost - monthlyAICost;
  const savingsPercent   = Math.round((monthlySavings / monthlyHumanCost) * 100);

  // Accordion State
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div style={{
      background: C.bg, minHeight: "100vh",
      fontFamily: "'Inter', -apple-system, sans-serif",
      color: C.espresso, overflowX: "hidden",
    }}>
      <style>{`
        @keyframes orb-float-1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(30px,-30px) scale(1.1)} }
        @keyframes orb-float-2 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-25px,25px) scale(1.15)} }
        @keyframes wave-bar { 0%,100%{height:6px} 50%{height:24px} }
        @keyframes pulse-ring { 0%{transform:scale(0.95);opacity:0.8} 50%{transform:scale(1.05);opacity:0.3} 100%{transform:scale(0.95);opacity:0.8} }
        @keyframes fade-in-up { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        html { scroll-behavior: smooth; }
      `}</style>

      {/* ═══ NAVBAR ═══════════════════════════════════════ */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 5vw", height: 72,
        background: solid ? "rgba(255, 255, 255, 0.94)" : "transparent",
        backdropFilter: solid ? "blur(20px) saturate(180%)" : "none",
        borderBottom: solid ? `1px solid ${C.border}` : "1px solid transparent",
        transition: "all 0.3s ease",
      }}>
        <NikkiLogo size={40} showText variant="horizontal" dark={false} />

        <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
          {[
            ["Features", "#features"],
            ["Architecture", "#architecture"],
            ["ROI Calculator", "#roi-calculator"],
            ["Pricing", "#pricing"],
            ["Live Demo", "#demo"],
          ].map(([label, href]) => (
            <a key={label} href={href} style={{
              color: C.textMid, fontSize: 14, textDecoration: "none",
              fontWeight: 600, transition: "color 0.2s",
            }}
              onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.color = C.terracotta; }}
              onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.color = C.textMid; }}
            >{label}</a>
          ))}
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a href="/login" style={{
            padding: "10px 22px", borderRadius: 10,
            border: `1px solid ${C.borderHi}`, background: "#fff",
            color: C.espresso, fontSize: 13, fontWeight: 700,
            textDecoration: "none", transition: "all 0.2s",
          }}>Sign In</a>
          <a href="/signup" style={{
            padding: "10px 24px", borderRadius: 10,
            background: `linear-gradient(135deg, ${C.terracotta}, #F97316)`,
            color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none",
            boxShadow: "0 6px 18px rgba(229,83,61,0.3)",
            transition: "transform 0.15s, boxShadow 0.15s",
          }}
            onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.transform = "translateY(0)"; }}
          >Start Free Trial</a>
        </div>
      </nav>

      {/* ═══ HERO SECTION ═════════════════════════════════ */}
      <section style={{
        background: `linear-gradient(180deg, ${C.vault} 0%, #EFF4F9 50%, #FFFFFF 100%)`,
        padding: "150px 5vw 110px", position: "relative", overflow: "hidden",
      }}>
        {/* Glowing 3D Orbs */}
        <div style={{
          position: "absolute", top: -80, right: -60,
          width: 480, height: 480, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(229,83,61,0.08) 0%, transparent 70%)",
          animation: "orb-float-1 8s ease-in-out infinite",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", bottom: -40, left: -40,
          width: 420, height: 420, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(18,69,122,0.07) 0%, transparent 70%)",
          animation: "orb-float-2 10s ease-in-out infinite",
          pointerEvents: "none",
        }} />

        <div style={{
          maxWidth: 1240, margin: "0 auto",
          display: "grid", gridTemplateColumns: "1.15fr 0.85fr",
          gap: 64, alignItems: "center", position: "relative", zIndex: 1,
        }}>
          {/* Left Hero Copy */}
          <div style={{ animation: "fade-in-up 0.8s ease-out" }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 10,
              background: "#fff", border: `1px solid ${C.borderHi}`,
              borderRadius: 30, padding: "6px 18px 6px 8px", marginBottom: 28,
              boxShadow: "0 4px 14px rgba(15,23,42,0.04)",
            }}>
              <div style={{
                background: `linear-gradient(135deg, ${C.terracotta}, #F97316)`,
                borderRadius: "50%", width: 26, height: 26,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <IconSparkles size={14} color="#fff" />
              </div>
              <span style={{
                color: C.teal, fontSize: 13, fontWeight: 800,
                letterSpacing: "0.02em",
              }}>
                Enterprise Voice AI · Telugu & English Dual Brain
              </span>
            </div>

            <h1 style={{
              fontSize: "clamp(38px, 4.6vw, 58px)",
              fontWeight: 900, lineHeight: 1.1, margin: "0 0 24px",
              letterSpacing: "-0.03em", color: C.espresso,
            }}>
              Never Miss a Call.{" "}
              <span style={{
                backgroundImage: `linear-gradient(120deg, ${C.terracotta} 0%, #F97316 100%)`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}>Ever.</span>
            </h1>

            <p style={{
              color: C.textMid, fontSize: 18, lineHeight: 1.7,
              marginBottom: 38, maxWidth: 540, fontWeight: 400,
            }}>
              Hey Nikki answers inbound calls sub-second in <strong>Telugu & English</strong>, books appointments, and triggers instant WhatsApp follow-ups — operating under your <strong>single business number</strong>.
            </p>

            <div style={{ display: "flex", gap: 16, marginBottom: 48, flexWrap: "wrap" }}>
              <a href="/signup" style={{
                padding: "16px 36px", borderRadius: 12,
                background: `linear-gradient(135deg, ${C.terracotta}, #F97316)`,
                color: "#fff", fontSize: 15, fontWeight: 800, textDecoration: "none",
                boxShadow: "0 8px 24px rgba(229,83,61,0.35)",
                transition: "transform 0.15s, box-shadow 0.15s",
              }}
                onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "0 12px 32px rgba(229,83,61,0.45)";
                }}
                onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 8px 24px rgba(229,83,61,0.35)";
                }}
              >Start 14-Day Free Trial →</a>

              <a href="#demo" style={{
                padding: "16px 30px", borderRadius: 12,
                background: "#fff", border: `1.5px solid ${C.borderHi}`,
                color: C.teal, fontSize: 15, fontWeight: 700, textDecoration: "none",
                display: "flex", alignItems: "center", gap: 8,
                transition: "border-color 0.2s, background 0.2s",
              }}
                onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.borderColor = C.teal; }}
                onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.borderColor = C.borderHi; }}
              >
                <IconVoiceWave size={18} color={C.teal} />
                Try Live Agent
              </a>
            </div>

            {/* Proof items */}
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              {[
                { icon: <IconShield size={16} color={C.emerald} />, text: "TRAI AI Compliant" },
                { icon: <IconWhatsApp size={16} color={C.emerald} />, text: "Meta WhatsApp Partner" },
                { icon: <IconRefresh size={16} color={C.teal} />, text: "Encrypted Call Recording" },
              ].map(({ icon, text }, idx) => (
                <div key={idx} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  color: C.textMid, fontSize: 13, fontWeight: 600,
                }}>
                  {icon} {text}
                </div>
              ))}
            </div>
          </div>

          {/* Right Hero: Live Voice Demo Widget */}
          <div id="demo" style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            position: "relative",
          }}>
            {/* Dynamic Soundwave Rings around widget */}
            <div style={{
              position: "absolute", inset: -14, borderRadius: 28,
              border: `1.5px solid rgba(18,69,122,0.15)`,
              animation: "pulse-ring 3s infinite", pointerEvents: "none",
            }} />
            <VoiceChatWidget />
          </div>
        </div>
      </section>

      {/* ═══ STATS ROW ════════════════════════════════════ */}
      <section style={{
        padding: "54px 5vw", background: C.vault,
        borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{
          maxWidth: 1100, margin: "0 auto",
          display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 32,
          textAlign: "center",
        }}>
          {[
            { val: "< 1s", label: "AI Answer Speed", sub: "Regional Telugu & English" },
            { val: "24 / 7", label: "Always Active", sub: "Zero missed after-hours calls" },
            { val: "3×*", label: "Est. Lead Capture Lift", sub: "Auto WhatsApp followup" },
            { val: "₹4", label: "AI Cost Per Call", sub: "vs ₹35 human receptionist" },
          ].map(({ val, label, sub }) => (
            <div key={label}>
              <div style={{ color: C.teal, fontSize: 42, fontWeight: 900, lineHeight: 1 }}>{val}</div>
              <div style={{ color: C.espresso, fontSize: 14, marginTop: 8, fontWeight: 800 }}>{label}</div>
              <div style={{ color: C.textDim, fontSize: 12, marginTop: 2 }}>{sub}</div>
            </div>
          ))}
        </div>
        <p style={{ textAlign: "center", color: C.textDim, fontSize: 11, marginTop: 28 }}>
          * Estimated, based on illustrative call-cost assumptions — not a guaranteed outcome.
        </p>
      </section>

      {/* ═══ DUAL ARCHITECTURE DIAGRAM ════════════════════ */}
      <section id="architecture" style={{ padding: "100px 5vw", background: C.bg }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <div style={{
              color: C.terracotta, fontSize: 12, fontWeight: 800,
              textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10,
            }}>DUAL OPERATIONAL ARCHITECTURE</div>
            <h2 style={{
              fontSize: "clamp(28px, 3.5vw, 44px)", fontWeight: 900,
              margin: "0 0 14px", letterSpacing: "-0.02em",
            }}>
              Two Brains. Two Eyes. <span style={{ color: C.teal }}>One Brand Number.</span>
            </h2>
            <p style={{ color: C.textMid, fontSize: 16, maxWidth: 640, margin: "0 auto", lineHeight: 1.6 }}>
              Whether handled by Voice AI or your human sales team, every phone call, WhatsApp brochure, and missed call follow-up originates from your single Jio/Vi virtual number.
            </p>
          </div>

          {/* Interactive Flow Diagram */}
          <div style={{
            background: C.vault, border: `1px solid ${C.border}`,
            borderRadius: 20, padding: "40px 32px",
            boxShadow: "0 12px 32px rgba(15,23,42,0.03)",
          }}>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 0.2fr 1fr 0.2fr 1fr",
              alignItems: "center", gap: 16, textAlign: "center",
            }}>
              {/* Box 1: Customer Call */}
              <div style={{
                background: "#fff", border: `1.5px solid ${C.borderHi}`,
                borderRadius: 16, padding: "24px 20px", boxShadow: "0 4px 14px rgba(0,0,0,0.03)",
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, background: C.vault,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 12px", border: `1px solid ${C.border}`,
                }}>
                  <IconPhoneCall size={22} color={C.teal} />
                </div>
                <div style={{ color: C.espresso, fontWeight: 800, fontSize: 15 }}>Customer Calls</div>
                <div style={{ color: C.textMid, fontSize: 12, marginTop: 4 }}>Single Jio/Vi Virtual DID</div>
              </div>

              {/* Arrow 1 */}
              <div style={{ color: C.terracotta, fontSize: 22, fontWeight: 900 }}>→</div>

              {/* Box 2: Brain 1 (Voice AI) */}
              <div style={{
                background: `linear-gradient(135deg, ${C.teal}, ${C.tealLight})`,
                borderRadius: 16, padding: "24px 20px", color: "#fff",
                boxShadow: "0 8px 24px rgba(18,69,122,0.25)",
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.15)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 12px", border: "1px solid rgba(255,255,255,0.3)",
                }}>
                  <IconBrain size={22} color="#fff" />
                </div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>Brain 1: Voice AI</div>
                <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>Answers Inbound & WhatsApp</div>
              </div>

              {/* Arrow 2 */}
              <div style={{ color: C.terracotta, fontSize: 22, fontWeight: 900 }}>→</div>

              {/* Box 3: Brain 2 (Human Sales) */}
              <div style={{
                background: "#fff", border: `1.5px solid ${C.borderHi}`,
                borderRadius: 16, padding: "24px 20px", boxShadow: "0 4px 14px rgba(0,0,0,0.03)",
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, background: C.vault,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 12px", border: `1px solid ${C.border}`,
                }}>
                  <IconPhoneCall size={22} color={C.terracotta} />
                </div>
                <div style={{ color: C.espresso, fontWeight: 800, fontSize: 15 }}>Brain 2: Human CTC</div>
                <div style={{ color: C.textMid, fontSize: 12, marginTop: 4 }}>Masked Outbound Sales Floor</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ INTERACTIVE ROI CALCULATOR ═══════════════════ */}
      <section id="roi-calculator" style={{
        padding: "100px 5vw", background: C.vault,
        borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 54 }}>
            <div style={{
              color: C.teal, fontSize: 12, fontWeight: 800,
              textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10,
            }}>INTERACTIVE SAVINGS CALCULATOR</div>
            <h2 style={{ fontSize: "clamp(26px, 3.5vw, 42px)", fontWeight: 900, margin: 0 }}>
              Calculate Your Monthly Receptionist Savings
            </h2>
          </div>

          <div style={{
            background: "#fff", border: `1px solid ${C.border}`,
            borderRadius: 20, padding: "40px 36px",
            boxShadow: "0 12px 32px rgba(15,23,42,0.04)",
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "center",
          }}>
            {/* Slider Column */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ color: C.espresso, fontWeight: 800, fontSize: 15 }}>Daily Inbound Calls</span>
                <span style={{ color: C.terracotta, fontWeight: 900, fontSize: 20 }}>{dailyCalls} calls / day</span>
              </div>

              <input
                type="range" min="10" max="200" step="5"
                value={dailyCalls}
                onChange={e => setDailyCalls(Number(e.target.value))}
                style={{
                  width: "100%", accentColor: C.terracotta, height: 8,
                  borderRadius: 4, cursor: "pointer", marginBottom: 28,
                }}
              />

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", background: C.vault, borderRadius: 10 }}>
                  <span style={{ color: C.textMid, fontSize: 13 }}>Human Receptionist Cost (₹35/call)</span>
                  <span style={{ color: C.espresso, fontWeight: 800, fontSize: 14 }}>₹{monthlyHumanCost.toLocaleString("en-IN")}/mo</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", background: C.vault, borderRadius: 10 }}>
                  <span style={{ color: C.textMid, fontSize: 13 }}>Hey Nikki AI Cost (₹4/call)</span>
                  <span style={{ color: C.teal, fontWeight: 800, fontSize: 14 }}>₹{monthlyAICost.toLocaleString("en-IN")}/mo</span>
                </div>
              </div>
            </div>

            {/* Savings Callout Column */}
            <div style={{
              background: `linear-gradient(135deg, ${C.teal}, ${C.tealLight})`,
              borderRadius: 16, padding: "36px 28px", color: "#fff",
              textAlign: "center", boxShadow: "0 12px 32px rgba(18,69,122,0.25)",
            }}>
              <div style={{ fontSize: 13, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em", opacity: 0.9, marginBottom: 8 }}>
                ESTIMATED MONTHLY SAVINGS
              </div>
              <div style={{ fontSize: 44, fontWeight: 900, color: "#fff", lineHeight: 1, marginBottom: 12 }}>
                ₹{monthlySavings.toLocaleString("en-IN")}
              </div>
              <p style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5, marginBottom: 24 }}>
                Based on the numbers above, that's roughly <strong>{savingsPercent}% lower operational cost</strong> than a human receptionist, plus faster follow-ups from automated WhatsApp messaging.
              </p>
              <a href="/signup" style={{
                display: "inline-block", padding: "12px 28px", borderRadius: 10,
                background: C.terracotta, color: "#fff", fontSize: 14,
                fontWeight: 800, textDecoration: "none",
                boxShadow: "0 4px 14px rgba(229,83,61,0.4)",
              }}>Claim Your Savings →</a>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FEATURES GRID ════════════════════════════════ */}
      <section id="features" style={{ padding: "100px 5vw", background: C.bg }}>
        <div style={{ maxWidth: 1240, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <div style={{
              color: C.terracotta, fontSize: 12, fontWeight: 800,
              textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10,
            }}>ENTERPRISE PLATFORM FEATURES</div>
            <h2 style={{ fontSize: "clamp(28px, 3.5vw, 44px)", fontWeight: 900, margin: 0 }}>
              Engineered for Real-World Reliability
            </h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24 }}>
            {[
              { icon: <IconVoiceWave size={24} color={C.teal} />, title: "Telugu & English Voice AI", desc: "Natural Tanglish with గారు honorifics, regional accents, and sub-second response time." },
              { icon: <IconCalendar size={24} color={C.teal} />, title: "Instant Appointment Booking", desc: "Captures name, phone, service, and slot. Books instantly and confirms via WhatsApp." },
              { icon: <IconWhatsApp size={24} color={C.emerald} />, title: "WhatsApp Dispatch Panel", desc: "Brochures, confirmations, and missed call follow-ups on approved Meta templates." },
              { icon: <IconPhoneCall size={24} color={C.terracotta} />, title: "Click-to-Call (Masked CLI)", desc: "Human team calls leads from dashboard. Customer sees your single business number." },
              { icon: <IconRefresh size={24} color={C.teal} />, title: "Jio & Vi Dual Failover", desc: "Active-active SIP trunk failover. If Jio drops, Vi picks up instantly with zero call drops." },
              { icon: <IconAnalytics size={24} color={C.teal} />, title: "ROI Analytics Dashboard", desc: "Track salary saved, conversion rates, peak hours, and WhatsApp delivery metrics." },
              { icon: <IconShield size={24} color={C.teal} />, title: "Missed Call Guard", desc: "Caller hangs up before 20s? Nikki sends a WhatsApp within 30s so no lead is lost." },
              { icon: <IconSparkles size={24} color={C.terracotta} />, title: "Cloudflare R2 Sync", desc: "Every call recorded, encrypted, offloaded to Cloudflare R2 with zero egress costs." },
              { icon: <IconBrain size={24} color={C.teal} />, title: "Self-Service Portal", desc: "Update FAQs, business hours, voice profile, and WhatsApp templates yourself." },
            ].map(({ icon, title, desc }, idx) => (
              <div key={idx} style={{
                background: "#fff", border: `1px solid ${C.border}`,
                borderRadius: 16, padding: "30px 24px",
                boxShadow: "0 4px 20px rgba(15,23,42,0.03)",
                transition: "all 0.25s ease",
              }}
                onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                  e.currentTarget.style.borderColor = C.teal + "44";
                  e.currentTarget.style.transform = "translateY(-3px)";
                  e.currentTarget.style.boxShadow = "0 10px 30px rgba(18,69,122,0.08)";
                }}
                onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                  e.currentTarget.style.borderColor = C.border;
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 4px 20px rgba(15,23,42,0.03)";
                }}
              >
                <div style={{
                  width: 48, height: 48, borderRadius: 12,
                  background: C.vault, border: `1px solid ${C.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 18,
                }}>{icon}</div>
                <div style={{ color: C.espresso, fontSize: 16, fontWeight: 800, marginBottom: 8 }}>{title}</div>
                <div style={{ color: C.textMid, fontSize: 14, lineHeight: 1.6 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PRICING SECTION ══════════════════════════════ */}
      <section id="pricing" style={{ padding: "100px 5vw", background: C.vault, borderTop: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <div style={{
              color: C.terracotta, fontSize: 12, fontWeight: 800,
              textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10,
            }}>TRANSPARENT PRICING</div>
            <h2 style={{ fontSize: "clamp(28px, 3.5vw, 44px)", fontWeight: 900, margin: "0 0 10px" }}>
              Plans for Every Business Size
            </h2>
            <p style={{ color: C.textMid, fontSize: 15 }}>
              14-day free trial on all plans. No credit card required.
            </p>
          </div>

          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3,1fr)",
            gap: 24, alignItems: "stretch",
          }}>
            {[
              {
                plan: "Starter", price: "₹2,999", highlight: false,
                features: ["1 Voice Profile", "500 AI Calls/Month", "WhatsApp Booking Sync", "Basic Lead CRM", "Email Support"],
              },
              {
                plan: "Growth", price: "₹5,999", highlight: true, badge: "Most Popular",
                features: ["3 Voice Profiles", "2,000 AI Calls/Month", "Click-to-Call + Disposition", "WhatsApp Dispatch Panel", "Missed Call Guard", "ROI Analytics", "Jio + Vi Failover"],
              },
              {
                plan: "Scale", price: "₹14,999", highlight: false,
                features: ["Unlimited Profiles", "5,000 AI Calls/Month", "Dedicated Account Manager", "Custom WhatsApp Templates", "ESL Outbound API", "Cloudflare R2 Sync"],
              },
            ].map(({ plan, price, highlight, badge, features }) => (
              <div key={plan} style={{
                background: highlight ? C.teal : "#fff",
                border: `1px solid ${highlight ? C.teal : C.border}`,
                borderRadius: 20, padding: "38px 30px",
                color: highlight ? "#fff" : C.espresso,
                position: "relative",
                boxShadow: highlight
                  ? "0 24px 48px rgba(18,69,122,0.25)"
                  : "0 4px 20px rgba(0,0,0,0.04)",
                transform: highlight ? "scale(1.03)" : "none",
              }}>
                {badge && (
                  <div style={{
                    position: "absolute", top: -14, left: "50%",
                    transform: "translateX(-50%)",
                    background: C.terracotta, color: "#fff",
                    fontSize: 11, fontWeight: 800,
                    padding: "5px 16px", borderRadius: 20,
                    textTransform: "uppercase",
                  }}>{badge}</div>
                )}
                <div style={{
                  color: highlight ? "rgba(255,255,255,0.7)" : C.textMid,
                  fontSize: 13, fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: "0.08em", marginBottom: 10,
                }}>{plan}</div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 4, marginBottom: 28 }}>
                  <span style={{ fontSize: 42, fontWeight: 900, lineHeight: 1 }}>{price}</span>
                  <span style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>/month</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 32 }}>
                  {features.map(f => (
                    <div key={f} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <span style={{ color: highlight ? "#fff" : C.emerald, fontSize: 14, fontWeight: 900 }}>✓</span>
                      <span style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.4 }}>{f}</span>
                    </div>
                  ))}
                </div>
                <a href="/signup" style={{
                  display: "block", padding: "14px 0", borderRadius: 10,
                  textAlign: "center",
                  background: highlight ? C.terracotta : C.vault,
                  border: highlight ? "none" : `1px solid ${C.borderHi}`,
                  color: highlight ? "#fff" : C.espresso,
                  fontSize: 14, fontWeight: 800, textDecoration: "none",
                  boxShadow: highlight ? "0 4px 14px rgba(229,83,61,0.3)" : "none",
                }}>
                  {highlight ? "Start Free Trial →" : "Get Started"}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FAQ ACCORDION ════════════════════════════════ */}
      <section style={{ padding: "100px 5vw", background: C.bg }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 54 }}>
            <div style={{
              color: C.teal, fontSize: 12, fontWeight: 800,
              textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10,
            }}>FREQUENTLY ASKED QUESTIONS</div>
            <h2 style={{ fontSize: "clamp(26px, 3.5vw, 40px)", fontWeight: 900, margin: 0 }}>
              Got Questions? We Have Answers.
            </h2>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              {
                q: "Does Hey Nikki require buying new phone numbers?",
                a: "No! Nikki attaches directly to your existing or newly assigned dedicated Jio/Vi Enterprise SIP trunk virtual number. Every inbound call, WhatsApp message, and human outbound call runs through your single brand number.",
              },
              {
                q: "How does Nikki handle Telugu accents & regional dialects?",
                a: "Nikki is trained on natural Telugu speech across Coastal Andhra, Telangana, and Rayalaseema. She understands Tanglish (English numbers/times mixed into Telugu sentence frames) seamlessly.",
              },
              {
                q: "What happens if a customer hangs up before speaking?",
                a: "If a call ends before 20 seconds, Missed Call Guard automatically triggers an instant WhatsApp follow-up message with your business brochure within 30 seconds so no lead is lost.",
              },
              {
                q: "Can my human sales team make calls through Nikki?",
                a: "Yes! Your team can click any lead on the dashboard to trigger a 2-leg Click-to-Call bridge. The customer sees your official business number as the caller ID, keeping your agents' personal numbers private.",
              },
            ].map(({ q, a }, idx) => (
              <div key={idx} style={{
                background: C.vault, border: `1px solid ${C.border}`,
                borderRadius: 14, overflow: "hidden",
              }}>
                <button
                  onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                  style={{
                    width: "100%", padding: "20px 24px", background: "transparent",
                    border: "none", textAlign: "left", cursor: "pointer",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                  <span style={{ color: C.espresso, fontWeight: 800, fontSize: 15 }}>{q}</span>
                  <div style={{
                    transform: openFaq === idx ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.2s",
                  }}>
                    <IconChevronDown size={20} color={C.textMid} />
                  </div>
                </button>
                {openFaq === idx && (
                  <div style={{
                    padding: "0 24px 20px", color: C.textMid,
                    fontSize: 14, lineHeight: 1.6, borderTop: `1px solid ${C.border}`,
                    paddingTop: 16,
                  }}>
                    {a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CTA BANNER ═══════════════════════════════════ */}
      <section style={{
        padding: "80px 5vw",
        background: `linear-gradient(135deg, ${C.teal}, ${C.tealLight})`,
        textAlign: "center", position: "relative", overflow: "hidden",
      }}>
        <div style={{ maxWidth: 720, margin: "0 auto", position: "relative", zIndex: 1 }}>
          <h2 style={{
            color: "#fff", fontSize: "clamp(28px, 3.5vw, 42px)",
            fontWeight: 900, margin: "0 0 16px", lineHeight: 1.2,
          }}>
            Ready to Automate Your Business Calls?
          </h2>
          <p style={{
            color: "rgba(255,255,255,0.85)", fontSize: 16,
            marginBottom: 36, lineHeight: 1.6,
          }}>
            Join clinics, real estate firms, and businesses operating 24/7 with Hey Nikki.
          </p>
          <a href="/signup" style={{
            display: "inline-block", padding: "16px 38px", borderRadius: 12,
            background: C.terracotta, color: "#fff",
            fontSize: 16, fontWeight: 800, textDecoration: "none",
            boxShadow: "0 8px 24px rgba(229,83,61,0.4)",
          }}>
            Start Your Free Trial Now →
          </a>
        </div>
      </section>

      {/* ═══ FOOTER ═══════════════════════════════════════ */}
      <footer style={{
        padding: "40px 5vw", background: C.vault,
        borderTop: `1px solid ${C.border}`,
        display: "flex", justifyContent: "space-between",
        alignItems: "center", flexWrap: "wrap", gap: 16,
      }}>
        <NikkiLogo size={32} showText variant="horizontal" dark={false} />
        <div style={{ display: "flex", gap: 24 }}>
          {["Privacy Policy", "Terms of Service", "Refund Policy", "Contact"].map(l => (
            <a key={l} href={`/${l.toLowerCase().replace(/ /g, "-")}`} style={{
              color: C.textMid, fontSize: 12, textDecoration: "none", fontWeight: 500,
            }}>{l}</a>
          ))}
        </div>
        <div style={{ color: C.textDim, fontSize: 12 }}>
          © 2026 Hey Nikki · Enterprise Voice AI & Omnichannel CRM
        </div>
      </footer>
    </div>
  );
}
