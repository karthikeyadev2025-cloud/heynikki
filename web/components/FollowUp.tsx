"use client";

/**
 * Follow-up reminders on a lead.
 *
 * A lead could be moved between stages but never scheduled. "Call her back
 * Thursday morning" lived in the owner's head, so the leads that asked to be
 * called later — the warmest ones there are — were the ones that got
 * dropped. This sets a date, a time and a note on the lead, and snoozes it.
 *
 * DEGRADES TO NOTHING. The columns arrive in supabase/056, which may not be
 * applied to the database this build is talking to. `followUpSupported()`
 * asks once; until it says yes, /leads renders no reminder UI at all rather
 * than offering a button that answers "column leads.follow_up_at does not
 * exist" in red.
 *
 * Times are IST, built by hand as `…+05:30`. A <input type="datetime-local">
 * is interpreted in the BROWSER's zone: an owner travelling, or a laptop
 * left on UTC, would set a 9am reminder that fires at 2:30pm.
 */
import { useState } from "react";
import { Bell, BellRing, Check, X } from "lucide-react";
import { createClient } from "../lib/supabase";
import { toast } from "./Toast";
import { NIKKI } from "../lib/brand";

const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border, teal: NIKKI.teal,
  gold: NIKKI.gold, grn: NIKKI.emerald, red: NIKKI.red,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

/** The columns supabase/056 adds. All optional — the migration may be pending. */
export type FollowUpFields = {
  follow_up_at?: string | null;
  follow_up_note?: string | null;
  follow_up_done_at?: string | null;
  follow_up_notified_at?: string | null;
};

const IST_MS = 330 * 60_000;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Today in IST, YYYY-MM-DD — the value a <input type="date"> wants. */
export function istToday(now = Date.now()): string {
  return new Date(now + IST_MS).toISOString().slice(0, 10);
}

/** Split an instant into the IST date and time a person would have typed. */
function istParts(iso: string): { date: string; time: string } {
  const d = new Date(new Date(iso).getTime() + IST_MS).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
}

/** An IST date + HH:MM back into an instant Postgres will store correctly. */
function istIso(date: string, time: string): string {
  return `${date}T${(time || "10:00").slice(0, 5)}:00+05:30`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(new Date(iso).getTime() + days * 86_400_000);
  return d.toISOString();
}

