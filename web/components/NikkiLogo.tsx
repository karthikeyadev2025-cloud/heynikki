"use client";

import { useId } from "react";

/**
 * THE canonical HeyNikki logo. Every surface uses this — nav, sidebar,
 * auth pages, legal pages, 404.
 *
 * WHY THIS FILE IS THE ONLY LOGO
 * The site was running four different marks at once:
 *   1. this component — voice-pulse bars in terracotta + teal
 *   2. the landing nav — a lucide Phone glyph in a marigold-on-ink square
 *   3. the dashboard sidebar — a glowing green dot and the bare word "Nikki"
 *   4. the favicon — waveform bars in ink + marigold
 * A customer moving from the landing page to signup to the dashboard saw
 * three unrelated brands and two different company names.
 *
 * THE MARK
 * A speech bubble holding a voice waveform: the receptionist and the AI in
 * one shape. The bare bars it replaces read as an audio meter but said
 * nothing about someone answering the phone, and they were also a JPEG of
 * the previous company's identity in every other surface of the repo.
 *
 * The gradient is the emerald-to-orange the product already used for its
 * README badges and the Flutter theme, so the marketing site, the app and
 * the repo finally agree. It is deliberately vivid enough to hold up on
 * both the white auth pages and the ink sidebar without a second variant.
 *
 * Gradient ids are per-instance (useId): two logos on one page — sidebar
 * plus a legal header, say — would otherwise share one <defs> id, and the
 * second would silently render with the first one's fill.
 */

const INK   = "#0B1F33";
const CREAM = "#FFFFFF";
const EMERALD = "#10B981";
const TEAL    = "#14B8A6";
const ORANGE  = "#F97316";

interface Props {
  size?: number;
  showText?: boolean;
  variant?: "horizontal" | "icon" | "stacked";
  /** true when sitting on a dark background (ink sections, sidebar) */
  dark?: boolean;
}

export default function NikkiLogo({
  size = 40,
  showText = true,
  variant = "horizontal",
  dark = false,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const tileGrad = `hn-tile-${uid}`;
  const waveGrad = `hn-wave-${uid}`;
  const textColor = dark ? CREAM : INK;

  const Mark = (
    <span
      aria-hidden
      style={{
        width: size, height: size, flexShrink: 0,
        display: "grid", placeItems: "center",
      }}
    >
      <svg
        width={size} height={size}
        viewBox="0 0 256 256"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="HeyNikki"
      >
        <defs>
          <linearGradient id={tileGrad} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={EMERALD} />
            <stop offset="55%" stopColor={TEAL} />
            <stop offset="100%" stopColor={ORANGE} />
          </linearGradient>
          <linearGradient id={waveGrad} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#0F9D6E" />
            <stop offset="100%" stopColor={ORANGE} />
          </linearGradient>
        </defs>

        <rect width="256" height="256" rx="58" fill={`url(#${tileGrad})`} />

        {/* speech bubble — the receptionist */}
        <path
          fill={CREAM}
          d="M82 62 h92 a26 26 0 0 1 26 26 v54 a26 26 0 0 1 -26 26 h-52
             l-32 30 a5 5 0 0 1 -8.4 -4.4 l5.4 -25.6 h-5
             a26 26 0 0 1 -26 -26 v-54 a26 26 0 0 1 26 -26 z"
        />

        {/* waveform — the voice */}
        <g fill={`url(#${waveGrad})`}>
          <rect x="76" y="103" width="12" height="26" rx="6" />
          <rect x="98" y="90" width="12" height="52" rx="6" />
          <rect x="120" y="79" width="12" height="74" rx="6" />
          <rect x="142" y="94" width="12" height="44" rx="6" />
          <rect x="164" y="105" width="12" height="22" rx="6" />
        </g>
      </svg>
    </span>
  );

  if (variant === "icon") return Mark;

  const Wordmark = (
    <span
      style={{
        fontFamily: "var(--font-display), system-ui, sans-serif",
        fontSize: size * 0.46,
        fontWeight: 700,
        letterSpacing: "-0.025em",
        color: textColor,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      HeyNikki
    </span>
  );

  if (variant === "stacked") {
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: size * 0.24 }}>
        {Mark}
        {showText && Wordmark}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.26 }}>
      {Mark}
      {showText && Wordmark}
    </span>
  );
}
