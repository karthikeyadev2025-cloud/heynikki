"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase";
import NikkiLogo from "../../components/NikkiLogo";

const J = {
  bg: "#070B19", vault: "#111827", surface: "#1A2235",
  border: "#1F2937", borderHi: "#374151",
  mercury: "#00E676", surya: "#F59E0B", chandra: "#F8FAFC",
  textMid: "#9CA3AF", textDim: "#4B5563", red: "#EF4444",
  grad: "linear-gradient(135deg, #F59E0B 0%, #00E676 100%)",
};

export default function ForgotPasswordPage() {
  const [email, setEmail]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [sent, setSent]       = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const sb = createClient();

    // Build a callback URL so Supabase redirects users back to the reset page
    // on this same origin after they click the email link.
    const redirectTo = `${window.location.origin}/reset-password`;

    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo });

    setLoading(false);

    if (error) {
      // We deliberately do NOT leak whether an account exists — show success
      // either way (prevents account-enumeration). Only show error for
      // network / rate-limit issues.
      if (error.message.toLowerCase().includes("rate")) {
        setError("Too many requests. Try again in a minute.");
        return;
      }
      // Other failures still bucket into the generic success message
      // so attackers can't probe email existence.
    }

    setSent(true);
  };

  return (
    <div style={{ minHeight: "100vh", background: J.bg, display: "flex",
                  alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 32 }}>
          <Link href="/"><NikkiLogo size={48} variant="stacked" /></Link>
        </div>

        <div style={{ background: J.vault, border: `1px solid ${J.border}`,
                      borderRadius: 16, padding: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: J.chandra,
                       marginBottom: 8, fontFamily: "var(--font-orbitron), system-ui, sans-serif" }}>
            Reset your password
          </h1>
          <p style={{ fontSize: 13, color: J.textMid, marginBottom: 24, lineHeight: 1.5 }}>
            {sent
              ? "If an account exists for that email, we've sent a password reset link. Check your inbox — including spam."
              : "Enter the email on your Nikki account and we'll send you a reset link."}
          </p>

          {!sent && (
            <form onSubmit={handleSubmit}>
              <label style={{ display: "block", fontSize: 11, color: J.textMid,
                              marginBottom: 6, textTransform: "uppercase",
                              letterSpacing: 1 }}>
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@business.in"
                style={{
                  width: "100%", padding: "12px 14px", fontSize: 14,
                  background: J.surface, border: `1px solid ${J.borderHi}`,
                  borderRadius: 10, color: J.chandra, marginBottom: 20, outline: "none",
                }}
              />

              {error && (
                <div style={{ background: J.red + "22", border: `1px solid ${J.red}`,
                              color: J.red, padding: 10, borderRadius: 8,
                              fontSize: 13, marginBottom: 16 }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email.trim()}
                style={{
                  width: "100%", padding: "12px", fontSize: 14, fontWeight: 700,
                  background: loading ? J.surface : J.grad,
                  color: loading ? J.textMid : "#0F1A2E",
                  border: "none", borderRadius: 10,
                  cursor: loading ? "wait" : "pointer",
                }}
              >
                {loading ? "Sending…" : "Send reset link"}
              </button>
            </form>
          )}

          {sent && (
            <Link href="/login" style={{
              display: "block", textAlign: "center", padding: "12px",
              background: J.surface, color: J.chandra,
              border: `1px solid ${J.border}`, borderRadius: 10,
              textDecoration: "none", fontWeight: 600, fontSize: 14,
            }}>
              ← Back to login
            </Link>
          )}
        </div>

        {!sent && (
          <div style={{ textAlign: "center", marginTop: 24, fontSize: 13, color: J.textMid }}>
            Remembered it?{" "}
            <Link href="/login" style={{ color: J.mercury, fontWeight: 700, textDecoration: "none" }}>
              Back to login
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
