"use client";
// web/app/page.tsx — heynikki.in
// ────────────────────────────────────────────────────────────────
// The page has one job: make a Telugu business owner believe the AI
// actually speaks their language, then sign up.
//
// The hero states the claim and nothing else — one viewport, black,
// copy-led. The proof follows immediately underneath: the call console
// opens the next band, so the visitor hears it work before reading a
// single feature. Everything below that answers the questions a person
// asks *after* they've heard it.
//
// Structure follows a call's real lifecycle (Ringing → Live → On
// WhatsApp), because that genuinely is a sequence — not decoration.
// ────────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import CallConsole from "../components/CallConsole";
import WakeWordNikki from "../components/WakeWordNikki";
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

      {/* ══ HERO — single viewport, black, copy-led ═══════════
          The old hero put CallConsole
          beside the headline because "the console is the argument".
          That argument still holds — so the console has not been
          deleted, it has been moved to the band immediately below,
          where it is the first thing the page does after the claim
          rather than a thing competing with it. ══════════════ */}
      <div className="v2">
        <header className="v2-header">
          <a className="v2-logo" href="#top" aria-label="HeyNikki">
            <NikkiLogo size={26} showText={false} dark />
            <span>Hey<span className="v2-logo-suffix">Nikki</span></span>
          </a>

          <nav className="v2-nav" aria-label="Primary">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#roi">ROI</a>
            <a href="#security">Security</a>
            <a href="#pricing">Pricing</a>
          </nav>

          <a className="v2-btn v2-btn-solid v2-header-cta" href="/signup">Get a number</a>
        </header>

        <section className="v2-hero" id="top">
          <div className="v2-copy">
            <span className="v2-badge">
              <span className="v2-badge-dot" aria-hidden />
              Telugu · Hindi · English
            </span>

            <h1>
              <span className="v2-line">Every missed call was</span>
              <span className="v2-line">someone <em>ready to buy.</em></span>
            </h1>

            <p className="v2-lede">
              Nikki answers your business number in real Telugu — books the appointment,
              captures the number, sends the WhatsApp. Not a phonetic impression of
              Telugu. The actual language your customers call you in.
            </p>

            <div className="v2-actions">
              <a className="v2-btn v2-btn-solid" href="/signup">Put Nikki on my number</a>
              <a className="v2-btn v2-btn-ghost" href="#demo">Talk to Nikki</a>
            </div>

            {/* Our own number, answered by our own agent. A prospect who rings
                it has tested the product before they have read a word of the
                pitch — which is the only demo that cannot be staged. */}
            <a href="tel:+918633502031" className="v2-callnum">
              <span className="v2-callnum-dot" aria-hidden="true" />
              Or just call her: <strong>+91 86335 02031</strong>
            </a>

            {/* The widget keeps its own markup and logic untouched —
                every class it renders is restyled below for dark.
                Porting the design was never going to mean rewriting
                the one component on this page that holds a mic open. */}
            <div className="v2-voice">
              <WakeWordNikki />
            </div>
          </div>
        </section>

        <footer className="v2-stats">
          <span className="v2-stat"><Languages size={15} /> 3 languages, switched mid-call</span>
          <span className="v2-stat"><Clock size={15} /> Live the same day</span>
          <span className="v2-stat"><MessageCircle size={15} /> Confirmed on WhatsApp</span>
        </footer>
      </div>

      {/* ══ THE CONSOLE — the argument, now on its own ═══════ */}
      <section id="demo" className="v2-demo">
        <div className="v2-demo-inner">
          <div className="v2-demo-head">
            <Eyebrow tone="#8FA6BD">Hear it before you believe it</Eyebrow>
            <h2>Ask her anything.</h2>
            <p>No signup. The same voice that will answer your customers — in Telugu, if you like.</p>
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
              // MEASURED, not aspirational. Anything here can be tested on the
              // demo call in front of a prospect, so it has to survive that.
              // The previous "< 700 ms first reply" was off by roughly 4x:
              // measured end to end it is ~0.5s before she starts speaking
              // (an acknowledgement) and ~2.5s to a full spoken answer.
              ["~0.5 s", "Before she starts speaking"],
              ["~2.5 s", "To a full spoken answer"],
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

        {/* The trial is minutes on a real number, not a sandbox. Stated in
            the customer's terms — what they get — rather than ours. */}
        <div style={{
          border: `1px solid ${C.line}`, background: C.card, borderRadius: 16,
          padding: "18px 22px", marginBottom: 26,
          display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap",
        }}>
          <div style={{
            fontFamily: M, fontSize: 26, fontWeight: 600, color: C.teal,
            letterSpacing: "-0.02em",
          }}>100 min</div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 15, fontWeight: 650, color: C.ink }}>
              Free on every new account
            </div>
            <div style={{ fontSize: 13.5, color: C.textMid, marginTop: 3, lineHeight: 1.5 }}>
              Real calls on a real number — inbound and outbound. No card, no sandbox,
              and nothing switches off at the end of a trial week.
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(268px, 1fr))", gap: 18 }}>
          {[
            // These MUST match /api/platform/pricing, which reads
            // platform_config and is what the billing page charges. They are
            // literals here because this page is prerendered on Vercel and
            // cannot reach the on-prem API at build time — so treat them as a
            // mirror, not a source, and change platform_config first.
            //
            // The previous card advertised "Unlimited inbound" at Rs 5,999 —
            // a plan that does not exist in billing, for a service that is
            // metered by minutes. A prospect was quoted it on the phone and
            // would then have seen metered tiers at signup.
            // Starter and Scale used to be a bullet inside a third card, so
            // the page advertised one tier and mentioned two. These are the
            // three that exist in platform_config as plan_tier_1/2/3, with
            // their real caps.
            {
              name: "Starter", price: "1,999", note: "per month",
              points: ["200 minutes included", "1 number", "2 calls at once",
                       "Appointments, leads and recordings"],
            },
            {
              name: "Growth", price: "4,999", note: "per month",
              highlight: true, badge: "Most businesses start here",
              points: ["600 minutes included", "3 numbers · 1 CRM seat", "5 calls at once",
                       "Outbound campaigns and WhatsApp follow-up",
                       "Call quality scoring on every call"],
            },
            {
              name: "Scale", price: "9,999", note: "per month",
              points: ["1,500 minutes included", "10 numbers · 5 CRM seats", "10 calls at once",
                       "Everything in Growth", "Priority support"],
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
          GST extra · Cancel any month · Extra minutes ₹15 · Add a number or CRM seat for ₹1,999
        </p>
      </Section>

      {/* ══ DATA SECURITY ═══════════════════════════════════
          Every claim here is one I verified against the running system
          before writing it. Nothing aspirational, no certifications we do
          not hold, and no residency claim — the Supabase region was not
          something I could confirm, so it is not on the page. A security
          section that overstates is worse than none: it is the first thing
          a customer will test you on. ══════════════════════════════ */}
      <Section id="security" bg={C.card}>
        <Eyebrow>Your data</Eyebrow>
        <h2 style={{
          fontFamily: D, fontSize: "clamp(28px, 3.6vw, 42px)", lineHeight: 1.12,
          letterSpacing: "-0.03em", fontWeight: 700, margin: "18px 0 14px", color: C.ink,
        }}>
          Your customers&apos; calls are your customers&apos; calls.
        </h2>
        <p style={{ fontSize: 16.5, lineHeight: 1.65, color: C.textMid, maxWidth: 640, margin: "0 0 40px" }}>
          You are handing us your business number and every conversation that arrives on it.
          Here is exactly what happens to it — the specifics, not a badge.
        </p>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20,
        }}>
          {[
            ["One business, one wall",
             "Every table is protected at the database level, not by our application code remembering to filter. A signed-in account can read its own calls, leads and recordings and nothing else — we test this by signing in as a fresh business and asking for everyone's data. It comes back empty."],
            ["Recordings encrypted at rest",
             "Call audio is encrypted with AES-256-GCM before it is stored. The storage bucket is private: there is no public link to a recording, and there never was one. Playing a call in your dashboard mints a link that expires in minutes."],
            ["Callers are told it is an AI",
             "Every call opens by disclosing that it is handled by an automated assistant, as TRAI requires. Nikki never claims to be a person, and says so if asked."],
            ["Outbound needs consent",
             "A campaign dials only numbers whose consent was declared, recorded with who declared it and when. If the DND check cannot run, the call is blocked rather than placed — the safe failure, not the convenient one."],
            ["Your dashboard is not on the internet",
             "Every signed-in page is excluded from search engines, and our llms.txt tells AI crawlers not to index or train on anything behind a login. Recordings and transcripts are never served from a public URL."],
            ["You can take it with you",
             "Recordings, transcripts, leads and appointments are yours. Export them or ask us to delete them, and keep your number — port it in and port it out."],
          ].map(([title, body]) => (
            <div key={title} style={{
              background: C.paper, border: `1px solid ${C.line}`,
              borderRadius: 16, padding: "22px 20px",
            }}>
              <div style={{
                fontSize: 15.5, fontWeight: 700, color: C.ink, marginBottom: 8,
                letterSpacing: "-0.01em",
              }}>{title}</div>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: C.textMid }}>{body}</div>
            </div>
          ))}
        </div>

        <p style={{ marginTop: 26, fontSize: 13.5, color: C.textDim, fontFamily: M, lineHeight: 1.6 }}>
          Questions we get asked and answer plainly:{" "}
          <a href="/privacy" style={{ color: C.teal }}>what we store and for how long</a>.
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
        /* ══ V2 HERO ════════════════════════════════════════
           Token-driven like the spec: one set of custom properties,
           overridden per breakpoint, so the hero holds a single
           viewport from a 360px phone to a 27" display without any
           value being tuned twice. ═════════════════════════ */
        .v2 {
          --bg:#000; --fg:#fff; --muted:#9a9a9a;
          --border:rgba(255,255,255,.16);
          --h1:44px; --lede:16.5px; --badge:13px; --stat:13.5px;
          --pad-x:20px; --pad-y:18px; --gap:38px;
          --btn-h:44px;
          background:var(--bg); color:var(--fg);
          min-height:100svh; display:flex; flex-direction:column;
          position:relative; overflow:hidden;
          font-family:${BD};
        }
        /* A single soft light source behind the copy. Without it the
           black reads as an unpainted div rather than a backdrop. */
        .v2::before {
          content:""; position:absolute; inset:-20% -10% auto -10%; height:80%;
          background:radial-gradient(60% 60% at 50% 0%, rgba(120,170,255,.13), transparent 70%);
          pointer-events:none;
        }
        .v2 > * { position:relative; z-index:1; }

        .v2-header {
          display:flex; align-items:center; justify-content:space-between; gap:20px;
          padding:var(--pad-y) var(--pad-x);
        }
        .v2-logo {
          display:inline-flex; align-items:center; gap:9px;
          color:var(--fg); text-decoration:none;
          font-size:15.5px; font-weight:600; letter-spacing:-.01em;
        }
        .v2-logo-suffix { color:var(--muted); }
        .v2-nav { display:none; gap:26px; }
        .v2-nav a {
          color:var(--muted); text-decoration:none; font-size:14px;
          transition:color .18s ease;
        }
        .v2-nav a:hover { color:var(--fg); }

        .v2-btn {
          display:inline-flex; align-items:center; justify-content:center;
          height:var(--btn-h); padding:0 20px; border-radius:999px;
          font-size:14px; font-weight:600; text-decoration:none;
          transition:transform .18s ease, background .18s ease, border-color .18s ease;
        }
        .v2-btn:hover { transform:translateY(-1px); }
        .v2-btn-solid { background:var(--fg); color:#000; }
        .v2-btn-solid:hover { background:#e8e8e8; }
        .v2-btn-ghost { border:1px solid var(--border); color:var(--fg); }
        .v2-btn-ghost:hover { border-color:rgba(255,255,255,.42); }
        .v2-header-cta { display:none; }

        .v2-hero {
          flex:1; display:flex; align-items:center;
          padding:var(--gap) var(--pad-x);
        }
        .v2-copy { max-width:860px; }

        .v2-badge {
          display:inline-flex; align-items:center; gap:9px;
          padding:7px 15px 7px 12px; border:1px solid var(--border);
          border-radius:999px; font-size:var(--badge); color:#d8d8d8;
        }
        .v2-badge-dot {
          width:7px; height:7px; border-radius:50%; background:#22C55E;
          box-shadow:0 0 0 3px rgba(34,197,94,.18);
        }

        .v2 h1 {
          margin:22px 0 0; font-family:${D};
          font-size:var(--h1); line-height:1.04; letter-spacing:-.035em;
          font-weight:700;
        }
        .v2-line { display:block; }
        .v2 h1 em { font-style:italic; color:#8FB4E8; }

        .v2-lede {
          margin:20px 0 0; max-width:520px;
          font-size:var(--lede); line-height:1.6; color:var(--muted);
        }
        .v2-actions { display:flex; flex-wrap:wrap; gap:11px; margin:30px 0 0; }

        .v2-callnum {
          display:inline-flex; align-items:center; gap:9px; margin:18px 0 0;
          padding:9px 15px; border:1px solid var(--border); border-radius:999px;
          color:#d8d8d8; font-size:14px; text-decoration:none;
          transition:border-color .18s ease, color .18s ease;
        }
        .v2-callnum:hover { border-color:rgba(255,255,255,.42); color:#fff; }
        .v2-callnum strong { color:#fff; font-weight:700; letter-spacing:.01em; }
        .v2-callnum-dot {
          width:7px; height:7px; border-radius:50%; background:#22C55E;
          box-shadow:0 0 0 3px rgba(34,197,94,.18); flex:none;
        }
        .v2-stats {
          display:flex; flex-wrap:wrap; gap:14px 28px;
          padding:var(--pad-y) var(--pad-x) calc(var(--pad-y) + 6px);
          border-top:1px solid rgba(255,255,255,.10);
        }
        .v2-stat {
          display:inline-flex; align-items:center; gap:8px;
          font-size:var(--stat); color:#d8d8d8;
        }
        .v2-stat svg { opacity:.62; flex:none; }

        /* ── The widget on dark ──────────────────────────────
           WakeWordNikki ships its own class names and no inline
           colours, which is the only reason this port is CSS and
           not a rewrite of the component holding the microphone. */
        .v2-voice { margin:32px 0 0; }
        .v2-voice .wwn { display:flex; flex-wrap:wrap; align-items:center; gap:14px; }
        .v2-voice .wwn-bars { display:flex; align-items:center; gap:3px; height:26px; }
        .v2-voice .wwn-bars span {
          width:3px; height:26px; border-radius:2px; background:rgba(255,255,255,.34);
          transform-origin:center; transition:transform .09s linear;
        }
        .v2-voice .wwn-bars.listening span { background:#8FB4E8; }
        .v2-voice .wwn-bars.speaking  span { background:#22C55E; }
        .v2-voice .wwn-caption { margin:0; font-size:13.5px; color:var(--muted); }
        .v2-voice .wwn-cta {
          height:38px; padding:0 17px; border-radius:999px;
          border:1px solid var(--border); background:transparent; color:#fff;
          font-size:13.5px; font-weight:600; cursor:pointer;
          transition:border-color .18s ease;
        }
        .v2-voice .wwn-cta:hover { border-color:rgba(255,255,255,.42); }
        .v2-voice .wwn-off {
          background:none; border:0; color:#7a7a7a; font-size:12.5px;
          text-decoration:underline; cursor:pointer; padding:0;
        }
        .v2-voice .wwn-note, .v2-voice .wwn-err { flex-basis:100%; margin:0; font-size:12.5px; }
        .v2-voice .wwn-note { color:#7a7a7a; }
        .v2-voice .wwn-err  { color:#ff9a8a; }
        .v2-voice .wwn-lines {
          flex-basis:100%; margin:4px 0 0; padding:14px 16px;
          border:1px solid rgba(255,255,255,.12); border-radius:14px;
          background:rgba(255,255,255,.04);
        }
        .v2-voice .wwn-lines p { margin:0 0 7px; font-size:14px; line-height:1.5; color:#e4e4e4; }
        .v2-voice .wwn-lines p:last-child { margin-bottom:0; }
        .v2-voice .wwn-lines span {
          display:inline-block; min-width:46px; color:#7a7a7a;
          font-family:${M}; font-size:11px; text-transform:uppercase; letter-spacing:.08em;
        }

        /* ── The console band ───────────────────────────────── */
        .v2-demo { background:#07121D; color:#fff; padding:clamp(56px,8vw,96px) var(--pad-x,20px); }
        .v2-demo-inner { max-width:1180px; margin:0 auto; }
        .v2-demo-head { margin:0 0 32px; }
        .v2-demo-head h2 {
          margin:16px 0 0; font-family:${D}; font-weight:700;
          font-size:clamp(30px,4vw,46px); letter-spacing:-.03em;
        }
        .v2-demo-head p { margin:12px 0 0; color:#8FA6BD; font-size:16px; }

        @media (min-width:768px) {
          .v2 { --h1:64px; --lede:18px; --pad-x:44px; --pad-y:24px; --gap:60px; }
          .v2-nav { display:flex; }
          .v2-header-cta { display:inline-flex; }
        }
        @media (min-width:1200px) {
          .v2 { --h1:78px; --lede:19.5px; --pad-x:72px; --pad-y:28px; }
        }
        @media (prefers-reduced-motion:reduce) {
          .v2-btn { transition:none; }
          .v2-btn:hover { transform:none; }
          .v2-voice .wwn-bars span { transition:none; }
        }

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
