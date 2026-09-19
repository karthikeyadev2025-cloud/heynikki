// lib/intent.ts — the one place a raw intent key becomes words a shop owner reads.
//
// The product stores intent in TWO vocabularies and always has:
//
//   calls.intent  — written by the voice pipeline at the end of a call:
//                   appointment / enquiry / callback / transfer / emergency /
//                   order, plus legacy `wa_otp_<code>` rows.
//   leads.intent  — written by the lead extractor (voice-pipeline/main.py
//                   _VALID_INTENTS): book_appointment / reschedule / cancel /
//                   pricing_enquiry / service_enquiry / location_hours /
//                   complaint / follow_up / other.
//
// Both were mapped separately in /calls, /dashboard, /analytics, /leads and
// LeadDetail — five copies, each knowing only half the words, so the
// dashboard printed a LEAD's `book_appointment` through the CALL badge and
// fell through to the raw key. One map, both vocabularies, one fallback that
// is merely ugly rather than a database string with underscores in it.
//
// Adding a new intent anywhere: add it HERE and every screen gets it.

import { NIKKI } from "./brand";

/** Colour tokens a badge may use. Kept to brand values, never ad-hoc hex. */
export const INTENT_COLORS = {
  green: NIKKI.emerald,
  cyan:  NIKKI.cyan,
  gold:  NIKKI.gold,
  teal:  NIKKI.tealLight,
  red:   NIKKI.red,
  dim:   NIKKI.textDim,
} as const;

type Tone = keyof typeof INTENT_COLORS;

const INTENTS: Record<string, { label: string; tone: Tone }> = {
  // ── calls.intent ──────────────────────────────────────────────
  appointment:      { label: "Booking",            tone: "green" },
  enquiry:          { label: "Enquiry",            tone: "cyan"  },
  callback:         { label: "Callback",           tone: "gold"  },
  transfer:         { label: "Asked for a person", tone: "teal"  },
  emergency:        { label: "Urgent",             tone: "red"   },
  order:            { label: "Order",              tone: "gold"  },
  // ── leads.intent ──────────────────────────────────────────────
  book_appointment: { label: "Wants to book",      tone: "green" },
  reschedule:       { label: "Reschedule",         tone: "teal"  },
  cancel:           { label: "Cancel",             tone: "red"   },
  pricing_enquiry:  { label: "Asked the price",    tone: "cyan"  },
  service_enquiry:  { label: "Service question",   tone: "cyan"  },
  location_hours:   { label: "Location / hours",   tone: "teal"  },
  complaint:        { label: "Complaint",          tone: "red"   },
  follow_up:        { label: "Follow-up",          tone: "gold"  },
  // ── shared ────────────────────────────────────────────────────
  other:            { label: "Something else",     tone: "dim"   },
  unknown:          { label: "Not captured",       tone: "dim"   },
  // Legacy rows carry `wa_otp_<code>` in calls.intent — an internal marker
  // for a WhatsApp verification call, not anything a caller asked for.
  wa_otp:           { label: "WhatsApp OTP",       tone: "cyan"  },
};

// The same aliases the pipeline coerces against (main.py _INTENT_ALIASES),
// repeated here for rows written before it did.
const ALIASES: Record<string, string> = {
  booking:           "book_appointment",
  service_inquiry:   "service_enquiry",
  price_enquiry:     "pricing_enquiry",
  price_inquiry:     "pricing_enquiry",
  pricing_inquiry:   "pricing_enquiry",
  pricing:           "pricing_enquiry",
  hours:             "location_hours",
  location:          "location_hours",
  abuse_hangup:      "other",
  wrong_number:      "other",
};

/** Normalise any stored value to a key this module knows, or "" if it doesn't. */
function key(raw: string | null | undefined): string {
  const k = String(raw ?? "").trim().toLowerCase();
  if (!k) return "unknown";
  if (k.startsWith("wa_otp")) return "wa_otp";
  const a = ALIASES[k] || k;
  return INTENTS[a] ? a : "";
}

/**
 * What to print. Never returns a database key: an intent this build has not
 * heard of comes back with its underscores opened and its first letter
 * raised, so a new pipeline value looks untidy instead of looking like code.
 */
export function intentLabel(raw: string | null | undefined): string {
  const k = key(raw);
  if (k) return INTENTS[k].label;
  const words = String(raw).replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : INTENTS.unknown.label;
}

/** The badge colour for an intent. Unknown keys read as "not captured" grey. */
export function intentColor(raw: string | null | undefined): string {
  const k = key(raw);
  return INTENT_COLORS[k ? INTENTS[k].tone : "dim"];
}

/** True when there is nothing worth showing (null, empty, or "unknown"). */
export function intentIsEmpty(raw: string | null | undefined): boolean {
  return key(raw) === "unknown";
}
