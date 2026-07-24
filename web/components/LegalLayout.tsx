"use client";
import Link from "next/link";
import NikkiLogo from "./NikkiLogo";

const J = {
  bg: "#070B19", vault: "#111827", border: "#1F2937",
  mercury: "#00E676", surya: "#F59E0B", chandra: "#F8FAFC",
  textMid: "#9CA3AF", textDim: "#4B5563",
};

export default function LegalLayout({
  title, lastUpdated, children,
}: { title: string; lastUpdated: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: J.bg, color: J.chandra }}>
      <nav style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(7, 11, 25, 0.85)", backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${J.border}`,
        padding: "16px 5%", display: "flex",
        justifyContent: "space-between", alignItems: "center",
      }}>
        <Link href="/" style={{ textDecoration: "none" }}>
          <NikkiLogo size={36} variant="horizontal" />
        </Link>
        <Link href="/" style={{
          color: J.textMid, fontSize: 14, fontWeight: 600, textDecoration: "none",
        }}>← Back to home</Link>
      </nav>

      <article style={{
        maxWidth: 760, margin: "0 auto", padding: "60px 24px 80px",
        fontSize: 15, lineHeight: 1.7, color: "#D1D5DB",
      }}>
        <div style={{
          fontSize: 12, color: J.surya, fontWeight: 800,
          letterSpacing: 2, textTransform: "uppercase", marginBottom: 12,
        }}>Legal</div>
        <h1 style={{
          fontSize: 36, fontWeight: 900, color: J.chandra,
          margin: "0 0 12px", letterSpacing: -1,
        }}>{title}</h1>
        <p style={{ color: J.textMid, fontSize: 13, marginBottom: 40 }}>
          Last updated: {lastUpdated}
        </p>

        <style>{`
          .legal h2 { font-size: 22px; font-weight: 800; color: #F8FAFC; margin: 36px 0 12px; }
          .legal h3 { font-size: 17px; font-weight: 700; color: #F8FAFC; margin: 24px 0 8px; }
          .legal p  { margin: 0 0 14px; }
          .legal ul { margin: 0 0 14px; padding-left: 24px; }
          .legal li { margin-bottom: 6px; }
          .legal a  { color: #00E676; text-decoration: none; }
          .legal a:hover { text-decoration: underline; }
          .legal strong { color: #F8FAFC; }
          .legal hr { border: 0; border-top: 1px solid #1F2937; margin: 32px 0; }
        `}</style>
        <div className="legal">{children}</div>
      </article>

      <footer style={{
        borderTop: `1px solid ${J.border}`,
        padding: "32px 5%", textAlign: "center",
        color: J.textMid, fontSize: 13,
      }}>
        <div style={{ marginBottom: 12 }}>
          © {new Date().getFullYear()} Nikki Technologies. Made in India 🇮🇳
        </div>
        <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/privacy"        style={{ color: J.textMid, textDecoration: "none" }}>Privacy</Link>
          <Link href="/terms"          style={{ color: J.textMid, textDecoration: "none" }}>Terms</Link>
          <Link href="/refund-policy"  style={{ color: J.textMid, textDecoration: "none" }}>Refund</Link>
          <Link href="/pricing"        style={{ color: J.textMid, textDecoration: "none" }}>Pricing</Link>
          <Link href="/contact"        style={{ color: J.textMid, textDecoration: "none" }}>Contact</Link>
        </div>
      </footer>
    </div>
  );
}
