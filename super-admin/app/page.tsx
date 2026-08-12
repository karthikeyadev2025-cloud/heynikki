// super-admin/app/page.tsx
// Deploy to: admin.heynikki.in (separate Vercel project)
// Access: super_admin role only
"use client";
import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer } from "recharts";
import { NIKKI } from "../lib/brand";
import {
  LayoutDashboard, Building2, Phone, IndianRupee, Plug, Megaphone,
  Settings, SignalHigh, CreditCard, Lock, BarChart3, TrendingUp,
  Check, AlertTriangle, RefreshCw, Bot, User, Users,
} from "lucide-react";

// ── ENV ──────────────────────────────────────────────────
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// ── DESIGN ───────────────────────────────────────────────
const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: NIKKI.gold,
  grn: NIKKI.emerald, red: NIKKI.red, cyn: NIKKI.cyan, org: NIKKI.terracotta,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

// Shared type + spacing scale — every inline fontSize/padding in this
// file should draw from these instead of picking a new ad-hoc number.
const TYPE  = { xs: 11, sm: 13, base: 15, lg: 20, xl: 28 };
const SPACE = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

// ── COMPONENTS ────────────────────────────────────────────
function Card({ children, style, hover }: { children: React.ReactNode; style?: React.CSSProperties; hover?: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => hover && setHovered(true)}
      onMouseLeave={() => hover && setHovered(false)}
      style={{
        background: hovered ? C.hi : C.surf,
        border: "1px solid " + C.bord,
        borderRadius: 12,
        padding: SPACE.md,
        boxShadow: hovered
          ? "0 4px 16px rgba(18,69,122,0.12), 0 1px 3px rgba(18,69,122,0.08)"
          : "0 1px 2px rgba(15,23,42,0.04)",
        transition: "background 0.15s ease, box-shadow 0.15s ease",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
function Pill({ label, color }: { label: string; color: string }) {
  return <span style={{ background: color + "22", color, border: "1px solid " + color + "44",
    borderRadius: 4, padding: "2px 8px", fontSize: TYPE.xs, fontWeight: 800,
    textTransform: "uppercase" as const, letterSpacing: "0.07em" }}>{label}</span>;
}
function StatusDot({ ok }: { ok: boolean }) {
  return <span style={{
    display: "inline-block", width: 8, height: 8, borderRadius: "50%",
    background: ok ? C.grn : C.red,
    boxShadow: `0 0 0 3px ${(ok ? C.grn : C.red)}22`,
  }} />;
}
function KPI({ value, label, color, icon: IconComp }: { value: any; label: string; color: string; icon: React.ComponentType<{ size?: number; color?: string }> }) {
  return (
    <Card hover>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: C.dim, fontSize: TYPE.xs, textTransform: "uppercase",
            letterSpacing: "0.1em", marginBottom: SPACE.xs + 2 }}>{label}</div>
          <div style={{ color, fontSize: TYPE.xl, fontWeight: 900 }}>{value}</div>
        </div>
        <div style={{ background: color + "15", borderRadius: 8, padding: 8, display: "flex" }}>
          <IconComp size={20} color={color} />
        </div>
      </div>
    </Card>
  );
}

const TABS = [
  { label: "Dashboard",       icon: LayoutDashboard },
  { label: "Tenants",         icon: Building2 },
  { label: "Live Calls",      icon: Phone },
  { label: "CRM",             icon: Users },
  { label: "Revenue",         icon: IndianRupee },
  { label: "API Health",      icon: Plug },
  { label: "Broadcast",       icon: Megaphone },
  { label: "Platform Config", icon: Settings },
  { label: "FreeSWITCH",      icon: SignalHigh },
  { label: "Pricing Engine",  icon: CreditCard },
];


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
    <CrmPanel          key="crm"  token={token} />,
    <RevenuePanel      key="rev"  token={token} />,
    <APIHealthPanel    key="api"  token={token} />,
    <BroadcastPanel    key="bc"   token={token} />,
    <PlatformConfigPanel key="cfg"   token={token} />,
    <FreeSwitchPanel     key="fs"    token={token} />,
    <PricingEnginePanel  key="price" token={token} />,
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
            <span style={{ fontSize: TYPE.base, fontWeight: 900 }}>Nikki — Super Admin</span>
            <Pill label="RESTRICTED ACCESS" color={C.red} />
          </div>
          <button onClick={() => sb.auth.signOut().then(() => window.location.reload())}
            style={{ background: "none", border: "1px solid " + C.bord, color: C.dim,
              borderRadius: 7, padding: "6px 12px", fontSize: TYPE.sm }}>Sign Out</button>
        </div>
        <div style={{ display: "flex", gap: 0, overflowX: "auto" }}>
          {TABS.map((t, i) => {
            const TabIcon = t.icon;
            return (
              <button key={t.label} onClick={() => setTab(i)} style={{
                background: "none", border: "none", display: "flex",
                alignItems: "center", gap: 6,
                borderBottom: "2px solid " + (tab === i ? C.glow : "transparent"),
                color: tab === i ? C.gbr : C.dim,
                padding: "8px 14px", fontSize: TYPE.xs, fontWeight: tab === i ? 700 : 400,
                cursor: "pointer", whiteSpace: "nowrap",
              }}>
                <TabIcon size={14} />
                {t.label}
              </button>
            );
          })}
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
          <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}><Lock size={32} color={C.glow} /></div>
          <div style={{ color: C.txt, fontSize: TYPE.lg, fontWeight: 900 }}>Super Admin</div>
          <div style={{ color: C.dim, fontSize: TYPE.sm, marginTop: 4 }}>Restricted — authorized personnel only</div>
        </div>
        {error && <div style={{ background: C.red + "22", color: C.red,
          border: "1px solid " + C.red + "44", borderRadius: 8,
          padding: "10px 12px", fontSize: TYPE.sm, marginBottom: 16 }}>{error}</div>}
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 14 }}>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="admin@heynikki.in" required
              style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
                borderRadius: 8, padding: "10px 12px", width: "100%", fontSize: TYPE.base }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required
              style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
                borderRadius: 8, padding: "10px 12px", width: "100%", fontSize: TYPE.base }} />
          </div>
          <button type="submit" disabled={loading} style={{
            width: "100%", background: C.red, color: "#fff", border: "none",
            borderRadius: 8, padding: "12px", fontSize: TYPE.base, fontWeight: 700,
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
        <KPI value={stats?.tenants || 0}       label="Total Tenants"   color={C.gbr}  icon={Building2} />
        <KPI value={stats?.paid || 0}           label="Paid Customers"  color={C.grn}  icon={IndianRupee} />
        <KPI value={stats?.active_calls || 0}   label="Live Calls Now"  color={C.red}  icon={Phone} />
        <KPI value={stats?.calls_today || 0}    label="Calls Today"     color={C.gold} icon={BarChart3} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card>
          <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800, marginBottom: 14 }}>
            7-Day Call Volume
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={stats?.volume || []} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="day" tick={{ fill: C.mid, fontSize: TYPE.xs }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.mid, fontSize: TYPE.xs }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: C.hi, border: "1px solid " + C.bord,
                borderRadius: 8, fontSize: TYPE.sm }} />
              <Bar dataKey="calls" fill={C.glow} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800, marginBottom: 14 }}>
            Plan Distribution
          </div>
          {stats && Object.entries(stats.by_plan || {}).map(([plan, count]: [string, any]) => (
            <div key={plan} style={{ display: "flex", justifyContent: "space-between",
              padding: "6px 0", borderBottom: "1px solid " + C.bord + "44" }}>
              <span style={{ color: C.mid, fontSize: TYPE.sm, textTransform: "capitalize" }}>{plan}</span>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ width: 80, height: 4, background: C.hi, borderRadius: 2 }}>
                  <div style={{ width: `${Math.min(100, (count / (stats.tenants || 1)) * 100)}%`,
                    height: "100%", background: C.glow, borderRadius: 2 }} />
                </div>
                <span style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 700, minWidth: 20 }}>{count}</span>
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
            <div style={{ color: C.grn, fontSize: TYPE.sm, fontWeight: 800 }}>
              {calls.length} Active Calls — All Tenants
            </div>
          </div>
          {calls.slice(0, 5).map((c: any) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between",
              padding: "8px 0", borderBottom: "1px solid " + C.bord + "44" }}>
              <div>
                <span style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 700 }}>{c.caller_number}</span>
                <span style={{ color: C.dim, fontSize: TYPE.xs }}> → {c.tenants?.name || "Unknown"}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: C.dim, fontSize: TYPE.xs }}>
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
            borderRadius: 8, padding: "8px 12px", fontSize: TYPE.sm, width: 220 }} />
        {["all","trial","active","suspended","starter","growth","scale"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "7px 12px", borderRadius: 7, fontSize: TYPE.sm, fontWeight: 700,
            background: filter === f ? C.glow + "66" : C.hi,
            color: filter === f ? C.gbr : C.mid,
            border: "1px solid " + (filter === f ? C.glow : C.bord),
          } as any}>{f}</button>
        ))}
        <span style={{ color: C.dim, fontSize: TYPE.sm, marginLeft: "auto", alignSelf: "center" }}>
          {filtered.length} tenants
        </span>
      </div>

      <Card>
        {loading ? <div style={{ color: C.mid, textAlign: "center", padding: 40 }}>Loading...</div> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Business","Plan","Status","Trial Ends","Actions"].map(h => (
                <th key={h} style={{ color: C.dim, fontSize: TYPE.xs, fontWeight: 700,
                  textTransform: "uppercase", padding: "8px 10px", textAlign: "left",
                  borderBottom: "1px solid " + C.bord }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id} style={{ borderBottom: "1px solid " + C.bord + "33" }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.hi)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <td style={{ padding: "10px", color: C.txt, fontSize: TYPE.sm, fontWeight: 600 }}>
                    {t.name}
                  </td>
                  <td style={{ padding: "10px" }}>
                    <Pill label={t.plan} color={t.plan === "scale" ? C.gold : t.plan === "growth" ? C.gbr : C.mid} />
                  </td>
                  <td style={{ padding: "10px" }}>
                    <Pill label={t.status}
                      color={t.status === "active" ? C.grn : t.status === "trial" ? C.gold : C.red} />
                  </td>
                  <td style={{ padding: "10px", color: C.dim, fontSize: TYPE.xs }}>
                    {t.trial_ends_at ? new Date(t.trial_ends_at).toLocaleDateString("en-IN") : "—"}
                  </td>
                  <td style={{ padding: "10px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {t.status !== "suspended" ? (
                        <button onClick={() => doAction(t.id, "suspend", { reason: "Admin action" })}
                          disabled={acting === t.id + "suspend"}
                          style={{ background: C.red + "22", color: C.red,
                            border: "1px solid " + C.red + "44", borderRadius: 5,
                            padding: "4px 10px", fontSize: TYPE.xs, fontWeight: 700, cursor: "pointer" }}>
                          Suspend
                        </button>
                      ) : (
                        <button onClick={() => doAction(t.id, "unsuspend")}
                          disabled={acting === t.id + "unsuspend"}
                          style={{ background: C.grn + "22", color: C.grn,
                            border: "1px solid " + C.grn + "44", borderRadius: 5,
                            padding: "4px 10px", fontSize: TYPE.xs, fontWeight: 700, cursor: "pointer" }}>
                          Restore
                        </button>
                      )}
                      <select onChange={e => e.target.value && doAction(t.id, "override-plan", { plan: e.target.value })}
                        defaultValue=""
                        style={{ background: C.hi, color: C.mid, border: "1px solid " + C.bord,
                          borderRadius: 5, padding: "4px 8px", fontSize: TYPE.xs, cursor: "pointer" }}>
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

// ── CRM PANEL ──────────────────────────────────────────────
// Platform-wide oversight across all tenants' leads. The leads table's
// own design notes (011_leads_crm.sql) are explicit: "a simple, honest
// funnel... NOT a configurable pipeline builder... a fake enterprise
// feature is worse than a clear simple one" — matching that same
// philosophy here rather than building something heavier than the
// data model actually supports. RLS already grants super_admin
// cross-tenant read/write (is_super_admin() in the leads policies),
// so this queries Supabase directly, same pattern as TenantsPanel.

function CrmPanel({ token: _ }: { token: string }) {
  const [leads, setLeads]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [stageFilter, setStageFilter] = useState("all");

  useEffect(() => {
    const load = async () => {
      const { data } = await sb.from("leads")
        .select("*, tenants(name)")
        .order("last_contacted_at", { ascending: false })
        .limit(500);
      setLeads(data || []);
      setLoading(false);
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const stageColor = (s: string) => ({
    new: C.cyn, contacted: C.gold, qualified: C.gbr, won: C.grn, lost: C.dim,
  } as Record<string, string>)[s] || C.mid;

  const filtered = leads.filter(l => {
    const matchStage  = stageFilter === "all" || l.stage === stageFilter;
    const matchSearch = !search ||
      l.name?.toLowerCase().includes(search.toLowerCase()) ||
      l.phone?.includes(search) ||
      l.tenants?.name?.toLowerCase().includes(search.toLowerCase());
    return matchStage && matchSearch;
  });

  const counts = ["new", "contacted", "qualified", "won", "lost"].map(s => ({
    stage: s, count: leads.filter(l => l.stage === s).length,
  }));

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: 20 }}>
        {counts.map(({ stage, count }) => (
          <Card key={stage} style={{ textAlign: "center" }}>
            <div style={{ color: stageColor(stage), fontSize: TYPE.xl, fontWeight: 900 }}>{count}</div>
            <div style={{ color: C.dim, fontSize: TYPE.xs, textTransform: "uppercase", marginTop: 2 }}>{stage}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, phone, or business..."
          style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
            borderRadius: 8, padding: "8px 12px", fontSize: TYPE.sm, width: 260 }} />
        {["all", "new", "contacted", "qualified", "won", "lost"].map(f => (
          <button key={f} onClick={() => setStageFilter(f)} style={{
            padding: "7px 12px", borderRadius: 7, fontSize: TYPE.sm, fontWeight: 700,
            background: stageFilter === f ? C.glow + "66" : C.hi,
            color: stageFilter === f ? C.gbr : C.mid,
            border: "1px solid " + (stageFilter === f ? C.glow : C.bord),
          } as any}>{f}</button>
        ))}
        <span style={{ color: C.dim, fontSize: TYPE.sm, marginLeft: "auto", alignSelf: "center" }}>
          {filtered.length} leads
        </span>
      </div>

      <Card>
        {loading ? <div style={{ color: C.mid, textAlign: "center", padding: 40 }}>Loading...</div> :
         filtered.length === 0 ? <div style={{ color: C.dim, textAlign: "center", padding: 40 }}>No leads match</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>{["Business","Name","Phone","Interest","Stage","Score","Calls","Last Contact"].map(h => (
                  <th key={h} style={{ color: C.dim, fontSize: TYPE.xs, fontWeight: 700,
                    textTransform: "uppercase", padding: "8px 10px", textAlign: "left",
                    borderBottom: "1px solid " + C.bord, whiteSpace: "nowrap" }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {filtered.map(l => (
                  <tr key={l.id} style={{ borderBottom: "1px solid " + C.bord + "33" }}>
                    <td style={{ padding: "10px", color: C.mid, fontSize: TYPE.sm }}>{l.tenants?.name || "—"}</td>
                    <td style={{ padding: "10px", color: C.txt, fontSize: TYPE.sm, fontWeight: 600 }}>{l.name || "Unknown"}</td>
                    <td style={{ padding: "10px", color: C.dim, fontSize: TYPE.sm }}>{l.phone}</td>
                    <td style={{ padding: "10px", color: C.mid, fontSize: TYPE.sm }}>{l.interest || "—"}</td>
                    <td style={{ padding: "10px" }}><Pill label={l.stage} color={stageColor(l.stage)} /></td>
                    <td style={{ padding: "10px", color: C.txt, fontSize: TYPE.sm, fontWeight: 700 }}>{l.score ?? 0}</td>
                    <td style={{ padding: "10px", color: C.dim, fontSize: TYPE.sm }}>{l.call_count ?? 1}</td>
                    <td style={{ padding: "10px", color: C.dim, fontSize: TYPE.xs }}>
                      {l.last_contacted_at ? new Date(l.last_contacted_at).toLocaleDateString("en-IN") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        <span style={{ color: C.grn, fontSize: TYPE.sm, fontWeight: 800 }}>
          {calls.length} Active Calls — Refreshing every 3s
        </span>
      </div>

      {calls.length === 0 ? (
        <Card style={{ textAlign: "center", padding: 48 }}>
          <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}><Phone size={32} color={C.dim} /></div>
          <div style={{ color: C.dim }}>No active calls right now</div>
        </Card>
      ) : (
        <Card>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Tenant","Profile","Caller","Direction","Duration","Intent","Latency"].map(h => (
                <th key={h} style={{ color: C.dim, fontSize: TYPE.xs, fontWeight: 700,
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
                    <td style={{ padding: "10px", color: C.txt, fontSize: TYPE.sm, fontWeight: 700 }}>
                      {c.tenants?.name || "—"}
                    </td>
                    <td style={{ padding: "10px", color: C.dim, fontSize: TYPE.xs }}>
                      {c.voice_profiles?.profile_sku || "standard"}
                    </td>
                    <td style={{ padding: "10px", color: C.txt, fontSize: TYPE.sm }}>
                      {c.caller_number}
                    </td>
                    <td style={{ padding: "10px" }}>
                      <span style={{ color: c.direction === "inbound" ? C.grn : C.gold,
                        fontSize: TYPE.xs, fontWeight: 600 }}>
                        {c.direction === "inbound" ? "↙ In" : "↗ Out"}
                      </span>
                    </td>
                    <td style={{ padding: "10px", color: C.gbr, fontSize: TYPE.sm, fontWeight: 700 }}>
                      {duration(c.created_at)}
                    </td>
                    <td style={{ padding: "10px" }}>
                      <Pill label={c.intent || "active"} color={C.grn} />
                    </td>
                    <td style={{ padding: "10px" }}>
                      <span style={{ color: latColor, fontSize: TYPE.sm, fontWeight: 700 }}>●</span>
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
  const [plans, setPlans] = useState<any[]>([]);

  useEffect(() => {
    fetch(`${API}/api/admin/stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setStats);
    // Was previously a hardcoded PLAN_PRICES object here, disconnected
    // from the real editable plans table — a price changed in the
    // Pricing Engine tab would silently never show up in MRR/ARR here.
    // Reading the same table PricingEnginePanel actually writes to.
    sb.from("plans").select("id,price_monthly_paise").then(({ data }) => setPlans(data || []));
  }, [token]);

  const planPrice = (planId: string) =>
    (plans.find(p => p.id === planId)?.price_monthly_paise || 0) / 100;

  const mrr = stats ? Object.entries(stats.by_plan || {}).reduce((sum, [plan, count]: [string, any]) => {
    return sum + planPrice(plan) * count;
  }, 0) : 0;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
        <KPI value={`₹${mrr.toLocaleString()}`} label="Est. MRR" color={C.grn} icon={IndianRupee} />
        <KPI value={`₹${(mrr * 12).toLocaleString()}`} label="Est. ARR" color={C.gold} icon={TrendingUp} />
        <KPI value={stats?.paid || 0} label="Paying Customers" color={C.gbr} icon={CreditCard} />
      </div>

      <Card>
        <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800, marginBottom: 14 }}>
          Revenue by Plan
        </div>
        {plans.map(({ id: plan }) => {
          const count = stats?.by_plan?.[plan] || 0;
          const rev   = planPrice(plan) * count;
          return (
            <div key={plan} style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", padding: "10px 0", borderBottom: "1px solid " + C.bord + "44" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <Pill label={plan}
                  color={plan === "scale" ? C.gold : plan === "growth" ? C.gbr : C.mid} />
                <span style={{ color: C.dim, fontSize: TYPE.sm }}>×{count} customers</span>
              </div>
              <span style={{ color: C.grn, fontSize: TYPE.base, fontWeight: 800 }}>
                ₹{rev.toLocaleString()}/mo
              </span>
            </div>
          );
        })}
        <div style={{ display: "flex", justifyContent: "space-between",
          marginTop: 12, paddingTop: 12, borderTop: "1px solid " + C.bord }}>
          <span style={{ color: C.txt, fontWeight: 800 }}>Total MRR</span>
          <span style={{ color: C.grn, fontSize: TYPE.lg, fontWeight: 900 }}>₹{mrr.toLocaleString()}/mo</span>
        </div>
      </Card>
    </div>
  );
}

// ── API HEALTH PANEL ──────────────────────────────────────
function APIHealthPanel({ token }: { token: string }) {
  const [providers, setProviders] = useState<any[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/api/admin/health`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setProviders(data.providers || []);
        setCheckedAt(data.checked_at || null);
      } catch {
        setProviders([]);
      }
      setLoading(false);
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [token]);

  return (
    <div>
      <div style={{ color: C.mid, fontSize: TYPE.sm, marginBottom: 16 }}>
        Checked server-side every 30 seconds{checkedAt ? ` · last checked ${new Date(checkedAt).toLocaleTimeString()}` : ""}
      </div>
      <Card>
        {loading ? (
          <div style={{ color: C.dim, fontSize: TYPE.sm, textAlign: "center", padding: "20px 0" }}>Checking...</div>
        ) : providers.length === 0 ? (
          <div style={{ color: C.red, fontSize: TYPE.sm, textAlign: "center", padding: "20px 0" }}>Could not reach health endpoint</div>
        ) : providers.map(p => (
          <div key={p.name} style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", padding: "12px 0", borderBottom: "1px solid " + C.bord + "44" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <StatusDot ok={!!p.ok} />
              <span style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 600 }}>{p.name}</span>
              {p.configured === false && (
                <Pill label="Not configured" color={C.dim} />
              )}
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {p.latencyMs > 0 && (
                <span style={{ color: p.latencyMs < 400 ? C.grn : p.latencyMs < 800 ? C.gold : C.red,
                  fontSize: TYPE.sm, fontWeight: 700 }}>{p.latencyMs}ms</span>
              )}
              <Pill label={p.configured === false ? "Skipped" : p.ok ? "Healthy" : "Down"}
                color={p.configured === false ? C.dim : p.ok ? C.grn : C.red} />
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
        <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 800, marginBottom: 16 }}>
          Broadcast Announcement
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ color: C.mid, fontSize: TYPE.sm, fontWeight: 600, display: "block", marginBottom: 6 }}>
            Target Audience
          </label>
          <select value={filter} onChange={e => setFilter(e.target.value)}
            style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
              borderRadius: 8, padding: "10px 12px", fontSize: TYPE.sm, width: "100%" }}>
            <option value="all">All Tenants</option>
            <option value="trial">Trial Users Only</option>
            <option value="starter">Starter Plan</option>
            <option value="growth">Growth Plan</option>
            <option value="scale">Scale Plan</option>
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ color: C.mid, fontSize: TYPE.sm, fontWeight: 600, display: "block", marginBottom: 6 }}>
            Message
          </label>
          <textarea value={message} onChange={e => setMessage(e.target.value)}
            placeholder="Type your announcement..."
            rows={4}
            style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
              borderRadius: 8, padding: "10px 12px", fontSize: TYPE.sm, width: "100%",
              resize: "vertical" }} />
        </div>

        {result && (
          <div style={{ background: C.grn + "22", border: "1px solid " + C.grn + "44",
            borderRadius: 8, padding: "10px 12px", color: C.grn, fontSize: TYPE.sm, marginBottom: 14,
            display: "flex", alignItems: "center", gap: 6 }}>
            <Check size={14} /> {result}
          </div>
        )}

        <button onClick={send} disabled={sending || !message.trim()}
          style={{ background: C.glow, color: "#fff", border: "none",
            borderRadius: 8, padding: "12px 24px", fontSize: TYPE.base, fontWeight: 700,
            opacity: (sending || !message.trim()) ? 0.6 : 1, cursor: "pointer" }}>
          {sending ? "Sending..." : "Send Broadcast"}
        </button>
      </Card>
    </div>
  );
}

// ── PILL TOGGLE COMPONENT ──────────────────────────────────────
function PillToggle({ options, value, onChange }: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "inline-flex", background: C.hi, borderRadius: 8,
      border: "1px solid " + C.bord, padding: 3, gap: 2 }}>
      {options.map(opt => (
        <button key={opt.value} onClick={() => onChange(opt.value)} style={{
          padding: "6px 18px", borderRadius: 6, border: "none", fontSize: TYPE.sm,
          fontWeight: 700, cursor: "pointer", transition: "all 0.2s",
          background: value === opt.value ? C.glow : "transparent",
          color: value === opt.value ? "#fff" : C.mid,
          boxShadow: value === opt.value ? "0 0 16px " + C.glow + "66" : "none",
        }}>{opt.label}</button>
      ))}
    </div>
  );
}

// ── PLATFORM CONFIG PANEL ─────────────────────────────────────
function PlatformConfigPanel({ token }: { token: string }) {
  const [cfg, setCfg]     = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved]   = useState<string | null>(null);
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  useEffect(() => {
    fetch(`${API_URL}/api/platform/config`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then((rows: any[]) => {
      const m: Record<string, string> = {};
      for (const r of rows) m[r.key] = r.value;
      setCfg(m);
    });
  }, [token, API_URL]);

  const saveKey = async (key: string, value: string) => {
    setSaving(key);
    await fetch(`${API_URL}/api/platform/config`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    setCfg(prev => ({ ...prev, [key]: value }));
    setSaving(null);
    setSaved(key);
    setTimeout(() => setSaved(null), 2000);
  };

  const Row = ({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "16px 0", borderBottom: "1px solid " + C.bord + "44" }}>
      <div>
        <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 700, marginBottom: 3 }}>{label}</div>
        <div style={{ color: C.dim, fontSize: TYPE.xs }}>{desc}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {children}
        {saved === label && <span style={{ color: C.grn, fontSize: TYPE.xs, display: "inline-flex", alignItems: "center", gap: 4 }}><Check size={11} /> Saved</span>}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ color: C.txt, fontSize: TYPE.lg, fontWeight: 900, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}><Settings size={18} color={C.glow} /> Platform Config</div>
      <div style={{ color: C.dim, fontSize: TYPE.sm, marginBottom: 20 }}>
        Toggle engines, configure URLs, and set global defaults — no redeployment needed.
      </div>

      {cfg["telephony_engine"] === "exotel" && (
        <div style={{ background: C.gold + "22", border: "1px solid " + C.gold + "44",
          borderRadius: 8, padding: "10px 14px", fontSize: TYPE.sm, color: C.gold, marginBottom: 16 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><AlertTriangle size={14} /> Exotel mode is active — inbound calls route through Exotel, not FreeSWITCH.</span>
        </div>
      )}

      <Card>
        <Row label="Telephony Engine" desc="FreeSWITCH = Jio/Vi SIP primary. Exotel = legacy fallback.">
          <PillToggle
            options={[{ label: "FreeSWITCH", value: "freeswitch" }, { label: "Exotel", value: "exotel" }]}
            value={cfg["telephony_engine"] || "freeswitch"}
            onChange={v => saveKey("telephony_engine", v)}
          />
        </Row>

        <Row label="Automation Engine" desc="Routes WhatsApp/automation webhooks to selected engine.">
          <PillToggle
            options={[{ label: "n8n", value: "n8n" }, { label: "Activepieces", value: "activepieces" }]}
            value={cfg["automation_engine"] || "n8n"}
            onChange={v => saveKey("automation_engine", v)}
          />
        </Row>

        <Row label="Primary SIP Trunk" desc="Which carrier gets inbound calls first.">
          <PillToggle
            options={[{ label: "Jio", value: "jio" }, { label: "Vi", value: "vi" }]}
            value={cfg["sip_primary"] || "jio"}
            onChange={v => saveKey("sip_primary", v)}
          />
        </Row>

        <Row label="Global Missed Call Guard" desc="Default: trigger 20s safety net on all DIDs.">
          <PillToggle
            options={[{ label: "ON", value: "true" }, { label: "OFF", value: "false" }]}
            value={cfg["missed_call_guard"] || "true"}
            onChange={v => saveKey("missed_call_guard", v)}
          />
          <input
            type="number" min={5} max={60}
            value={cfg["missed_call_seconds"] || "20"}
            onChange={e => setCfg(p => ({ ...p, missed_call_seconds: e.target.value }))}
            onBlur={e => saveKey("missed_call_seconds", e.target.value)}
            style={{ width: 60, background: C.hi, border: "1px solid " + C.bord, color: C.txt,
              borderRadius: 6, padding: "6px 8px", fontSize: TYPE.sm, textAlign: "center" }}
          />
          <span style={{ color: C.dim, fontSize: TYPE.xs }}>sec</span>
        </Row>

        {([
          { key: "n8n_url" as const,          label: "n8n" },
          { key: "activepieces_url" as const, label: "Activepieces" },
          { key: "r2_public_url" as const,    label: "R2 Public URL" },
        ]).map(({ key, label }) => (
          <Row key={key} label={label} desc={`Internal URL for ${key}`}>
            <input
              value={cfg[key] || ""}
              onChange={e => setCfg(p => ({ ...p, [key]: e.target.value }))}
              onBlur={e => saveKey(key, e.target.value)}
              style={{ width: 260, background: C.hi, border: "1px solid " + C.bord, color: C.txt,
                borderRadius: 6, padding: "7px 10px", fontSize: TYPE.sm }}
            />
            {cfg[key] && (
              <a href={cfg[key]} target="_blank" rel="noopener noreferrer" style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                color: C.glow, fontSize: TYPE.xs, fontWeight: 700, textDecoration: "none",
                border: "1px solid " + C.glow + "44", borderRadius: 6, padding: "6px 10px",
              }}>Open →</a>
            )}
          </Row>
        ))}
      </Card>
    </div>
  );
}

// ── FREESWITCH PANEL ──────────────────────────────────────────
function FreeSwitchPanel({ token }: { token: string }) {
  const [fsData, setFsData]   = useState<any>(null);
  const [dids, setDids]       = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing]   = useState<string | null>(null);
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const loadFS = async () => {
    const [fs, d, t] = await Promise.all([
      fetch(`${API_URL}/api/admin/freeswitch/status`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()).catch(() => null),
      sb.from("dids").select("*, tenants(name)").order("created_at", { ascending: false }),
      sb.from("tenants").select("id, name").eq("status", "active"),
    ]);
    setFsData(fs);
    setDids(d.data || []);
    setTenants(t.data || []);
    setLoading(false);
  };

  useEffect(() => { loadFS(); const t = setInterval(loadFS, 10000); return () => clearInterval(t); }, []);

  const hangupChannel = async (uuid: string) => {
    setActing(uuid);
    await fetch(`${API_URL}/api/admin/freeswitch/hangup-channel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ uuid }),
    });
    await loadFS(); setActing(null);
  };

  const reloadDialplan = async () => {
    setActing("reload");
    await fetch(`${API_URL}/api/admin/freeswitch/reload-dialplan`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` },
    });
    setActing(null);
  };

  const assignDid = async (didId: string, tenantId: string) => {
    await sb.from("dids").update({ tenant_id: tenantId, status: "assigned", assigned_at: new Date().toISOString() }).eq("id", didId);
    await loadFS();
  };

  const statusColor = (s: string) => s === "registered" ? C.grn : s === "unregistered" ? C.gold : C.red;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ color: C.txt, fontSize: TYPE.lg, fontWeight: 900, display: "flex", alignItems: "center", gap: 8 }}><SignalHigh size={18} color={C.glow} /> FreeSWITCH Control</div>
          <div style={{ color: C.dim, fontSize: TYPE.sm, marginTop: 2 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><StatusDot ok={!!fsData?.alive} /> FreeSWITCH {fsData?.alive ? "reachable" : "unreachable"}</span> · Refreshing every 10s
          </div>
        </div>
        <button onClick={reloadDialplan} disabled={acting === "reload"} style={{
          background: C.glow + "22", color: C.gbr, border: "1px solid " + C.glow + "44",
          borderRadius: 7, padding: "8px 16px", fontSize: TYPE.sm, fontWeight: 700, cursor: "pointer",
        }}>
          {acting === "reload" ? "Reloading..." : (<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><RefreshCw size={14} /> Reload Dialplan</span>)}
        </button>
      </div>

      {/* SIP Trunk Status */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        {(fsData?.trunks || [{ name: "Jio Enterprise", status: "unknown", gateway: "jio_primary" },
                              { name: "Vi Business", status: "unknown", gateway: "vi_failover" }]).map((trunk: any) => (
          <Card key={trunk.gateway}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 700 }}>{trunk.name}</div>
                <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 2 }}>{trunk.gateway}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%",
                  background: statusColor(trunk.status),
                  boxShadow: "0 0 8px " + statusColor(trunk.status) }} />
                <Pill label={trunk.status} color={statusColor(trunk.status)} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Active Channels */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800, marginBottom: 12 }}>
          Active Channels ({(fsData?.channels || []).length})
        </div>
        {(fsData?.channels || []).length === 0 ? (
          <div style={{ color: C.dim, fontSize: TYPE.sm, textAlign: "center", padding: "20px 0" }}>No active calls</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["UUID", "Caller", "Called", "Direction", "Duration", ""].map(h => (
                <th key={h} style={{ color: C.dim, fontSize: TYPE.xs, fontWeight: 700, textTransform: "uppercase",
                  padding: "6px 10px", textAlign: "left", borderBottom: "1px solid " + C.bord }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {(fsData?.channels || []).map((ch: any) => (
                <tr key={ch.uuid} style={{ borderBottom: "1px solid " + C.bord + "33" }}>
                  <td style={{ padding: "8px 10px", color: C.dim, fontSize: TYPE.xs, fontFamily: "monospace" }}>{ch.uuid?.slice(0,8)}…</td>
                  <td style={{ padding: "8px 10px", color: C.txt, fontSize: TYPE.sm }}>{ch.caller_number}</td>
                  <td style={{ padding: "8px 10px", color: C.mid, fontSize: TYPE.sm }}>{ch.called_number}</td>
                  <td style={{ padding: "8px 10px" }}><Pill label={ch.direction} color={ch.direction === "inbound" ? C.grn : C.gold} /></td>
                  <td style={{ padding: "8px 10px", color: C.gbr, fontSize: TYPE.sm, fontWeight: 700 }}>{ch.duration_sec}s</td>
                  <td style={{ padding: "8px 10px" }}>
                    <button onClick={() => hangupChannel(ch.uuid)} disabled={acting === ch.uuid}
                      style={{ background: C.red + "22", color: C.red, border: "1px solid " + C.red + "44",
                        borderRadius: 5, padding: "3px 8px", fontSize: TYPE.xs, fontWeight: 700, cursor: "pointer" }}>
                      Hangup
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* DID Management */}
      <Card>
        <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800, marginBottom: 12 }}>DID Inventory</div>
        {loading ? <div style={{ color: C.dim, textAlign: "center", padding: 20 }}>Loading...</div> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Number", "Provider", "Tenant", "Routing", "Status", "Monthly Cost", "Action"].map(h => (
                <th key={h} style={{ color: C.dim, fontSize: TYPE.xs, fontWeight: 700, textTransform: "uppercase",
                  padding: "6px 10px", textAlign: "left", borderBottom: "1px solid " + C.bord }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {dids.map((did: any) => (
                <tr key={did.id} style={{ borderBottom: "1px solid " + C.bord + "33" }}>
                  <td style={{ padding: "10px", color: C.txt, fontSize: TYPE.sm, fontWeight: 700 }}>{did.number}</td>
                  <td style={{ padding: "10px" }}><Pill label={did.provider} color={C.cyn} /></td>
                  <td style={{ padding: "10px", color: C.mid, fontSize: TYPE.sm }}>{did.tenants?.name || "—"}</td>
                  <td style={{ padding: "10px" }}><Pill label={did.routing_mode || "ai"} color={C.gbr} /></td>
                  <td style={{ padding: "10px" }}>
                    <Pill label={did.status} color={did.status === "assigned" ? C.grn : did.status === "available" ? C.gold : C.dim} />
                  </td>
                  <td style={{ padding: "10px", color: C.grn, fontSize: TYPE.sm, fontWeight: 700 }}>
                    ₹{((did.monthly_cost_paise || 199900) / 100).toLocaleString()}/mo
                  </td>
                  <td style={{ padding: "10px" }}>
                    <select defaultValue="" onChange={e => e.target.value && assignDid(did.id, e.target.value)}
                      style={{ background: C.hi, color: C.mid, border: "1px solid " + C.bord,
                        borderRadius: 5, padding: "4px 8px", fontSize: TYPE.xs, cursor: "pointer" }}>
                      <option value="" disabled>Assign to…</option>
                      {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
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

// ── PRICING ENGINE PANEL ──────────────────────────────────────
function PricingEnginePanel({ token }: { token: string }) {
  const [plans, setPlans]   = useState<any[]>([]);
  const [edited, setEdited] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [skuCfg, setSkuCfg] = useState<Record<string, string>>({});
  const [skuSaving, setSkuSaving] = useState<string | null>(null);
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  useEffect(() => {
    sb.from("plans").select("*").then(({ data }) => setPlans(data || []));
    // These 3 SKU cards used to be hardcoded strings with a label
    // claiming "Update in Plans table above" — they weren't actually
    // connected to anything. Now backed by platform_config, same
    // table/pattern PlatformConfigPanel already uses.
    fetch(`${API_URL}/api/platform/config`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then((rows: any[]) => {
        const m: Record<string, string> = {};
        for (const r of rows) m[r.key] = r.value;
        setSkuCfg(m);
      });
  }, [token, API_URL]);

  const saveSkuPrice = async (key: string, paise: number) => {
    setSkuSaving(key);
    await fetch(`${API_URL}/api/platform/config`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: String(paise) }),
    });
    setSkuCfg(prev => ({ ...prev, [key]: String(paise) }));
    setSkuSaving(null);
  };

  const set = (planId: string, field: string, val: any) => {
    setEdited(prev => ({ ...prev, [planId]: { ...(prev[planId] || {}), [field]: val } }));
  };

  const saveAll = async () => {
    setSaving(true);
    for (const [planId, changes] of Object.entries(edited)) {
      await sb.from("plans").update(changes).eq("id", planId);
    }
    const { data } = await sb.from("plans").select("*");
    setPlans(data || []);
    setEdited({});
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const val = (plan: any, field: string) =>
    edited[plan.id]?.[field] ?? plan[field];

  const Input = ({ plan, field, prefix = "", suffix = "" }: { plan: any; field: string; prefix?: string; suffix?: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
      {prefix && <span style={{ color: C.dim, fontSize: TYPE.xs }}>{prefix}</span>}
      <input
        type="number"
        value={field.includes("paise") ? Math.round(val(plan, field) / 100) : val(plan, field)}
        onChange={e => set(plan.id, field, field.includes("paise") ? parseInt(e.target.value) * 100 : parseInt(e.target.value))}
        style={{ width: 80, background: C.hi, border: "1px solid " + C.bord, color: C.txt,
          borderRadius: 6, padding: "5px 8px", fontSize: TYPE.sm, textAlign: "right" }}
      />
      {suffix && <span style={{ color: C.dim, fontSize: TYPE.xs }}>{suffix}</span>}
    </div>
  );

  const PLAN_COLORS: Record<string, string> = { trial: C.dim, starter: C.mid, growth: C.gbr, scale: C.gold };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ color: C.txt, fontSize: TYPE.lg, fontWeight: 900, display: "flex", alignItems: "center", gap: 8 }}><CreditCard size={18} color={C.glow} /> Pricing Engine</div>
          <div style={{ color: C.dim, fontSize: TYPE.sm, marginTop: 2 }}>
            Edit pricing live — changes take effect immediately. No redeployment.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {saved && <span style={{ color: C.grn, fontSize: TYPE.sm, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><Check size={12} /> Saved!</span>}
          <button onClick={saveAll} disabled={saving || Object.keys(edited).length === 0} style={{
            background: C.glow, color: "#fff", border: "none", borderRadius: 7,
            padding: "10px 20px", fontSize: TYPE.sm, fontWeight: 700, cursor: "pointer",
            opacity: saving || Object.keys(edited).length === 0 ? 0.5 : 1,
          }}>
            {saving ? "Saving..." : "Save All Changes"}
          </button>
        </div>
      </div>

      {/* Plans table */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Plan", "Monthly (₹)", "Annual (₹)", "Minutes", "Max Profiles", "Max DIDs", "Concurrent", "Recording Days"].map(h => (
                <th key={h} style={{ color: C.dim, fontSize: TYPE.xs, fontWeight: 700, textTransform: "uppercase",
                  padding: "8px 12px", textAlign: "left", borderBottom: "1px solid " + C.bord, whiteSpace: "nowrap" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {plans.map(plan => (
                <tr key={plan.id} style={{ borderBottom: "1px solid " + C.bord + "44" }}>
                  <td style={{ padding: "12px" }}>
                    <Pill label={plan.id} color={PLAN_COLORS[plan.id] || C.mid} />
                  </td>
                  <td style={{ padding: "12px" }}><Input plan={plan} field="price_monthly_paise" prefix="₹" /></td>
                  <td style={{ padding: "12px" }}><Input plan={plan} field="price_annual_paise" prefix="₹" /></td>
                  <td style={{ padding: "12px" }}><Input plan={plan} field="minutes_per_month" suffix="min" /></td>
                  <td style={{ padding: "12px" }}><Input plan={plan} field="max_voice_profiles" /></td>
                  <td style={{ padding: "12px" }}><Input plan={plan} field="max_phone_numbers" /></td>
                  <td style={{ padding: "12px" }}><Input plan={plan} field="max_concurrent_calls" /></td>
                  <td style={{ padding: "12px" }}><Input plan={plan} field="recording_days" suffix="d" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Product pricing cards */}
      <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800, marginBottom: 12 }}>Product Unit Pricing</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        {[
          { key: "price_ai_telecaller_paise", label: "AI Telecaller Unit", icon: Bot,   color: C.glow, defaultPaise: 599900 },
          { key: "price_human_crm_seat_paise", label: "Human CRM Seat",    icon: User,  color: C.gbr,  defaultPaise: 199900 },
          { key: "price_jio_did_paise",        label: "Dedicated Jio DID", icon: Phone, color: C.grn,  defaultPaise: 199900 },
        ].map(p => {
          const paise = parseInt(skuCfg[p.key] || String(p.defaultPaise), 10);
          return (
            <Card key={p.key} hover>
              <div style={{ marginBottom: 8 }}><p.icon size={24} color={p.color} /></div>
              <div style={{ color: C.mid, fontSize: TYPE.xs, marginBottom: 4 }}>{p.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ color: p.color, fontSize: TYPE.xs }}>₹</span>
                <input
                  type="number"
                  defaultValue={Math.round(paise / 100)}
                  onBlur={e => saveSkuPrice(p.key, parseInt(e.target.value || "0", 10) * 100)}
                  style={{ width: 70, background: "transparent", border: "none", borderBottom: "1px solid " + p.color + "44",
                    color: p.color, fontSize: TYPE.lg, fontWeight: 900, padding: "2px 0" }}
                />
                <span style={{ color: C.dim, fontSize: TYPE.xs }}>/mo</span>
              </div>
              <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 4 }}>
                {skuSaving === p.key ? "Saving..." : "Click to edit, saves on blur"}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
