"use client";

interface Props {
  size?: number;
  showText?: boolean;
  variant?: "horizontal" | "icon" | "stacked";
}

/**
 * Nikki logo — replaces the old Jovio "J" monogram (2026-07-02 rebrand).
 *
 * Design note: the mark is built from three thick, rounded-cap strokes
 * forming an "N" monogram, rather than a hand-computed filled path like
 * the old logo's custom "J" curves. This is deliberate — I can't visually
 * render/preview SVG output from this environment, and a stroke-based
 * geometric construction (line, line, line) is far more likely to render
 * correctly on the first try than hand-computed bezier/polygon path data
 * I can't check by eye. Same gradient/glow treatment as before (surya
 * amber + mercury green), so it stays visually consistent with the rest
 * of the brand system — only the letterform and wordmark text changed.
 */
export default function NikkiLogo({ size = 48, showText = true, variant = "horizontal" }: Props) {
  const SURYA = "#F59E0B";
  const MERCURY = "#00E676";
  const CHANDRA = "#F8FAFC";

  const NMark = (
    <svg
      width={size} height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="surya-grad-n" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FCD34D"/>
          <stop offset="60%" stopColor={SURYA}/>
          <stop offset="100%" stopColor="#D97706"/>
        </linearGradient>
        <linearGradient id="mercury-grad-n" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#34F39A"/>
          <stop offset="60%" stopColor={MERCURY}/>
          <stop offset="100%" stopColor="#00B358"/>
        </linearGradient>
        <filter id="glow-mark-n">
          <feGaussianBlur stdDeviation="1.5" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      {/* Left stroke of the N */}
      <line x1="26" y1="18" x2="26" y2="82"
            stroke="url(#surya-grad-n)" strokeWidth="15" strokeLinecap="round"
            filter="url(#glow-mark-n)" />
      {/* Right stroke of the N */}
      <line x1="74" y1="18" x2="74" y2="82"
            stroke="url(#mercury-grad-n)" strokeWidth="15" strokeLinecap="round"
            filter="url(#glow-mark-n)" />
      {/* Diagonal connecting stroke */}
      <line x1="26" y1="22" x2="74" y2="78"
            stroke="url(#mercury-grad-n)" strokeWidth="13" strokeLinecap="round"
            filter="url(#glow-mark-n)" />
    </svg>
  );

  if (variant === "icon") return NMark;

  if (variant === "stacked") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        {NMark}
        {showText && (
          <div style={{ textAlign: "center" }}>
            <div style={{
              fontSize: size * 0.42,
              fontWeight: 900,
              color: CHANDRA,
              letterSpacing: size * 0.04,
              lineHeight: 1,
            }}>
              NIK<span style={{ color: SURYA }}>K</span><span style={{ color: SURYA }}>I</span>
            </div>
            <div style={{
              fontSize: size * 0.13,
              color: MERCURY,
              letterSpacing: size * 0.05,
              fontWeight: 600,
              marginTop: size * 0.08,
              textTransform: "uppercase",
            }}>
              Global Technologies
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: size * 0.25 }}>
      {NMark}
      {showText && (
        <div style={{ lineHeight: 1.1 }}>
          <div style={{
            fontSize: size * 0.55,
            fontWeight: 900,
            color: CHANDRA,
            letterSpacing: size * 0.02,
          }}>
            NIK<span style={{ color: SURYA }}>KI</span>
          </div>
          <div style={{
            fontSize: size * 0.14,
            color: MERCURY,
            letterSpacing: size * 0.06,
            fontWeight: 600,
            marginTop: size * 0.06,
            textTransform: "uppercase",
          }}>
            Global Technologies
          </div>
        </div>
      )}
    </div>
  );
}
