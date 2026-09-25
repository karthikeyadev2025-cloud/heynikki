"use client";
import Link from "next/link";
import NikkiLogo from "./NikkiLogo";

const J = {
  bg: "#FFFFFF", vault: "#F6F8FB", border: "#E2E8F0",
  mercury: "#12457A", surya: "#E5533D", chandra: "#0F172A",
  textMid: "#475569", textDim: "#94A3B8",
};

// Pricing and Contact share this frame with the legal pages, so the eyebrow,
// the date line and the width are the page's to choose: a pricing page
// labelled "Legal" with a "Last updated" stamp read as a policy document.
export default function LegalLayout({
  title, lastUpdated, children, eyebrow = "Legal", lede, updatedLabel = "Last updated:", wide = false,
}: {
  title: string; lastUpdated?: string; children: React.ReactNode;
  eyebrow?: string; lede?: React.ReactNode; updatedLabel?: string; wide?: boolean;
}) {
  return (
    <div style={{ minHeight: "100vh", background: J.bg, color: J.chandra }}>
      <nav style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(255, 255, 255, 0.90)", backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${J.border}`,
        padding: "16px 5%", display: "flex",
        justifyContent: "space-between", alignItems: "center",
      }}>
        <Link href="/" style={{ textDecoration: "none" }}>
          <NikkiLogo size={36} variant="horizontal" />
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Link href="/" className="ll-home" style={{
            color: J.textMid, fontSize: 14, fontWeight: 600, textDecoration: "none",
          }}>← Back to home</Link>
          <Link href="/signup" style={{
            background: J.mercury, color: "#fff", fontSize: 14, fontWeight: 600,
            padding: "9px 16px", borderRadius: 999, textDecoration: "none", whiteSpace: "nowrap",
          }}>Start free</Link>
        </div>
      </nav>

      {/* Body text was #D1D5DB — a grey meant for the old dark theme, left
          behind on white, where every paragraph of every policy was faint. */}
      <article style={{
        maxWidth: wide ? 1080 : 760, margin: "0 auto", padding: "56px 24px 80px",
        fontSize: 15.5, lineHeight: 1.7, color: J.textMid,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          fontFamily: "var(--font-mono), monospace", fontSize: 12, color: J.mercury,
          letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 14,
        }}><span aria-hidden style={{ width: 18, height: 1, background: J.mercury }} />{eyebrow}</div>
        <h1 style={{
          fontFamily: "var(--font-display), sans-serif", fontSize: "clamp(32px, 5vw, 46px)", fontWeight: 700,
          color: J.chandra, margin: "0 0 12px", letterSpacing: "-0.03em", lineHeight: 1.08,
        }}>{title}</h1>
        {lede && <p style={{ color: J.textMid, fontSize: 18, lineHeight: 1.6, margin: "0 0 12px", maxWidth: 640 }}>{lede}</p>}
        {lastUpdated
          ? <p style={{ color: J.textDim, fontSize: 13, marginBottom: 40 }}>{updatedLabel} {lastUpdated}</p>
          : <div style={{ height: 28 }} />}

        <style>{`
          .legal h2 { font-size: 22px; font-weight: 800; color: #0F172A; margin: 36px 0 12px; }
          .legal h3 { font-size: 17px; font-weight: 700; color: #0F172A; margin: 24px 0 8px; }
          .legal p  { margin: 0 0 14px; }
          .legal ul { margin: 0 0 14px; padding-left: 24px; }
          .legal li { margin-bottom: 6px; }
          .legal a  { color: #12457A; text-decoration: underline; }
          .legal a:hover { text-decoration: underline; }
          .legal strong { color: #0F172A; }
          .legal hr { border: 0; border-top: 1px solid #E2E8F0; margin: 32px 0; }
          .legal h2 { font-family: var(--font-display), sans-serif; letter-spacing: -0.015em; font-weight: 700; }
          @media (max-width: 560px) { .ll-home { display: none; } }
        `}</style>
        <div className="legal">{children}</div>
      </article>

      <footer style={{
        borderTop: `1px solid ${J.border}`,
        padding: "32px 5%", textAlign: "center",
        color: J.textMid, fontSize: 13,
      }}>
        <div style={{ marginBottom: 12 }}>
          © {new Date().getFullYear()} Nikki Technologies · a unit of Adexos Global Technologies · Made in India
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
