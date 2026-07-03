// super-admin/app/page.tsx
// Deploy to: admin.jovio.in (separate Vercel project)
// Access: super_admin role only
"use client";
import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer } from "recharts";

// ── ENV ──────────────────────────────────────────────────
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// ── DESIGN ───────────────────────────────────────────────
const C = {
  bg:"#07070D", surf:"#0F0F1A", hi:"#161625", bord:"#1E1E35",
  glow:"#8B5CF6", gbr:"#A78BFA", gold:"#F59E0B",
  grn:"#10B981", red:"#EF4444", cyn:"#06B6D4", org:"#F97316",
  txt:"#EEEEFF", mid:"#8888AA", dim:"#44445A",
};

// ── COMPONENTS ────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: C.surf, border: "1px solid " + C.bord,
    borderRadius: 10, padding: 16, ...style }}>{children}</div>;
}
function Pill({ label, color }: { label: string; color: string }) {
  return <span style={{ background: color + "22", color, border: "1px solid " + color + "44",
    borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 800,
    textTransform: "uppercase" as const, letterSpacing: "0.07em" }}>{label}</span>;
}
function KPI({ value, label, color, icon }: { value: any; label: string; color: string; icon: string }) {
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: C.dim, fontSize: 10, textTransform: "uppercase",
            letterSpacing: "0.1em", marginBottom: 6 }}>{label}</div>
          <div style={{ color, fontSize: 26, fontWeight: 900 }}>{value}</div>
        </div>
        <span style={{ fontSize: 22 }}>{icon}</span>
      </div>
    </Card>
  );
}

const TABS = ["📡 Dashboard","🏢 Tenants","📞 Live Calls","💰 Revenue","🔌 API Health","📣 Broadcast"];

