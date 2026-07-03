// lib/brand.ts — Nikki Official Brand System
export const NIKKI = {
  // Official brand colors (locked)
  background: "#070B19",  // Deep navy black
  vault:      "#111827",  // Surface
  mercury:    "#00E676",  // Brand green (logo bottom)
  surya:      "#F59E0B",  // Brand orange (logo top)
  chandra:    "#F8FAFC",  // Pure white text

  // Derived shades
  bgDeep:     "#040813",  // Even darker for hover/depth
  surface:    "#111827",  // = vault
  surfaceHi:  "#1A2235",  // Elevated surface
  border:     "#1F2937",  // Default border
  borderHi:   "#374151",  // Brighter border

  // Text shades
  text:       "#F8FAFC",  // = chandra
  textMid:    "#9CA3AF",  // Mid gray
  textDim:    "#4B5563",  // Dim gray

  // Semantic
  red:        "#EF4444",
  yellow:     "#F59E0B",  // = surya
  blue:       "#3B82F6",
  purple:     "#8B5CF6",

  // Gradients — using brand colors
  gradient:    "linear-gradient(135deg, #F59E0B 0%, #00E676 100%)",
  gradientRev: "linear-gradient(135deg, #00E676 0%, #F59E0B 100%)",
  gradientV:   "linear-gradient(180deg, #F59E0B 0%, #00E676 100%)",
} as const;

// Tailwind class shortcuts
export const tw = {
  bg:      "bg-[#070B19]",
  surface: "bg-[#111827]",
  text:    "text-[#F8FAFC]",
  mid:     "text-[#9CA3AF]",
  mercury: "text-[#00E676]",
  surya:   "text-[#F59E0B]",
};
