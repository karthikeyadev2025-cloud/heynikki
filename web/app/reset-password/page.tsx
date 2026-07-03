"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

export default function ResetPasswordPage() {
  const router = useRouter();
  const [pw, setPw]           = useState("");
  const [pw2, setPw2]         = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [ready, setReady]     = useState(false);

  // Supabase delivers the recovery session in the URL hash on page load.
  // We wait for the auth state to settle before showing the form.
  useEffect(() => {
    const sb = createClient();
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });

    // Also handle the case where the session is already established
    sb.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (pw.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (pw !== pw2) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const sb = createClient();
    const { error } = await sb.auth.updateUser({ password: pw });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }
    router.push("/dashboard");
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
            Set a new password
          </h1>
          <p style={{ fontSize: 13, color: J.textMid, marginBottom: 24, lineHeight: 1.5 }}>
            {ready
              ? "Choose a strong password — at least 8 characters."
              : "Verifying your reset link…"}
          </p>

          {ready ? (
            <form onSubmit={handleSubmit}>
              <label style={{ display: "block", fontSize: 11, color: J.textMid,
                              marginBottom: 6, textTransform: "uppercase",
                              letterSpacing: 1 }}>
                New password
              </label>
              <input
                type="password"
                required
                value={pw}
                onChange={e => setPw(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: "100%", padding: "12px 14px", fontSize: 14,
                  background: J.surface, border: `1px solid ${J.borderHi}`,
                  borderRadius: 10, color: J.chandra, marginBottom: 16, outline: "none",
                }}
              />

              <label style={{ display: "block", fontSize: 11, color: J.textMid,
                              marginBottom: 6, textTransform: "uppercase",
                              letterSpacing: 1 }}>
                Confirm
              </label>
              <input
                type="password"
                required
                value={pw2}
                onChange={e => setPw2(e.target.value)}
                placeholder="••••••••"
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
                disabled={loading}
                style={{
                  width: "100%", padding: "12px", fontSize: 14, fontWeight: 700,
                  background: loading ? J.surface : J.grad,
                  color: loading ? J.textMid : "#0F1A2E",
                  border: "none", borderRadius: 10,
                  cursor: loading ? "wait" : "pointer",
                }}
              >
                {loading ? "Updating…" : "Update password & sign in"}
              </button>
            </form>
          ) : (
            <div style={{ textAlign: "center", padding: 20, color: J.textMid }}>
              <div style={{ marginBottom: 12, fontSize: 20 }}>⏳</div>
              <div style={{ fontSize: 13 }}>If this hangs, the link may be expired.</div>
              <Link href="/forgot-password" style={{
                display: "inline-block", marginTop: 16,
                color: J.mercury, fontWeight: 600, fontSize: 13, textDecoration: "none",
              }}>
                Request a new link →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
