// What a customer calls each plan. The ids (starter/growth/scale) are what
// the database, checkout and every limit key on; since 070 the plans are
// sold as Shop / Team / Business, and the raw id must never reach a screen.
const LABELS: Record<string, string> = {
  trial: "Free", starter: "Shop", growth: "Team", scale: "Business",
};

export function planLabel(id?: string | null): string {
  const k = String(id || "trial").toLowerCase();
  return LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1));
}
