"use client";

/**
 * Appointments dashboard.
 *
 * Shows bookings that Hey Nikki captured during calls. Until the extraction
 * module (the appointment handler) shipped, the AI would tell callers
 * "you're booked for 10:30 tomorrow" and save nothing — so this page had no
 * data to show and didn't exist. Now every call that contains a real
 * booking writes an appointments row, and this is where the business sees
 * them.
 *
 * Reads Supabase directly with the user's JWT (RLS policy "appt_select"
 * scopes rows to tenant members) — same secure pattern as the campaigns
 * page, no shared browser secret.
 */

import { useState, useEffect, useCallback } from "react";
import Shell from "../../components/Shell";
import AddToCalendar from "../../components/AddToCalendar";
import ExportButton from "../../components/ExportButton";
import { createClient } from "../../lib/supabase";
import { NIKKI } from "../../lib/brand";
import { Calendar, Hash } from "lucide-react";

const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: NIKKI.gold,
  grn: NIKKI.emerald, red: NIKKI.red, cyn: NIKKI.cyan,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

type Appointment = {
  id: string;
  caller_name: string | null;
  caller_number: string;
  service: string | null;
  slot_date: string | null;
  slot_time: string | null;
  status: string;
  notes: string | null;
  booking_ref: string | null;
  created_at: string;
};

// `pending` is what the AI writes the moment a caller asks to book, before
// a date AND time are both known (supabase/041). It needs a colour and a
// way to be confirmed by hand, otherwise a half-captured booking sits in
// the list in the fallback grey with nothing to do about it.
const STATUS_COLORS: Record<string, string> = {
  pending: C.gold, confirmed: C.grn, completed: C.cyn, cancelled: C.red,
  no_show: C.gold, rescheduled: C.gbr,
};
const STATUS_LABELS: Record<string, string> = {
  pending: "Needs confirmation", confirmed: "Confirmed", completed: "Done",
  cancelled: "Cancelled", no_show: "No-show", rescheduled: "Rescheduled",
};

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/** "Today", "Tomorrow", or the date — the heading over each day's bookings. */
function dayHeading(d: string | null): string {
  if (!d) return "No date captured";
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt.getTime())) return d;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((dt.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return fmtDate(d);
}

function isUpcoming(d: string | null): boolean {
  if (!d) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dt = new Date(d + "T00:00:00");
  return dt >= today;
}

/**
 * The business's own booking-number format. A clinic runs on OP numbers,
 * a salon on booking numbers; both want the sequence they already use on
 * paper, so the prefix and the next number are theirs to set. The database
 * stamps the next one on every appointment that becomes confirmed
 * (supabase/043_booking_reference.sql), whichever way it was booked.
 */
function BookingNumberSettings({ tenantId, onSaved }: { tenantId: string; onSaved: () => void }) {
  const [prefix, setPrefix] = useState("");
  const [next, setNext] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    const sb = createClient();
    sb.from("tenants").select("booking_ref_prefix, booking_ref_next").eq("id", tenantId).maybeSingle()
      .then(({ data }) => {
        if (data) { setPrefix(data.booking_ref_prefix || ""); setNext(data.booking_ref_next || 1); }
        setLoaded(true);
      });
  }, [tenantId]);

  const preview = (n: number) => `${prefix}${String(n).padStart(3, "0")}`;

  async function save() {
    setSaving(true); setMsg(null);
    const sb = createClient();
    const { error } = await sb.from("tenants")
      .update({ booking_ref_prefix: prefix.trim().slice(0, 12), booking_ref_next: Math.max(1, Math.floor(next) || 1) })
      .eq("id", tenantId);
    setSaving(false);
    if (error) {
      // A customer cannot apply a migration; naming the SQL file to them
      // was an instruction for us dressed up as an error for them.
      setMsg({ bad: true, text: /booking_ref/.test(error.message)
        ? "Booking numbers aren't available on your account yet. Email support@heynikki.in and we'll switch them on."
        : "Couldn't save booking-number settings. Please try again." });
      console.error("[appointments] booking_ref save failed:", error.message);
      return;
    }
    setMsg({ text: `Saved. The next confirmed booking will be ${preview(Math.max(1, Math.floor(next) || 1))}.` });
    onSaved();
  }

  if (!loaded) return null;
  const inputStyle: React.CSSProperties = {
    background: C.hi, border: `1px solid ${C.bord}`, borderRadius: 8, padding: "9px 12px",
    color: C.txt, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", width: "100%",
  };
  return (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: C.txt, fontSize: 14.5, fontWeight: 800, display: "flex", alignItems: "center", gap: 7 }}>
            <Hash size={15} /> Booking numbers
          </div>
          <div style={{ color: C.mid, fontSize: 12.5, marginTop: 3 }}>
            Every confirmed booking gets the next number — next up is{" "}
            <strong style={{ color: C.cyn, fontFamily: "monospace" }}>{preview(next)}</strong>.
            It shows here and on the customer&apos;s WhatsApp confirmation.
          </div>
        </div>
        <button onClick={() => setOpen(v => !v)} style={{
          background: C.hi, color: C.txt, border: `1px solid ${C.bord}`, borderRadius: 8,
          padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}>{open ? "Close" : "Change"}</button>
      </div>
      {open && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 160px" }}>
              <label style={{ display: "block", fontSize: 12, color: C.mid, marginBottom: 6 }}>Prefix</label>
              <input style={inputStyle} value={prefix} maxLength={12} placeholder="OP-"
                onChange={e => setPrefix(e.target.value.replace(/\s/g, ""))} />
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <label style={{ display: "block", fontSize: 12, color: C.mid, marginBottom: 6 }}>Next number</label>
              <input type="number" min={1} style={inputStyle} value={next}
                onChange={e => setNext(parseInt(e.target.value) || 1)} />
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <label style={{ display: "block", fontSize: 12, color: C.mid, marginBottom: 6 }}>Looks like</label>
              <div style={{ ...inputStyle, fontFamily: "monospace", color: C.cyn, fontWeight: 700 }}>
                {preview(next)}, {preview(next + 1)}, {preview(next + 2)}…
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
            <button disabled={saving} onClick={save} style={{
              background: C.grn, color: "#fff", border: "none", borderRadius: 8,
              padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: saving ? 0.7 : 1,
            }}>{saving ? "Saving…" : "Save"}</button>
            <span style={{ fontSize: 12, color: C.dim }}>
              Numbers already given out don&apos;t change. Pick a next number above your last paper one to keep the sequence unbroken.
            </span>
          </div>
          {msg && <div style={{ marginTop: 8, fontSize: 12.5, color: msg.bad ? C.red : C.grn }}>{msg.text}</div>}
        </div>
      )}
    </div>
  );
}

