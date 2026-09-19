"use client";

/**
 * The health banner on /dashboard.
 *
 * Every condition it shows already stops something working, and every one of
 * them used to be invisible from inside the app: free minutes at zero, no
 * number assigned, KYC rejected, WhatsApp never connected, a campaign the
 * dispatcher stopped. The owner's first signal for any of it was a customer
 * ringing them to say nobody answered.
 *
 * Renders NOTHING when nothing is wrong. That is the whole contract — a strip
 * at the top of the dashboard that is usually empty is one people read when it
 * is not, and a permanent row of chips is one they stop seeing in a week.
 *
 * Dismissal is per alert per IST day and lives in localStorage, so it costs no
 * round trip and no migration. It is deliberately not permanent: a condition
 * the owner waved away yesterday and has not fixed is still breaking their
 * phone line today.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "../lib/supabase";
import { NIKKI } from "../lib/brand";
import { AlertTriangle, AlertCircle, Info, X } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

type Severity = "critical" | "warning" | "info";
type Alert = {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  action: { label: string; href: string };
};

const TONE: Record<Severity, { color: string; Icon: typeof AlertTriangle }> = {
  critical: { color: NIKKI.red,   Icon: AlertCircle },
  warning:  { color: NIKKI.gold,  Icon: AlertTriangle },
  info:     { color: NIKKI.cyan,  Icon: Info },
};

/** The business's own day, not the browser's. A dismissal taken at 23:00 IST
 *  must not come back twenty minutes later because UTC rolled over first. */
function istDay(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

const STORE_KEY = "nikki.dashboard.alerts.dismissed";

function readDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return new Set();
    const v = JSON.parse(raw) as { day?: string; ids?: string[] };
    // Yesterday's dismissals are not today's. Anything still wrong comes back.
    if (v?.day !== istDay()) return new Set();
    return new Set(Array.isArray(v.ids) ? v.ids : []);
  } catch {
    // Private mode, a full quota, or a value some other build wrote. Showing
    // an alert the owner dismissed is a smaller failure than hiding one.
    return new Set();
  }
}

function writeDismissed(ids: Set<string>) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ day: istDay(), ids: [...ids] }));
  } catch { /* storage unavailable — the dismissal lasts for this page view */ }
}

export default function OwnerAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => { setDismissed(readDismissed()); }, []);

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await createClient().auth.getSession();
      if (!session?.access_token) return;
      const r = await fetch(`${API_URL}/api/owner/alerts`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!r.ok) return;                       // stay silent rather than shout
      const j = await r.json();
      setAlerts(Array.isArray(j?.alerts) ? j.alerts : []);
    } catch {
      // The dashboard is still useful without this strip; an unreachable API
      // must not put a red error box above a working reception log.
    }
  }, []);

  useEffect(() => {
    load();
    // Far slower than the 30-second call refresh below it. Nothing here
    // changes minute to minute — a plan is not exhausted twice in an hour —
    // and this endpoint reads eight tables per call.
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, [load]);

  function dismiss(id: string) {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    writeDismissed(next);
  }

  const shown = alerts.filter(a => !dismissed.has(a.id));
  if (shown.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
      {shown.map(a => {
        const { color, Icon } = TONE[a.severity] || TONE.warning;
        return (
          // flexWrap, and the action + dismiss kept together in their own row.
          // Without wrapping, the un-shrinkable button and X held their full
          // width on a 360px phone and squeezed the message into a ~100px
          // ribbon — "KYC / documents / not / uploaded", one word per line,
          // as the first thing a new owner sees after signing up.
          <div key={a.id} style={{
            background: color + "0D", border: `1px solid ${color}55`, borderRadius: 10,
            padding: "13px 14px", display: "flex", gap: 12, alignItems: "flex-start",
            flexWrap: "wrap",
          }}>
            <Icon size={18} color={color} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
              <div style={{ color: NIKKI.text, fontSize: 14, fontWeight: 800 }}>{a.title}</div>
              <div style={{ color: NIKKI.textMid, fontSize: 12.5, marginTop: 3, lineHeight: 1.55 }}>
                {a.detail}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto", flexShrink: 0 }}>
              <a href={a.action.href} style={{
                background: color, color: "#fff", borderRadius: 8, padding: "7px 14px",
                fontSize: 12.5, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap",
              }}>{a.action.label}</a>
              <button onClick={() => dismiss(a.id)} title="Hide until tomorrow" aria-label="Hide until tomorrow"
                style={{ background: "none", border: "none", cursor: "pointer", color: NIKKI.textDim,
                  padding: 4, flexShrink: 0 }}>
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
