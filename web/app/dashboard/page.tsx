// app/dashboard/page.tsx — Reception Log (main dashboard)
"use client";
import { useEffect, useState, useCallback } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import type { CallRecord, Appointment } from "../../lib/supabase";

const C = {
  bg:"#07070D", surf:"#0F0F1A", hi:"#161625", bord:"#1E1E35",
  glow:"#8B5CF6", gbr:"#A78BFA", gold:"#F59E0B",
  grn:"#10B981", red:"#EF4444", cyn:"#06B6D4",
  txt:"#EEEEFF", mid:"#8888AA", dim:"#44445A",
};

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: C.surf, border: "1px solid " + C.bord,
    borderRadius: 10, padding: 16, ...style }}>{children}</div>;
}

function IntentBadge({ intent }: { intent: string }) {
  const map: Record<string, [string, string]> = {
    appointment: [C.grn + "22",  C.grn],
    enquiry:     [C.cyn + "22",  C.cyn],
    callback:    [C.gold + "22", C.gold],
    transfer:    [C.gbr + "22",  C.gbr],
    emergency:   [C.red + "22",  C.red],
    unknown:     [C.dim + "22",  C.dim],
  };
  const [bg, fg] = map[intent] || map.unknown;
  return (
    <span style={{ background: bg, color: fg, border: "1px solid " + fg + "44",
      borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700,
      textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>
      {intent}
    </span>
  );
}

function StatCard({ icon, value, label, color }: { icon: string; value: string | number; label: string; color: string }) {
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: C.mid, fontSize: 11, textTransform: "uppercase",
            letterSpacing: "0.1em", marginBottom: 6 }}>{label}</div>
          <div style={{ color, fontSize: 26, fontWeight: 900 }}>{value}</div>
        </div>
        <span style={{ fontSize: 24 }}>{icon}</span>
      </div>
    </Card>
  );
}

function formatDuration(s: number) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function timeAgo(ts: string) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString("en-IN");
}