/** "Today 3:00 pm" / "Fri 25 Sep, 10:00 am" — how the chip reads. */
export function followUpLabel(iso: string): string {
  const p = istParts(iso);
  const t = new Date(new Date(iso).getTime() + IST_MS);
  const h24 = t.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const clock = `${h12}:${String(t.getUTCMinutes()).padStart(2, "0")} ${h24 < 12 ? "am" : "pm"}`;
  const today = istToday();
  if (p.date === today) return `Today ${clock}`;
  if (p.date === istToday(Date.now() + 86_400_000)) return `Tomorrow ${clock}`;
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${clock}`;
}

/** A reminder that has come due and nobody has ticked off. */
export function isDue(l: FollowUpFields, now = Date.now()): boolean {
  if (!l.follow_up_at || l.follow_up_done_at) return false;
  // Anything due at any point today counts as "today's work" — an owner
  // opening the dashboard at 9am wants the 5pm callback in the list, not
  // eight hours later.
  return istParts(l.follow_up_at).date <= istToday(now);
}

export function isOverdue(l: FollowUpFields, now = Date.now()): boolean {
  return !!l.follow_up_at && !l.follow_up_done_at && new Date(l.follow_up_at).getTime() < now;
}

/**
 * Does this database have supabase/056 yet?
 *
 * Asked with a one-row probe rather than by looking at a lead that came
 * back, because an account with no leads yet would answer neither way. The
 * result is cached for the tab: a migration does not land mid-session.
 */
let supported: boolean | null = null;
export async function followUpSupported(): Promise<boolean> {
  if (supported !== null) return supported;
  const sb = createClient();
  const { error } = await sb.from("leads").select("id,follow_up_at").limit(1);
  // 42703 = undefined_column. Anything else (offline, RLS, a bad session)
  // is not proof the feature is missing, so do not cache a "no" for it.
  if (error && (error.code === "42703" || /follow_up_at/.test(error.message || ""))) {
    supported = false;
  } else if (!error) {
    supported = true;
  }
  return supported === true;
}

const SNOOZE = [
  { label: "1 day",     days: 1 },
  { label: "3 days",    days: 3 },
  { label: "Next week", days: 7 },
];

/**
 * Snoozing measures from NOW when the reminder is already late.
 *
 * Adding a day to a due date that passed last Tuesday leaves it still
 * overdue, so the button appears to do nothing — the lead stays in "due
 * today" and the owner presses it again.
 */
function snoozedTo(current: string | null | undefined, days: number): string {
  const now = Date.now();
  const base = current && new Date(current).getTime() > now ? current : new Date(now).toISOString();
  return addDays(base, days);
}

/**
 * The reminder control for one lead: a chip when something is scheduled, a
 * quiet bell when nothing is, and a small dialog behind both.
 *
 * Writes go straight to Supabase under the leads_update policy from 011 —
 * the same door the stage dropdown on this page already uses. follow_up_at
 * moving always clears follow_up_notified_at, which is what re-arms the
 * scheduler for the new time.
 */
export default function FollowUp({ lead, onSaved, compact }: {
  lead: FollowUpFields & { id: string; name?: string | null; phone: string };
  onSaved: (patch: FollowUpFields) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const existing = lead.follow_up_at ? istParts(lead.follow_up_at) : null;
  const [date, setDate] = useState(existing?.date || istToday(Date.now() + 86_400_000));
  const [time, setTime] = useState(existing?.time || "10:00");
  const [note, setNote] = useState(lead.follow_up_note || "");
  const [busy, setBusy] = useState(false);

  const save = async (patch: FollowUpFields) => {
    setBusy(true);
    const sb = createClient();
    const { error } = await sb.from("leads").update(patch).eq("id", lead.id);
    setBusy(false);
    if (error) { toast.err(error.message); return false; }
    onSaved(patch);
    return true;
  };

  const setReminder = async () => {
    const at = istIso(date, time);
    if (await save({ follow_up_at: at, follow_up_note: note.trim() || null,
                     follow_up_done_at: null, follow_up_notified_at: null })) {
      toast.ok(`Reminder set for ${followUpLabel(at)}`);
      setOpen(false);
    }
  };

  const snooze = async (days: number) => {
    const at = snoozedTo(lead.follow_up_at, days);
    if (await save({ follow_up_at: at, follow_up_done_at: null, follow_up_notified_at: null })) {
      const p = istParts(at);
      setDate(p.date); setTime(p.time);
      toast.ok(`Snoozed to ${followUpLabel(at)}`);
      setOpen(false);
    }
  };

  const markDone = async () => {
    if (await save({ follow_up_done_at: new Date().toISOString() })) {
      toast.ok("Follow-up marked done");
      setOpen(false);
    }
  };

  const clear = async () => {
    if (await save({ follow_up_at: null, follow_up_note: null,
                     follow_up_done_at: null, follow_up_notified_at: null })) {
      toast.ok("Reminder removed");
      setOpen(false);
    }
  };

  const pending = !!lead.follow_up_at && !lead.follow_up_done_at;
  const late    = isOverdue(lead);
  const colour  = late ? C.red : pending ? C.gold : C.dim;

  const field: React.CSSProperties = {
    background: C.hi, border: `1px solid ${C.bord}`, borderRadius: 8,
    padding: "9px 10px", color: C.txt, fontSize: 13, fontFamily: "inherit",
    width: "100%", boxSizing: "border-box",
  };

  return (
    <>
      <button type="button" onClick={e => { e.stopPropagation(); setOpen(true); }}
        title={pending ? `Follow up ${followUpLabel(lead.follow_up_at!)}` : "Set a follow-up reminder"}
        aria-label={pending ? "Change follow-up reminder" : "Set a follow-up reminder"}
        style={{
          background: pending ? colour + "16" : "transparent",
          color: colour, border: `1px solid ${pending ? colour + "55" : C.bord}`,
          borderRadius: 8, padding: "7px 10px", fontSize: 12, fontWeight: 700,
          display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
        }}>
        {pending ? <BellRing size={13} /> : <Bell size={13} />}
        {pending && !compact && <span>{late ? "Overdue · " : ""}{followUpLabel(lead.follow_up_at!)}</span>}
      </button>

      {open && (
        <div onClick={e => { e.stopPropagation(); setOpen(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 10002,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12,
              padding: 20, width: "min(400px, 100%)", boxShadow: "0 20px 60px #0008" }}>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <div style={{ color: C.txt, fontSize: 15, fontWeight: 900 }}>Follow up</div>
                <div style={{ color: C.mid, fontSize: 12, marginTop: 2 }}>{lead.name || lead.phone}</div>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close"
                style={{ background: "none", border: "none", color: C.dim, display: "flex" }}>
                <X size={18} />
              </button>
            </div>

            {pending && (
              <div style={{ background: colour + "12", border: `1px solid ${colour}44`, borderRadius: 8,
                padding: "8px 10px", marginBottom: 14, color: colour, fontSize: 12.5, fontWeight: 700 }}>
                {late ? "Overdue since " : "Due "}{followUpLabel(lead.follow_up_at!)}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: C.mid, fontWeight: 700, marginBottom: 4 }}>DATE</div>
                <input type="date" value={date} min={istToday()} onChange={e => setDate(e.target.value)} style={field} />
              </div>
              <div style={{ width: 120 }}>
                <div style={{ fontSize: 11, color: C.mid, fontWeight: 700, marginBottom: 4 }}>TIME</div>
                <input type="time" value={time} onChange={e => setTime(e.target.value)} style={field} />
              </div>
            </div>

            <div style={{ fontSize: 11, color: C.mid, fontWeight: 700, marginBottom: 4 }}>NOTE</div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="e.g. quoted ₹8,000, wants to confirm with husband"
              style={{ ...field, resize: "vertical", marginBottom: 14 }} />

            <button onClick={setReminder} disabled={busy}
              style={{ background: C.teal, color: "#fff", border: 0, borderRadius: 8,
                padding: "10px 16px", fontSize: 13, fontWeight: 700, width: "100%", marginBottom: 12 }}>
              {busy ? "Saving…" : pending ? "Update reminder" : "Set reminder"}
            </button>

            <div style={{ fontSize: 11, color: C.mid, fontWeight: 700, marginBottom: 6 }}>SNOOZE</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
              {SNOOZE.map(s => (
                <button key={s.days} onClick={() => snooze(s.days)} disabled={busy}
                  title={`Remind me again in ${s.label.toLowerCase()}`}
                  style={{ background: C.hi, color: C.txt, border: `1px solid ${C.bord}`,
                    borderRadius: 20, padding: "6px 12px", fontSize: 12.5, fontWeight: 700 }}>
                  {s.label}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {pending && (
                <button onClick={markDone} disabled={busy}
                  style={{ background: C.grn + "16", color: C.grn, border: `1px solid ${C.grn}55`,
                    borderRadius: 8, padding: "8px 12px", fontSize: 12.5, fontWeight: 700,
                    display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <Check size={13} /> Done
                </button>
              )}
              {lead.follow_up_at && (
                <button onClick={clear} disabled={busy}
                  style={{ background: "none", color: C.dim, border: `1px solid ${C.bord}`,
                    borderRadius: 8, padding: "8px 12px", fontSize: 12.5 }}>
                  Remove reminder
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
