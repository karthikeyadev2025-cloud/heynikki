"use client";

import Link from "next/link";
import { NIKKI } from "../lib/brand";
import NikkiLogo from "./NikkiLogo";

const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, bord: NIKKI.border,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
  accent: NIKKI.emerald, teal: NIKKI.teal,
};

/**
 * Shell for the marketing pages that exist to be found.
 *
 * The site had one page with product content on it, which is a hard ceiling
 * on what it can rank for: a single page cannot be the best answer to "Telugu
 * AI receptionist", "AI telecaller" and "call answering for clinics" at once.
 * These pages each answer one real question properly, and are linked from
 * each other so a crawler can reach them all from the homepage.
 */
export default function ContentPage({
  h1, lede, children, cta = "Start free — 100 minutes", eyebrow,
}: {
  h1: string; lede: string; children: React.ReactNode; cta?: string; eyebrow?: string;
}) {
  // Fonts are the ones app/layout.tsx actually defines. This used
  // --font-bricolage / --font-manrope / --font-noto-telugu, none of which
  // exist, so every page on this frame (About, the Telugu receptionist and
  // telecaller pages, clinics, real estate, alternatives) fell back to the
  // system font — and the Telugu examples to whatever the phone had.
  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.txt,
      fontFamily: "var(--font-body), system-ui, sans-serif" }}>
      <nav style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "rgba(255,255,255,0.9)", backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${C.bord}`, padding: "14px 5%",
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16,
      }}>
        <Link href="/" style={{ textDecoration: "none" }}><NikkiLogo size={34} variant="horizontal" /></Link>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Link href="/pricing" className="cp-link" style={{ color: C.mid, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>Pricing</Link>
          <Link href="/contact" className="cp-link" style={{ color: C.mid, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>Contact</Link>
          <Link href="/signup" style={{ background: C.teal, color: "#fff", fontSize: 14, fontWeight: 600,
            padding: "9px 16px", borderRadius: 999, textDecoration: "none", whiteSpace: "nowrap" }}>Start free</Link>
        </div>
      </nav>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 24px 90px" }}>
        {eyebrow && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 56,
            fontFamily: "var(--font-mono), monospace", fontSize: 12, color: C.teal,
            letterSpacing: "0.14em", textTransform: "uppercase" }}>
            <span aria-hidden style={{ width: 18, height: 1, background: C.teal }} />{eyebrow}
          </div>
        )}
        <h1 style={{ fontFamily: "var(--font-display), sans-serif", fontWeight: 700,
          fontSize: "clamp(32px,5.4vw,48px)", lineHeight: 1.08, letterSpacing: "-.03em",
          margin: eyebrow ? "14px 0 16px" : "56px 0 16px", textWrap: "balance" }}>{h1}</h1>

        <p style={{ fontSize: 19, lineHeight: 1.6, color: C.mid, margin: "0 0 30px" }}>{lede}</p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 48 }}>
          <Link href="/signup" style={{ background: C.teal, color: "#fff",
            padding: "12px 22px", borderRadius: 999, fontWeight: 600, fontSize: 15,
            textDecoration: "none" }}>{cta}</Link>
          <a href="tel:08633502031" style={{ border: "1px solid #D8DFE8", color: C.txt,
            padding: "12px 20px", borderRadius: 999, fontWeight: 600, fontSize: 15,
            textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: "#22C55E",
              boxShadow: "0 0 0 4px rgba(34,197,94,0.16)" }} />
            Or call her: 086335 02031
          </a>
        </div>

        <article className="prose">{children}</article>

      {/* Breadcrumbs turn a bare URL in the result into a readable path, and
          tell Google these pages hang off the homepage rather than floating
          on their own. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "HeyNikki", item: "https://www.heynikki.in" },
          { "@type": "ListItem", position: 2, name: h1 },
        ],
      })}} />

        <nav style={{ marginTop: 56, paddingTop: 26, borderTop: `1px solid ${C.bord}`,
          display: "flex", gap: "10px 18px", flexWrap: "wrap", fontSize: 14.5 }}>
          <Link href="/telugu-ai-receptionist" style={{ color: C.teal }}>Telugu AI receptionist</Link>
          <Link href="/ai-telecaller" style={{ color: C.teal }}>AI telecaller</Link>
          <Link href="/for/clinics" style={{ color: C.teal }}>For clinics</Link>
          <Link href="/for/real-estate" style={{ color: C.teal }}>For real estate</Link>
          <Link href="/alternatives" style={{ color: C.teal }}>Compare options</Link>
          <Link href="/pricing" style={{ color: C.teal }}>Pricing</Link>
          <Link href="/about" style={{ color: C.teal }}>About</Link>
        </nav>
      </div>

      <footer style={{ borderTop: `1px solid ${C.bord}`, padding: "28px 5%", textAlign: "center",
        color: C.mid, fontSize: 13 }}>
        © {new Date().getFullYear()} Nikki Technologies · a unit of Adexos Global Technologies · Made in India
        <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap", marginTop: 10 }}>
          <Link href="/privacy" style={{ color: C.mid, textDecoration: "none" }}>Privacy</Link>
          <Link href="/terms" style={{ color: C.mid, textDecoration: "none" }}>Terms</Link>
          <Link href="/refund-policy" style={{ color: C.mid, textDecoration: "none" }}>Refund</Link>
          <Link href="/contact" style={{ color: C.mid, textDecoration: "none" }}>Contact</Link>
        </div>
      </footer>

      <style>{`
        .prose h2 { font-family: var(--font-display), sans-serif; font-weight: 700;
          font-size: 26px; letter-spacing: -.02em; margin: 44px 0 12px; color: ${C.txt}; }
        .prose h3 { font-size: 17.5px; font-weight: 700; margin: 26px 0 8px; color: ${C.txt}; }
        .prose p  { font-size: 16.5px; line-height: 1.7; color: ${C.mid}; margin: 0 0 15px; }
        .prose li { font-size: 16.5px; line-height: 1.6; color: ${C.mid}; margin-bottom: 8px; }
        .prose ul { padding-left: 22px; margin: 0 0 18px; }
        .prose strong { color: ${C.txt}; font-weight: 700; }
        .prose a { color: ${C.teal}; }
        .prose .te { font-family: var(--font-telugu), sans-serif; }
        @media (max-width: 560px) { .cp-link { display: none; } }
      `}</style>
    </div>
  );
}

/** FAQ block that renders visibly AND as schema, from one source. */
export function Faq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <>
      <h2>Common questions</h2>
      {items.map((f, i) => (
        <div key={i} style={{ marginBottom: 18 }}>
          <h3 style={{ margin: "0 0 5px" }}>{f.q}</h3>
          <p style={{ margin: 0 }}>{f.a}</p>
        </div>
      ))}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map(f => ({
          "@type": "Question", name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      })}} />
    </>
  );
}
