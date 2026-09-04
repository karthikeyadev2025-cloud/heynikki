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

const STATUS_COLORS: Record<string, string> = {
  confirmed: C.grn, completed: C.cyn, cancelled: C.red,
  no_show: C.gold, rescheduled: C.gbr,
};

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
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
      setMsg({ bad: true, text: /booking_ref/.test(error.message)
        ? "Booking numbers aren't enabled on the database yet — apply supabase/043_booking_reference.sql."
        : error.message });
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
  const [filter, setFilter] = useState<"upcoming" | "all">("all");
  const [notice, setNotice] = useState("");
  const [tenantId, setTenantId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) { window.location.href = "/login"; return; }
    const { data: tu } = await sb.from("tenant_users").select("tenant_id")
      .eq("user_id", auth.user.id).maybeSingle();
    if (tu?.tenant_id) setTenantId(tu.tenant_id);

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
    if (e) setError(e.message);
    else { setNotice(`Marked ${status}.`); load(); }
  }

  const shown = appts.filter(a => filter === "all" || isUpcoming(a.slot_date));
  const upcomingCount = appts.filter(a => isUpcoming(a.slot_date) && a.status === "confirmed").length;

  return (
    <Shell>
      <div style={{ padding: 24, maxWidth: 960 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: C.txt, margin: "0 0 4px" }}>
          Appointments
        </h1>
        <p style={{ color: C.mid, fontSize: 14, marginTop: 0, marginBottom: 20 }}>
          Bookings Hey Nikki captured on calls. {upcomingCount > 0 &&
            <span style={{ color: C.grn }}>{upcomingCount} upcoming.</span>}
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

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(["upcoming", "all"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              background: filter === f ? C.glow : C.hi,
              color: filter === f ? "#fff" : C.mid,
              border: `1px solid ${filter === f ? C.glow : C.bord}`,
              borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600,
              cursor: "pointer", textTransform: "capitalize",
            }}>{f}</button>
          ))}
        </div>

        {loading ? (
          <p style={{ color: C.mid }}>Loading…</p>
        ) : shown.length === 0 ? (
          <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12,
            padding: 40, textAlign: "center" }}>
            <div style={{ marginBottom: 10, display: "flex", justifyContent: "center" }}><Calendar size={28} /></div>
            <h3 style={{ color: C.txt, margin: "0 0 6px", fontSize: 17 }}>
              {filter === "upcoming" ? "No upcoming appointments" : "No appointments yet"}
            </h3>
            <p style={{ color: C.mid, fontSize: 14, margin: 0, lineHeight: 1.5 }}>
              When Hey Nikki books an appointment on a call, it appears here
              automatically.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {shown.map(a => {
              const col = STATUS_COLORS[a.status] || C.mid;
              return (
                <div key={a.id} style={{
                  background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12,
                  padding: 16, display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap",
                }}>
                  {/* date block */}
                  <div style={{
                    background: C.hi, borderRadius: 10, padding: "10px 14px",
                    textAlign: "center", minWidth: 76,
                  }}>
                    <div style={{ fontSize: 12, color: C.mid, fontWeight: 600 }}>{fmtDate(a.slot_date)}</div>
                    <div style={{ fontSize: 15, color: C.txt, fontWeight: 800, marginTop: 2 }}>
                      {a.slot_time || "—"}
                    </div>
                  </div>

                  {/* details */}
                  <div style={{ flex: "1 1 200px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                      {a.booking_ref && (
                        <span style={{
                          background: C.cyn + "1A", color: C.cyn, border: `1px solid ${C.cyn}55`,
                          fontSize: 12, fontWeight: 800, padding: "2px 8px", borderRadius: 6,
                          fontFamily: "monospace", letterSpacing: 0.5,
                        }}>{a.booking_ref}</span>
                      )}
                      <span style={{ fontSize: 16, fontWeight: 700, color: C.txt }}>
                        {a.caller_name || "Unknown caller"}
                      </span>
                      <span style={{
                        background: col + "22", color: col, border: `1px solid ${col}44`,
                        fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                        textTransform: "uppercase", letterSpacing: 0.5,
                      }}>{a.status}</span>
                    </div>
                    <div style={{ fontSize: 13, color: C.mid, fontFamily: "monospace" }}>
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
                  </div>

                  {/* actions */}
                  {a.status === "confirmed" && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button onClick={() => updateStatus(a.id, "completed")} style={{
                        background: C.cyn + "22", color: C.cyn, border: `1px solid ${C.cyn}44`,
                        borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                      }}>Done</button>
                      <button onClick={() => updateStatus(a.id, "no_show")} style={{
                        background: C.gold + "22", color: C.gold, border: `1px solid ${C.gold}44`,
                        borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                      }}>No-show</button>
                      <button onClick={() => updateStatus(a.id, "cancelled")} style={{
                        background: C.red + "22", color: C.red, border: `1px solid ${C.red}44`,
                        borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                      }}>Cancel</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
}
