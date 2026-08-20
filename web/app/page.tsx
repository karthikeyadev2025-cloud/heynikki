"use client";
// web/app/page.tsx — heynikki.in
// ────────────────────────────────────────────────────────────────
// The page has one job: make a Telugu business owner believe the AI
// actually speaks their language, then sign up.
//
// So the hero doesn't describe the product — it IS the product. The
// page opens with a phone ringing and hands the visitor the call.
// Everything below the fold answers the questions a person asks
// *after* they've heard it work.
//
// Structure follows a call's real lifecycle (Ringing → Live → On
// WhatsApp), because that genuinely is a sequence — not decoration.
// ────────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import CallConsole from "../components/CallConsole";
import NikkiLogo from "../components/NikkiLogo";
import {
  Phone, Users, ShieldCheck, MessageCircle, Languages,
  Clock, ArrowRight, Plus, Minus, IndianRupee,
} from "lucide-react";

const C = {
  ink:       "#0B1F33",
  teal:      "#12457A",
  live:      "#22C55E",
  marigold:  "#E9A72C",
  red:       "#E5533D",
  paper:     "#F7F5F0",
  card:      "#FFFFFF",
  line:      "#E4E0D8",
  text:      "#101B25",
  textMid:   "#5A6672",
  textDim:   "#8B96A2",
};

const D  = "var(--font-display), Georgia, serif";
const BD = "var(--font-body), system-ui, sans-serif";
const M  = "var(--font-mono), ui-monospace, monospace";

// ── Shared pieces ─────────────────────────────────────────────
function Eyebrow({ children, tone = C.teal }: { children: React.ReactNode; tone?: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      fontFamily: M, fontSize: 11, letterSpacing: "0.14em",
      textTransform: "uppercase", color: tone, fontWeight: 500,
    }}>
      <span aria-hidden style={{ width: 18, height: 1, background: tone, opacity: 0.5 }} />
      {children}
    </span>
  );
}

