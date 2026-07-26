"use client";

/**
 * Appointments dashboard.
 *
 * Shows bookings that Hey Nikki captured during calls. Until the extraction
 * module (app/exotel/appointments.py) shipped, the AI would tell callers
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

const C = {
  bg:"#07070D", surf:"#0F0F1A", hi:"#161625", bord:"#1E1E35",
  glow:"#8B5CF6", gbr:"#A78BFA", gold:"#F59E0B",
  grn:"#10B981", red:"#EF4444", cyn:"#06B6D4",
  txt:"#EEEEFF", mid:"#8888AA", dim:"#44445A",
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

export default function AppointmentsPage() {
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"upcoming" | "all">("upcoming");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) { window.location.href = "/login"; return; }

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
            <div style={{ fontSize: 32, marginBottom: 10 }}>📅</div>
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
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
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
