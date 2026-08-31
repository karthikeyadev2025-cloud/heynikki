"use client";

import Link from "next/link";
import { NIKKI } from "../lib/brand";

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
  h1, lede, children, cta = "Start free — 100 minutes",
}: {
  h1: string; lede: string; children: React.ReactNode; cta?: string;
}) {
  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.txt,
      fontFamily: "var(--font-manrope), system-ui, sans-serif" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 24px 90px" }}>

        <header style={{ padding: "28px 0 0" }}>
          <Link href="/" style={{ color: C.accent, textDecoration: "none",
            fontWeight: 800, fontSize: 17, letterSpacing: "-.02em" }}>
            HeyNikki
          </Link>
        </header>

        <h1 style={{ fontFamily: "var(--font-bricolage), sans-serif", fontWeight: 800,
          fontSize: "clamp(31px,5.4vw,48px)", lineHeight: 1.08, letterSpacing: "-.03em",
          margin: "44px 0 16px", textWrap: "balance" }}>{h1}</h1>

        <p style={{ fontSize: 19, lineHeight: 1.6, color: C.mid, margin: "0 0 30px" }}>{lede}</p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 44 }}>
          <Link href="/signup" style={{ background: C.accent, color: "#04140d",
            padding: "12px 22px", borderRadius: 10, fontWeight: 800, fontSize: 15,
            textDecoration: "none" }}>{cta}</Link>
          <a href="tel:08633502031" style={{ border: `1px solid ${C.bord}`, color: C.txt,
            padding: "12px 22px", borderRadius: 10, fontWeight: 700, fontSize: 15,
            textDecoration: "none" }}>Or call her: 086335 02031</a>
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
          display: "flex", gap: 18, flexWrap: "wrap", fontSize: 14.5 }}>
          <Link href="/telugu-ai-receptionist" style={{ color: C.teal }}>Telugu AI receptionist</Link>
          <Link href="/ai-telecaller" style={{ color: C.teal }}>AI telecaller</Link>
          <Link href="/for/clinics" style={{ color: C.teal }}>For clinics</Link>
          <Link href="/for/real-estate" style={{ color: C.teal }}>For real estate</Link>
          <Link href="/alternatives" style={{ color: C.teal }}>Compare options</Link>
          <Link href="/pricing" style={{ color: C.teal }}>Pricing</Link>
        </nav>
      </div>

      <style>{`
        .prose h2 { font-family: var(--font-bricolage), sans-serif; font-weight: 700;
          font-size: 25px; letter-spacing: -.02em; margin: 40px 0 12px; color: ${C.txt}; }
        .prose h3 { font-size: 17.5px; font-weight: 700; margin: 26px 0 8px; color: ${C.txt}; }
        .prose p  { font-size: 16.5px; line-height: 1.68; color: ${C.mid}; margin: 0 0 15px; }
        .prose li { font-size: 16.5px; line-height: 1.6; color: ${C.mid}; margin-bottom: 8px; }
        .prose ul { padding-left: 22px; margin: 0 0 18px; }
        .prose strong { color: ${C.txt}; font-weight: 700; }
        .prose a { color: ${C.teal}; }
        .prose .te { font-family: var(--font-noto-telugu), sans-serif; }
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
