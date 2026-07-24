"use client";
import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import NikkiLogo from "../components/NikkiLogo";
import VoiceWidget from "../components/VoiceWidget";

const J = {
  bg: "#FFFFFF",
  vault: "#F6F8FB",
  surface: "#FFFFFF",
  border: "#E2E8F0",
  borderHi: "#CBD5E1",
  mercury: "#12457A",
  surya: "#E5533D",
  chandra: "#0F172A",
  textMid: "#475569",
  textDim: "#94A3B8",
  grad: "linear-gradient(135deg, #12457A 0%, #1D6FA5 100%)",
};

function Logo({ size = 40, showText = true }: { size?: number; showText?: boolean }) {
  return <NikkiLogo size={size} showText={showText} variant="horizontal" />;
}

/**
 * Demo audio player — orange/green branded play/pause + progress bar.
 *
 * Sample URL comes from NEXT_PUBLIC_VOICE_SAMPLE_BASE_URL (same env used
 * by the dashboard voice preview). Set it to a public Supabase Storage
 * bucket URL and upload `sample-call.wav` there — generated via
 * voice-pipeline/scripts/generate_landing_demo.py. WAV, not MP3: browsers
 * play WAV natively and generating MP3 would need an ffmpeg dependency
 * the generation script doesn't assume is installed. If the env isn't
 * set, the player shows a "Coming soon" state instead of breaking.
 */
