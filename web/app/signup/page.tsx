"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase";
import NikkiLogo from "../../components/NikkiLogo";

const J = {
  bg: "#FAF6EF", vault: "#F3ECE1", surface: "#FFFFFF",
  border: "#E5DDD0", borderHi: "#D4C7B4",
  mercury: "#1A5C54", surya: "#E8623D", chandra: "#2B2420",
  textMid: "#8A7F73", textDim: "#B5A996", red: "#EF4444",
  grad: "linear-gradient(135deg, #E8623D 0%, #1A5C54 100%)",
};

export default function SignupPage() {
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      setLoading(false);
      return;
    }
    const sb = createClient();
    const { error: err } = await sb.auth.signUp({
      email, password,
      options: {
        data: { business_name: businessName },
        emailRedirectTo: window.location.origin + "/dashboard",
      },
    });
    if (err) { setError(err.message); setLoading(false); return; }
    setDone(true);
    setLoading(false);
  };

  if (done) {
    return (
      <div style={{ minHeight: "100vh", background: J.bg, color: J.chandra, display: "flex",
        alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{
          background: J.vault, border: `1px solid ${J.border}`,
          borderRadius: 16, padding: 40, maxWidth: 420, textAlign: "center",
        }}>
          <div style={{ marginBottom: 20, display: "inline-block" }}>
            <NikkiLogo size={64} variant="icon" />
          </div>
          <div style={{ fontSize: 52, marginBottom: 16 }}>📧</div>
          <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 8, color: J.chandra }}>
            Check your email
          </h2>
          <p style={{ color: J.textMid, fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
            We sent a confirmation link to<br />
            <span style={{ color: J.mercury, fontWeight: 700 }}>{email}</span>
          </p>
          <p style={{ color: J.textDim, fontSize: 12, marginBottom: 24 }}>
            Click the link to verify your account and start your 14-day free trial.
          </p>
          <Link href="/login" style={{
            display: "inline-block", background: J.grad, color: J.bg,
            padding: "12px 28px", borderRadius: 10, textDecoration: "none",
            fontWeight: 700, fontSize: 14,
          }}>Go to Sign In</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: J.bg, display: "flex",
      alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>

        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ marginBottom: 20, display: "inline-block" }}>
            <NikkiLogo size={84} variant="stacked" />
          </div>
          <h1 style={{
            fontSize: 22, fontWeight: 800, color: J.chandra,
            margin: "0 0 6px", letterSpacing: -0.5,
          }}>Start your free trial</h1>
          <div style={{ color: J.textMid, fontSize: 14 }}>
            14 days free · No credit card required
          </div>
        </div>

        <div style={{
          background: J.vault, border: `1px solid ${J.border}`,
          borderRadius: 16, padding: 32,
        }}>
          <form onSubmit={handleSignup}>
            {error && (
              <div style={{
                background: `${J.red}22`, color: J.red,
                padding: "10px 12px", borderRadius: 8,
                fontSize: 13, marginBottom: 16,
                border: `1px solid ${J.red}44`,
              }}>{error}</div>
            )}

            <label style={{ display: "block", color: J.textMid, fontSize: 11, marginBottom: 6, fontWeight: 700, letterSpacing: 0.5 }}>
              BUSINESS NAME
            </label>
            <input
              type="text" value={businessName} onChange={e => setBusinessName(e.target.value)}
              required placeholder="Ravi Clinic, Banjara Hills"
              style={{
                width: "100%", padding: "12px 14px", fontSize: 14,
                background: J.surface, border: `1px solid ${J.border}`, borderRadius: 10,
                color: J.chandra, marginBottom: 14, outline: "none",
              }}
            />

            <label style={{ display: "block", color: J.textMid, fontSize: 11, marginBottom: 6, fontWeight: 700, letterSpacing: 0.5 }}>
              EMAIL
            </label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              required placeholder="you@business.in"
              style={{
                width: "100%", padding: "12px 14px", fontSize: 14,
                background: J.surface, border: `1px solid ${J.border}`, borderRadius: 10,
                color: J.chandra, marginBottom: 14, outline: "none",
              }}
            />

            <label style={{ display: "block", color: J.textMid, fontSize: 11, marginBottom: 6, fontWeight: 700, letterSpacing: 0.5 }}>
              PASSWORD <span style={{ color: J.textDim, fontWeight: 400, letterSpacing: 0 }}>(min 8 chars)</span>
            </label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              required minLength={8} placeholder="••••••••"
              style={{
                width: "100%", padding: "12px 14px", fontSize: 14,
                background: J.surface, border: `1px solid ${J.border}`, borderRadius: 10,
                color: J.chandra, marginBottom: 20, outline: "none",
              }}
            />

            <button type="submit" disabled={loading} style={{
              width: "100%", padding: "13px", fontSize: 15, fontWeight: 700,
              background: loading ? J.surface : J.grad,
              color: loading ? J.textMid : J.bg, border: "none", borderRadius: 10,
              cursor: loading ? "wait" : "pointer", marginBottom: 10,
            }}>
              {loading ? "Creating account..." : "Start Free Trial →"}
            </button>

            <p style={{ fontSize: 11, color: J.textDim, textAlign: "center", margin: 0 }}>
              By signing up you agree to Nikki's Terms and Privacy Policy.
            </p>
          </form>
        </div>

        <div style={{ textAlign: "center", marginTop: 24, fontSize: 13, color: J.textMid }}>
          Already have an account?{" "}
          <Link href="/login" style={{ color: J.mercury, fontWeight: 700, textDecoration: "none" }}>
            Sign in →
          </Link>
        </div>
      </div>
    </div>
  );
}