export default function SuperAdminPage() {
  const [tab, setTab]           = useState(0);
  const [authed, setAuthed]     = useState(false);
  const [checking, setChecking] = useState(true);
  const [token, setToken]       = useState("");

  useEffect(() => {
    sb.auth.getSession().then(async ({ data }) => {
      if (!data.session) { setChecking(false); return; }
      setToken(data.session.access_token);
      const { data: tu } = await sb.from("tenant_users")
        .select("role").eq("user_id", data.session.user.id).single();
      setAuthed(tu?.role === "super_admin");
      setChecking(false);
    });
  }, []);

  if (checking) return <div style={{ background: C.bg, minHeight: "100vh",
    display: "flex", alignItems: "center", justifyContent: "center", color: C.mid }}>Loading...</div>;

  if (!authed) return <AdminLogin onSuccess={(t) => { setToken(t); setAuthed(true); }} />;

  const panels = [
    <PlatformDashboard key="dash" token={token} />,
    <TenantsPanel      key="ten"  token={token} />,
    <LiveCallsPanel    key="live" token={token} />,
    <RevenuePanel      key="rev"  token={token} />,
    <APIHealthPanel    key="api"  token={token} />,
    <BroadcastPanel    key="bc"   token={token} />,
  ];

  return (
    <div style={{ background: C.bg, minHeight: "100vh",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: C.txt }}>
      <style>{"*{box-sizing:border-box;margin:0;padding:0} a{color:inherit}"}</style>

      {/* Header */}
      <div style={{ background: C.surf, borderBottom: "1px solid " + C.bord,
        padding: "0 24px", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8,
          padding: "12px 0 8px", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.red,
              boxShadow: "0 0 8px " + C.red }} />
            <span style={{ fontSize: 14, fontWeight: 900 }}>Nikki — Super Admin</span>
            <Pill label="RESTRICTED ACCESS" color={C.red} />
          </div>
          <button onClick={() => sb.auth.signOut().then(() => window.location.reload())}
            style={{ background: "none", border: "1px solid " + C.bord, color: C.dim,
              borderRadius: 7, padding: "6px 12px", fontSize: 12 }}>Sign Out</button>
        </div>
        <div style={{ display: "flex", gap: 0, overflowX: "auto" }}>
          {TABS.map((t, i) => (
            <button key={t} onClick={() => setTab(i)} style={{
              background: "none", border: "none",
              borderBottom: "2px solid " + (tab === i ? C.glow : "transparent"),
              color: tab === i ? C.gbr : C.dim,
              padding: "8px 14px", fontSize: 12, fontWeight: tab === i ? 700 : 400,
              cursor: "pointer", whiteSpace: "nowrap",
            }}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 24px 60px" }}>
        {panels[tab]}
      </div>
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────
function AdminLogin({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { data, error: err } = await sb.auth.signInWithPassword({ email, password });
    if (err) { setError(err.message); setLoading(false); return; }
    const { data: tu } = await sb.from("tenant_users")
      .select("role").eq("user_id", data.user!.id).single();
    if (tu?.role !== "super_admin") {
      setError("Super admin access required.");
      await sb.auth.signOut();
      setLoading(false);
      return;
    }
    onSuccess(data.session!.access_token);
  };

  return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.surf, border: "1px solid " + C.red + "44",
        borderRadius: 12, padding: 32, width: 360 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔐</div>
          <div style={{ color: C.txt, fontSize: 18, fontWeight: 900 }}>Super Admin</div>
          <div style={{ color: C.dim, fontSize: 12, marginTop: 4 }}>Restricted — authorized personnel only</div>
        </div>
        {error && <div style={{ background: C.red + "22", color: C.red,
          border: "1px solid " + C.red + "44", borderRadius: 8,
          padding: "10px 12px", fontSize: 13, marginBottom: 16 }}>{error}</div>}
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 14 }}>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="admin@jovio.in" required
              style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
                borderRadius: 8, padding: "10px 12px", width: "100%", fontSize: 14 }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required
              style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
                borderRadius: 8, padding: "10px 12px", width: "100%", fontSize: 14 }} />
          </div>
          <button type="submit" disabled={loading} style={{
            width: "100%", background: C.red, color: "#fff", border: "none",
            borderRadius: 8, padding: "12px", fontSize: 14, fontWeight: 700,
            opacity: loading ? 0.7 : 1 }}>
            {loading ? "Verifying..." : "Access Super Admin"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── PLATFORM DASHBOARD ────────────────────────────────────
function PlatformDashboard({ token }: { token: string }) {
  const [stats, setStats]   = useState<any>(null);
  const [calls, setCalls]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch7DayVolume = useCallback(async () => {
    const { data } = await sb.from("calls").select("created_at")
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() - (6 - i) * 86400000);
      const dayStr = d.toISOString().split("T")[0];
      return {
        day: d.toLocaleDateString("en-IN", { weekday: "short" }),
        calls: (data || []).filter(c => c.created_at?.startsWith(dayStr)).length,
      };
    });
  }, []);

  useEffect(() => {
    const load = async () => {
      const [s, c, vol] = await Promise.all([
        fetch(`${API}/api/admin/stats`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        fetch(`${API}/api/admin/live-calls`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        fetch7DayVolume(),
      ]);
      setStats({ ...s, volume: vol });
      setCalls(c);
      setLoading(false);
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [token, fetch7DayVolume]);

  if (loading) return <div style={{ color: C.mid, padding: 40, textAlign: "center" }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
        <KPI value={stats?.tenants || 0}       label="Total Tenants"   color={C.gbr}  icon="🏢" />
        <KPI value={stats?.paid || 0}           label="Paid Customers"  color={C.grn}  icon="💰" />
        <KPI value={stats?.active_calls || 0}   label="Live Calls Now"  color={C.red}  icon="📞" />
        <KPI value={stats?.calls_today || 0}    label="Calls Today"     color={C.gold} icon="📊" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card>
          <div style={{ color: C.txt, fontSize: 13, fontWeight: 800, marginBottom: 14 }}>
            7-Day Call Volume
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={stats?.volume || []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="day" tick={{ fill: C.mid, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.mid, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: C.hi, border: "1px solid " + C.bord,
                borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="calls" fill={C.glow} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <div style={{ color: C.txt, fontSize: 13, fontWeight: 800, marginBottom: 14 }}>
            Plan Distribution
          </div>
          {stats && Object.entries(stats.by_plan || {}).map(([plan, count]: [string, any]) => (
            <div key={plan} style={{ display: "flex", justifyContent: "space-between",
              padding: "6px 0", borderBottom: "1px solid " + C.bord + "44" }}>
              <span style={{ color: C.mid, fontSize: 13, textTransform: "capitalize" }}>{plan}</span>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ width: 80, height: 4, background: C.hi, borderRadius: 2 }}>
                  <div style={{ width: `${Math.min(100, (count / (stats.tenants || 1)) * 100)}%`,
                    height: "100%", background: C.glow, borderRadius: 2 }} />
                </div>
                <span style={{ color: C.txt, fontSize: 13, fontWeight: 700, minWidth: 20 }}>{count}</span>
              </div>
            </div>
          ))}
        </Card>
      </div>

      {calls.length > 0 && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.grn,
              boxShadow: "0 0 8px " + C.grn, animation: "pulse 2s infinite" }} />
            <div style={{ color: C.grn, fontSize: 13, fontWeight: 800 }}>
              {calls.length} Active Calls — All Tenants
            </div>
          </div>
          {calls.slice(0, 5).map((c: any) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between",
              padding: "8px 0", borderBottom: "1px solid " + C.bord + "44" }}>
              <div>
                <span style={{ color: C.txt, fontSize: 12, fontWeight: 700 }}>{c.caller_number}</span>
                <span style={{ color: C.dim, fontSize: 11 }}> → {c.tenants?.name || "Unknown"}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: C.dim, fontSize: 11 }}>
                  {c.voice_profiles?.profile_sku || "standard"}
                </span>
                <Pill label={c.intent || "active"} color={C.grn} />
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ── TENANTS PANEL ─────────────────────────────────────────
function TenantsPanel({ token }: { token: string }) {
  const [tenants, setTenants]   = useState<any[]>([]);
  const [search, setSearch]     = useState("");
  const [filter, setFilter]     = useState("all");
  const [loading, setLoading]   = useState(true);
  const [acting, setActing]     = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await fetch(`${API}/api/admin/tenants`,
      { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
    setTenants(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (tenantId: string, action: string, body?: any) => {
    setActing(tenantId + action);
    await fetch(`${API}/api/admin/tenants/${tenantId}/${action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    await load();
    setActing(null);
  };

  const filtered = tenants.filter(t => {
    const matchSearch = !search || t.name?.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || t.status === filter || t.plan === filter;
    return matchSearch && matchFilter;
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search tenants..."
          style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
            borderRadius: 8, padding: "8px 12px", fontSize: 13, width: 220 }} />
        {["all","trial","active","suspended","starter","growth","scale"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "7px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700,
            background: filter === f ? C.glow + "66" : C.hi,
            color: filter === f ? C.gbr : C.mid,
            border: "1px solid " + (filter === f ? C.glow : C.bord),
          } as any}>{f}</button>
        ))}
        <span style={{ color: C.dim, fontSize: 12, marginLeft: "auto", alignSelf: "center" }}>
          {filtered.length} tenants
        </span>
      </div>

      <Card>
        {loading ? <div style={{ color: C.mid, textAlign: "center", padding: 40 }}>Loading...</div> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Business","Plan","Status","Trial Ends","Actions"].map(h => (
                <th key={h} style={{ color: C.dim, fontSize: 10, fontWeight: 700,
                  textTransform: "uppercase", padding: "8px 10px", textAlign: "left",
                  borderBottom: "1px solid " + C.bord }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id} style={{ borderBottom: "1px solid " + C.bord + "33" }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.hi)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <td style={{ padding: "10px", color: C.txt, fontSize: 13, fontWeight: 600 }}>
                    {t.name}
                  </td>
                  <td style={{ padding: "10px" }}>
                    <Pill label={t.plan} color={t.plan === "scale" ? C.gold : t.plan === "growth" ? C.gbr : C.mid} />
                  </td>
                  <td style={{ padding: "10px" }}>
                    <Pill label={t.status}
                      color={t.status === "active" ? C.grn : t.status === "trial" ? C.gold : C.red} />
                  </td>
                  <td style={{ padding: "10px", color: C.dim, fontSize: 11 }}>
                    {t.trial_ends_at ? new Date(t.trial_ends_at).toLocaleDateString("en-IN") : "—"}
                  </td>
                  <td style={{ padding: "10px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {t.status !== "suspended" ? (
                        <button onClick={() => doAction(t.id, "suspend", { reason: "Admin action" })}
                          disabled={acting === t.id + "suspend"}
                          style={{ background: C.red + "22", color: C.red,
                            border: "1px solid " + C.red + "44", borderRadius: 5,
                            padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          Suspend
                        </button>
                      ) : (
                        <button onClick={() => doAction(t.id, "unsuspend")}
                          disabled={acting === t.id + "unsuspend"}
                          style={{ background: C.grn + "22", color: C.grn,
                            border: "1px solid " + C.grn + "44", borderRadius: 5,
                            padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          Restore
                        </button>
                      )}
                      <select onChange={e => e.target.value && doAction(t.id, "override-plan", { plan: e.target.value })}
                        defaultValue=""
                        style={{ background: C.hi, color: C.mid, border: "1px solid " + C.bord,
                          borderRadius: 5, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}>
                        <option value="" disabled>Override plan</option>
                        {["starter","growth","scale"].map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ── LIVE CALLS PANEL ──────────────────────────────────────
function LiveCallsPanel({ token }: { token: string }) {
  const [calls, setCalls] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      const data = await fetch(`${API}/api/admin/live-calls`,
        { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
      setCalls(Array.isArray(data) ? data : []);
    };
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [token]);

  const duration = (ts: string) => {
    const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
    return `${Math.floor(s/60)}m ${s%60}s`;
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.grn,
          boxShadow: "0 0 8px " + C.grn, animation: "pulse 2s infinite" }} />
        <span style={{ color: C.grn, fontSize: 13, fontWeight: 800 }}>
          {calls.length} Active Calls — Refreshing every 3s
        </span>
      </div>

      {calls.length === 0 ? (
        <Card style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📞</div>
          <div style={{ color: C.dim }}>No active calls right now</div>
        </Card>
      ) : (
        <Card>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Tenant","Profile","Caller","Direction","Duration","Intent","Latency"].map(h => (
                <th key={h} style={{ color: C.dim, fontSize: 10, fontWeight: 700,
                  textTransform: "uppercase", padding: "8px 10px", textAlign: "left",
                  borderBottom: "1px solid " + C.bord }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {calls.map((c: any) => {
                const dur = (Date.now() - new Date(c.created_at).getTime()) / 1000;
                const latColor = dur < 700 ? C.grn : dur < 1000 ? C.gold : C.red;
                return (
                  <tr key={c.id} style={{ borderBottom: "1px solid " + C.bord + "44" }}>
                    <td style={{ padding: "10px", color: C.txt, fontSize: 12, fontWeight: 700 }}>
                      {c.tenants?.name || "—"}
                    </td>
                    <td style={{ padding: "10px", color: C.dim, fontSize: 11 }}>
                      {c.voice_profiles?.profile_sku || "standard"}
                    </td>
                    <td style={{ padding: "10px", color: C.txt, fontSize: 12 }}>
                      {c.caller_number}
                    </td>
                    <td style={{ padding: "10px" }}>
                      <span style={{ color: c.direction === "inbound" ? C.grn : C.gold,
                        fontSize: 11, fontWeight: 600 }}>
                        {c.direction === "inbound" ? "↙ In" : "↗ Out"}
                      </span>
                    </td>
                    <td style={{ padding: "10px", color: C.gbr, fontSize: 12, fontWeight: 700 }}>
                      {duration(c.created_at)}
                    </td>
                    <td style={{ padding: "10px" }}>
                      <Pill label={c.intent || "active"} color={C.grn} />
                    </td>
                    <td style={{ padding: "10px" }}>
                      <span style={{ color: latColor, fontSize: 12, fontWeight: 700 }}>●</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ── REVENUE PANEL ─────────────────────────────────────────
function RevenuePanel({ token }: { token: string }) {
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}/api/admin/stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setStats);
  }, [token]);

  const PLAN_PRICES = { starter: 1999, growth: 4999, scale: 9999, trial: 0 };
  const mrr = stats ? Object.entries(stats.by_plan || {}).reduce((sum, [plan, count]: [string, any]) => {
    return sum + ((PLAN_PRICES as any)[plan] || 0) * count;
  }, 0) : 0;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
        <KPI value={`₹${mrr.toLocaleString()}`} label="Est. MRR" color={C.grn} icon="💰" />
        <KPI value={`₹${(mrr * 12).toLocaleString()}`} label="Est. ARR" color={C.gold} icon="📈" />
        <KPI value={stats?.paid || 0} label="Paying Customers" color={C.gbr} icon="💳" />
      </div>

      <Card>
        <div style={{ color: C.txt, fontSize: 13, fontWeight: 800, marginBottom: 14 }}>
          Revenue by Plan
        </div>
        {Object.entries(PLAN_PRICES).map(([plan, price]) => {
          const count = stats?.by_plan?.[plan] || 0;
          const rev   = price * count;
          return (
            <div key={plan} style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", padding: "10px 0", borderBottom: "1px solid " + C.bord + "44" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <Pill label={plan}
                  color={plan === "scale" ? C.gold : plan === "growth" ? C.gbr : C.mid} />
                <span style={{ color: C.dim, fontSize: 12 }}>×{count} customers</span>
              </div>
              <span style={{ color: C.grn, fontSize: 14, fontWeight: 800 }}>
                ₹{rev.toLocaleString()}/mo
              </span>
            </div>
          );
        })}
        <div style={{ display: "flex", justifyContent: "space-between",
          marginTop: 12, paddingTop: 12, borderTop: "1px solid " + C.bord }}>
          <span style={{ color: C.txt, fontWeight: 800 }}>Total MRR</span>
          <span style={{ color: C.grn, fontSize: 18, fontWeight: 900 }}>₹{mrr.toLocaleString()}/mo</span>
        </div>
      </Card>
    </div>
  );
}

// ── API HEALTH PANEL ──────────────────────────────────────
function APIHealthPanel({ token: _ }: { token: string }) {
  const [providers, setProviders] = useState([
    { name: "Sarvam AI (STT+TTS)", status: "checking", latency: 0, url: "https://api.sarvam.ai" },
    { name: "Gemini 2.5 Flash",    status: "checking", latency: 0, url: "https://generativelanguage.googleapis.com" },
    { name: "LiveKit Cloud",        status: "checking", latency: 0, url: "https://cloud.livekit.io" },
    { name: "Exotel",               status: "checking", latency: 0, url: "https://api.exotel.com" },
    { name: "Razorpay",             status: "checking", latency: 0, url: "https://api.razorpay.com" },
    { name: "Supabase",             status: "checking", latency: 0, url: process.env.NEXT_PUBLIC_SUPABASE_URL || "" },
  ]);

  useEffect(() => {
    const check = async () => {
      const updated = await Promise.all(providers.map(async p => {
        const start = Date.now();
        try {
          await fetch(p.url, { method: "HEAD", mode: "no-cors", signal: AbortSignal.timeout(3000) });
          return { ...p, status: "ok", latency: Date.now() - start };
        } catch {
          return { ...p, status: "error", latency: 0 };
        }
      }));
      setProviders(updated);
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <div style={{ color: C.mid, fontSize: 12, marginBottom: 16 }}>
        Checks every 30 seconds · Circuit breaker auto-activates if error rate &gt;5%
      </div>
      <Card>
        {providers.map(p => (
          <div key={p.name} style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", padding: "12px 0", borderBottom: "1px solid " + C.bord + "44" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%",
                background: p.status === "ok" ? C.grn : p.status === "checking" ? C.gold : C.red,
                boxShadow: "0 0 6px " + (p.status === "ok" ? C.grn : p.status === "checking" ? C.gold : C.red),
              }} />
              <span style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{p.name}</span>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {p.latency > 0 && (
                <span style={{ color: p.latency < 400 ? C.grn : p.latency < 800 ? C.gold : C.red,
                  fontSize: 12, fontWeight: 700 }}>{p.latency}ms</span>
              )}
              <Pill label={p.status === "ok" ? "Healthy" : p.status === "checking" ? "Checking" : "Down"}
                color={p.status === "ok" ? C.grn : p.status === "checking" ? C.gold : C.red} />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ── BROADCAST PANEL ───────────────────────────────────────
function BroadcastPanel({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [filter, setFilter]   = useState("all");
  const [sending, setSending] = useState(false);
  const [result, setResult]   = useState<string | null>(null);

  const send = async () => {
    if (!message.trim()) return;
    setSending(true);
    setResult(null);
    const resp = await fetch(`${API}/api/admin/broadcast`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message, plan_filter: filter === "all" ? undefined : filter }),
    });
    const data = await resp.json();
    setResult(`Sent to ${data.sent_to || 0} tenants`);
    setSending(false);
    setMessage("");
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <Card>
        <div style={{ color: C.txt, fontSize: 14, fontWeight: 800, marginBottom: 16 }}>
          Broadcast Announcement
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ color: C.mid, fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>
            Target Audience
          </label>
          <select value={filter} onChange={e => setFilter(e.target.value)}
            style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
              borderRadius: 8, padding: "10px 12px", fontSize: 13, width: "100%" }}>
            <option value="all">All Tenants</option>
            <option value="trial">Trial Users Only</option>
            <option value="starter">Starter Plan</option>
            <option value="growth">Growth Plan</option>
            <option value="scale">Scale Plan</option>
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ color: C.mid, fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>
            Message
          </label>
          <textarea value={message} onChange={e => setMessage(e.target.value)}
            placeholder="Type your announcement..."
            rows={4}
            style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
              borderRadius: 8, padding: "10px 12px", fontSize: 13, width: "100%",
              resize: "vertical" }} />
        </div>

        {result && (
          <div style={{ background: C.grn + "22", border: "1px solid " + C.grn + "44",
            borderRadius: 8, padding: "10px 12px", color: C.grn, fontSize: 13, marginBottom: 14 }}>
            ✓ {result}
          </div>
        )}

        <button onClick={send} disabled={sending || !message.trim()}
          style={{ background: C.glow, color: "#fff", border: "none",
            borderRadius: 8, padding: "12px 24px", fontSize: 14, fontWeight: 700,
            opacity: (sending || !message.trim()) ? 0.6 : 1, cursor: "pointer" }}>
          {sending ? "Sending..." : "Send Broadcast"}
        </button>
      </Card>
    </div>
  );
}
