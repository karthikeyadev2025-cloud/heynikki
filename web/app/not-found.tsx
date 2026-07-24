"use client";
import Link from "next/link";
import NikkiLogo from "@/components/NikkiLogo";

export default function NotFound() {
  return (
    <div style={{
      minHeight: "100vh", background: "#FDFBF7", color: "#1F1915",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{ textAlign: "center", maxWidth: 480 }}>
        <div style={{ marginBottom: 24, display: "inline-block" }}>
          <NikkiLogo size={80} variant="icon" />
        </div>
        <h1 style={{ fontSize: 48, fontWeight: 900, margin: "0 0 12px", color: "#1F1915" }}>404</h1>
        <p style={{ color: "#6B6055", fontSize: 16, marginBottom: 32 }}>
          This page doesn't exist on Hey Nikki.
        </p>
        <Link href="/" style={{
          display: "inline-block",
          background: "linear-gradient(135deg, #F97316 0%, #E5533D 100%)",
          color: "#FDFBF7", padding: "12px 28px", borderRadius: 10,
          textDecoration: "none", fontWeight: 700, fontSize: 14,
        }}>← Back to Hey Nikki</Link>
      </div>
    </div>
  );
}