function Section({ id, bg, children, style }: {
  id?: string; bg?: string; children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <section id={id} style={{ background: bg || C.paper, padding: "clamp(64px, 9vw, 108px) 5vw", ...style }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>{children}</div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════
export default function Home() {
  const [dailyCalls, setDailyCalls] = useState(40);
  const [dealValue, setDealValue]   = useState(2000);
  const [openFaq, setOpenFaq]       = useState<number | null>(0);
  const [scrolled, setScrolled]     = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Deliberately framed as revenue recovered, NOT as a cost comparison.
  // The previous version computed "Hey Nikki: dailyCalls * 30 * 4" — which
  // published our per-call cost basis on the marketing page, directly
  // beside the ₹5,999 plan price. Any prospect could divide the two and
  // read our margin, and it invites "why is it 4 rupees but you charge me
  // 6 thousand". What the customer actually cares about is the business
  // they're currently losing, so that's what this shows.
  const missedPerDay   = Math.round(dailyCalls * 0.3);
  const missedMonthly  = missedPerDay * 30;
  // Conversion rate on a recovered missed call, kept conservative on
  // purpose — an inflated number here reads as a sales pitch.
  const recoveredDeals = Math.round(missedMonthly * 0.2);
  const recovered      = recoveredDeals * dealValue;

  return (
    <main style={{ background: C.paper, color: C.text, fontFamily: BD, overflowX: "hidden" }}>

      {/* ══ NAV ══════════════════════════════════════════════ */}
      <header style={{
        position: "sticky", top: 0, zIndex: 60,
        background: scrolled ? "rgba(247,245,240,0.86)" : "transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        borderBottom: `1px solid ${scrolled ? C.line : "transparent"}`,
        transition: "background 240ms, border-color 240ms",
      }}>
        <nav style={{
          maxWidth: 1180, margin: "0 auto", padding: "16px 5vw",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20,
        }}>
          <a href="/" aria-label="Hey Nikki home" style={{ textDecoration: "none" }}>
            <NikkiLogo size={34} />
          </a>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {[
              ["How it works", "#how"],
              ["Pricing", "#pricing"],
              ["Questions", "#faq"],
            ].map(([label, href]) => (
              <a key={label} href={href} className="nk-navlink" style={{
                padding: "8px 13px", fontSize: 13.5, color: C.textMid,
                textDecoration: "none", borderRadius: 8,
              }}>{label}</a>
            ))}
            <a href="/login" className="nk-navlink" style={{
              padding: "8px 13px", fontSize: 13.5, color: C.textMid, textDecoration: "none",
            }}>Sign in</a>
            <a href="/signup" style={{
              padding: "10px 18px", background: C.ink, color: "#fff", borderRadius: 999,
              fontSize: 13.5, fontWeight: 600, textDecoration: "none",
            }}>Get a number</a>
          </div>
        </nav>
      </header>

      {/* ══ HERO — the console is the argument ═══════════════ */}
      <section style={{ padding: "clamp(28px, 5vw, 64px) 5vw clamp(56px, 7vw, 88px)" }}>
        <div className="nk-hero" style={{
          maxWidth: 1180, margin: "0 auto",
          display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.05fr)",
          gap: "clamp(32px, 5vw, 64px)", alignItems: "center",
        }}>
          <div>
            <Eyebrow>Telugu · Hindi · English</Eyebrow>

            <h1 style={{
              fontFamily: D, fontSize: "clamp(38px, 5.6vw, 68px)", lineHeight: 1.02,
              letterSpacing: "-0.035em", fontWeight: 700, margin: "20px 0 0", color: C.ink,
            }}>
              Every missed call<br />
              was someone<br />
              <span style={{ color: C.teal, fontStyle: "italic" }}>ready to buy.</span>
            </h1>

            <p style={{ fontSize: 17.5, lineHeight: 1.65, color: C.textMid, margin: "22px 0 0", maxWidth: 460 }}>
              Nikki answers your business number in real Telugu — books the appointment,
              captures the number, sends the WhatsApp. Not a phonetic impression of Telugu.
              The actual language your customers call you in.
            </p>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "30px 0 0" }}>
              <a href="/signup" style={{
                display: "inline-flex", alignItems: "center", gap: 9,
                padding: "15px 26px", background: C.ink, color: "#fff",
                borderRadius: 999, textDecoration: "none", fontSize: 15, fontWeight: 650,
              }}>
                Put Nikki on my number <ArrowRight size={16} />
              </a>
              <a href="#how" style={{
                display: "inline-flex", alignItems: "center", gap: 9,
                padding: "15px 24px", border: `1px solid ${C.line}`, color: C.text,
                borderRadius: 999, textDecoration: "none", fontSize: 15, fontWeight: 600,
                background: C.card,
              }}>
                How it works
              </a>
            </div>

            <p style={{ margin: "22px 0 0", fontFamily: M, fontSize: 12, color: C.textDim, letterSpacing: "0.04em" }}>
              Live in 60 seconds · Keep your existing number · No app for your customers
            </p>
          </div>

          <CallConsole />
        </div>
      </section>

      {/* ══ PROOF STRIP ═════════════════════════════════════ */}
      <div style={{ borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, background: C.card }}>
        <div style={{
          maxWidth: 1180, margin: "0 auto", padding: "28px 5vw",
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 26,
        }}>
          {[
            ["< 700 ms", "First reply to the caller"],
            ["Every call", "Answered, logged, followed up"],
            ["24 / 7", "Including Sunday, 2 AM, festival days"],
            ["3 languages", "Switched mid-sentence, mid-call"],
          ].map(([big, small]) => (
            <div key={big}>
              <div style={{
                fontFamily: M, fontSize: 24, fontWeight: 500, color: C.ink,
                letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums",
              }}>{big}</div>
              <div style={{ fontSize: 13, color: C.textMid, marginTop: 5, lineHeight: 1.45 }}>{small}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ══ HOW IT WORKS — a real sequence, so numbered ══════ */}
      <Section id="how">
        <Eyebrow>What happens on the call</Eyebrow>
        <h2 style={{
          fontFamily: D, fontSize: "clamp(30px, 4vw, 46px)", lineHeight: 1.1,
          letterSpacing: "-0.03em", fontWeight: 700, margin: "18px 0 12px", color: C.ink,
        }}>
          Three states. That's the whole product.
        </h2>
        <p style={{ fontSize: 16.5, color: C.textMid, maxWidth: 560, lineHeight: 1.65, margin: "0 0 46px" }}>
          A call is a sequence, so this one is numbered. Everything Nikki does happens
          inside these three moments.
        </p>

        <ol style={{
          listStyle: "none", padding: 0, margin: 0,
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 1,
          background: C.line, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden",
        }}>
          {[
            {
              n: "01", state: "Ringing", tone: C.marigold, icon: Phone,
              title: "The call arrives on your own number",
              body: "Your existing business line, forwarded or fully ported. Customers dial the number already on your board and your cards. Nothing about the number changes.",
            },
            {
              n: "02", state: "Live", tone: C.live, icon: Languages,
              title: "Nikki talks, in the caller's language",
              body: "Telugu by default, switching to Hindi or English the moment the caller does. She asks for the name, the number, the service and the slot — and handles the caller who answers three of those in one breath.",
            },
            {
              n: "03", state: "On WhatsApp", tone: C.teal, icon: MessageCircle,
              title: "The confirmation lands before they hang up",
              body: "Appointment written to your dashboard, WhatsApp confirmation sent, recording and transcript stored. If nobody picked up at all, the missed-call follow-up fires on its own.",
            },
          ].map(({ n, state, tone, icon: Icon, title, body }) => (
            <li key={n} style={{ background: C.card, padding: "30px 26px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <span style={{ fontFamily: M, fontSize: 12, color: C.textDim, letterSpacing: "0.1em" }}>{n}</span>
                <span aria-hidden style={{ flex: 1, height: 1, background: C.line }} />
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  fontFamily: M, fontSize: 10.5, letterSpacing: "0.12em",
                  textTransform: "uppercase", color: tone, fontWeight: 600,
                }}>
                  <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: tone }} />
                  {state}
                </span>
              </div>
              <Icon size={20} color={C.ink} strokeWidth={1.6} />
              <h3 style={{
                fontFamily: D, fontSize: 20, lineHeight: 1.28, fontWeight: 650,
                margin: "14px 0 9px", color: C.ink, letterSpacing: "-0.02em",
              }}>{title}</h3>
              <p style={{ fontSize: 14.5, lineHeight: 1.65, color: C.textMid, margin: 0 }}>{body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* ══ TWO BRAINS ══════════════════════════════════════ */}
      <Section bg={C.ink} style={{ color: "#fff" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "clamp(30px, 5vw, 60px)", alignItems: "center" }}>
          <div>
            <Eyebrow tone={C.marigold}>The part nobody else does</Eyebrow>
            <h2 style={{
              fontFamily: D, fontSize: "clamp(30px, 4vw, 46px)", lineHeight: 1.1,
              letterSpacing: "-0.03em", fontWeight: 700, margin: "18px 0 16px", color: "#fff",
            }}>
              Two brains.<br />One brand number.
            </h2>
            <p style={{ fontSize: 16.5, lineHeight: 1.7, color: "rgba(255,255,255,0.62)", margin: "0 0 22px" }}>
              Most AI receptionists make you choose: the bot handles everything, or your
              staff do. Nikki runs both off a single number and decides per call.
            </p>
            <p style={{ fontSize: 16.5, lineHeight: 1.7, color: "rgba(255,255,255,0.62)", margin: 0 }}>
              Routine bookings go to the AI. A caller who says{" "}
              <em style={{ color: C.marigold, fontStyle: "normal" }}>&ldquo;manishitho matladali&rdquo;</em>{" "}
              gets a human — with the customer&apos;s history already on screen when their phone rings.
            </p>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            {[
              { icon: Languages,   t: "AI brain", d: "Answers, qualifies, books, confirms. Never on a break, never annoyed at 11 PM." },
              { icon: Users,       t: "Human brain", d: "Your telecaller, with click-to-call and the full transcript already loaded." },
              { icon: ShieldCheck, t: "One number, one identity", d: "The caller never learns which one they got. Your brand stays intact either way." },
            ].map(({ icon: Icon, t, d }) => (
              <div key={t} style={{
                display: "flex", gap: 15, padding: "19px 20px",
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)",
                borderRadius: 13,
              }}>
                <Icon size={19} color={C.marigold} strokeWidth={1.7} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontWeight: 650, fontSize: 15.5, marginBottom: 4 }}>{t}</div>
                  <div style={{ fontSize: 14, lineHeight: 1.6, color: "rgba(255,255,255,0.55)" }}>{d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ══ ROI ═════════════════════════════════════════════ */}
      <Section id="roi" bg={C.card}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "clamp(30px, 5vw, 60px)", alignItems: "center" }}>
          <div>
            <Eyebrow>Your numbers</Eyebrow>
            <h2 style={{
              fontFamily: D, fontSize: "clamp(28px, 3.6vw, 42px)", lineHeight: 1.12,
              letterSpacing: "-0.03em", fontWeight: 700, margin: "18px 0 14px", color: C.ink,
            }}>
              What is a missed call worth to you?
            </h2>
            <p style={{ fontSize: 16, lineHeight: 1.65, color: C.textMid, margin: "0 0 30px" }}>
              Indian SMBs miss roughly 3 in 10 inbound calls — lunch, a walk-in
              customer, a second line already busy. Those callers don&apos;t leave a
              voicemail. They call the next business on the list.
            </p>

            <label htmlFor="calls" style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              marginBottom: 10, fontSize: 14, color: C.textMid,
            }}>
              <span>Calls per day</span>
              <span style={{ fontFamily: M, fontSize: 22, color: C.ink, fontVariantNumeric: "tabular-nums" }}>
                {dailyCalls}
              </span>
            </label>
            <input
              id="calls" type="range" min={10} max={300} step={5}
              value={dailyCalls}
              onChange={(e) => setDailyCalls(Number(e.target.value))}
              className="nk-range" style={{ width: "100%" }}
            />

            <label htmlFor="deal" style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              margin: "26px 0 10px", fontSize: 14, color: C.textMid,
            }}>
              <span>Average value of one customer</span>
              <span style={{ fontFamily: M, fontSize: 22, color: C.ink, fontVariantNumeric: "tabular-nums" }}>
                ₹{dealValue.toLocaleString("en-IN")}
              </span>
            </label>
            <input
              id="deal" type="range" min={500} max={50000} step={500}
              value={dealValue}
              onChange={(e) => setDealValue(Number(e.target.value))}
              className="nk-range" style={{ width: "100%" }}
            />
          </div>

          <div style={{ border: `1px solid ${C.line}`, borderRadius: 18, overflow: "hidden", background: C.paper }}>
            {([
              ["Calls ringing out, per day",   `${missedPerDay}`],
              ["Missed calls, per month",      `${missedMonthly}`],
              ["Customers you could recover",  `${recoveredDeals}`],
            ] as [string, string][]).map(([label, val]) => (
              <div key={label} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "17px 22px", borderBottom: `1px solid ${C.line}`,
              }}>
                <span style={{ fontSize: 14.5, color: C.textMid }}>{label}</span>
                <span style={{
                  fontFamily: M, fontSize: 16.5, fontWeight: 600, color: C.ink,
                  fontVariantNumeric: "tabular-nums",
                }}>{val}</span>
              </div>
            ))}
            <div style={{ padding: "26px 22px", background: C.ink, color: "#fff" }}>
              <div style={{
                fontFamily: M, fontSize: 11, letterSpacing: "0.14em",
                textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 8,
              }}>
                Business currently walking away
              </div>
              <div style={{
                fontFamily: D, fontSize: "clamp(34px, 5vw, 48px)", fontWeight: 700,
                letterSpacing: "-0.03em", display: "flex", alignItems: "center", gap: 2,
              }}>
                <IndianRupee size={30} strokeWidth={2.2} />
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{recovered.toLocaleString("en-IN")}</span>
                <span style={{ fontSize: 16, fontWeight: 500, opacity: 0.5, marginLeft: 6, alignSelf: "flex-end", paddingBottom: 8 }}>
                  / month
                </span>
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.55 }}>
                Assumes 1 in 5 recovered calls becomes a customer. Your own rate is
                probably higher — these are people who called you first.
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Section id="pricing">
        <Eyebrow>Pricing</Eyebrow>
        <h2 style={{
          fontFamily: D, fontSize: "clamp(30px, 4vw, 46px)", lineHeight: 1.1,
          letterSpacing: "-0.03em", fontWeight: 700, margin: "18px 0 46px", color: C.ink,
        }}>
          Pick what you actually need.
        </h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(268px, 1fr))", gap: 18 }}>
          {[
            {
              name: "AI Telecaller", price: "5,999", note: "per month",
              highlight: true, badge: "Most businesses start here",
              points: ["Unlimited inbound on one number", "Telugu, Hindi and English", "Appointments to your dashboard", "WhatsApp confirmation on every booking", "Recordings and transcripts"],
            },
            {
              name: "Human CRM Seat", price: "1,999", note: "per seat / month",
              points: ["Click-to-call from the lead list", "Caller history on screen before pickup", "Call disposition and notes", "Shared pipeline with your team"],
            },
            {
              name: "Dedicated Business Number", price: "1,999", note: "per number / month",
              points: ["A new business number, yours", "Or port the number you already use", "Masked outbound caller ID", "Automatic carrier failover"],
            },
          ].map((p) => (
            <div key={p.name} style={{
              background: p.highlight ? C.ink : C.card,
              color: p.highlight ? "#fff" : C.text,
              border: `1px solid ${p.highlight ? C.ink : C.line}`,
              borderRadius: 18, padding: "28px 24px",
              display: "flex", flexDirection: "column",
            }}>
              {p.badge && (
                <span style={{
                  alignSelf: "flex-start", marginBottom: 14, padding: "5px 11px",
                  borderRadius: 999, background: C.marigold, color: "#2A1B00",
                  fontFamily: M, fontSize: 10.5, fontWeight: 700,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                }}>{p.badge}</span>
              )}
              <h3 style={{ fontFamily: D, fontSize: 21, fontWeight: 650, margin: "0 0 12px", letterSpacing: "-0.02em" }}>
                {p.name}
              </h3>
              <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginBottom: 4 }}>
                <span style={{ fontSize: 19, opacity: 0.7 }}>₹</span>
                <span style={{ fontFamily: M, fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em" }}>{p.price}</span>
              </div>
              <div style={{ fontSize: 13, opacity: 0.55, marginBottom: 22 }}>{p.note}</div>

              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px", display: "grid", gap: 10, flex: 1 }}>
                {p.points.map((pt) => (
                  <li key={pt} style={{
                    display: "flex", gap: 10, fontSize: 14, lineHeight: 1.55,
                    opacity: p.highlight ? 0.82 : 1, color: p.highlight ? "#fff" : C.textMid,
                  }}>
                    <span aria-hidden style={{
                      width: 5, height: 5, borderRadius: "50%", flexShrink: 0, marginTop: 8,
                      background: p.highlight ? C.marigold : C.teal,
                    }} />
                    {pt}
                  </li>
                ))}
              </ul>

              <a href="/signup" style={{
                display: "block", textAlign: "center", padding: "13px 20px", borderRadius: 999,
                textDecoration: "none", fontSize: 14.5, fontWeight: 650,
                background: p.highlight ? C.marigold : "transparent",
                color: p.highlight ? "#2A1B00" : C.ink,
                border: p.highlight ? "none" : `1px solid ${C.line}`,
              }}>
                Get started
              </a>
            </div>
          ))}
        </div>

        <p style={{ marginTop: 22, fontSize: 13.5, color: C.textDim, fontFamily: M }}>
          GST extra · Cancel any month · Your call recordings stay yours
        </p>
      </Section>

      {/* ══ FAQ ═════════════════════════════════════════════ */}
      <Section id="faq" bg={C.card}>
        <Eyebrow>Questions people actually ask</Eyebrow>
        <h2 style={{
          fontFamily: D, fontSize: "clamp(28px, 3.6vw, 42px)", lineHeight: 1.12,
          letterSpacing: "-0.03em", fontWeight: 700, margin: "18px 0 40px", color: C.ink,
        }}>
          Before you hand over your number.
        </h2>

        <div style={{ borderTop: `1px solid ${C.line}` }}>
          {[
            {
              q: "Is it really Telugu, or English with a Telugu accent?",
              a: "Really Telugu. The speech model is trained on Telugu, not on English text spelled out phonetically. She handles the Telangana and coastal Andhra differences, and switches to Hindi or English the moment your caller does.",
            },
            {
              q: "Do I have to change my number?",
              a: "No. Forward your existing number to Nikki, or port it fully — both work. Your board, your cards and your Google listing all stay exactly as they are.",
            },
            {
              q: "What happens when Nikki doesn't understand?",
              a: "She asks once, plainly. If it's still unclear, or the caller asks for a person, the call goes to your telecaller with the transcript already on their screen. She doesn't invent an answer to get off the call.",
            },
            {
              q: "Do my callers know it's an AI?",
              a: "Yes — TRAI requires disclosure at the start of every automated call, and Nikki does it. In practice callers keep talking anyway, because the booking gets done in under a minute.",
            },
            {
              q: "Who can hear my call recordings?",
              a: "You. Recordings are encrypted and stored against your account only — no other business on the platform can reach them. Export or delete them whenever you want.",
            },
          ].map((item, i) => {
            const open = openFaq === i;
            return (
              <div key={i} style={{ borderBottom: `1px solid ${C.line}` }}>
                <button
                  onClick={() => setOpenFaq(open ? null : i)}
                  aria-expanded={open}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: 20, padding: "22px 2px", background: "none", border: "none",
                    cursor: "pointer", textAlign: "left", color: C.ink,
                    fontSize: 17, fontWeight: 600, fontFamily: BD, lineHeight: 1.4,
                  }}
                >
                  {item.q}
                  {open ? <Minus size={17} color={C.textDim} style={{ flexShrink: 0 }} />
                        : <Plus  size={17} color={C.textDim} style={{ flexShrink: 0 }} />}
                </button>
                {open && (
                  <p style={{
                    margin: "0 0 24px", padding: "0 2px", maxWidth: 680,
                    fontSize: 15.5, lineHeight: 1.7, color: C.textMid,
                  }}>{item.a}</p>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* ══ CLOSING ═════════════════════════════════════════ */}
      <Section bg={C.ink} style={{ textAlign: "center" }}>
        <Eyebrow tone={C.marigold}>One number. Nobody on hold.</Eyebrow>
        <h2 style={{
          fontFamily: D, fontSize: "clamp(32px, 5vw, 56px)", lineHeight: 1.06,
          letterSpacing: "-0.035em", fontWeight: 700, margin: "20px auto 18px",
          color: "#fff", maxWidth: 720,
        }}>
          Your phone is ringing right now.
        </h2>
        <p style={{
          fontSize: 17, lineHeight: 1.65, color: "rgba(255,255,255,0.6)",
          maxWidth: 480, margin: "0 auto 32px",
        }}>
          Sixty seconds to set up. Keep the number you already have.
        </p>
        <a href="/signup" style={{
          display: "inline-flex", alignItems: "center", gap: 10,
          padding: "16px 30px", background: C.marigold, color: "#2A1B00",
          borderRadius: 999, textDecoration: "none", fontSize: 16, fontWeight: 700,
        }}>
          Put Nikki on my number <ArrowRight size={17} />
        </a>
        <div style={{
          marginTop: 24, display: "inline-flex", alignItems: "center", gap: 8,
          color: "rgba(255,255,255,0.4)", fontFamily: M, fontSize: 12,
        }}>
          <Clock size={13} /> Most businesses are live before their next call
        </div>
      </Section>

      {/* ══ FOOTER ══════════════════════════════════════════ */}
      <footer style={{ background: C.ink, borderTop: "1px solid rgba(255,255,255,0.08)", padding: "34px 5vw" }}>
        <div style={{
          maxWidth: 1180, margin: "0 auto", display: "flex", flexWrap: "wrap",
          gap: 18, alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontFamily: M, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
            © {new Date().getFullYear()} Hey Nikki · Hyderabad
          </span>
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
            {["Privacy", "Terms", "Refund Policy", "Contact"].map((l) => (
              <a key={l} href={`/${l.toLowerCase().replace(/ /g, "-")}`} style={{
                fontSize: 13, color: "rgba(255,255,255,0.5)", textDecoration: "none",
              }}>{l}</a>
            ))}
          </div>
        </div>
      </footer>

      <style>{`
        .nk-navlink:hover { background: rgba(0,0,0,0.04); color: ${C.ink}; }
        a:focus-visible, button:focus-visible, input:focus-visible {
          outline: 2px solid ${C.teal};
          outline-offset: 3px;
          border-radius: 6px;
        }
        .nk-range {
          -webkit-appearance: none; appearance: none;
          height: 4px; border-radius: 999px; background: ${C.line};
          outline: none; cursor: pointer;
        }
        .nk-range::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 22px; height: 22px; border-radius: 50%;
          background: ${C.ink}; border: 3px solid ${C.card};
          box-shadow: 0 2px 8px rgba(0,0,0,0.22); cursor: pointer;
        }
        .nk-range::-moz-range-thumb {
          width: 22px; height: 22px; border-radius: 50%;
          background: ${C.ink}; border: 3px solid ${C.card};
          box-shadow: 0 2px 8px rgba(0,0,0,0.22); cursor: pointer;
        }
        @media (max-width: 900px) {
          .nk-hero { grid-template-columns: 1fr !important; }
          .nk-navlink { display: none !important; }
        }
      `}</style>
    </main>
  );
}
