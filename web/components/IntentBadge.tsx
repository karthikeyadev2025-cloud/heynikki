// components/IntentBadge.tsx — the one intent chip.
//
// /calls, /dashboard and /analytics each carried their own copy, each with
// its own half of the two intent vocabularies (see lib/intent.ts). They are
// this component now, so a screen cannot print a raw key by forgetting to
// add a map entry.
//
// Sentence case, not uppercase: "ASKED FOR A PERSON" shouts, and these are
// read at 360px on a phone where the extra letter-spacing costs real width.
"use client";

import { intentColor, intentLabel } from "../lib/intent";

export default function IntentBadge({ intent, title }: {
  intent: string | null | undefined;
  /** Optional hover text — the badge itself never shows the raw key. */
  title?: string;
}) {
  const col   = intentColor(intent);
  const label = intentLabel(intent);
  return (
    <span title={title} style={{
      background: col + "14", color: col,
      borderRadius: 999, padding: "3px 9px", fontSize: 11.5, fontWeight: 600,
      whiteSpace: "nowrap", display: "inline-block", lineHeight: 1.4,
    }}>
      {label}
    </span>
  );
}
