"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase";
import NikkiLogo from "../../components/NikkiLogo";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { isNativeApp, nativeGoogleSignIn, installAuthDeepLink } from "../../lib/native";
import { landingFor } from "../../lib/landing";

/**
 * Palette pulled onto the HeyNikki brand: the emerald-to-orange gradient the
 * mark, the PWA icons and the Flutter theme all use. The page previously ran
 * a blue "mercury" gradient that appeared nowhere else, so the logo directly
 * above the sign-in button disagreed with the button.
 */
const C = {
  bg: "#FFFFFF", vault: "#F8FAFC", surface: "#FFFFFF",
  border: "#E2E8F0", borderHi: "#CBD5E1",
  emerald: "#10B981", orange: "#F97316", ink: "#0F172A",
  textMid: "#475569", textDim: "#94A3B8", red: "#DC2626",
  grad: "linear-gradient(135deg, #10B981 0%, #14B8A6 55%, #F97316 100%)",
  focus: "0 0 0 3px rgba(16,185,129,0.22)",
};

const inputBase: React.CSSProperties = {
  width: "100%", padding: "12px 14px", fontSize: 14,
  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
  color: C.ink, outline: "none",
  transition: "border-color .15s ease, box-shadow .15s ease",
};

const labelStyle: React.CSSProperties = {
  display: "block", color: C.textMid, fontSize: 11,
  marginBottom: 6, fontWeight: 700, letterSpacing: 0.5,
};

