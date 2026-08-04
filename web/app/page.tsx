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

  return (
    <div style={{
      background: C.bg, minHeight: "100vh",
      fontFamily: "'Inter', -apple-system, sans-serif",
      color: C.espresso, overflowX: "hidden",
    }}>
      <style>{`
        @keyframes hero-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes hero-glow { 0%,100%{opacity:0.4} 50%{opacity:0.7} }
        @keyframes fade-up { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slide-in { from{opacity:0;transform:translateX(-20px)} to{opacity:1;transform:translateX(0)} }
        html { scroll-behavior: smooth; }
      `}</style>

      {/* ═══ NAVBAR ═══════════════════════════════════════ */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 5vw", height: 68,
        background: solid ? "rgba(255,255,255,0.96)" : "transparent",
        backdropFilter: solid ? "blur(16px) saturate(180%)" : "none",
        borderBottom: solid ? `1px solid ${C.border}` : "1px solid transparent",
        transition: "all 0.3s ease",
      }}>
        <NikkiLogo size={38} showText variant="horizontal" dark={false} />

        <div style={{ display: "flex", gap: 30, alignItems: "center" }}>
          {[
            ["Features", "#features"],
            ["How It Works", "#how-it-works"],
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

        <div style={{ display: "flex", gap: 10 }}>
          <a href="/login" style={{
            padding: "9px 20px", borderRadius: 8,
            border: `1px solid ${C.borderHi}`, background: "#fff",
            color: C.espresso, fontSize: 13, fontWeight: 700,
            textDecoration: "none", transition: "all 0.2s",
          }}>Sign In</a>
          <a href="/signup" style={{
            padding: "9px 22px", borderRadius: 8,
            background: C.terracotta, color: "#fff",
            fontSize: 13, fontWeight: 700, textDecoration: "none",
            boxShadow: "0 4px 16px rgba(229,83,61,0.3)",
          }}>Start Free Trial</a>
        </div>
      </nav>

      {/* ═══ HERO ═════════════════════════════════════════ */}
      <section style={{
        background: `linear-gradient(175deg, ${C.vault} 0%, #EFF4F9 40%, #FFFFFF 100%)`,
        padding: "140px 5vw 100px",
        position: "relative", overflow: "hidden",
      }}>
        {/* Decorative gradient blobs */}
        <div style={{
          position: "absolute", top: -100, right: -80,
          width: 400, height: 400, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(229,83,61,0.06) 0%, transparent 70%)",
          animation: "hero-glow 6s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", bottom: -60, left: -60,
          width: 300, height: 300, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(18,69,122,0.05) 0%, transparent 70%)",
        }} />

        <div style={{
          maxWidth: 1200, margin: "0 auto",
          display: "grid", gridTemplateColumns: "1.15fr 0.85fr",
          gap: 60, alignItems: "center", position: "relative",
        }}>
          {/* Left copy */}
          <div style={{ animation: "fade-up 0.8s ease-out" }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "#fff", border: `1px solid ${C.borderHi}`,
              borderRadius: 24, padding: "6px 18px 6px 6px", marginBottom: 28,
              boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%",
                background: C.emerald, display: "flex",
                alignItems: "center", justifyContent: "center",
              }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />
              </div>
              <span style={{
                color: C.teal, fontSize: 12, fontWeight: 800,
                textTransform: "uppercase", letterSpacing: "0.06em",
              }}>
                AI Voice Receptionist · Telugu & English
              </span>
            </div>

            <h1 style={{
              fontSize: "clamp(36px, 4.5vw, 56px)",
              fontWeight: 900, lineHeight: 1.1, margin: "0 0 24px",
              letterSpacing: "-0.03em",
            }}>
              Your Business Deserves a{" "}
              <span style={{
                color: C.terracotta,
                backgroundImage: `linear-gradient(120deg, ${C.terracotta} 0%, #F97316 100%)`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}>24/7 Receptionist.</span>
            </h1>

            <p style={{
              color: C.textMid, fontSize: 17, lineHeight: 1.7,
              marginBottom: 36, maxWidth: 520,
            }}>
              Nikki answers every call in <strong>sub-second</strong> — in natural Telugu & English. She books appointments, sends WhatsApp confirmations, and never takes a day off. All from your <strong>single dedicated business number</strong>.
            </p>

            <div style={{ display: "flex", gap: 14, marginBottom: 44, flexWrap: "wrap" }}>
              <a href="/signup" style={{
                padding: "15px 32px", borderRadius: 10,
                background: C.terracotta, color: "#fff",
                fontSize: 15, fontWeight: 800, textDecoration: "none",
                boxShadow: "0 8px 24px rgba(229,83,61,0.3)",
                transition: "transform 0.15s, box-shadow 0.15s",
              }}
                onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 12px 32px rgba(229,83,61,0.4)"; }}
                onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(229,83,61,0.3)"; }}
              >Start 14-Day Free Trial →</a>
              <a href="#demo" style={{
                padding: "15px 28px", borderRadius: 10,
                background: "#fff", border: `1.5px solid ${C.borderHi}`,
                color: C.teal, fontSize: 15, fontWeight: 700, textDecoration: "none",
                transition: "border-color 0.2s",
              }}
                onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.borderColor = C.teal; }}
                onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.borderColor = C.borderHi; }}
              >🎙️ Try Live Demo</a>
            </div>

            {/* Trust row */}
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {[
                { icon: "⚡", text: "Sub-Second Response" },
                { icon: "📱", text: "WhatsApp Auto-Sync" },
                { icon: "🔒", text: "TRAI Compliant" },
              ].map(({ icon, text }) => (
                <div key={text} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  color: C.textDim, fontSize: 12, fontWeight: 600,
                }}>
                  <span style={{ fontSize: 14 }}>{icon}</span> {text}
                </div>
              ))}
            </div>
          </div>

          {/* Right: Live Voice Agent Widget */}
          <div id="demo" style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            animation: "hero-float 5s ease-in-out infinite",
          }}>
            <VoiceChatWidget />
          </div>
        </div>
      </section>

      {/* ═══ STATS ════════════════════════════════════════ */}
      <section style={{
        padding: "56px 5vw", background: C.vault,
        borderTop: `1px solid ${C.border}`,
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{
          maxWidth: 1100, margin: "0 auto",
          display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 32,
          textAlign: "center",
        }}>
          {[
            { val: "< 1s", label: "AI Answer Time" },
            { val: "24/7", label: "Always Available" },
            { val: "3×", label: "Lead Capture Rate" },
            { val: "₹4", label: "Cost Per Call vs ₹35 Human" },
          ].map(({ val, label }) => (
            <div key={label}>
              <div style={{ color: C.teal, fontSize: 40, fontWeight: 900, lineHeight: 1 }}>{val}</div>
              <div style={{ color: C.textMid, fontSize: 13, marginTop: 8, fontWeight: 600 }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ FEATURES ═════════════════════════════════════ */}
      <section id="features" style={{ padding: "100px 5vw" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <div style={{
              color: C.terracotta, fontSize: 12, fontWeight: 800,
              textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10,
            }}>EVERYTHING YOU NEED</div>
            <h2 style={{
              fontSize: "clamp(28px, 3.5vw, 44px)",
              fontWeight: 900, margin: "0 0 12px", letterSpacing: "-0.02em",
            }}>
              Two Brains. One Brand Number.
            </h2>
            <p style={{
              color: C.textMid, fontSize: 16, maxWidth: 640, margin: "0 auto", lineHeight: 1.6,
            }}>
              AI handles inbound calls autonomously. Your human team makes outbound calls via Click-to-Call. Every interaction through your single dedicated Jio/Vi number.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
            {[
              { icon: "🎙️", title: "Telugu & English Voice AI", desc: "Natural Tanglish with గారు honorifics, regional accents, and sub-second response time.", tag: "CORE" },
              { icon: "📅", title: "Instant Appointment Booking", desc: "Captures name, phone, service, and slot. Books instantly and confirms via WhatsApp.", tag: "AUTO" },
              { icon: "💬", title: "WhatsApp Dispatch Panel", desc: "Brochure PDFs, appointment confirmations, and missed call follow-ups on approved Meta templates." },
              { icon: "📞", title: "Click-to-Call with Masked CLI", desc: "Human team calls leads from dashboard. Customer sees your business number, not agent's personal phone." },
              { icon: "🔄", title: "Jio + Vi Dual Trunk Failover", desc: "Active-active SIP trunk failover. If Jio drops, Vi picks up instantly. Zero missed calls.", tag: "HA" },
              { icon: "📊", title: "ROI Analytics Dashboard", desc: "Human salary saved (₹35→₹4/call), conversion rates, peak hours, WhatsApp delivery metrics." },
              { icon: "📵", title: "Missed Call Guard", desc: "Caller hangs up before 20s? Nikki sends a WhatsApp within 30 seconds so no lead is lost." },
              { icon: "🔒", title: "Encrypted Call Recordings", desc: "Every call recorded, encrypted, uploaded to Cloudflare R2 with zero egress costs." },
              { icon: "⚙️", title: "Full Self-Service Control", desc: "Update FAQs, business hours, voice profile, missed call timeout, and WhatsApp templates yourself." },
            ].map(({ icon, title, desc, tag }) => (
              <div key={title} style={{
                background: "#fff", border: `1px solid ${C.border}`,
                borderRadius: 14, padding: "28px 24px",
                boxShadow: "0 4px 20px rgba(15,23,42,0.03)",
                transition: "border-color 0.25s, box-shadow 0.25s",
                position: "relative",
              }}
                onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                  e.currentTarget.style.borderColor = C.teal + "44";
                  e.currentTarget.style.boxShadow = "0 8px 32px rgba(18,69,122,0.08)";
                }}
                onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                  e.currentTarget.style.borderColor = C.border;
                  e.currentTarget.style.boxShadow = "0 4px 20px rgba(15,23,42,0.03)";
                }}
              >
                {tag && (
                  <span style={{
                    position: "absolute", top: 16, right: 16,
                    background: C.vault, border: `1px solid ${C.borderHi}`,
                    color: C.teal, fontSize: 9, fontWeight: 800,
                    padding: "2px 8px", borderRadius: 10, textTransform: "uppercase",
                  }}>{tag}</span>
                )}
                <div style={{
                  width: 48, height: 48, borderRadius: 12,
                  background: C.vault, border: `1px solid ${C.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 22, marginBottom: 16,
                }}>{icon}</div>
                <div style={{ color: C.espresso, fontSize: 16, fontWeight: 800, marginBottom: 8 }}>{title}</div>
                <div style={{ color: C.textMid, fontSize: 14, lineHeight: 1.6 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ HOW IT WORKS ═════════════════════════════════ */}
      <section id="how-it-works" style={{
        padding: "100px 5vw", background: C.vault,
        borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 60 }}>
            <div style={{
              color: C.teal, fontSize: 12, fontWeight: 800,
              textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10,
            }}>GET STARTED IN 5 MINUTES</div>
            <h2 style={{ fontSize: "clamp(26px, 3vw, 40px)", fontWeight: 900, margin: 0 }}>
              How Hey Nikki Works
            </h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
            {[
              { num: "01", icon: "🏢", title: "Set Up Profile", desc: "Business hours, FAQs, services, and preferred Telugu voice — done in 5 minutes." },
              { num: "02", icon: "📞", title: "Get Virtual Number", desc: "Dedicated Jio/Vi Enterprise SIP trunk DID. This becomes your single brand number." },
              { num: "03", icon: "🤖", title: "Nikki Answers Calls", desc: "Every inbound call answered sub-second in natural Telugu/English with live AI." },
              { num: "04", icon: "💬", title: "WhatsApp + CRM", desc: "Confirmed bookings get WhatsApp confirmation. Hot leads go to your sales dashboard." },
            ].map(({ num, icon, title, desc }) => (
              <div key={num} style={{
                background: "#fff", border: `1px solid ${C.border}`,
                borderRadius: 14, padding: "28px 22px",
                boxShadow: "0 4px 16px rgba(0,0,0,0.02)",
              }}>
                <div style={{
                  color: C.terracotta, fontSize: 11, fontWeight: 900,
                  textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14,
                }}>STEP {num}</div>
                <div style={{ fontSize: 28, marginBottom: 14 }}>{icon}</div>
                <div style={{ color: C.espresso, fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{title}</div>
                <div style={{ color: C.textMid, fontSize: 13, lineHeight: 1.6 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PRICING ══════════════════════════════════════ */}
      <section id="pricing" style={{ padding: "100px 5vw" }}>
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
                borderRadius: 16, padding: "36px 28px",
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
                <div style={{
                  display: "flex", alignItems: "flex-end", gap: 4, marginBottom: 28,
                }}>
                  <span style={{ fontSize: 40, fontWeight: 900, lineHeight: 1 }}>{price}</span>
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
                  display: "block", padding: "13px 0", borderRadius: 10,
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

      {/* ═══ CTA BANNER ═══════════════════════════════════ */}
      <section style={{
        padding: "80px 5vw",
        background: `linear-gradient(135deg, ${C.teal}, ${C.tealLight})`,
        textAlign: "center",
      }}>
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <h2 style={{
            color: "#fff", fontSize: "clamp(26px, 3vw, 40px)",
            fontWeight: 900, margin: "0 0 16px", lineHeight: 1.2,
          }}>
            Stop Losing Customers to Missed Calls.
          </h2>
          <p style={{
            color: "rgba(255,255,255,0.8)", fontSize: 16,
            marginBottom: 36, lineHeight: 1.6,
          }}>
            Every missed call is a lost customer. Nikki ensures that never happens — answering in Telugu & English, 24 hours a day, 7 days a week.
          </p>
          <a href="/signup" style={{
            display: "inline-block", padding: "16px 36px", borderRadius: 10,
            background: C.terracotta, color: "#fff",
            fontSize: 16, fontWeight: 800, textDecoration: "none",
            boxShadow: "0 8px 24px rgba(229,83,61,0.4)",
          }}>
            Start Your Free Trial Today →
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
