"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase";
import NikkiLogo from "../../components/NikkiLogo";
import { Mail } from "lucide-react";

const J = {
  bg: "#FFFFFF", vault: "#F6F8FB", surface: "#FFFFFF",
  border: "#E2E8F0", borderHi: "#CBD5E1",
  mercury: "#12457A", surya: "#E5533D", chandra: "#0F172A",
  textMid: "#475569", textDim: "#94A3B8", red: "#EF4444",
  grad: "linear-gradient(135deg, #12457A 0%, #1D6FA5 100%)",
};

export default function SignupPage() {
  // An invited colleague arrives at /signup?invite=<token>. Their account is
  // created the normal way — the signup trigger even gives them their own
  // empty tenant — and the token is redeemed straight afterwards, which
  // moves them onto the team that invited them and clears the shell.
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("invite");
    if (t) setInviteToken(t);
  }, []);

  const [businessName, setBusinessName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
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
        // Carried into handle_new_user, which normalises it and writes it to
        // the owner's tenant_users row. Without it there is no address for a
        // single onboarding message — the first thing a customer would hear
        // from HeyNikki is a message their own caller triggered.
        data: { business_name: businessName, owner_phone: ownerPhone },
        // The invite rides through the verification link, because there is
        // no session to redeem it with until the address is confirmed.
        // Stored locally too, in case they verify in a different tab.
        emailRedirectTo: window.location.origin + "/dashboard"
          + (inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ""),
      },
    });
    if (err) { setError(err.message); setLoading(false); return; }
    if (inviteToken) { try { localStorage.setItem("nikki_invite", inviteToken); } catch {} }
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
          <div style={{ marginBottom: 16, display: "flex", justifyContent: "center" }}><Mail size={44} /></div>
          <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 8, color: J.chandra }}>
            Check your email
          </h2>
          <p style={{ color: J.textMid, fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
            We sent a confirmation link to<br />
            <span style={{ color: J.mercury, fontWeight: 700 }}>{email}</span>
          </p>
          <p style={{ color: J.textDim, fontSize: 12, marginBottom: 24 }}>
            Click the link to verify your account and start with 100 free minutes.
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
          }}>Start free — 100 minutes</h1>
          <div style={{ color: J.textMid, fontSize: 14 }}>
            100 minutes free · No credit card required
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
              YOUR WHATSAPP NUMBER
            </label>
            <input
              type="tel" value={ownerPhone}
              onChange={e => setOwnerPhone(e.target.value.replace(/[^\d+ ]/g, ""))}
              required inputMode="numeric" placeholder="98765 43210"
              // The first organic signup typed eleven digits; last-10
              // truncation kept the wrong ten and their onboarding went to
              // a number starting with 4. Validate the shape HERE, where
              // the person who knows the right number is still looking.
              pattern="^(\+?91)?[\s]*[6-9][0-9\s]{9,13}$"
              title="10-digit mobile starting 6-9"
              style={{
                width: "100%", padding: "12px 14px", fontSize: 14,
                background: J.surface, border: `1px solid ${J.border}`, borderRadius: 10,
                color: J.chandra, marginBottom: 6, outline: "none",
              }}
            />
            <div style={{ color: J.textDim, fontSize: 11.5, marginBottom: 14, lineHeight: 1.5 }}>
              Where we send your setup updates. Not shown to your callers.
            </div>

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
              {loading ? "Creating account..." : "Start free →"}
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
