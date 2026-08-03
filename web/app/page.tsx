"use client";
import { useState, useEffect } from "react";
import NikkiLogo from "../components/NikkiLogo";
import VoiceChatWidget from "../components/VoiceChatWidget";

// ── Hey Nikki Official Brand Palette ──────────────────────────
const J = {
  bg:         "#FFFFFF",
  vault:      "#F6F8FB",
  surface:    "#FFFFFF",
  border:     "#E2E8F0",
  borderHi:   "#CBD5E1",
  teal:       "#12457A",
  terracotta: "#E5533D",
  espresso:   "#0F172A",
  textMid:    "#475569",
  textDim:    "#94A3B8",
  gold:       "#F59E0B",
  emerald:    "#10B981",
  cyan:       "#06B6D4",
  gradTeal:   "linear-gradient(135deg, #12457A 0%, #1D6FA5 100%)",
  gradHero:   "linear-gradient(180deg, #F6F8FB 0%, #FFFFFF 100%)",
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

// ── NavBar ───────────────────────────────────────────────────
function NavBar({ scrollY }: { scrollY: number }) {
  const solid = scrollY > 40;
  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 5vw", height: 68,
      background: solid ? "rgba(255, 255, 255, 0.95)" : J.vault,
      backdropFilter: solid ? "blur(12px)" : "none",
      borderBottom: `1px solid ${J.border}`,
      transition: "all 0.25s ease",
    }}>
      <NikkiLogo size={38} showText variant="horizontal" dark={false} />
      
      <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
        {[
          ["Features", "#features"],
          ["How it works", "#how-it-works"],
          ["Pricing", "#pricing"],
          ["Live Demo", "#demo"],
        ].map(([l, h]) => (
          <a key={l} href={h}
            style={{ color: J.espresso, fontSize: 14, textDecoration: "none", fontWeight: 600,
              transition: "color 0.2s" }}
            onMouseEnter={e => (e.currentTarget.style.color = J.terracotta)}
            onMouseLeave={e => (e.currentTarget.style.color = J.espresso)}>
            {l}
          </a>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <a href="/login" style={{
          padding: "9px 20px", borderRadius: 8, border: `1px solid ${J.borderHi}`,
          color: J.espresso, fontSize: 13, fontWeight: 700, textDecoration: "none",
          background: "#FFFFFF", transition: "all 0.2s",
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = J.teal; e.currentTarget.style.color = J.teal; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = J.borderHi; e.currentTarget.style.color = J.espresso; }}>
          Sign In
        </a>
        <a href="/signup" style={{
          padding: "9px 22px", borderRadius: 8,
          background: J.terracotta,
          color: "#FFFFFF", fontSize: 13, fontWeight: 700, textDecoration: "none",
          boxShadow: "0 4px 14px rgba(229, 83, 61, 0.3)",
          transition: "transform 0.15s",
        }}
          onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-1px)")}
          onMouseLeave={e => (e.currentTarget.style.transform = "translateY(0)")}>
          Start Free Trial
        </a>
      </div>
    </nav>
  );
}