export default function AppointmentsPage() {
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // "Upcoming" is the useful default: on "all" a completed booking from two
  // days ago sorts above tomorrow's, and the one question this page answers
  // is "who is coming in". "All" is one tap away.
  const [filter, setFilter] = useState<"upcoming" | "all">("upcoming");
  const [notice, setNotice] = useState("");
  const [tenantId, setTenantId] = useState<string | null>(null);
  // The name a caller knows the business by — it titles the calendar event.
  // tenants.name is the internal one; voice_profiles.business_name is what
  // Nikki says on the phone, and what the server's .ics already uses.
  const [business, setBusiness] = useState("Appointment");

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) { window.location.href = "/login"; return; }
    const { data: tu } = await sb.from("tenant_users").select("tenant_id")
      .eq("user_id", auth.user.id).maybeSingle();
    if (tu?.tenant_id) {
      setTenantId(tu.tenant_id);
      const { data: vp } = await sb.from("voice_profiles").select("business_name")
        .eq("tenant_id", tu.tenant_id).limit(1).maybeSingle();
      if (vp?.business_name) setBusiness(vp.business_name);
    }

    const { data, error: e } = await sb.from("appointments")
      .select("*")
      .order("slot_date", { ascending: true, nullsFirst: false });
    if (e) setError(e.message);
    else setAppts((data || []) as Appointment[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function updateStatus(id: string, status: string) {
    setNotice(""); setError("");
    const sb = createClient();
    const { error: e } = await sb.from("appointments")
      .update({ status }).eq("id", id);
    if (e) {
      console.error("[appointments] status update failed:", e.message);
      setError("Couldn't update that appointment. Please try again.");
    } else {
      setNotice(status === "confirmed" ? "Confirmed." : `Marked ${STATUS_LABELS[status] || status}.`);
      load();
    }
  }

  // A pending booking has no slot yet, so it is never "upcoming" by date;
  // it is listed under both filters so it cannot be hidden by accident.
  const shown = appts.filter(a => filter === "all" || a.status === "pending" || isUpcoming(a.slot_date));
  const upcomingCount = appts.filter(a => isUpcoming(a.slot_date) && a.status === "confirmed").length;
  const pendingCount  = appts.filter(a => a.status === "pending").length;

  return (
    <Shell title="Appointments">
      {/* No inner padding: .nk-page already gives the page its margins, and
          the two together pushed this list in twice as far as any other. */}
      <div style={{ maxWidth: 1040 }}>
        <h1 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 30, fontWeight: 700,
          letterSpacing: "-0.02em", color: C.txt, margin: "0 0 4px" }}>
          Appointments
        </h1>
        <p style={{ color: C.mid, fontSize: 14, marginTop: 0, marginBottom: 20 }}>
          Bookings Hey Nikki captured on calls.
          {upcomingCount > 0 && <>{" "}<span style={{ color: C.grn }}>{upcomingCount} upcoming.</span></>}
          {pendingCount > 0 && <>{" "}<span style={{ color: C.gold }}>
            {pendingCount} waiting for you to confirm.</span></>}
        </p>

        {error && (
          <div style={{ background: C.red + "0D", border: `1px solid ${C.red}55`,
            borderRadius: 10, padding: 14, marginBottom: 16, color: C.red, fontSize: 13 }}>
            {error}
          </div>
        )}
        {notice && (
          <div style={{ background: C.grn + "0D", border: `1px solid ${C.grn}55`,
            borderRadius: 10, padding: 14, marginBottom: 16, color: C.grn, fontSize: 13 }}>
            {notice}
          </div>
        )}

        {tenantId && <BookingNumberSettings tenantId={tenantId} onSaved={load} />}

        {/* The appointments export has existed on the API since exports were
            built (GET /api/export/appointments.csv, paged past PostgREST's
            1000-row ceiling) and no page has ever linked to it. /calls and
            /leads both had a download button; the one list a clinic actually
            wants in a spreadsheet — tomorrow's bookings — did not. */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div role="tablist" aria-label="Which bookings" style={{ display: "inline-flex", background: "#EEF1F5",
            borderRadius: 10, padding: 3, gap: 2 }}>
            {(["upcoming", "all"] as const).map(f => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} style={{
                background: filter === f ? C.surf : "transparent",
                color: filter === f ? C.txt : C.mid,
                border: 0, borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600,
                boxShadow: filter === f ? "0 1px 2px rgba(15,23,42,0.08)" : "none",
                cursor: "pointer",
              }}>{f === "upcoming" ? "Upcoming" : "All bookings"}</button>
            ))}
          </div>
          <div style={{ marginLeft: "auto" }}>
            <ExportButton path="/api/export/appointments.csv" label="Download CSV"
              title="Download every booking as a CSV for Excel or Sheets" />
          </div>
        </div>

        {loading ? (
          <p style={{ color: C.mid }}>Loading…</p>
        ) : shown.length === 0 ? (
          <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12,
            padding: 40, textAlign: "center" }}>
            <div style={{ marginBottom: 10, display: "flex", justifyContent: "center" }}><Calendar size={28} /></div>
            <h3 style={{ color: C.txt, margin: "0 0 6px", fontSize: 17 }}>
              {filter === "upcoming" ? "Nothing booked from today onward" : "No appointments yet"}
            </h3>
            {/* An owner with a full month of past bookings and an empty week
                ahead was told "it appears here automatically", as though the
                page had never worked. Say which of the two it is. */}
            <p style={{ color: C.mid, fontSize: 14, margin: 0, lineHeight: 1.5 }}>
              {filter === "upcoming" && appts.length > 0
                ? "Older bookings are still here."
                : "When Hey Nikki books an appointment on a call, it appears here automatically."}
            </p>
            {filter === "upcoming" && appts.length > 0 && (
              <button onClick={() => setFilter("all")} style={{
                marginTop: 12, background: "none", border: `1px solid ${C.bord}`,
                color: C.glow, borderRadius: 8, padding: "8px 16px",
                fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}>Show all bookings</button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {shown.map((a, idx) => {
              const col = STATUS_COLORS[a.status] || C.mid;
              // A heading where the day changes — the list is ordered by
              // slot_date — so "tomorrow" is something you see, not work out.
              const newDay = idx === 0 || shown[idx - 1].slot_date !== a.slot_date;
              const d = a.slot_date ? new Date(a.slot_date + "T00:00:00") : null;
              return (
                <div key={a.id}>
                {newDay && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: idx === 0 ? "4px 2px 8px" : "18px 2px 8px" }}>
                    <span style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 16, fontWeight: 700, color: C.txt }}>
                      {dayHeading(a.slot_date)}
                    </span>
                    {d && dayHeading(a.slot_date) !== fmtDate(a.slot_date) && (
                      <span style={{ fontSize: 12.5, color: C.dim }}>{fmtDate(a.slot_date)}</span>
                    )}
                  </div>
                )}
                <div style={{
                  background: C.surf, border: "1px solid #E4E9F0", borderRadius: 12,
                  boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                  padding: 16, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap",
                }}>
                  {/* date tile: the edge carries the status */}
                  <div style={{
                    background: "#F8FAFC", borderRadius: 10, padding: "9px 12px 10px",
                    textAlign: "center", minWidth: 72, borderLeft: `3px solid ${col}`,
                  }}>
                    <div style={{ fontSize: 11, color: C.mid, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {d ? d.toLocaleDateString("en-IN", { month: "short" }) : "—"}
                    </div>
                    <div style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 24, fontWeight: 700,
                      color: C.txt, lineHeight: 1.05 }}>{d ? d.getDate() : "?"}</div>
                    <div style={{ fontSize: 12.5, color: C.txt, fontWeight: 600, marginTop: 3 }}>
                      {a.slot_time || "time?"}
                    </div>
                  </div>

                  {/* details */}
                  <div style={{ flex: "1 1 200px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                      {a.booking_ref && (
                        <span title="Booking number" style={{
                          background: "#F1F4F8", color: C.mid,
                          fontSize: 12, fontWeight: 500, padding: "2px 8px", borderRadius: 6,
                          fontFamily: "var(--font-mono), monospace", letterSpacing: 0.3,
                        }}>{a.booking_ref}</span>
                      )}
                      <span style={{ fontSize: 16, fontWeight: 700, color: C.txt }}>
                        {a.caller_name || "Unknown caller"}
                      </span>
                      <span style={{
                        background: col + "14", color: col, display: "inline-flex", alignItems: "center", gap: 5,
                        fontSize: 11.5, fontWeight: 600, padding: "3px 9px 3px 7px", borderRadius: 999, whiteSpace: "nowrap",
                      }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: col }} />{STATUS_LABELS[a.status] || a.status}</span>
                    </div>
                    <div style={{ fontSize: 13, color: C.mid, fontFamily: "var(--font-mono), monospace" }}>
                      {a.caller_number}
                    </div>
                    {a.service && (
                      <div style={{ fontSize: 13, color: C.gbr, marginTop: 4 }}>{a.service}</div>
                    )}
                    {a.notes && (
                      <div style={{ fontSize: 12, color: C.dim, marginTop: 4, fontStyle: "italic" }}>
                        {a.notes}
                      </div>
                    )}
                    {a.status === "pending" && (!a.slot_date || !a.slot_time) && (
                      <div style={{ fontSize: 12, color: C.gold, marginTop: 4 }}>
                        {!a.slot_date ? "Date" : "Time"} wasn&apos;t captured on the call — check with the caller before confirming.
                      </div>
                    )}
                  </div>

                  {/* actions */}
                  {/* Whatever its status, a booking with a date can go in a
                      calendar — including a cancelled one somebody wants a
                      record of. The button hides itself when there is no date
                      to put anywhere. */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flexDirection: "column", alignItems: "flex-start" }}>
                  {a.status === "pending" && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button onClick={() => updateStatus(a.id, "confirmed")} style={{
                        background: C.grn, color: "#fff", border: `1px solid ${C.grn}`,
                        borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                      }}>Confirm</button>
                      <button onClick={() => updateStatus(a.id, "cancelled")} style={{
                        background: C.surf, color: C.red, border: "1px solid #E4E9F0",
                        borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                      }}>Cancel</button>
                    </div>
                  )}
                  {a.status === "confirmed" && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button onClick={() => updateStatus(a.id, "completed")} style={{
                        background: C.surf, color: C.cyn, border: "1px solid #E4E9F0",
                        borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                      }}>Done</button>
                      <button onClick={() => updateStatus(a.id, "no_show")} style={{
                        background: C.surf, color: C.gold, border: "1px solid #E4E9F0",
                        borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                      }}>No-show</button>
                      <button onClick={() => updateStatus(a.id, "cancelled")} style={{
                        background: C.surf, color: C.red, border: "1px solid #E4E9F0",
                        borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                      }}>Cancel</button>
                    </div>
                  )}
                  <AddToCalendar appointment={a} business={business} />
                  </div>
                </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
}