export default function DashboardPage() {
  const [activeCalls, setActiveCalls]       = useState<CallRecord[]>([]);
  const [recentCalls, setRecentCalls]       = useState<CallRecord[]>([]);
  const [missedCalls, setMissedCalls]       = useState<CallRecord[]>([]);
  const [appointments, setAppointments]     = useState<Appointment[]>([]);
  const [stats, setStats]                   = useState({ total: 0, appointments: 0, missed: 0, waSent: 0 });
  const [loading, setLoading]               = useState(true);
  const [tenantId, setTenantId]             = useState<string | null>(null);

  const fetchData = useCallback(async (tid: string) => {
    const sb = createClient();
    const today = new Date().toISOString().split("T")[0];

    const [active, recent, missed, appts, todayStats] = await Promise.all([
      sb.from("calls").select("*").eq("tenant_id", tid).eq("status", "active")
        .order("created_at", { ascending: false }),
      sb.from("calls").select("*").eq("tenant_id", tid).neq("status", "active")
        .order("created_at", { ascending: false }).limit(20),
      sb.from("calls").select("*").eq("tenant_id", tid).eq("status", "missed")
        .order("created_at", { ascending: false }).limit(10),
      sb.from("appointments").select("*").eq("tenant_id", tid)
        .order("created_at", { ascending: false }).limit(10),
      sb.from("calls").select("id, status, wa_sent, appointment_created")
        .eq("tenant_id", tid).gte("created_at", today + "T00:00:00"),
    ]);

    setActiveCalls(active.data || []);
    setRecentCalls(recent.data || []);
    setMissedCalls(missed.data || []);
    setAppointments(appts.data || []);

    const d = todayStats.data || [];
    setStats({
      total:        d.length,
      appointments: d.filter(c => c.appointment_created).length,
      missed:       d.filter(c => c.status === "missed").length,
      waSent:       d.filter(c => c.wa_sent).length,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    const sb = createClient();
    let cleanupChannels: (() => void) | null = null;

    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = "/login"; return; }
      const { data: tu } = await sb.from("tenant_users")
        .select("tenant_id").eq("user_id", data.user.id).single();
      if (!tu) return;

      setTenantId(tu.tenant_id);
      await fetchData(tu.tenant_id);

      // Realtime: subscribe to BOTH calls and appointments for this tenant.
      // Any insert/update/delete refreshes the view. Postgres-changes are
      // filtered server-side so we only get rows for this tenant.
      const callsChannel = sb.channel(`calls-live-${tu.tenant_id}`)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "calls",
            filter: `tenant_id=eq.${tu.tenant_id}` },
          () => fetchData(tu.tenant_id))
        .subscribe();

      const apptsChannel = sb.channel(`appts-live-${tu.tenant_id}`)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "appointments",
            filter: `tenant_id=eq.${tu.tenant_id}` },
          () => fetchData(tu.tenant_id))
        .subscribe();

      cleanupChannels = () => {
        sb.removeChannel(callsChannel);
        sb.removeChannel(apptsChannel);
      };
    });

    return () => { if (cleanupChannels) cleanupChannels(); };
  }, [fetchData]);

  // Safety-net polling — only fires if realtime drops (every 30s, not 5s).
  // Realtime should handle nearly all updates; this just catches edge cases
  // like the websocket reconnecting after a sleep.
  useEffect(() => {
    if (!tenantId) return;
    const t = setInterval(() => fetchData(tenantId), 30000);
    return () => clearInterval(t);
  }, [tenantId, fetchData]);

  return (
    <Shell title="Reception Log">
      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: C.mid }}>
          <div style={{ fontSize: 24, animation: "spin 1s linear infinite", display: "inline-block" }}>◌</div>
          <div style={{ marginTop: 8 }}>Loading reception log...</div>
        </div>
      ) : (
        <>
          {/* Stats row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            <StatCard icon="📞" value={stats.total}        label="Calls Today"          color={C.gbr}  />
            <StatCard icon="📅" value={stats.appointments} label="Appointments Booked"  color={C.grn}  />
            <StatCard icon="📵" value={stats.missed}       label="Missed (handled)"     color={C.gold} />
            <StatCard icon="💬" value={stats.waSent}       label="WhatsApp Sent"        color={C.cyn}  />
          </div>

          {/* First-run empty state — shown only when no data at all exists */}
          {stats.total === 0 && activeCalls.length === 0 && recentCalls.length === 0 &&
           missedCalls.length === 0 && appointments.length === 0 && (
            <Card style={{ marginBottom: 20, padding: 32, textAlign: "center",
                           background: `linear-gradient(135deg, ${C.glow}10 0%, ${C.cyn}10 100%)`,
                           borderColor: C.glow + "44" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
              <div style={{ color: C.txt, fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
                Welcome to Nikki
              </div>
              <div style={{ color: C.mid, fontSize: 13, lineHeight: 1.6, maxWidth: 480, margin: "0 auto 20px" }}>
                Your AI receptionist isn't taking calls yet. Two quick steps to go live:
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 560, margin: "0 auto" }}>
                <a href="/setup" style={{
                  display: "block", padding: 16, background: C.surf,
                  border: "1px solid " + C.bord, borderRadius: 10,
                  textDecoration: "none", color: C.txt, textAlign: "left",
                }}>
                  <div style={{ color: C.glow, fontSize: 11, fontWeight: 800, marginBottom: 4 }}>STEP 1</div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Pick a voice profile</div>
                  <div style={{ color: C.dim, fontSize: 12, marginTop: 4 }}>Choose Standard / Clinic / Real Estate / Premium →</div>
                </a>
                <a href="/setup#forwarding" style={{
                  display: "block", padding: 16, background: C.surf,
                  border: "1px solid " + C.bord, borderRadius: 10,
                  textDecoration: "none", color: C.txt, textAlign: "left",
                }}>
                  <div style={{ color: C.grn, fontSize: 11, fontWeight: 800, marginBottom: 4 }}>STEP 2</div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Forward your number</div>
                  <div style={{ color: C.dim, fontSize: 12, marginTop: 4 }}>Add the Nikki DID to your business line →</div>
                </a>
              </div>
              <div style={{ color: C.dim, fontSize: 11, marginTop: 20 }}>
                Stuck? Email <a href="mailto:support@jovio.in" style={{ color: C.grn }}>support@jovio.in</a>
              </div>
            </Card>
          )}

          {/* Active calls live ticker */}
          {activeCalls.length > 0 && (
            <Card style={{ marginBottom: 20, borderColor: C.grn + "44", background: C.grn + "08" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.grn,
                  boxShadow: "0 0 8px " + C.grn, animation: "pulse 2s infinite" }} />
                <span style={{ color: C.grn, fontSize: 13, fontWeight: 800 }}>
                  {activeCalls.length} Active Call{activeCalls.length > 1 ? "s" : ""} Right Now
                </span>
              </div>
              {activeCalls.map(call => (
                <div key={call.id} style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "center", padding: "10px 12px", background: C.surf,
                  borderRadius: 8, marginBottom: 8, border: "1px solid " + C.bord }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <span style={{ fontSize: 20 }}>📱</span>
                    <div>
                      <div style={{ color: C.txt, fontSize: 13, fontWeight: 700 }}>
                        {call.caller_number}
                      </div>
                      <div style={{ color: C.dim, fontSize: 11 }}>
                        {call.direction} · {timeAgo(call.created_at)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <IntentBadge intent={call.intent || "unknown"} />
                    <span style={{ color: C.grn, fontSize: 11, fontWeight: 700 }}>LIVE</span>
                  </div>
                </div>
              ))}
            </Card>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>

            {/* Today's appointments */}
            <Card>
              <div style={{ color: C.gbr, fontSize: 13, fontWeight: 800, marginBottom: 12 }}>
                📅 Appointment Ledger
              </div>
              {appointments.length === 0 ? (
                <div style={{ color: C.dim, fontSize: 12, textAlign: "center", padding: 20 }}>
                  No appointments yet today
                </div>
              ) : appointments.map(a => (
                <div key={a.id} style={{ padding: "8px 0", borderBottom: "1px solid " + C.bord + "44" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ color: C.txt, fontSize: 12, fontWeight: 700 }}>
                        {a.caller_name || a.caller_number}
                      </div>
                      <div style={{ color: C.dim, fontSize: 11, marginTop: 2 }}>
                        {a.service || "General"} · {a.slot_date} {a.slot_time}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {a.wa_confirmed && (
                        <span style={{ color: C.grn, fontSize: 10 }}>✓ WA</span>
                      )}
                      <span style={{ background: C.grn + "22", color: C.grn, fontSize: 10,
                        padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>
                        {a.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </Card>

            {/* Missed calls */}
            <Card>
              <div style={{ color: C.gold, fontSize: 13, fontWeight: 800, marginBottom: 12 }}>
                📵 Missed Calls — AI Handled
              </div>
              {missedCalls.length === 0 ? (
                <div style={{ color: C.dim, fontSize: 12, textAlign: "center", padding: 20 }}>
                  No missed calls 🎉
                </div>
              ) : missedCalls.map(call => (
                <div key={call.id} style={{ padding: "8px 0", borderBottom: "1px solid " + C.bord + "44" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ color: C.txt, fontSize: 12, fontWeight: 700 }}>
                        {call.caller_number}
                      </div>
                      <div style={{ color: C.dim, fontSize: 11 }}>{timeAgo(call.created_at)}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {call.wa_sent && (
                        <span style={{ color: C.cyn, fontSize: 10, fontWeight: 700 }}>WA ✓</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          </div>

          {/* Recent calls feed */}
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ color: C.txt, fontSize: 13, fontWeight: 800 }}>Recent Calls</div>
              <a href="/calls" style={{ color: C.glow, fontSize: 12 }}>View all →</a>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Caller", "Direction", "Duration", "Intent", "WA", "Time"].map(h => (
                    <th key={h} style={{ color: C.dim, fontSize: 10, fontWeight: 700,
                      textTransform: "uppercase", letterSpacing: "0.08em",
                      padding: "6px 8px", textAlign: "left",
                      borderBottom: "1px solid " + C.bord }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentCalls.slice(0, 10).map(call => (
                  <tr key={call.id} style={{ borderBottom: "1px solid " + C.bord + "33" }}
                    onMouseEnter={e => (e.currentTarget.style.background = C.hi)}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <td style={{ padding: "8px 8px", color: C.txt, fontSize: 12 }}>
                      {call.caller_number}
                    </td>
                    <td style={{ padding: "8px 8px" }}>
                      <span style={{ color: call.direction === "inbound" ? C.grn : C.gold,
                        fontSize: 11, fontWeight: 600 }}>
                        {call.direction === "inbound" ? "↙ In" : "↗ Out"}
                      </span>
                    </td>
                    <td style={{ padding: "8px 8px", color: C.mid, fontSize: 12 }}>
                      {formatDuration(call.duration_seconds)}
                    </td>
                    <td style={{ padding: "8px 8px" }}>
                      <IntentBadge intent={call.intent || "unknown"} />
                    </td>
                    <td style={{ padding: "8px 8px", color: call.wa_sent ? C.grn : C.dim,
                      fontSize: 12 }}>
                      {call.wa_sent ? "✓ Sent" : "—"}
                    </td>
                    <td style={{ padding: "8px 8px", color: C.dim, fontSize: 11 }}>
                      {timeAgo(call.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </Shell>
  );
}
