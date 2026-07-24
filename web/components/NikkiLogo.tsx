"use client";

interface Props {
  size?: number;
  showText?: boolean;
  variant?: "horizontal" | "icon" | "stacked";
  dark?: boolean;
}

/**
 * Hey Nikki logo (2026-07-02 redesign, replacing the earlier "N" monogram).
 * Wordmark-forward rather than a monogram -- "Hey Nikki" is a spoken product
 * name in the Siri/Alexa mold, not an abstract initial. The mark is a small
 * voice-pulse (audio equalizer bars), directly representing the product
 * category rather than an arbitrary letterform. Built from simple filled
 * rects at varying heights -- safe, predictable geometry since this
 * environment can't render/preview SVG output before shipping it.
 *
 * Palette: warm terracotta + deep teal on a cream/espresso base -- moved
 * away from the earlier dark-navy + neon-green scheme, which read as a
 * generic "AI startup" template rather than a distinct brand.
 */
const TERRACOTTA = "#E5533D";
const TEAL = "#0F5F52";
const ESPRESSO = "#1F1915";
const CREAM = "#FDFBF7";

export default function NikkiLogo({ size = 48, showText = true, variant = "horizontal", dark = false }: Props) {
  const textColor = dark ? CREAM : ESPRESSO;

  const PulseMark = (
    <svg
      width={size} height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
      role="img"
      aria-label="Hey Nikki voice pulse mark"
    >
      <rect x="12" y="35" width="14" height="30" rx="7" fill={TEAL} />
      <rect x="32" y="18" width="14" height="64" rx="7" fill={TERRACOTTA} />
      <rect x="52" y="8"  width="14" height="84" rx="7" fill={TERRACOTTA} />
      <rect x="72" y="28" width="14" height="44" rx="7" fill={TEAL} />
    </svg>
  );

  if (variant === "icon") return PulseMark;

  if (variant === "stacked") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        {PulseMark}
        {showText && (
          <div style={{ textAlign: "center" }}>
            <div style={{
              fontSize: size * 0.4,
              fontWeight: 800,
              color: textColor,
              letterSpacing: -size * 0.01,
              lineHeight: 1,
            }}>
              hey <span style={{ color: TERRACOTTA }}>nikki</span>
            </div>
            <div style={{
              fontSize: size * 0.12,
              color: TEAL,
              letterSpacing: size * 0.04,
              fontWeight: 600,
              marginTop: size * 0.08,
              textTransform: "uppercase",
            }}>
              Nikki Technologies
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: size * 0.22 }}>
      {PulseMark}
      {showText && (
        <div style={{ lineHeight: 1.1 }}>
          <div style={{
            fontSize: size * 0.5,
            fontWeight: 800,
            color: textColor,
            letterSpacing: -size * 0.008,
          }}>
            hey <span style={{ color: TERRACOTTA }}>nikki</span>
          </div>
          <div style={{
            fontSize: size * 0.13,
            color: TEAL,
            letterSpacing: size * 0.05,
            fontWeight: 600,
            marginTop: size * 0.05,
            textTransform: "uppercase",
          }}>
            Nikki Technologies
          </div>
        </div>
      )}
    </div>
  );
}