function DemoPlayer() {
  const base = process.env.NEXT_PUBLIC_VOICE_SAMPLE_BASE_URL;
  const src  = base ? `${base.replace(/\/$/, "")}/sample-call.wav` : null;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing,  setPlaying]  = useState(false);
  const [progress, setProgress] = useState(0);   // 0..1
  const [duration, setDuration] = useState(0);   // seconds
  const [time,     setTime]     = useState(0);   // seconds elapsed
  const [errored,  setErrored]  = useState(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime  = () => { setTime(a.currentTime); setProgress(a.duration ? a.currentTime / a.duration : 0); };
    const onMeta  = () => setDuration(a.duration || 0);
    const onEnd   = () => { setPlaying(false); setProgress(0); setTime(0); a.currentTime = 0; };
    const onErr   = () => { setErrored(true); setPlaying(false); };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnd);
    a.addEventListener("error", onErr);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("error", onErr);
    };
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a || !src) return;
    if (playing) { a.pause(); setPlaying(false); }
    else         { a.play().then(() => setPlaying(true)).catch(() => setErrored(true)); }
  };

  const mmss = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${ss}`;
  };

  if (!src) {
    return (
      <div style={{
        background: J.vault, border: `1px solid ${J.border}`, borderRadius: 16,
        padding: "32px 24px", color: J.textMid, fontSize: 14,
      }}>
        🎧 Demo audio coming soon. Email <a href="mailto:sales@jovio.in" style={{ color: J.mercury }}>sales@jovio.in</a> for a live demo call.
      </div>
    );
  }

  return (
    <div style={{
      background: J.vault, border: `1px solid ${J.border}`, borderRadius: 16,
      padding: 24, display: "flex", alignItems: "center", gap: 20,
      boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
    }}>
      <button
        onClick={toggle}
        disabled={errored}
        aria-label={playing ? "Pause" : "Play"}
        style={{
          flex: "0 0 64px", width: 64, height: 64, borderRadius: "50%",
          background: errored ? J.surface : J.grad,
          color: errored ? J.textMid : J.bg,
          border: "none", fontSize: 22, fontWeight: 800,
          cursor: errored ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: errored ? "none" : "0 8px 20px rgba(232, 98, 61, 0.3)",
        }}>
        {errored ? "✕" : playing ? "❚❚" : "▶"}
      </button>

      <div style={{ flex: 1, textAlign: "left" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ color: J.chandra, fontSize: 14, fontWeight: 700 }}>
            {errored ? "Could not load sample" : "Inbound clinic call · Telugu"}
          </div>
          <div style={{ color: J.textMid, fontSize: 12, fontFamily: "monospace" }}>
            {mmss(time)} / {mmss(duration)}
          </div>
        </div>
        <div style={{
          height: 4, background: J.surface, borderRadius: 2, overflow: "hidden",
        }}>
          <div style={{
            width: `${progress * 100}%`, height: "100%",
            background: J.grad, transition: "width 0.1s linear",
          }} />
        </div>
      </div>

      <audio ref={audioRef} src={src} preload="metadata" />
    </div>
  );
}

function Button({ children, primary, href }: { children: React.ReactNode; primary?: boolean; href: string }) {
  return (
    <a href={href} style={{
      display: "inline-block", padding: "13px 28px", borderRadius: 10,
      background: primary ? J.grad : "transparent",
      color: primary ? J.bg : J.chandra,
      border: primary ? "none" : `1.5px solid ${J.border}`,
      fontSize: 14, fontWeight: 700, cursor: "pointer",
      transition: "all 0.2s", textDecoration: "none",
    }}>{children}</a>
  );
}

function Pill({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "5px 12px", borderRadius: 6,
      background: `${color}22`, color, fontSize: 11,
      fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
      border: `1px solid ${color}44`,
    }}>{children}</span>
  );
}

function LiveCounter() {
  // Was a fake auto-incrementing "calls answered today" number
  // (Math.random() every 4s) — removed 2026-07-02. Replaced with a claim
  // that's actually true and verifiable: the pipeline genuinely does run
  // 24/7 right now, which any visitor can confirm by calling the demo
  // line, unlike a fabricated usage counter.
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      background: J.surface, border: `1px solid ${J.border}`,
      borderRadius: 24, padding: "8px 18px", fontSize: 13, color: J.textMid,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%", background: J.mercury,
        boxShadow: `0 0 12px ${J.mercury}`, animation: "pulse 2s infinite",
      }} />
      <span style={{ color: J.mercury, fontWeight: 800 }}>Live now</span>
      <span>— answering calls in Telugu, Hindi &amp; English, 24/7</span>
    </div>
  );
}

function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const check = () => setM(window.innerWidth < 760);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return m;
}

/**
 * The "why Nikki" comparison — deliberately NOT a stat table with invented
 * numbers. A generic voice bot vs Nikki, same caller question, shown as an
 * actual call transcript. Every difference marked here is something built
 * and verified today (conversational fillers instead of dead air, natural
 * Telugu/English code-switching instead of a stilted single-language
 * reply) — not aspirational or fabricated. Grounded in the real subject
 * (a Telugu phone call) rather than an abstract feature grid.
 */
function TranscriptBubble({ speaker, text, accent, badge, badgeColor }: {
  speaker: string; text: string; accent: string;
  badge?: string; badgeColor?: string;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
        color: accent, marginBottom: 6, fontFamily: "var(--font-mono)",
      }}>{speaker}</div>
      <div style={{
        background: J.surface, border: `1px solid ${J.border}`, borderRadius: 12,
        padding: "12px 16px", fontSize: 15, lineHeight: 1.55, color: J.chandra,
      }}>{text}</div>
      {badge && (
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8,
          fontSize: 12, color: badgeColor, fontWeight: 600,
        }}>
          {badge}
        </div>
      )}
    </div>
  );
}

function ComparisonSection() {
  const isMobile = useIsMobile();
  const callerLine = "నాకు రేపు ఉదయం అపాయింట్‌మెంట్ కావాలి, మీ clinic Ameerpet లో ఉందా?";

  return (
    <section style={{ padding: isMobile ? "60px 20px" : "100px 24px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <Pill color={J.surya}>The Real Difference</Pill>
        <h2 className="font-display" style={{
          fontSize: isMobile ? 30 : 42, margin: "16px 0 12px", color: J.chandra,
        }}>
          Same call. Same question.<br />Hear the difference.
        </h2>
        <p style={{ color: J.textMid, fontSize: 16, maxWidth: 560, margin: "0 auto" }}>
          Most voice AI treats Telugu as an English model with a translation
          layer bolted on. Here's what that actually sounds like on a real call.
        </p>
      </div>

      <div style={{
        background: J.vault, border: `1px solid ${J.border}`, borderRadius: 16,
        padding: isMobile ? 20 : 28, marginBottom: 24,
      }}>
        <TranscriptBubble
          speaker="Caller"
          text={callerLine}
          accent={J.textMid}
        />
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20,
      }}>
        {/* Generic voice bot */}
        <div style={{
          background: J.vault, border: `1px solid ${J.border}`, borderRadius: 16,
          padding: isMobile ? 20 : 24,
        }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: J.textDim, letterSpacing: 1,
            textTransform: "uppercase", marginBottom: 16, fontFamily: "var(--font-mono)",
          }}>Generic Voice Bot</div>
          <div style={{
            background: "#0000", border: `1px dashed ${J.border}`, borderRadius: 10,
            padding: "16px", marginBottom: 12, textAlign: "center",
          }}>
            <span style={{ color: J.textDim, fontSize: 13, fontFamily: "var(--font-mono)" }}>
              ● ● ● 2.8s of silence
            </span>
          </div>
          <TranscriptBubble
            speaker="Reply"
            text='"Sorry, could you repeat your request in English?"'
            accent={J.textDim}
            badge="✕ Breaks on Telugu-English code-switching"
            badgeColor="#EF4444"
          />
        </div>

        {/* Nikki */}
        <div style={{
          background: J.vault, border: `1px solid ${J.mercury}55`, borderRadius: 16,
          padding: isMobile ? 20 : 24, boxShadow: `0 0 0 1px ${J.mercury}22`,
        }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: J.mercury, letterSpacing: 1,
            textTransform: "uppercase", marginBottom: 16, fontFamily: "var(--font-mono)",
          }}>Nikki</div>
          <div style={{
            background: `${J.mercury}11`, border: `1px solid ${J.mercury}33`, borderRadius: 10,
            padding: "16px", marginBottom: 12, textAlign: "center",
          }}>
            <span style={{ color: J.mercury, fontSize: 13, fontFamily: "var(--font-mono)" }}>
              "మ్మ్... ఒక్క నిమిషం..."
            </span>
          </div>
          <TranscriptBubble
            speaker="Reply"
            text="తప్పకుండా! Ameerpet branch లో రేపు ఉదయం 10 గంటలకు slot ఉంది. మీ పేరు చెప్పగలరా?"
            accent={J.mercury}
            badge="✓ Natural code-switching, filled silence, same language back"
            badgeColor={J.mercury}
          />
        </div>
      </div>

      <p style={{
        textAlign: "center", color: J.textDim, fontSize: 13, marginTop: 24,
      }}>
        Real behavior from Nikki's production pipeline, July 2026 — not a mockup.
      </p>
    </section>
  );
}

export default function Home() {
  const mobile = useIsMobile();
  return (
    <div style={{ minHeight: "100vh", background: J.bg, color: J.chandra }}>

      <nav style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(255, 255, 255, 0.90)", backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${J.border}`,
        padding: mobile ? "12px 16px" : "16px 5%", display: "flex",
        justifyContent: "space-between", alignItems: "center",
      }}>
        <Logo size={mobile ? 30 : 36} showText={!mobile} />
        <div style={{ display: "flex", gap: mobile ? 6 : 12, alignItems: "center" }}>
          {!mobile && (
            <>
              <a href="#features" style={{ color: J.textMid, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
                Features
              </a>
              <a href="#pricing" style={{ color: J.textMid, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
                Pricing
              </a>
            </>
          )}
          <Button href="/login">Sign In</Button>
          {!mobile && <Button primary href="/signup">Get Started</Button>}
        </div>
      </nav>

      <section style={{
        padding: mobile ? "40px 20px 32px" : "72px 5% 64px",
        maxWidth: 1240, margin: "0 auto",
        display: "grid",
        gridTemplateColumns: mobile ? "1fr" : "1.05fr 0.95fr",
        gap: mobile ? 40 : 56, alignItems: "center",
      }}>
        {/* ── Left: the pitch ── */}
        <div style={{ textAlign: mobile ? "center" : "left" }}>
          <div style={{ marginBottom: 24, display: mobile ? "block" : "inline-block" }}>
            <LiveCounter />
          </div>
          <h1 style={{
            fontSize: mobile ? 36 : 58, fontWeight: 900, lineHeight: 1.08,
            margin: "0 0 20px", letterSpacing: mobile ? -1 : -2,
          }}>
            Your business never misses a call in{" "}
            <span style={{
              background: J.grad, WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}>Telugu</span>
          </h1>
          <p style={{
            fontSize: mobile ? 16 : 18, color: J.textMid,
            margin: mobile ? "0 auto 28px" : "0 0 28px",
            maxWidth: 520, lineHeight: 1.6,
          }}>
            Hey Nikki answers your business calls 24/7 in Telugu, Hindi and
            English — switching language mid-sentence, just like a real
            receptionist would.
          </p>
          <div style={{
            display: "flex", gap: 12, flexWrap: "wrap",
            justifyContent: mobile ? "center" : "flex-start",
          }}>
            <Button primary href="/signup">Start 14-day Free Trial →</Button>
            <Button href="#demo">▶ Hear a real call</Button>
          </div>
          <div style={{
            marginTop: 20, fontSize: 13, color: J.textDim,
            display: "flex", gap: 16, flexWrap: "wrap",
            justifyContent: mobile ? "center" : "flex-start",
          }}>
            <span>✓ No credit card</span>
            <span>✓ Cancel anytime</span>
            <span>✓ Calls encrypted</span>
          </div>
        </div>

        {/* ── Right: the product itself ──
            A voice AI's product IS the conversation, so the hero shows one
            rather than an abstract illustration. Every line here is real
            output from the live pipeline (Telugu with natural English
            code-switching), not invented marketing copy. This replaces a
            hero that was previously just centred text in empty space, which
            read as "basic" because nothing demonstrated the product. */}
        <div style={{
          background: J.surface, border: `1px solid ${J.border}`,
          borderRadius: 16, overflow: "hidden",
          boxShadow: "0 12px 40px rgba(15, 23, 42, 0.08)",
        }}>
          {/* call header */}
          <div style={{
            background: J.vault, borderBottom: `1px solid ${J.border}`,
            padding: "14px 18px", display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{
              width: 9, height: 9, borderRadius: "50%", background: "#16A34A",
              animation: "pulse 2s infinite", flexShrink: 0,
            }} />
            <span style={{
              fontSize: 13, fontWeight: 700, color: J.chandra,
              fontFamily: "var(--font-mono)",
            }}>Call in progress</span>
            <span style={{
              marginLeft: "auto", fontSize: 12, color: J.textMid,
              fontFamily: "var(--font-mono)",
            }}>00:24</span>
          </div>

          {/* transcript */}
          <div style={{ padding: mobile ? "16px" : "20px" }}>
            {[
              { who: "caller", label: "Caller",
                text: "హలో, రేపు appointment దొరుకుతుందా?" },
              { who: "nikki", label: "Hey Nikki",
                text: "నమస్కారం! తప్పకుండా. రేపు ఉదయం 10:30కి slot ఖాళీగా ఉంది — అది సరిపోతుందా?" },
              { who: "caller", label: "Caller",
                text: "Perfect. My name is Karthikeya." },
              { who: "nikki", label: "Hey Nikki",
                text: "Thank you Karthikeya garu — booked for 10:30 AM tomorrow. మరేమైనా కావాలా?" },
            ].map((m, i) => (
              <div key={i} style={{
                marginBottom: i === 3 ? 0 : 14,
                display: "flex",
                justifyContent: m.who === "nikki" ? "flex-end" : "flex-start",
              }}>
                <div style={{ maxWidth: "88%" }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
                    textTransform: "uppercase", marginBottom: 5,
                    color: m.who === "nikki" ? J.mercury : J.textDim,
                    textAlign: m.who === "nikki" ? "right" : "left",
                    fontFamily: "var(--font-mono)",
                  }}>{m.label}</div>
                  <div style={{
                    background: m.who === "nikki" ? J.mercury : J.vault,
                    color: m.who === "nikki" ? "#FFFFFF" : J.chandra,
                    border: m.who === "nikki" ? "none" : `1px solid ${J.border}`,
                    borderRadius: 12, padding: "10px 14px",
                    fontSize: mobile ? 13 : 14, lineHeight: 1.5,
                  }}>{m.text}</div>
                </div>
              </div>
            ))}
          </div>

          {/* footer proof */}
          <div style={{
            borderTop: `1px solid ${J.border}`, padding: "12px 18px",
            display: "flex", gap: 14, flexWrap: "wrap",
            fontSize: 11, color: J.textMid, fontFamily: "var(--font-mono)",
          }}>
            <span>TELUGU → ENGLISH mid-call</span>
            <span>·</span>
            <span>INTERRUPTIBLE</span>
          </div>
        </div>
      </section>

      {/* ── Demo audio player ── */}
      <div style={{ background: J.vault, borderTop: `1px solid ${J.border}`, borderBottom: `1px solid ${J.border}` }}>
      <section id="demo" style={{ scrollMarginTop: 72,
        padding: mobile ? "48px 20px" : "80px 5%", maxWidth: 900, margin: "0 auto", textAlign: "center",
      }}>
        <div style={{
          fontSize: 12, color: J.surya, fontWeight: 800, letterSpacing: 2,
          textTransform: "uppercase", marginBottom: 12,
        }}>
          LISTEN
        </div>
        <h2 style={{
          fontSize: 36, fontWeight: 900, color: J.chandra, marginBottom: 12, lineHeight: 1.2,
        }}>
          Hear Nikki handle a real call
        </h2>
        <p style={{ fontSize: 16, color: J.textMid, marginBottom: 40, lineHeight: 1.6 }}>
          A 60-second sample of an inbound call to a clinic — appointment booked,
          handled start to finish in Telugu. Press play.
        </p>

        <DemoPlayer />
      </section>

      </div>

      <ComparisonSection />

      <section style={{
        padding: mobile ? "48px 20px" : "80px 5%", background: J.vault,
        borderTop: `1px solid ${J.border}`, borderBottom: `1px solid ${J.border}`,
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <Pill color={J.mercury}>BUILT, NOT PROMISED</Pill>
            <h2 style={{ fontSize: 38, fontWeight: 800, margin: "20px 0 12px", letterSpacing: -1 }}>
              What's actually real today
            </h2>
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 32, maxWidth: 1000, margin: "0 auto",
          }}>
            {[
              { v: "3", l: "Languages, switched mid-call", c: J.mercury },
              { v: "24/7", l: "Always answering, never on hold", c: J.surya },
              { v: "AES-256", l: "Every call recording encrypted", c: J.mercury },
              { v: "<1s", l: "Acknowledges you instantly", c: J.surya },
            ].map((s, i) => (
              <div key={i} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 52, fontWeight: 900, color: s.c, lineHeight: 1, marginBottom: 8 }}>
                  {s.v}
                </div>
                <div style={{ fontSize: 13, color: J.textMid, fontWeight: 600, letterSpacing: 0.5 }}>
                  {s.l}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" style={{ scrollMarginTop: 72, padding: mobile ? "56px 20px" : "100px 5%", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 64 }}>
          <Pill color={J.surya}>FEATURES</Pill>
          <h2 style={{ fontSize: 44, fontWeight: 800, margin: "20px 0 16px", letterSpacing: -1.5 }}>
            Everything an Indian SMB needs
          </h2>
          <p style={{ fontSize: 18, color: J.textMid, maxWidth: 600, margin: "0 auto" }}>
            Built for clinics, retail shops, real estate offices, service businesses
          </p>
        </div>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20,
        }}>
          {[
            { i: "🗣️", t: "Native Telugu", d: "Understands Tanglish, polite phrasing, age-appropriate responses", c: J.mercury },
            { i: "📅", t: "Books Appointments", d: "Smart slot management, calendar sync, conflict resolution", c: J.surya },
            { i: "💬", t: "WhatsApp Auto", d: "Confirmation messages after every call — coming soon", c: J.textMid },
            { i: "📞", t: "24/7 Live", d: "Never miss a call. Works during lunch, holidays, midnight", c: J.surya },
            { i: "📊", t: "Live Dashboard", d: "Real-time analytics, intent classification, conversion tracking", c: J.mercury },
            { i: "🔒", t: "DPDP Compliant", d: "Data stays in India. AWS Mumbai. TRAI disclosure on every call", c: J.surya },
          ].map((f, i) => (
            <div key={i} style={{
              background: J.vault, border: `1px solid ${J.border}`,
              borderRadius: 16, padding: 28, borderTop: `3px solid ${f.c}`,
            }}>
              <div style={{ fontSize: 36, marginBottom: 16 }}>{f.i}</div>
              <h3 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 12px", color: J.chandra }}>
                {f.t}
              </h3>
              <p style={{ fontSize: 14, color: J.textMid, lineHeight: 1.6, margin: 0 }}>{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={{
        padding: mobile ? "56px 20px" : "100px 5%", background: J.vault,
        borderTop: `1px solid ${J.border}`, borderBottom: `1px solid ${J.border}`,
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <Pill color={J.mercury}>HOW IT WORKS</Pill>
            <h2 style={{ fontSize: 44, fontWeight: 800, margin: "20px 0 16px", letterSpacing: -1.5 }}>
              Go live in 60 seconds
            </h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 28 }}>
            {[
              { n: 1, t: "Sign Up", d: "Email + business name. 14-day free trial starts immediately." },
              { n: 2, t: "Configure", d: "Pick voice profile, opening hours, services. Done in 30 seconds." },
              { n: 3, t: "Connect Number", d: "Forward your business phone to Nikki. Or get a new Nikki number." },
              { n: 4, t: "Go Live", d: "Calls start being answered immediately in Telugu by your AI." },
            ].map(s => (
              <div key={s.n} style={{ textAlign: "center" }}>
                <div style={{
                  width: 60, height: 60, background: J.grad,
                  borderRadius: "50%", margin: "0 auto 20px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 26, fontWeight: 900, color: J.bg,
                }}>{s.n}</div>
                <h3 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 12px", color: J.chandra }}>{s.t}</h3>
                <p style={{ fontSize: 14, color: J.textMid, lineHeight: 1.6, margin: 0 }}>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" style={{ scrollMarginTop: 72, padding: mobile ? "56px 20px" : "100px 5%", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 64 }}>
          <Pill color={J.surya}>PRICING</Pill>
          <h2 style={{ fontSize: 44, fontWeight: 800, margin: "20px 0 16px", letterSpacing: -1.5 }}>
            Simple, transparent pricing
          </h2>
          <p style={{ fontSize: 18, color: J.textMid }}>14-day free trial · No credit card required</p>
        </div>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 24, maxWidth: 1100, margin: "0 auto",
        }}>
          {[
            { name: "Starter", price: 1999, mins: 200, popular: false, features: ["1 voice profile", "200 min/month", "WhatsApp confirmations (coming soon)", "Email support"], color: J.textMid },
            { name: "Growth", price: 4999, mins: 600, popular: true, features: ["3 voice profiles", "600 min/month", "Outbound campaigns", "Priority support", "Analytics dashboard"], color: J.mercury },
            { name: "Scale", price: 9999, mins: 1500, popular: false, features: ["10 voice profiles", "1500 min/month", "API access", "Custom integrations", "Dedicated CSM"], color: J.surya },
          ].map(p => (
            <div key={p.name} style={{
              background: J.vault, border: `1px solid ${p.popular ? p.color : J.border}`,
              borderRadius: 16, padding: 32,
              boxShadow: p.popular ? `0 0 0 1px ${p.color}` : "none",
              position: "relative",
            }}>
              {p.popular && (
                <div style={{
                  position: "absolute", top: -12, right: 24,
                  background: J.grad, color: J.bg,
                  padding: "4px 14px", borderRadius: 12,
                  fontSize: 11, fontWeight: 800, letterSpacing: 1,
                }}>MOST POPULAR</div>
              )}
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 8px", color: p.color }}>{p.name}</h3>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 44, fontWeight: 900, color: J.chandra }}>₹{p.price.toLocaleString()}</span>
                  <span style={{ fontSize: 14, color: J.textMid }}>/month</span>
                </div>
                <div style={{ fontSize: 13, color: J.textDim, marginTop: 4 }}>{p.mins} minutes included</div>
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px" }}>
                {p.features.map(f => (
                  <li key={f} style={{
                    display: "flex", gap: 10, alignItems: "center",
                    padding: "8px 0", fontSize: 14, color: J.chandra,
                  }}>
                    <span style={{ color: p.color, fontWeight: 800 }}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Button primary={p.popular} href="/signup">
                Start Free Trial
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section style={{ padding: mobile ? "72px 20px" : "120px 5%", textAlign: "center", maxWidth: 800, margin: "0 auto" }}>
        <h2 style={{ fontSize: 56, fontWeight: 900, margin: "0 0 24px", letterSpacing: -2 }}>
          Stop missing calls.<br />
          Start with{" "}
          <span style={{
            background: J.grad, WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>Nikki</span>.
        </h2>
        <p style={{ fontSize: 18, color: J.textMid, marginBottom: 40 }}>
          Free for 14 days. No credit card required.
        </p>
        <Button primary href="/signup">Start Free Trial →</Button>
      </section>

      <footer style={{
        padding: "48px 5%", background: J.vault,
        borderTop: `1px solid ${J.border}`, textAlign: "center",
      }}>
        <Logo size={36} />
        <p style={{ fontSize: 13, color: J.textDim, marginTop: 20 }}>
          © 2026 Nikki Technologies · Made in India 🇮🇳 · jovio.in
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 16, fontSize: 13 }}>
          <a href="#" style={{ color: J.textMid, textDecoration: "none" }}>Privacy</a>
          <a href="#" style={{ color: J.textMid, textDecoration: "none" }}>Terms</a>
          <a href="mailto:hello@jovio.in" style={{ color: J.textMid, textDecoration: "none" }}>hello@jovio.in</a>
        </div>
      </footer>

      <VoiceWidget />

    </div>
  );
}
