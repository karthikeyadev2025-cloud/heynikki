"use client";

/**
 * THE canonical Hey Nikki logo. Every surface uses this — nav, sidebar,
 * auth pages, legal pages, 404.
 *
 * WHY THIS FILE IS NOW THE ONLY LOGO
 * The site was running four different marks at once:
 *   1. this component — voice-pulse bars in terracotta + teal, with a
 *      "Nikki Technologies" subtitle
 *   2. the landing nav — a lucide Phone glyph in a marigold-on-ink square
 *   3. the dashboard sidebar — a glowing green dot and the bare word "Nikki"
 *   4. the favicon — waveform bars in ink + marigold
 * A customer moving from the landing page to signup to the dashboard saw
 * three unrelated brands and two different company names.
 *
 * Unified on the voice-pulse mark: it's the one that means something (this
 * is a voice product, the bars are an audio level meter) and it already
 * matches the favicon and PWA icons, so the browser tab, the home-screen
 * icon and the header now agree.
 *
 * The "Nikki Technologies" subtitle is gone. The brand is Hey Nikki
 * (heynikki.in) — the old subtitle was leftover from an earlier naming
 * pass and contradicted the wordmark directly above it.
 */

const INK      = "#0B1F33";
const MARIGOLD = "#E9A72C";
const TEAL     = "#12457A";
const CREAM    = "#FFFFFF";

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
  const textColor = dark ? CREAM : INK;
  // On dark ground the ink bars would disappear, so the quiet bars go
  // translucent white and the loud ones stay marigold either way.
  const quietBar = dark ? "rgba(255,255,255,0.55)" : TEAL;

  const PulseMark = (
    <span
      aria-hidden
      style={{
        width: size, height: size, flexShrink: 0,
        borderRadius: size * 0.24,
        background: dark ? "rgba(255,255,255,0.08)" : INK,
        display: "grid", placeItems: "center",
      }}
    >
      <svg
        width={size * 0.66} height={size * 0.66}
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Hey Nikki"
      >
        {/* Same four bars, same proportions, as icon.svg and the PWA icons. */}
        <rect x="6"  y="34" width="16" height="32" rx="8" fill={dark ? quietBar : CREAM} />
        <rect x="29" y="16" width="16" height="68" rx="8" fill={MARIGOLD} />
        <rect x="52" y="8"  width="16" height="84" rx="8" fill={MARIGOLD} />
        <rect x="75" y="26" width="16" height="48" rx="8" fill={dark ? quietBar : CREAM} />
      </svg>
    </span>
  );

  if (variant === "icon") return PulseMark;

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
      Hey Nikki
    </span>
  );

  if (variant === "stacked") {
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: size * 0.24 }}>
        {PulseMark}
        {showText && Wordmark}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.26 }}>
      {PulseMark}
      {showText && Wordmark}
    </span>
  );
}
