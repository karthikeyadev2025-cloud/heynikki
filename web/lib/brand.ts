// lib/brand.ts — Hey Nikki Official Brand System
// Palette locked 2026: Teal (#12457A) + Terracotta (#E5533D), light theme.
// This is the single source of truth — every page/component should import
// NIKKI from here instead of redefining its own local color object.
//
// Superseded palette (do not reintroduce): navy #070B19 / neon-green #00E676
// / orange #F59E0B on dark background. Some legacy pages (api-keys, dashboard,
// calls, leads, billing, analytics, knowledge, campaigns, appointments, setup,
// whatsapp, Shell) still use that old palette or a third purple/indigo one —
// those need to be migrated to this file next.

export const NIKKI = {
  // Core surfaces (light theme)
  bg:         "#FFFFFF",  // Page background
  vault:      "#F6F8FB",  // Section / card background
  surface:    "#FFFFFF",  // Elevated surface (cards, modals)
  border:     "#E2E8F0",  // Default border
  borderHi:   "#CBD5E1",  // Emphasized border

  // Brand colors (locked)
  teal:       "#12457A",  // Primary — logo, CTAs, links, trust
  tealLight:  "#1D6FA5",  // Gradient partner / hover state for teal
  terracotta: "#E5533D",  // Accent — highlights, badges, energy

  // Text
  text:       "#0F172A",  // Primary text (near-black)
  textMid:    "#475569",  // Secondary text
  textDim:    "#94A3B8",  // Tertiary / placeholder text

  // Semantic
  red:        "#EF4444",  // Errors / destructive
  gold:       "#F59E0B",  // Warnings
  emerald:    "#10B981",  // Success
  cyan:       "#06B6D4",  // Info

  // Gradients — brand only, do not mix with old navy/green gradient
  gradient:       "linear-gradient(135deg, #12457A 0%, #1D6FA5 100%)",
  gradientAccent: "linear-gradient(135deg, #E5533D 0%, #F97316 100%)",
} as const;

// ── Legacy key aliases ──────────────────────────────────────────
// A handful of pages (login, signup, LegalLayout, not-found,
// CookieBanner) already hardcode the *new* teal/terracotta values but under
// the *old* key names (mercury/surya/chandra/espresso/grad) inherited from
// the navy/green system. These aliases let those files switch to importing
// from here with a minimal diff. New code should use the real names above
// (teal/terracotta/text) — don't write new code against these aliases.
//
// VoiceWidget was on this list until it was deleted; the landing page's
// CallConsole replaced it and uses the ink/marigold palette directly.
export const NIKKI_LEGACY_ALIASES = {
  mercury:  NIKKI.teal,
  surya:    NIKKI.terracotta,
  chandra:  NIKKI.text,
  espresso: NIKKI.text,
  grad:     NIKKI.gradient,
} as const;

// Tailwind class shortcuts
export const tw = {
  bg:         "bg-white",
  surface:    "bg-[#F6F8FB]",
  text:       "text-[#0F172A]",
  mid:        "text-[#475569]",
  teal:       "text-[#12457A]",
  terracotta: "text-[#E5533D]",
};
