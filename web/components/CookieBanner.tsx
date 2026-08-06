"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * DPDP Act 2023 cookie consent banner.
 *
 * Stores acknowledgement in localStorage so it doesn't reappear. Note:
 * the underlying app only uses ESSENTIAL cookies (Supabase session,
 * CSRF token), so we present this as a notice + acknowledge rather than
 * an opt-in/opt-out toggle. If we ever add advertising / analytics
 * cookies, replace this with a proper consent UI with per-category
 * toggles BEFORE setting those cookies.
 */
export default function CookieBanner() {
  const [ack, setAck] = useState(true); // hide while we check localStorage

  useEffect(() => {
    try {
      setAck(localStorage.getItem("nikki-cookie-ack") === "1");
    } catch {
      // localStorage blocked (private mode / disabled cookies). Show banner
      // but accept clicks won't persist — that's fine, just shows again next visit.
      setAck(false);
    }
  }, []);

  const accept = () => {
    try { localStorage.setItem("nikki-cookie-ack", "1"); } catch {}
    setAck(true);
  };

  if (ack) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie notice"
      style={{
        position: "fixed", bottom: 16, left: 16, right: 16,
        maxWidth: 720, margin: "0 auto", zIndex: 9999,
        background: "#0F172A",
        border: "1px solid #1E293B", borderRadius: 14,
        padding: "16px 20px",
        boxShadow: "0 20px 40px rgba(0, 0, 0, 0.5)",
        display: "flex", flexWrap: "wrap", gap: 14,
        alignItems: "center", justifyContent: "space-between",
        fontSize: 13, color: "#D1D5DB",
      }}
    >
      <div style={{ flex: "1 1 320px" }}>
        We use only <strong style={{ color: "#F8FAFC" }}>essential cookies</strong> —
        for login session and CSRF protection. No ads, no third-party tracking.{" "}
        <Link href="/privacy" style={{ color: "#12457A", textDecoration: "none" }}>
          Read our privacy policy →
        </Link>
      </div>
      <button
        onClick={accept}
        style={{
          padding: "10px 18px",
          background: "linear-gradient(135deg, #12457A 0%, #1D6FA5 100%)",
          color: "#FFFFFF",
          border: "none", borderRadius: 8,
          fontWeight: 800, fontSize: 13,
          cursor: "pointer",
        }}
      >
        Got it
      </button>
    </div>
  );
}
