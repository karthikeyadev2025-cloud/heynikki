"use client";

/**
 * "Add to calendar" for one appointment.
 *
 * The .ics side of this has existed on the server since calendar invites were
 * built — GET /api/appointments/:id/invite-link hands back a signed, public
 * .ics URL with the right TZID and a two-hour alarm — and NOTHING in the
 * dashboard has ever called it. The business could see a booking and had no
 * way to get it into the calendar they actually run their day from.
 *
 * The .ics is fetched from that endpoint rather than rebuilt here: it is the
 * one place that knows the business name, the booking's service and the
 * Asia/Kolkata TZID that keeps 3pm meaning 3pm. The Google Calendar link is
 * built here because Google's template URL is a URL, not a file — it cannot
 * consume the .ics.
 *
 * The link is fetched on first click, not on render: a page listing forty
 * bookings would otherwise fire forty signed-link requests nobody asked for.
 */

import { useState } from "react";
import { createClient } from "../lib/supabase";
import { NIKKI } from "../lib/brand";
import { CalendarPlus, Download, ExternalLink } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

export type CalendarAppointment = {
  id: string;
  slot_date: string | null;
  slot_time: string | null;
  service: string | null;
  caller_name: string | null;
};

/**
 * Google's TEMPLATE url wants UTC basic-format timestamps. Slots are stored
 * as IST wall-clock ("2026-09-20", "15:30"), so the offset is subtracted
 * here — handing Google the wall-clock digits as if they were UTC would put
 * every appointment in the calendar five and a half hours early.
 *
 * Returns null for a booking with no date, which cannot become an event at
 * all; the caller hides the button in that case.
 */
function googleRange(slotDate: string, slotTime: string | null): { start: string; end: string } | null {
  const m = String(slotDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const hm = String(slotTime || "10:00").match(/^(\d{1,2}):(\d{2})/);
  const startMs = Date.UTC(+m[1], +m[2] - 1, +m[3], hm ? +hm[1] : 10, hm ? +hm[2] : 0)
    - 5.5 * 3600 * 1000;                    // IST wall-clock -> the real instant
  // One hour, the same duration the server's .ics uses, so the two agree.
  const fmt = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  return { start: fmt(startMs), end: fmt(startMs + 3600 * 1000) };
}

function googleUrl(a: CalendarAppointment, business: string): string | null {
  if (!a.slot_date) return null;
  const range = googleRange(a.slot_date, a.slot_time);
  if (!range) return null;
  const title = a.service ? `${a.service} — ${business}` : business;
  const details = `Booked with ${business}${a.caller_name ? ` for ${a.caller_name}` : ""}.`;
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${range.start}/${range.end}`,
    details,
    ctz: "Asia/Kolkata",
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

export default function AddToCalendar({ appointment, business }: {
  appointment: CalendarAppointment;
  /** The name a caller knows the business by — goes in the event title. */
  business: string;
}) {
  const [open, setOpen] = useState(false);
  const [icsUrl, setIcsUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");

  // A booking with no date is the one thing that cannot become a calendar
  // entry — the server answers 409 for exactly this case.
  if (!appointment.slot_date) return null;

  const gcal = googleUrl(appointment, business);

  async function expand() {
    setOpen(o => !o);
    if (icsUrl || state === "loading") return;
    setState("loading");
    try {
      const { data: { session } } = await createClient().auth.getSession();
      const r = await fetch(`${API_URL}/api/appointments/${appointment.id}/invite-link`, {
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.url) throw new Error(j?.error || `HTTP ${r.status}`);
      setIcsUrl(j.url);
      setState("idle");
    } catch (e: any) {
      console.error("[appointments] invite link failed:", e?.message || e);
      setState("failed");
    }
  }

  const linkStyle: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6, background: NIKKI.vault,
    color: NIKKI.teal, border: `1px solid ${NIKKI.border}`, borderRadius: 8,
    padding: "6px 12px", fontSize: 12, fontWeight: 600, textDecoration: "none",
  };

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <button onClick={expand} style={{
        background: NIKKI.teal + "14", color: NIKKI.teal, border: `1px solid ${NIKKI.teal}44`,
        borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600,
        cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6,
      }}>
        <CalendarPlus size={13} /> Add to calendar
      </button>

      {open && (
        <>
          {gcal && (
            <a href={gcal} target="_blank" rel="noopener noreferrer" style={linkStyle}>
              <ExternalLink size={12} /> Google Calendar
            </a>
          )}
          {state === "loading" && (
            <span style={{ fontSize: 12, color: NIKKI.textDim }}>Preparing file…</span>
          )}
          {icsUrl && (
            // Apple Calendar, Outlook and anything else that opens .ics. The
            // link is signed and public on purpose — the same one a caller
            // gets on WhatsApp — so no download header is needed here.
            <a href={icsUrl} style={linkStyle}>
              <Download size={12} /> Download .ics
            </a>
          )}
          {state === "failed" && (
            <span style={{ fontSize: 12, color: NIKKI.gold }}>
              Couldn&apos;t build the calendar file — the Google link above still works.
            </span>
          )}
        </>
      )}
    </div>
  );
}
