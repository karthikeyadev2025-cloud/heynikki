"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase";
import NikkiLogo from "../../components/NikkiLogo";
import { Key } from "lucide-react";

const J = {
  bg: "#FFFFFF", vault: "#F6F8FB", surface: "#FFFFFF",
  border: "#E2E8F0", borderHi: "#CBD5E1",
  mercury: "#12457A", surya: "#E5533D", chandra: "#0F172A",
  textMid: "#475569", textDim: "#94A3B8", red: "#EF4444",
  grad: "linear-gradient(135deg, #12457A 0%, #1D6FA5 100%)",
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const sb = createClient();
    const { error: err } = await sb.auth.signInWithPassword({ email, password });
    if (err) { setError(err.message); setLoading(false); return; }
    window.location.href = "/dashboard";
  };

  const handleGoogle = async () => {
    const sb = createClient();
    await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/dashboard" },
    });
  };

  return (
    <div style={{ minHeight: "100vh", background: J.bg, color: J.chandra, display: "flex",
      alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>

        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ marginBottom: 20, display: "inline-block" }}>
            <NikkiLogo size={84} variant="stacked" />
          </div>
          <h1 style={{
            fontSize: 22, fontWeight: 800, color: J.chandra,
            margin: "0 0 6px", letterSpacing: -0.5,
          }}>Welcome back</h1>
          <div style={{ color: J.textMid, fontSize: 14 }}>
            Sign in to your Nikki account
          </div>
        </div>

        <div style={{
          background: J.vault, border: `1px solid ${J.border}`,
          borderRadius: 16, padding: 32,
        }}>
          <form onSubmit={handleLogin}>
            {error && (
              <div style={{
                background: `${J.red}22`, color: J.red,
                padding: "10px 12px", borderRadius: 8,
                fontSize: 13, marginBottom: 16,
                border: `1px solid ${J.red}44`,
              }}>{error}</div>
            )}

            <label style={{ display: "block", color: J.textMid, fontSize: 11, marginBottom: 6, fontWeight: 700, letterSpacing: 0.5 }}>
              EMAIL
            </label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              required placeholder="you@business.in"
              style={{
                width: "100%", padding: "12px 14px", fontSize: 14,
                background: J.surface, border: `1px solid ${J.border}`, borderRadius: 10,
                color: J.chandra, marginBottom: 16, outline: "none",
              }}
            />

            <label style={{ display: "block", color: J.textMid, fontSize: 11, marginBottom: 6, fontWeight: 700, letterSpacing: 0.5 }}>
              PASSWORD
            </label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              required placeholder="••••••••"
              style={{
                width: "100%", padding: "12px 14px", fontSize: 14,
                background: J.surface, border: `1px solid ${J.border}`, borderRadius: 10,
                color: J.chandra, marginBottom: 8, outline: "none",
              }}
            />

            <div style={{ textAlign: "right", marginBottom: 16 }}>
              <Link
                href="/forgot-password"
                style={{ color: J.textMid, fontSize: 12, textDecoration: "none" }}
              >
                Forgot password?
              </Link>
            </div>

            <button type="submit" disabled={loading} style={{
              width: "100%", padding: "13px", fontSize: 15, fontWeight: 700,
              background: loading ? J.surface : J.grad,
              color: loading ? J.textMid : J.bg, border: "none", borderRadius: 10,
              cursor: loading ? "wait" : "pointer", marginBottom: 16,
            }}>
              {loading ? "Signing in..." : "Sign In →"}
            </button>

            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              color: J.textDim, fontSize: 11, margin: "16px 0",
            }}>
              <div style={{ flex: 1, height: 1, background: J.border }} />
              OR
              <div style={{ flex: 1, height: 1, background: J.border }} />
            </div>

            <button type="button" onClick={handleGoogle} style={{
              width: "100%", padding: "12px", fontSize: 14, fontWeight: 600,
              background: J.surface, color: J.chandra,
              border: `1px solid ${J.border}`, borderRadius: 10, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            }}>
              <Key size={15} /> Continue with Google
            </button>
          </form>
        </div>

        <div style={{ textAlign: "center", marginTop: 24, fontSize: 13, color: J.textMid }}>
          New to Nikki?{" "}
          <Link href="/signup" style={{ color: J.mercury, fontWeight: 700, textDecoration: "none" }}>
            Start free trial →
          </Link>
        </div>
      </div>
    </div>
  );
}