export default function LoginPage() {
  useEffect(() => { installAuthDeepLink(() => landingFor(createClient())); }, []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Phone sign-in. Two steps in one component rather than a second page:
  // the OTP is only meaningful for the number just entered, and a separate
  // route invites a refresh that loses it.
  const [mode, setMode]       = useState<"email" | "phone">("email");
  const [phone, setPhone]     = useState("");
  const [otp, setOtp]         = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");

  // Shared focus/blur handlers so every field gets a visible ring. The inputs
  // set outline:none for the rounded look and previously replaced it with
  // nothing, which left keyboard users with no focus indicator at all.
  const onFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = C.emerald;
    e.currentTarget.style.boxShadow = C.focus;
  };
  const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = C.border;
    e.currentTarget.style.boxShadow = "none";
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const sb = createClient();
    const { error: err } = await sb.auth.signInWithPassword({ email, password });
    if (err) { setError(err.message); setLoading(false); return; }
    window.location.href = await landingFor(sb);
  };

  /** India E.164. Supabase wants the country code; people type ten digits. */
  const toE164 = (raw: string) => {
    const d = raw.replace(/\D/g, "");
    if (d.length === 10) return `+91${d}`;
    if (d.length === 12 && d.startsWith("91")) return `+${d}`;
    if (d.length === 11 && d.startsWith("0")) return `+91${d.slice(1)}`;
    return null;
  };

  const sendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = toE164(phone);
    if (!p) { setError("Enter a 10-digit mobile number."); return; }
    setLoading(true); setError("");
    const sb = createClient();
    const { error: err } = await sb.auth.signInWithOtp({ phone: p });
    setLoading(false);
    if (err) {
      // The commonest failure here is not the user's: phone auth is a
      // provider toggle in Supabase, and until it is on every attempt fails
      // with an opaque message. Say which it is.
      setError(/not enabled|unsupported|provider/i.test(err.message)
        ? "Phone sign-in is not enabled on this project yet."
        : err.message);
      return;
    }
    setOtpSent(true);
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = toE164(phone);
    if (!p) return;
    setLoading(true); setError("");
    const sb = createClient();
    const { error: err } = await sb.auth.verifyOtp({ phone: p, token: otp.trim(), type: "sms" });
    if (err) { setError(err.message); setLoading(false); return; }
    window.location.href = await landingFor(sb);
  };

  const handleGoogle = async () => {
    setError("");
    setGoogleLoading(true);
    if (isNativeApp()) {
      // Custom Tab round-trip; the deep-link listener finishes the sign-in.
      const r = await nativeGoogleSignIn();
      if (!r.ok) setError(r.error || "Google sign-in failed");
      setGoogleLoading(false);
      return;
    }
    const sb = createClient();
    const { error: err } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/dashboard" },
    });
    // A failed OAuth handoff used to leave the button spinning forever with no
    // message, because the redirect never happens on error.
    if (err) { setError(err.message); setGoogleLoading(false); }
  };

  const busy = loading || googleLoading;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, display: "flex",
      alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>

        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ marginBottom: 18, display: "inline-block" }}>
            <NikkiLogo size={84} variant="stacked" />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: C.ink, margin: "0 0 6px", letterSpacing: -0.5 }}>
            Welcome back
          </h1>
          <div style={{ color: C.textMid, fontSize: 14 }}>
            Sign in to your HeyNikki account
          </div>
        </div>

        <div style={{ background: C.vault, border: `1px solid ${C.border}`, borderRadius: 16, padding: 32 }}>
          {/* Email or phone. A toggle rather than two pages: the OTP only
              means anything for the number just typed, and a second route
              invites a refresh that throws it away. */}
          <div role="tablist" aria-label="Sign-in method"
               style={{ display: "flex", gap: 6, marginBottom: 20,
                        background: C.surface, border: `1px solid ${C.border}`,
                        borderRadius: 10, padding: 4 }}>
            {(["email", "phone"] as const).map(m => (
              <button key={m} type="button" role="tab" aria-selected={mode === m}
                onClick={() => { setMode(m); setError(""); setOtpSent(false); }}
                style={{
                  flex: 1, padding: "8px 10px", borderRadius: 7, border: "none",
                  fontSize: 13, fontWeight: 700, cursor: "pointer",
                  background: mode === m ? C.ink : "transparent",
                  color: mode === m ? "#fff" : C.textMid,
                }}>
                {m === "email" ? "Email" : "Mobile"}
              </button>
            ))}
          </div>

          <form onSubmit={mode === "phone" ? (otpSent ? verifyOtp : sendOtp) : handleLogin}>
            {error && (
              <div
                role="alert"
                aria-live="polite"
                style={{
                  background: "#FEF2F2", color: C.red,
                  padding: "10px 12px", borderRadius: 8,
                  fontSize: 13, marginBottom: 16,
                  border: "1px solid #FECACA",
                }}
              >
                {error}
              </div>
            )}

            {mode === "phone" ? (
              <>
                <label htmlFor="phone" style={labelStyle}>MOBILE NUMBER</label>
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <span style={{ ...inputBase, width: 62, display: "flex", alignItems: "center",
                                 justifyContent: "center", color: C.textMid, background: C.vault }}>+91</span>
                  <input
                    id="phone" name="phone" type="tel" inputMode="numeric"
                    value={phone} onChange={e => setPhone(e.target.value)}
                    required autoComplete="tel" autoFocus
                    placeholder="98765 43210"
                    disabled={busy || otpSent}
                    onFocus={onFocus} onBlur={onBlur}
                    style={{ ...inputBase, flex: 1 }}
                  />
                </div>

                {otpSent && (
                  <>
                    <label htmlFor="otp" style={labelStyle}>6-DIGIT CODE</label>
                    <input
                      id="otp" name="otp" inputMode="numeric" maxLength={6}
                      value={otp} onChange={e => setOtp(e.target.value)}
                      required autoComplete="one-time-code" autoFocus
                      placeholder="123456"
                      disabled={busy}
                      onFocus={onFocus} onBlur={onBlur}
                      style={{ ...inputBase, marginBottom: 8, letterSpacing: 6, textAlign: "center" }}
                    />
                    <div style={{ textAlign: "right", marginBottom: 16 }}>
                      <button type="button" onClick={() => { setOtpSent(false); setOtp(""); }}
                        style={{ background: "none", border: "none", color: C.textMid,
                                 fontSize: 12, cursor: "pointer", padding: 0 }}>
                        Wrong number?
                      </button>
                    </div>
                  </>
                )}

                <button type="submit" disabled={busy} style={{
                  width: "100%", padding: "13px", fontSize: 15, fontWeight: 700,
                  background: busy ? C.borderHi : C.grad, color: "#fff",
                  border: "none", borderRadius: 10, cursor: busy ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  marginBottom: 16,
                }}>
                  {loading
                    ? <><Loader2 size={16} className="hn-spin" /> {otpSent ? "Verifying…" : "Sending…"}</>
                    : otpSent ? "Verify and sign in" : "Send code"}
                </button>
              </>
            ) : (
            <>
            <label htmlFor="email" style={labelStyle}>EMAIL</label>
            <input
              id="email" name="email" type="email"
              value={email} onChange={e => setEmail(e.target.value)}
              required autoComplete="email" autoFocus
              placeholder="you@business.in"
              disabled={busy}
              onFocus={onFocus} onBlur={onBlur}
              style={{ ...inputBase, marginBottom: 16 }}
            />

            <label htmlFor="password" style={labelStyle}>PASSWORD</label>
            <div style={{ position: "relative", marginBottom: 8 }}>
              <input
                id="password" name="password"
                type={showPw ? "text" : "password"}
                value={password} onChange={e => setPassword(e.target.value)}
                required autoComplete="current-password"
                placeholder="••••••••"
                disabled={busy}
                onFocus={onFocus} onBlur={onBlur}
                style={{ ...inputBase, paddingRight: 44 }}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
                style={{
                  position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer",
                  padding: 8, color: C.textDim, display: "grid", placeItems: "center",
                }}
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <div style={{ textAlign: "right", marginBottom: 16 }}>
              <Link href="/forgot-password" style={{ color: C.textMid, fontSize: 12, textDecoration: "none" }}>
                Forgot password?
              </Link>
            </div>

            <button type="submit" disabled={busy} style={{
              width: "100%", padding: "13px", fontSize: 15, fontWeight: 700,
              background: busy ? C.borderHi : C.grad,
              color: "#FFFFFF", border: "none", borderRadius: 10,
              cursor: busy ? "not-allowed" : "pointer", marginBottom: 16,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "filter .15s ease",
            }}>
              {loading
                ? <><Loader2 size={16} className="hn-spin" /> Signing in…</>
                : <>Sign In →</>}
            </button>

            </>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.textDim, fontSize: 11, margin: "16px 0" }}>
              <div style={{ flex: 1, height: 1, background: C.border }} />
              OR
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>

            <button type="button" onClick={handleGoogle} disabled={busy} style={{
              width: "100%", padding: "12px", fontSize: 14, fontWeight: 600,
              background: C.surface, color: C.ink,
              border: `1px solid ${C.border}`, borderRadius: 10,
              cursor: busy ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            }}>
              {/* Google's own mark. This was a lucide key glyph, which is the
                  icon for a password — the opposite of what the button does. */}
              <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
                <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.9c-.5 2.8-2.1 5.1-4.4 6.7v5.6h7.1c4.2-3.8 6.5-9.5 6.5-16.5z"/>
                <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.6-5.3l-7.1-5.6c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.2v5.8C7.9 41.2 15.4 46 24 46z"/>
                <path fill="#FBBC05" d="M11.6 28.1c-.4-1.3-.7-2.7-.7-4.1s.2-2.8.7-4.1v-5.8H4.2C2.8 17 2 20.4 2 24s.8 7 2.2 9.9l7.4-5.8z"/>
                <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.4 2 7.9 6.8 4.2 14.1l7.4 5.8c1.7-5.2 6.6-9.1 12.4-9.1z"/>
              </svg>
              {googleLoading ? "Redirecting…" : "Continue with Google"}
            </button>
          </form>
        </div>

        <div style={{ textAlign: "center", marginTop: 24, fontSize: 13, color: C.textMid }}>
          New to HeyNikki?{" "}
          <Link href="/signup" style={{ color: C.emerald, fontWeight: 700, textDecoration: "none" }}>
            Start free — 100 minutes →
          </Link>
        </div>
      </div>

      <style>{`
        @keyframes hn-spin-kf { to { transform: rotate(360deg); } }
        .hn-spin { animation: hn-spin-kf .8s linear infinite; }
      `}</style>
    </div>
  );
}
