"use client";

import { useId } from "react";

interface Props {
  size?: number;
  showText?: boolean;
  variant?: "horizontal" | "icon" | "stacked";
  dark?: boolean;
}

/**
 * The HeyNikki logo — identical mark to web/components/NikkiLogo.tsx.
 *
 * This file used to define a THIRD version of the brand: voice-pulse bars in
 * terracotta + deep teal, with the wordmark set lowercase as "hey nikki".
 * Between it, the web component and the favicons, an operator moving between
 * the admin console and the customer dashboard saw two different marks, two
 * colour schemes and two capitalisations of the product name.
 *
 * The mark is a speech bubble holding a voice waveform — the receptionist and
 * the AI in one shape — in the emerald-to-orange gradient shared by the PWA
 * icons, the README and the Flutter theme.
 *
 * Nothing imports this component today. It is kept in step anyway: an unused
 * copy of the brand is exactly how the three-way drift above happened.
 */

const INK = "#0F172A";
const CREAM = "#FFFFFF";
const EMERALD = "#10B981";
const TEAL = "#14B8A6";
const ORANGE = "#F97316";

export default function NikkiLogo({ size = 48, showText = true, variant = "horizontal", dark = false }: Props) {
  const uid = useId().replace(/:/g, "");
  const tileGrad = `sa-tile-${uid}`;
  const waveGrad = `sa-wave-${uid}`;
  const textColor = dark ? CREAM : INK;

  const Mark = (
    <svg
      width={size} height={size}
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
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
      <path
        fill={CREAM}
        d="M82 62 h92 a26 26 0 0 1 26 26 v54 a26 26 0 0 1 -26 26 h-52
           l-32 30 a5 5 0 0 1 -8.4 -4.4 l5.4 -25.6 h-5
           a26 26 0 0 1 -26 -26 v-54 a26 26 0 0 1 26 -26 z"
      />
      <g fill={`url(#${waveGrad})`}>
        <rect x="76" y="103" width="12" height="26" rx="6" />
        <rect x="98" y="90" width="12" height="52" rx="6" />
        <rect x="120" y="79" width="12" height="74" rx="6" />
        <rect x="142" y="94" width="12" height="44" rx="6" />
        <rect x="164" y="105" width="12" height="22" rx="6" />
      </g>
    </svg>
  );

  if (variant === "icon") return Mark;

  const Wordmark = (
    <div style={{ lineHeight: 1.1 }}>
      <div style={{ fontSize: size * 0.46, fontWeight: 800, color: textColor, letterSpacing: -size * 0.008 }}>
        HeyNikki
      </div>
      <div style={{
        fontSize: size * 0.13,
        color: dark ? "rgba(255,255,255,0.6)" : "#64748B",
        letterSpacing: size * 0.05,
        fontWeight: 600,
        marginTop: size * 0.05,
        textTransform: "uppercase",
      }}>
        Nikki Technologies
      </div>
    </div>
  );

  if (variant === "stacked") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
        {Mark}
        {showText && Wordmark}
      </div>
    );
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: size * 0.22 }}>
      {Mark}
      {showText && Wordmark}
    </div>
  );
}