// ── Feature Card ─────────────────────────────────────────────
function FeatureCard({ icon, title, desc, tag }: {
  icon: string; title: string; desc: string; tag?: string;
}) {
  return (
    <div style={{
      background: J.surface, border: `1px solid ${J.border}`,
      borderRadius: 14, padding: "28px 24px",
      transition: "all 0.25s ease",
      boxShadow: "0 4px 20px rgba(15, 23, 42, 0.03)",
      position: "relative",
    }}>
      {tag && (
        <span style={{
          position: "absolute", top: 16, right: 16,
          background: J.vault, border: `1px solid ${J.borderHi}`,
          color: J.teal, fontSize: 10, fontWeight: 800,
          padding: "2px 8px", borderRadius: 10, textTransform: "uppercase",
        }}>{tag}</span>
      )}
      <div style={{
        width: 48, height: 48, borderRadius: 12,
        background: J.vault, border: `1px solid ${J.border}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 22, marginBottom: 16,
      }}>{icon}</div>
      <div style={{ color: J.espresso, fontSize: 16, fontWeight: 800, marginBottom: 8 }}>{title}</div>
      <div style={{ color: J.textMid, fontSize: 14, lineHeight: 1.6 }}>{desc}</div>
    </div>
  );
}

// ── Stat Item ─────────────────────────────────────────────
function StatItem({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color: J.teal, fontSize: 38, fontWeight: 900, lineHeight: 1 }}>{value}</div>
      <div style={{ color: J.textMid, fontSize: 13, marginTop: 8, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

// ── Step Card ─────────────────────────────────────────────
function StepCard({ num, title, desc, icon }: { num: string; title: string; desc: string; icon: string }) {
  return (
    <div style={{
      background: J.surface, border: `1px solid ${J.border}`, borderRadius: 14,
      padding: "28px 22px", position: "relative",
      boxShadow: "0 4px 16px rgba(0,0,0,0.02)",
    }}>
      <div style={{
        color: J.terracotta, fontSize: 12, fontWeight: 900,
        marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.1em",
      }}>STEP {num}</div>
      <div style={{ fontSize: 26, marginBottom: 12 }}>{icon}</div>
      <div style={{ color: J.espresso, fontSize: 15, fontWeight: 800, marginBottom: 6 }}>{title}</div>
      <div style={{ color: J.textMid, fontSize: 13, lineHeight: 1.6 }}>{desc}</div>
    </div>
  );
}

// ── Pricing Card ──────────────────────────────────────────
function PricingCard({ plan, price, features, highlight = false, badge }: {
  plan: string; price: string; features: string[]; highlight?: boolean; badge?: string;
}) {
  return (
    <div style={{
      background: highlight ? J.teal : J.surface,
      border: `1px solid ${highlight ? J.teal : J.border}`,
      borderRadius: 16, padding: "32px 26px",
      color: highlight ? "#FFFFFF" : J.espresso,
      position: "relative",
      boxShadow: highlight ? "0 20px 40px rgba(18, 69, 122, 0.25)" : "0 4px 20px rgba(0,0,0,0.04)",
      transform: highlight ? "scale(1.03)" : "none",
    }}>
      {badge && (
        <div style={{
          position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)",
          background: J.terracotta, color: "#FFFFFF", fontSize: 11, fontWeight: 800,
          padding: "4px 14px", borderRadius: 20, textTransform: "uppercase",
        }}>{badge}</div>
      )}
      <div style={{ color: highlight ? "rgba(255,255,255,0.8)" : J.textMid, fontSize: 13,
        fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{plan}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, marginBottom: 24 }}>
        <span style={{ fontSize: 36, fontWeight: 900 }}>{price}</span>
        {price !== "Custom" && <span style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>/month</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
        {features.map(f => (
          <div key={f} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ color: highlight ? "#FFFFFF" : J.emerald, fontSize: 14, fontWeight: 900 }}>✓</span>
            <span style={{ fontSize: 13, opacity: highlight ? 0.95 : 0.85, lineHeight: 1.4 }}>{f}</span>
          </div>
        ))}
      </div>
      <a href="/signup" style={{
        display: "block", padding: "12px 0", borderRadius: 8, textAlign: "center",
        background: highlight ? J.terracotta : J.vault,
        border: highlight ? "none" : `1px solid ${J.borderHi}`,
        color: highlight ? "#FFFFFF" : J.espresso,
        fontSize: 14, fontWeight: 700, textDecoration: "none",
        transition: "all 0.2s",
      }}>
        {highlight ? "Start 14-Day Free Trial →" : "Get Started"}
      </a>
    </div>
  );
}

// ── MAIN LANDING PAGE ─────────────────────────────────────────
export default function LandingPage() {
  const scrollY = useScrollY();

  return (
    <div style={{
      background: J.bg, minHeight: "100vh",
      fontFamily: "'Inter', -apple-system, sans-serif",
      color: J.espresso, overflowX: "hidden",
    }}>
      <NavBar scrollY={scrollY} />

      {/* ── HERO SECTION ────────────────────────────────── */}
      <section style={{
        background: J.gradHero,
        padding: "130px 5vw 80px",
        borderBottom: `1px solid ${J.border}`,
      }}>
        <div style={{
          maxWidth: 1200, margin: "0 auto",
          display: "grid", gridTemplateColumns: "1.1fr 0.9fr",
          gap: 48, alignItems: "center",
        }}>
          {/* Left Hero Copy */}
          <div>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: J.vault, border: `1px solid ${J.borderHi}`,
              borderRadius: 20, padding: "6px 16px", marginBottom: 24,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: J.emerald }} />
              <span style={{ color: J.teal, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                AI Voice Receptionist · Live in Telugu & English
              </span>
            </div>

            <h1 style={{
              fontSize: "clamp(34px, 4.5vw, 54px)",
              fontWeight: 900, lineHeight: 1.12, margin: "0 0 20px",
              color: J.espresso, letterSpacing: "-0.02em",
            }}>
              Never Miss a <span style={{ color: J.terracotta }}>Business Call</span> Again.
            </h1>

            <p style={{
              color: J.textMid, fontSize: 17, lineHeight: 1.7, marginBottom: 36,
              maxWidth: 520, fontWeight: 400,
            }}>
              Hey Nikki is your 24/7 AI-powered receptionist. She answers calls in sub-second in <strong style={{ color: J.teal }}>Telugu & English</strong>, books appointments, and sends instant WhatsApp follow-ups — using your single dedicated business number.
            </p>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 40 }}>
              <a href="/signup" style={{
                padding: "14px 30px", borderRadius: 8,
                background: J.terracotta, color: "#FFFFFF",
                fontSize: 15, fontWeight: 800, textDecoration: "none",
                boxShadow: "0 8px 24px rgba(229, 83, 61, 0.3)",
              }}>
                🚀 Start Free Trial
              </a>
              <a href="#demo" style={{
                padding: "14px 26px", borderRadius: 8,
                background: J.vault, border: `1px solid ${J.borderHi}`,
                color: J.espresso, fontSize: 15, fontWeight: 700, textDecoration: "none",
              }}>
                🎙️ Test Live Agent
              </a>
            </div>

            {/* Badges */}
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", borderTop: `1px solid ${J.border}`, paddingTop: 24 }}>
              {["✅ No credit card required", "✅ Single Jio/Vi DID number", "✅ Auto WhatsApp follow-up"].map(b => (
                <span key={b} style={{ color: J.textMid, fontSize: 12, fontWeight: 600 }}>{b}</span>
              ))}
            </div>
          </div>

          {/* Right Hero: Live Voice Agent */}
          <div id="demo" style={{ display: "flex", flexDirect: "column", alignItems: "center" }}>
            <VoiceChatWidget />
          </div>
        </div>
      </section>

      {/* ── STATS ROW ───────────────────────────────────── */}
      <section style={{
        padding: "50px 5vw",
        background: J.vault,
        borderBottom: `1px solid ${J.border}`,
      }}>
        <div style={{
          maxWidth: 1100, margin: "0 auto",
          display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 32,
        }}>
          <StatItem value="< 1 sec" label="Sub-second AI answer time" />
          <StatItem value="24 / 7"  label="Always-on receptionist" />
          <StatItem value="3×"      label="Higher lead capture rate" />
          <StatItem value="100%"    label="WhatsApp delivery sync" />
        </div>
      </section>

      {/* ── FEATURES GRID ───────────────────────────────── */}
      <section id="features" style={{ padding: "90px 5vw", background: J.bg }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 60 }}>
            <div style={{ color: J.terracotta, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
              COMPLETE CRM & VOICE PLATFORM
            </div>
            <h2 style={{ fontSize: "clamp(26px, 3.5vw, 42px)", fontWeight: 900, color: J.espresso, margin: 0 }}>
              Two Brains. Two Eyes. <span style={{ color: J.teal }}>One Brand Number.</span>
            </h2>
            <p style={{ color: J.textMid, fontSize: 15, maxWidth: 620, margin: "12px auto 0", lineHeight: 1.6 }}>
              AI answers inbound calls sub-second. Your sales team makes human outbound calls via Click-to-Call. Every interaction runs through your single dedicated Jio/Vi virtual number.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
            <FeatureCard icon="🎙️" tag="Sub-Second"
              title="Telugu & English Voice AI"
              desc="Nikki speaks natural Telugu, English, and Tanglish with regional accent support. Automatic TRAI disclosure built in." />
            <FeatureCard icon="📅" tag="Automated"
              title="Instant Appointment Booking"
              desc="Captures caller name, preferred date, time slot, and service. Updates your dashboard and confirms via WhatsApp." />
            <FeatureCard icon="💬" tag="WhatsApp"
              title="WhatsApp Dispatch Panel"
              desc="Auto-sends brochure PDFs, appointment confirmations, and missed call follow-ups using approved Meta templates." />
            <FeatureCard icon="📞" tag="Human CTC"
              title="Click-to-Call (Masked CLI)"
              desc="Your human team calls leads straight from the dashboard with masked caller ID and instant disposition logging." />
            <FeatureCard icon="🔄" tag="Active-Active"
              title="Jio & Vi Dual Trunk Failover"
              desc="Primary SIP trunk on Jio Enterprise. Instant active-active failover to Vi Business so you never drop a call." />
            <FeatureCard icon="📊" tag="ROI Metrics"
              title="ROI Analytics Dashboard"
              desc="Tracks human receptionist salary saved (₹35 vs ₹4 AI cost), conversion rates, peak hours, and WhatsApp delivery." />
            <FeatureCard icon="📵" tag="Missed Guard"
              title="Missed Call Guard"
              desc="If a caller hangs up before 20s, Nikki automatically triggers a WhatsApp follow-up message so no lead is lost." />
            <FeatureCard icon="🔒" tag="Cloudflare R2"
              title="Encrypted Call Recordings"
              desc="Every call recorded, encrypted, and offloaded to Cloudflare R2 with zero egress costs and GDPR compliance." />
            <FeatureCard icon="⚙️" tag="Self-Service"
              title="Full Self-Service Control"
              desc="Update FAQs, timings, missed call guard timeouts, and WhatsApp templates right from your client portal." />
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ────────────────────────────────── */}
      <section id="how-it-works" style={{
        padding: "90px 5vw",
        background: J.vault,
        borderTop: `1px solid ${J.border}`,
        borderBottom: `1px solid ${J.border}`,
      }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 54 }}>
            <div style={{ color: J.teal, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
              SIMPLE 4-STEP ONBOARDING
            </div>
            <h2 style={{ fontSize: "clamp(24px, 3vw, 38px)", fontWeight: 900, color: J.espresso, margin: 0 }}>
              How Hey Nikki Works
            </h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
            <StepCard num="01" icon="🏢" title="Configure Profile" desc="Set your business hours, FAQs, services, and preferred voice in 5 minutes." />
            <StepCard num="02" icon="📞" title="Assign Virtual Number" desc="Get your dedicated Jio/Vi Enterprise SIP trunk virtual DID number." />
            <StepCard num="03" icon="🤖" title="Nikki Handles Calls" desc="Inbound calls are answered sub-second in Telugu/English with automatic AI logging." />
            <StepCard num="04" icon="💬" title="WhatsApp & CTC" desc="Confirmed bookings get WhatsApp confirmations; hot leads are handed over to your human sales floor." />
          </div>
        </div>
      </section>

      {/* ── PRICING SECTION ─────────────────────────────── */}
      <section id="pricing" style={{ padding: "90px 5vw", background: J.bg }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 60 }}>
            <div style={{ color: J.terracotta, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
              TRANSPARENT PRICING
            </div>
            <h2 style={{ fontSize: "clamp(26px, 3.5vw, 42px)", fontWeight: 900, color: J.espresso, margin: 0 }}>
              Plans Built for Every Business
            </h2>
            <p style={{ color: J.textMid, fontSize: 15, margin: "10px auto 0" }}>
              Start with a 14-day free trial. Upgrade or cancel anytime.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24, alignItems: "center" }}>
            <PricingCard
              plan="Starter"
              price="₹2,999"
              features={[
                "1 AI Voice Profile",
                "500 AI-handled calls/month",
                "WhatsApp appointment sync",
                "Basic Lead CRM",
                "Email & Chat Support",
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
                "WhatsApp Dispatch Panel",
                "Missed Call Guard",
                "ROI Analytics Dashboard",
                "Jio + Vi Dual Trunk Failover",
              ]} />
            <PricingCard
              plan="Scale"
              price="₹14,999"
              features={[
                "Unlimited Voice Profiles",
                "5,000 AI-handled calls/month",
                "Dedicated Account Manager",
                "Custom WhatsApp Templates",
                "FreeSWITCH ESL Outbound API",
                "Cloudflare R2 Direct Sync",
              ]} />
          </div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────── */}
      <footer style={{
        padding: "40px 5vw", background: J.vault, borderTop: `1px solid ${J.border}`,
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16,
      }}>
        <NikkiLogo size={32} showText variant="horizontal" dark={false} />
        <div style={{ display: "flex", gap: 24 }}>
          {["Privacy Policy", "Terms of Service", "Refund Policy", "Contact"].map(l => (
            <a key={l} href={`/${l.toLowerCase().replace(/ /g,"-")}`} style={{ color: J.textMid, fontSize: 12, textDecoration: "none", fontWeight: 500 }}>
              {l}
            </a>
          ))}
        </div>
        <div style={{ color: J.textDim, fontSize: 12 }}>
          © 2026 Hey Nikki · Enterprise Voice AI & Omnichannel CRM
        </div>
      </footer>
    </div>
  );
}
