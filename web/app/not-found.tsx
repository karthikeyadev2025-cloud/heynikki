"use client";
import Link from "next/link";
import NikkiLogo from "@/components/NikkiLogo";

export default function NotFound() {
  return (
    <div style={{
      minHeight: "100vh", background: "#070B19", color: "#F8FAFC",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{ textAlign: "center", maxWidth: 480 }}>
        <div style={{ marginBottom: 24, display: "inline-block" }}>
          <NikkiLogo size={80} variant="icon" />
        </div>
        <h1 style={{ fontSize: 48, fontWeight: 900, margin: "0 0 12px", color: "#F8FAFC" }}>404</h1>
        <p style={{ color: "#9CA3AF", fontSize: 16, marginBottom: 32 }}>
          This page doesn't exist on Nikki.
        </p>
        <Link href="/" style={{
          display: "inline-block",
          background: "linear-gradient(135deg, #F59E0B 0%, #00E676 100%)",
          color: "#070B19", padding: "12px 28px", borderRadius: 10,
          textDecoration: "none", fontWeight: 700, fontSize: 14,
        }}>← Back to Nikki</Link>
      </div>
    </div>
  );
}
