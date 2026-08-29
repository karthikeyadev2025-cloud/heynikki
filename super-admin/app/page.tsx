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
  X, Tag, Clock, Download, UserPlus, MessageSquare, Activity, ShieldCheck, Gauge, MessageCircle, Menu, Mic } from "lucide-react";

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


// Eighteen destinations do not fit in a row of tabs. They fit in six groups,
// and the grouping is the point: an operator arrives knowing whether they are
// here about a CUSTOMER, a CALL, or the PLATFORM, and only then which screen.
// Order within each group runs in the order the work actually happens.
const NAV_GROUPS: { title: string; labels: string[] }[] = [
  { title: "Overview",  labels: ["Dashboard"] },
  { title: "Customers", labels: ["Tenants", "KYC Review", "CRM", "Revenue"] },
  { title: "Telephony", labels: ["Live Calls", "Numbers", "WhatsApp", "FreeSWITCH"] },
  { title: "Quality",   labels: ["Call Quality", "Agent Versions", "Voice Lab"] },
  { title: "Outreach",  labels: ["Campaigns", "Broadcast"] },
  { title: "Platform",  labels: ["Operations", "API Health", "Platform Config",
                                 "Pricing Engine", "Audit Log"] },
];

const TABS = [
  { label: "Dashboard",       icon: LayoutDashboard },
  { label: "Tenants",         icon: Building2 },
  { label: "Live Calls",      icon: Phone },
  { label: "CRM",             icon: Users },
  { label: "Revenue",         icon: IndianRupee },
  { label: "Operations",      icon: Activity },
  { label: "KYC Review",      icon: ShieldCheck },
  { label: "Numbers",         icon: Phone },
  { label: "WhatsApp",        icon: MessageCircle },
  { label: "Call Quality",    icon: Gauge },
  { label: "Campaigns",       icon: Megaphone },
  { label: "Agent Versions",  icon: Bot },
  { label: "Voice Lab",       icon: Mic },
  { label: "Audit Log",       icon: Lock },
  { label: "API Health",      icon: Plug },
  { label: "Broadcast",       icon: Megaphone },
  { label: "Platform Config", icon: Settings },
  { label: "FreeSWITCH",      icon: SignalHigh },
  { label: "Pricing Engine",  icon: CreditCard },
];


export default function SuperAdminPage() {
  const [tab, setTab]           = useState(0);
  const [navOpen, setNavOpen]   = useState(false);
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
    <OperationsPanel   key="ops"  token={token} />,
    <KycPanel          key="kyc"  token={token} />,
    <DidPanel          key="did"  token={token} />,
    <WhatsAppNumbersPanel key="wa" token={token} />,
    <QualityPanel      key="qua"  token={token} />,
    <CampaignsPanel    key="cmp"  token={token} />,
    <AgentVersionsPanel key="ver" token={token} />,
    <VoiceLabPanel     key="vlab" token={token} />,
    <AuditPanel        key="aud"  token={token} />,
    <APIHealthPanel    key="api"  token={token} />,
    <BroadcastPanel    key="bc"   token={token} />,
    <PlatformConfigPanel key="cfg"   token={token} />,
    <FreeSwitchPanel     key="fs"    token={token} />,
    <PricingEnginePanel  key="price" token={token} />,
  ];


  return (
    <div style={{ background: C.bg, minHeight: "100vh",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: C.txt }}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0} a{color:inherit}
        .nk-shell{display:grid;grid-template-columns:232px minmax(0,1fr);
                  max-width:1400px;margin:0 auto;align-items:start}
        .nk-side{position:sticky;top:56px;max-height:calc(100vh - 56px);
                 overflow-y:auto;padding:18px 10px 40px;
                 border-right:1px solid ${C.bord}}
        .nk-side button:hover{background:${C.hi}}
        .nk-side button:focus-visible{outline:2px solid ${C.glow};outline-offset:-2px}
        .nk-burger{display:none}
        .nk-scrim{display:none}
        @media (max-width: 900px){
          .nk-shell{grid-template-columns:minmax(0,1fr)}
          .nk-burger{display:inline-flex}
          .nk-side{position:fixed;top:56px;left:0;bottom:0;width:250px;z-index:60;
                   background:${C.surf};transform:translateX(-100%);
                   transition:transform .18s ease}
          .nk-side-open{transform:translateX(0)}
          .nk-scrim{display:block;position:fixed;inset:56px 0 0;z-index:55;
                    background:rgba(15,23,42,.38)}
        }
        @media (max-width: 560px){ .nk-hide-sm{display:none} }
        @media (prefers-reduced-motion: reduce){ .nk-side{transition:none} }
      `}</style>

      {/* Header */}
      <header style={{ background: C.surf, borderBottom: "1px solid " + C.bord,
        padding: "0 20px", position: "sticky", top: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        height: 56 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="nk-burger" onClick={() => setNavOpen(o => !o)}
            aria-label="Menu" aria-expanded={navOpen}
            style={{ background: "none", border: "1px solid " + C.bord, color: C.mid,
              borderRadius: 7, padding: "5px 8px", cursor: "pointer", lineHeight: 0 }}>
            <Menu size={16} />
          </button>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.red,
            boxShadow: "0 0 8px " + C.red, flex: "none" }} />
          <span style={{ fontSize: TYPE.base, fontWeight: 900, whiteSpace: "nowrap" }}>
            Nikki — Super Admin
          </span>
          <span className="nk-hide-sm"><Pill label="RESTRICTED ACCESS" color={C.red} /></span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="nk-hide-sm" style={{ color: C.dim, fontSize: TYPE.xs }}>
            {TABS[tab].label}
          </span>
          <button onClick={() => sb.auth.signOut().then(() => window.location.reload())}
            style={{ background: "none", border: "1px solid " + C.bord, color: C.dim,
              borderRadius: 7, padding: "6px 12px", fontSize: TYPE.sm, cursor: "pointer" }}>
            Sign Out
          </button>
        </div>
      </header>

      <div className="nk-shell">
        <nav className={"nk-side" + (navOpen ? " nk-side-open" : "")} aria-label="Sections">
          {NAV_GROUPS.map(g => (
            <div key={g.title} style={{ marginBottom: 18 }}>
              <div style={{ color: C.dim, fontSize: 10, fontWeight: 800,
                letterSpacing: "0.12em", textTransform: "uppercase" as const,
                padding: "0 10px 6px" }}>{g.title}</div>
              {g.labels.map(label => {
                const i = TABS.findIndex(t => t.label === label);
                if (i < 0) return null;           // a renamed tab loses its icon, not the console
                const Icon = TABS[i].icon;
                const on = tab === i;
                return (
                  <button key={label} onClick={() => { setTab(i); setNavOpen(false); }}
                    aria-current={on ? "page" : undefined}
                    style={{
                      display: "flex", alignItems: "center", gap: 9, width: "100%",
                      padding: "7px 10px", marginBottom: 1, borderRadius: 8,
                      border: "none", cursor: "pointer", textAlign: "left" as const,
                      background: on ? C.glow + "1A" : "transparent",
                      color: on ? C.gbr : C.mid,
                      fontSize: TYPE.sm, fontWeight: on ? 700 : 500,
                      borderLeft: "2px solid " + (on ? C.glow : "transparent"),
                    }}>
                    <Icon size={14} style={{ flex: "none", opacity: on ? 1 : 0.75 }} />
                    <span style={{ whiteSpace: "nowrap" as const }}>{label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {navOpen && <div className="nk-scrim" onClick={() => setNavOpen(false)} />}

        <main style={{ minWidth: 0, padding: "22px 20px 60px" }}>
          <h1 style={{ fontSize: 19, fontWeight: 900, marginBottom: 16, color: C.txt }}>
            {TABS[tab].label}
          </h1>
          {panels[tab]}
        </main>
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
  // Anything needing action, above the counters. Four tiles tell you the
  // platform has three tenants; they do not tell you a pipeline stopped
  // running two days ago, which is the thing worth opening the console for.
  const [attention, setAttention] = useState<any[]>([]);

  useEffect(() => {
    fetch(`${API}/api/admin/operations`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(j => setAttention((j.checks || []).filter((c: any) => c.state !== "ok")))
      .catch(() => setAttention([]));
  }, [token]);

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
      {attention.length > 0 && (
        <Card style={{ borderColor: C.gold + "55", background: C.gold + "0D", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <AlertTriangle size={15} color={C.gold} />
            <span style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800 }}>
              {attention.length} thing{attention.length === 1 ? "" : "s"} need attention
            </span>
          </div>
          {attention.map((c: any) => (
            <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "baseline",
                                     padding: "5px 0", flexWrap: "wrap" as const }}>
              <span style={{ color: c.state === "unknown" ? C.dim : C.gold,
                             fontSize: TYPE.sm, fontWeight: 900, minWidth: 30 }}>
                {c.value === null ? "?" : c.value}
              </span>
              <span style={{ color: C.txt, fontSize: TYPE.xs }}>{c.label}</span>
              <span style={{ color: C.dim, fontSize: TYPE.xs, flex: 1, minWidth: 180 }}>{c.hint}</span>
            </div>
          ))}
        </Card>
      )}

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
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, alignItems: "center" }}>
                      <OnboardingCallButton token={token} tenantId={t.id} />
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

function CrmPanel({ token }: { token: string }) {
  const [leads, setLeads]     = useState<any[]>([]);
  const [stages, setStages]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailLead, setDetailLead] = useState<any>(null);
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const load = async () => {
    const [{ data: leadRows }, { data: stageRows }] = await Promise.all([
      sb.from("leads").select("*, tenants(name)").order("last_contacted_at", { ascending: false }).limit(500),
      sb.from("crm_pipeline_stages").select("*").order("sort_order"),
    ]);
    setLeads(leadRows || []);
    // De-dupe: a tenant-specific stage with the same name overrides the
    // platform default of that name, rather than showing both.
    const byName = new Map<string, any>();
    for (const s of stageRows || []) {
      if (!byName.has(s.name) || s.tenant_id) byName.set(s.name, s);
    }
    setStages([...byName.values()].sort((a, b) => a.sort_order - b.sort_order));
    setLoading(false);
  };
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  const stageColor = (s: string) => stages.find(st => st.name === s)?.color || C.mid;

  const filtered = leads.filter(l => {
    const matchStage  = stageFilter === "all" || l.stage === stageFilter;
    const matchSearch = !search ||
      l.name?.toLowerCase().includes(search.toLowerCase()) ||
      l.phone?.includes(search) ||
      l.tenants?.name?.toLowerCase().includes(search.toLowerCase()) ||
      l.tags?.some((t: string) => t.toLowerCase().includes(search.toLowerCase()));
    return matchStage && matchSearch;
  });

  const counts = stages.map(s => ({ stage: s.name, color: s.color, count: leads.filter(l => l.stage === s.name).length }));

  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const bulkSetStage = async (newStage: string) => {
    const ids = [...selected];
    await sb.from("leads").update({ stage: newStage }).in("id", ids);
    await sb.from("lead_activities").insert(
      ids.map(id => ({ lead_id: id, type: "stage_change", description: `Bulk-moved to "${newStage}"` }))
    );
    setSelected(new Set());
    load();
  };

  const exportCsv = () => {
    const rows = (selected.size > 0 ? filtered.filter(l => selected.has(l.id)) : filtered);
    const header = ["Business","Name","Phone","Interest","Stage","Score","Deal Value","Tags","Calls","Last Contact"];
    const csv = [header, ...rows.map(l => [
      l.tenants?.name || "", l.name || "", l.phone || "", l.interest || "", l.stage || "",
      l.score ?? 0, ((l.deal_value_paise || 0) / 100).toFixed(0), (l.tags || []).join("|"),
      l.call_count ?? 1, l.last_contacted_at || "",
    ])].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `leads-export-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${stages.length || 5},1fr)`, gap: 10, marginBottom: 20 }}>
        {counts.map(({ stage, color, count }) => (
          <Card key={stage} style={{ textAlign: "center" }}>
            <div style={{ color, fontSize: TYPE.xl, fontWeight: 900 }}>{count}</div>
            <div style={{ color: C.dim, fontSize: TYPE.xs, textTransform: "uppercase", marginTop: 2 }}>{stage}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, phone, business, or tag..."
          style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
            borderRadius: 8, padding: "8px 12px", fontSize: TYPE.sm, width: 260 }} />
        <button onClick={() => setStageFilter("all")} style={{
          padding: "7px 12px", borderRadius: 7, fontSize: TYPE.sm, fontWeight: 700,
          background: stageFilter === "all" ? C.glow + "66" : C.hi,
          color: stageFilter === "all" ? C.gbr : C.mid,
          border: "1px solid " + (stageFilter === "all" ? C.glow : C.bord),
        } as any}>all</button>
        {stages.map(s => (
          <button key={s.id} onClick={() => setStageFilter(s.name)} style={{
            padding: "7px 12px", borderRadius: 7, fontSize: TYPE.sm, fontWeight: 700,
            background: stageFilter === s.name ? s.color + "33" : C.hi,
            color: stageFilter === s.name ? s.color : C.mid,
            border: "1px solid " + (stageFilter === s.name ? s.color : C.bord),
          } as any}>{s.name}</button>
        ))}
        <button onClick={exportCsv} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "7px 12px", borderRadius: 7, fontSize: TYPE.sm, fontWeight: 700,
          background: C.hi, color: C.mid, border: "1px solid " + C.bord, cursor: "pointer",
        }}><Download size={13} /> Export {selected.size > 0 ? `(${selected.size})` : "All"}</button>
        <span style={{ color: C.dim, fontSize: TYPE.sm, marginLeft: "auto", alignSelf: "center" }}>
          {filtered.length} leads
        </span>
      </div>

      {selected.size > 0 && (
        <Card style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, padding: "10px 16px" }}>
          <span style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 700 }}>{selected.size} selected</span>
          <span style={{ color: C.dim, fontSize: TYPE.sm }}>Move to:</span>
          {stages.map(s => (
            <button key={s.id} onClick={() => bulkSetStage(s.name)} style={{
              padding: "5px 10px", borderRadius: 6, fontSize: TYPE.xs, fontWeight: 700,
              background: s.color + "22", color: s.color, border: "1px solid " + s.color + "44", cursor: "pointer",
            }}>{s.name}</button>
          ))}
          <button onClick={() => setSelected(new Set())} style={{
            marginLeft: "auto", background: "none", border: "none", color: C.dim, cursor: "pointer",
            display: "flex", alignItems: "center" }}><X size={14} /></button>
        </Card>
      )}

      <Card>
        {loading ? <div style={{ color: C.mid, textAlign: "center", padding: 40 }}>Loading...</div> :
         filtered.length === 0 ? <div style={{ color: C.dim, textAlign: "center", padding: 40 }}>No leads match</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>{["","Business","Name","Phone","Stage","Deal Value","Tags","Score","Last Contact"].map(h => (
                  <th key={h} style={{ color: C.dim, fontSize: TYPE.xs, fontWeight: 700,
                    textTransform: "uppercase", padding: "8px 10px", textAlign: "left",
                    borderBottom: "1px solid " + C.bord, whiteSpace: "nowrap" }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {filtered.map(l => (
                  <tr key={l.id} style={{ borderBottom: "1px solid " + C.bord + "33", cursor: "pointer" }}
                    onClick={() => setDetailLead(l)}>
                    <td style={{ padding: "10px" }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSelect(l.id)} />
                    </td>
                    <td style={{ padding: "10px", color: C.mid, fontSize: TYPE.sm }}>{l.tenants?.name || "—"}</td>
                    <td style={{ padding: "10px", color: C.txt, fontSize: TYPE.sm, fontWeight: 600 }}>{l.name || "Unknown"}</td>
                    <td style={{ padding: "10px", color: C.dim, fontSize: TYPE.sm }}>{l.phone}</td>
                    <td style={{ padding: "10px" }}><Pill label={l.stage} color={stageColor(l.stage)} /></td>
                    <td style={{ padding: "10px", color: C.grn, fontSize: TYPE.sm, fontWeight: 700 }}>
                      {l.deal_value_paise ? `₹${(l.deal_value_paise / 100).toLocaleString()}` : "—"}
                    </td>
                    <td style={{ padding: "10px" }}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {(l.tags || []).slice(0, 2).map((t: string) => (
                          <span key={t} style={{ background: C.hi, color: C.mid, fontSize: TYPE.xs,
                            padding: "2px 6px", borderRadius: 4 }}>{t}</span>
                        ))}
                        {(l.tags || []).length > 2 && <span style={{ color: C.dim, fontSize: TYPE.xs }}>+{l.tags.length - 2}</span>}
                      </div>
                    </td>
                    <td style={{ padding: "10px", color: C.txt, fontSize: TYPE.sm, fontWeight: 700 }}>{l.score ?? 0}</td>
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

      {detailLead && (
        <LeadDetailDrawer lead={detailLead} stages={stages} token={token} apiUrl={API_URL}
          onClose={() => setDetailLead(null)} onChanged={load} />
      )}
    </div>
  );
}

// ── LEAD DETAIL DRAWER ─────────────────────────────────────
// Assignment, deal value, tags, and the activity timeline — the parts
// of "enterprise CRM" that don't fit in a table row.
function LeadDetailDrawer({ lead, stages, token, apiUrl, onClose, onChanged }: {
  lead: any; stages: any[]; token: string; apiUrl: string; onClose: () => void; onChanged: () => void;
}) {
  const [activities, setActivities] = useState<any[]>([]);
  const [staff, setStaff]     = useState<any[]>([]);
  const [note, setNote]       = useState("");
  const [tagInput, setTagInput] = useState("");
  const [dealValue, setDealValue] = useState(String((lead.deal_value_paise || 0) / 100));

  useEffect(() => {
    sb.from("lead_activities").select("*").eq("lead_id", lead.id)
      .order("created_at", { ascending: false }).then(({ data }) => setActivities(data || []));
    fetch(`${apiUrl}/api/admin/tenant-staff/${lead.tenant_id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setStaff).catch(() => setStaff([]));
  }, [lead.id]);

  const logActivity = async (type: string, description: string) => {
    await sb.from("lead_activities").insert({ lead_id: lead.id, type, description });
    sb.from("lead_activities").select("*").eq("lead_id", lead.id)
      .order("created_at", { ascending: false }).then(({ data }) => setActivities(data || []));
  };

  const addNote = async () => {
    if (!note.trim()) return;
    await sb.from("leads").update({ notes: note }).eq("id", lead.id);
    await logActivity("note", note);
    setNote("");
    onChanged();
  };

  const setStage = async (stageName: string) => {
    await sb.from("leads").update({ stage: stageName }).eq("id", lead.id);
    await logActivity("stage_change", `Moved to "${stageName}"`);
    onChanged();
  };

  const setAssignee = async (userId: string) => {
    await sb.from("leads").update({ assigned_to: userId || null }).eq("id", lead.id);
    const person = staff.find(s => s.user_id === userId);
    await logActivity("assignment", userId ? `Assigned to ${person?.email || userId}` : "Unassigned");
    onChanged();
  };

  const saveDealValue = async () => {
    const paise = Math.round(parseFloat(dealValue || "0") * 100);
    await sb.from("leads").update({ deal_value_paise: paise }).eq("id", lead.id);
    await logActivity("value_change", `Deal value set to ₹${dealValue}`);
    onChanged();
  };

  const addTag = async () => {
    if (!tagInput.trim()) return;
    const newTags = [...(lead.tags || []), tagInput.trim()];
    await sb.from("leads").update({ tags: newTags }).eq("id", lead.id);
    await logActivity("tag_change", `Tagged "${tagInput.trim()}"`);
    setTagInput("");
    onChanged();
  };

  const removeTag = async (tag: string) => {
    const newTags = (lead.tags || []).filter((t: string) => t !== tag);
    await sb.from("leads").update({ tags: newTags }).eq("id", lead.id);
    await logActivity("tag_change", `Removed tag "${tag}"`);
    onChanged();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", zIndex: 999,
      display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div style={{ width: 440, maxWidth: "100%", height: "100%", background: C.surf,
        borderLeft: "1px solid " + C.bord, overflowY: "auto", padding: 24 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ color: C.txt, fontSize: TYPE.lg, fontWeight: 900 }}>{lead.name || "Unknown"}</div>
            <div style={{ color: C.dim, fontSize: TYPE.sm }}>{lead.phone} · {lead.tenants?.name}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.dim, cursor: "pointer" }}><X size={18} /></button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ color: C.dim, fontSize: TYPE.xs, textTransform: "uppercase", marginBottom: 6 }}>Stage</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {stages.map(s => (
              <button key={s.id} onClick={() => setStage(s.name)} style={{
                padding: "6px 12px", borderRadius: 6, fontSize: TYPE.xs, fontWeight: 700, cursor: "pointer",
                background: lead.stage === s.name ? s.color + "33" : C.hi,
                color: lead.stage === s.name ? s.color : C.mid,
                border: "1px solid " + (lead.stage === s.name ? s.color : C.bord),
              }}>{s.name}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ color: C.dim, fontSize: TYPE.xs, textTransform: "uppercase", marginBottom: 6,
            display: "flex", alignItems: "center", gap: 4 }}><UserPlus size={12} /> Assigned To</div>
          <select value={lead.assigned_to || ""} onChange={e => setAssignee(e.target.value)} style={{
            width: "100%", background: C.hi, border: "1px solid " + C.bord, color: C.txt,
            borderRadius: 6, padding: "8px 10px", fontSize: TYPE.sm,
          }}>
            <option value="">Unassigned</option>
            {staff.map(s => <option key={s.user_id} value={s.user_id}>{s.email} ({s.role})</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ color: C.dim, fontSize: TYPE.xs, textTransform: "uppercase", marginBottom: 6 }}>Deal Value</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="number" value={dealValue} onChange={e => setDealValue(e.target.value)}
              style={{ flex: 1, background: C.hi, border: "1px solid " + C.bord, color: C.txt,
                borderRadius: 6, padding: "8px 10px", fontSize: TYPE.sm }} />
            <button onClick={saveDealValue} style={{ background: C.glow, color: "#fff", border: "none",
              borderRadius: 6, padding: "8px 14px", fontSize: TYPE.sm, fontWeight: 700, cursor: "pointer" }}>Save</button>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ color: C.dim, fontSize: TYPE.xs, textTransform: "uppercase", marginBottom: 6,
            display: "flex", alignItems: "center", gap: 4 }}><Tag size={12} /> Tags</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {(lead.tags || []).map((t: string) => (
              <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 4,
                background: C.hi, color: C.mid, fontSize: TYPE.xs, padding: "3px 8px", borderRadius: 5 }}>
                {t}
                <X size={10} style={{ cursor: "pointer" }} onClick={() => removeTag(t)} />
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={tagInput} onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addTag()}
              placeholder="Add tag..." style={{ flex: 1, background: C.hi, border: "1px solid " + C.bord,
                color: C.txt, borderRadius: 6, padding: "7px 10px", fontSize: TYPE.sm }} />
            <button onClick={addTag} style={{ background: C.hi, color: C.mid, border: "1px solid " + C.bord,
              borderRadius: 6, padding: "7px 14px", fontSize: TYPE.sm, cursor: "pointer" }}>Add</button>
          </div>
        </div>

        <div>
          <div style={{ color: C.dim, fontSize: TYPE.xs, textTransform: "uppercase", marginBottom: 6,
            display: "flex", alignItems: "center", gap: 4 }}><Clock size={12} /> Activity Timeline</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input value={note} onChange={e => setNote(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addNote()}
              placeholder="Add a note..." style={{ flex: 1, background: C.hi, border: "1px solid " + C.bord,
                color: C.txt, borderRadius: 6, padding: "7px 10px", fontSize: TYPE.sm }} />
            <button onClick={addNote} style={{ background: C.hi, color: C.mid, border: "1px solid " + C.bord,
              borderRadius: 6, padding: "7px 10px", cursor: "pointer", display: "flex", alignItems: "center" }}>
              <MessageSquare size={14} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activities.length === 0 && <div style={{ color: C.dim, fontSize: TYPE.sm }}>No activity yet.</div>}
            {activities.map(a => (
              <div key={a.id} style={{ padding: "8px 10px", background: C.hi, borderRadius: 6 }}>
                <div style={{ color: C.txt, fontSize: TYPE.sm }}>{a.description}</div>
                <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 2 }}>
                  {a.type} · {new Date(a.created_at).toLocaleString("en-IN")}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
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

/**
 * Operations — did the automations actually run?
 *
 * API Health answers "is the process up". This answers the different and
 * harder question of whether the work happened, because every real fault in
 * this platform has been a silent one: the knowledge base unable to embed,
 * appointments confirmed with no date so no reminder could fire, campaigns
 * built and never started, WhatsApp returning 200 while sending nothing.
 * A process can be perfectly healthy and doing none of its job.
 *
 * A check that cannot be evaluated shows UNKNOWN, never OK — reading a
 * broken check as green is how this class of fault survives.
 */
function OperationsPanel({ token }: { token: string }) {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const load = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API_URL}/api/admin/operations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error || `Failed (${res.status})`); }
      else setData(j);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const tone = (state: string) =>
    state === "ok" ? C.grn : state === "attention" ? C.gold : C.dim;

  if (loading) return <div style={{ color: C.dim, fontSize: TYPE.sm }}>Checking…</div>;

  const checks    = data?.checks || [];
  const counters  = data?.counters || {};
  const attention = checks.filter((c: any) => c.state === "attention").length;
  const unknown   = checks.filter((c: any) => c.state === "unknown").length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: SPACE.md }}>
        <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 900 }}>Automation health</div>
        {attention > 0
          ? <Pill label={`${attention} need attention`} color={C.gold} />
          : <Pill label="all clear" color={C.grn} />}
        {unknown > 0 && <Pill label={`${unknown} unknown`} color={C.dim} />}
        <button onClick={load} style={{ marginLeft: "auto", background: "none",
          border: "1px solid " + C.bord, color: C.dim, borderRadius: 7,
          padding: "5px 11px", fontSize: TYPE.xs, cursor: "pointer" }}>Re-check</button>
      </div>

      {error && (
        <Card style={{ borderColor: C.red + "55", marginBottom: SPACE.md }}>
          <div style={{ color: C.red, fontSize: TYPE.sm }}>{error}</div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
                    gap: SPACE.sm, marginBottom: SPACE.md }}>
        {[
          { l: "Calls this week",   v: counters.calls_week },
          { l: "Scored",            v: counters.scored_week },
          { l: "Campaigns running", v: counters.campaigns_running },
          { l: "Appts tomorrow",    v: counters.appts_tomorrow },
          { l: "Agent changes",     v: counters.agent_changes_week },
        ].map(k => (
          <Card key={k.l}>
            <div style={{ color: C.dim, fontSize: TYPE.xs, textTransform: "uppercase",
                          letterSpacing: "0.08em" }}>{k.l}</div>
            <div style={{ color: C.txt, fontSize: 22, fontWeight: 900, marginTop: 4 }}>
              {k.v ?? "—"}
            </div>
          </Card>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: SPACE.sm }}>
        {checks.map((c: any) => (
          <Card key={c.id} hover>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                             background: tone(c.state), marginTop: 6, flexShrink: 0,
                             boxShadow: c.state === "attention" ? "0 0 8px " + C.gold : "none" }} />
              <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 700 }}>{c.label}</div>
                <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 3, lineHeight: 1.5 }}>{c.hint}</div>
              </div>
              <div style={{ color: tone(c.state), fontSize: 20, fontWeight: 900 }}>
                {c.value === null ? "?" : c.value}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {data?.generated_at && (
        <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: SPACE.md }}>
          Checked {new Date(data.generated_at).toLocaleString("en-IN")}
        </div>
      )}
    </div>
  );
}


/**
 * KYC review queue.
 *
 * Businesses upload identity documents to get a phone number, and
 * /api/admin/kyc plus /api/admin/kyc/:id/review have existed with no screen
 * behind them — the only way to approve anyone was to hand-craft an HTTP
 * request. A customer who cannot be approved cannot go live, so this was an
 * onboarding dead end.
 *
 * Document links are short-lived signed URLs generated per request; the
 * bucket is private and stays that way. They are opened in a new tab rather
 * than embedded, so an identity document is never rendered into a page that
 * might be screenshotted or cached.
 */
function KycPanel({ token }: { token: string }) {
  const [docs, setDocs]       = useState<any[]>([]);
  const [status, setStatus]   = useState<"pending" | "approved" | "rejected">("pending");
  const [loading, setLoading] = useState(true);
  const [acting, setActing]   = useState<string | null>(null);
  const [note, setNote]       = useState<Record<string, string>>({});
  const [error, setError]     = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch(`${API}/api/admin/kyc?status=${status}`,
        { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (!r.ok) setError(j.error || `Failed (${r.status})`);
      else setDocs(Array.isArray(j) ? j : (j.documents || []));
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [token, status]);

  useEffect(() => { load(); }, [load]);

  const review = async (id: string, decision: "approved" | "rejected") => {
    // Rejecting without saying why leaves the business with nothing to fix.
    if (decision === "rejected" && !(note[id] || "").trim()) {
      setError("Add a note explaining the rejection — the business sees it.");
      return;
    }
    setActing(id + decision); setError("");
    try {
      const r = await fetch(`${API}/api/admin/kyc/${id}/review`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note[id] || null }),
      });
      if (!r.ok) { const j = await r.json(); setError(j.error || "Review failed"); }
      else await load();
    } catch (e: any) { setError(e.message); }
    setActing(null);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: SPACE.md, alignItems: "center" }}>
        {(["pending", "approved", "rejected"] as const).map(f => (
          <button key={f} onClick={() => setStatus(f)} style={{
            background: status === f ? C.glow + "22" : "none",
            border: "1px solid " + (status === f ? C.glow : C.bord),
            color: status === f ? C.gbr : C.dim, borderRadius: 7,
            padding: "5px 12px", fontSize: TYPE.xs, fontWeight: 700,
            textTransform: "capitalize", cursor: "pointer",
          }}>{f}</button>
        ))}
        <button onClick={load} style={{ marginLeft: "auto", background: "none",
          border: "1px solid " + C.bord, color: C.dim, borderRadius: 7,
          padding: "5px 11px", fontSize: TYPE.xs, cursor: "pointer" }}>Refresh</button>
      </div>

      {error && (
        <Card style={{ borderColor: C.red + "55", marginBottom: SPACE.sm }}>
          <div style={{ color: C.red, fontSize: TYPE.sm }}>{error}</div>
        </Card>
      )}

      {loading ? <div style={{ color: C.dim, fontSize: TYPE.sm }}>Loading…</div>
      : docs.length === 0 ? (
        <Card><div style={{ color: C.dim, fontSize: TYPE.sm, textAlign: "center", padding: SPACE.md }}>
          Nothing {status}.
        </div></Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: SPACE.sm }}>
          {docs.map(d => (
            <Card key={d.id} hover>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ flex: "1 1 280px", minWidth: 0 }}>
                  <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 700 }}>
                    {d.tenant_name || d.tenant_id?.slice(0, 8)} · {d.doc_type}
                  </div>
                  <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 3 }}>
                    {d.file_name} · {d.size_bytes ? Math.round(d.size_bytes / 1024) + " KB" : "—"} ·
                    {" "}{new Date(d.created_at).toLocaleDateString("en-IN")}
                  </div>
                  {d.url && (
                    <a href={d.url} target="_blank" rel="noopener noreferrer"
                       style={{ color: C.gbr, fontSize: TYPE.xs, textDecoration: "underline" }}>
                      Open document ↗
                    </a>
                  )}
                </div>

                {status === "pending" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 220 }}>
                    <input
                      value={note[d.id] || ""}
                      onChange={e => setNote(n => ({ ...n, [d.id]: e.target.value }))}
                      placeholder="Note (required to reject)"
                      style={{ background: C.bg, border: "1px solid " + C.bord, borderRadius: 6,
                               padding: "6px 9px", color: C.txt, fontSize: TYPE.xs }} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => review(d.id, "approved")}
                        disabled={acting === d.id + "approved"}
                        style={{ flex: 1, background: C.grn + "22", color: C.grn,
                                 border: "1px solid " + C.grn + "55", borderRadius: 6,
                                 padding: "6px 10px", fontSize: TYPE.xs, fontWeight: 700, cursor: "pointer" }}>
                        Approve
                      </button>
                      <button onClick={() => review(d.id, "rejected")}
                        disabled={acting === d.id + "rejected"}
                        style={{ flex: 1, background: C.red + "18", color: C.red,
                                 border: "1px solid " + C.red + "44", borderRadius: 6,
                                 padding: "6px 10px", fontSize: TYPE.xs, fontWeight: 700, cursor: "pointer" }}>
                        Reject
                      </button>
                    </div>
                  </div>
                )}
                {status !== "pending" && (
                  <Pill label={d.status} color={d.status === "approved" ? C.grn : C.red} />
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}


/**
 * DID inventory — the numbers themselves.
 *
 * /api/admin/dids and its assign/release actions existed with no screen, so
 * onboarding a customer onto a number meant a hand-crafted request. Assigning
 * a DID is the step that makes a tenant live; it should not be the one thing
 * you cannot do from the console.
 *
 * Release asks for confirmation. It detaches a live phone number from a
 * paying business, and there is no undo beyond assigning it back.
 */
function DidPanel({ token }: { token: string }) {
  const [dids, setDids]       = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing]   = useState<string | null>(null);
  const [pick, setPick]       = useState<Record<string, string>>({});
  const [error, setError]     = useState("");
  const [newNum, setNewNum]   = useState("");
  const [adding, setAdding]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [d, t] = await Promise.all([
        fetch(`${API}/api/admin/dids`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        fetch(`${API}/api/admin/tenants`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      ]);
      setDids(Array.isArray(d) ? d : (d.dids || []));
      setTenants(Array.isArray(t) ? t : []);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const act = async (number: string, action: "assign" | "release", body?: any) => {
    setActing(number + action); setError("");
    try {
      const r = await fetch(`${API}/api/admin/dids/${number}/${action}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setError(j.error || `Failed (${r.status})`); }
      else await load();
    } catch (e: any) { setError(e.message); }
    setActing(null);
  };

  const addDid = async () => {
    setAdding(true); setError("");
    try {
      const r = await fetch(`${API}/api/admin/dids`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ number: newNum }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setError(j.error || `Failed (${r.status})`);
      else { setNewNum(""); await load(); }
    } catch (e: any) { setError(e.message); }
    setAdding(false);
  };

  const free = dids.filter(d => d.status !== "assigned").length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: SPACE.md }}>
        <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 900 }}>Numbers</div>
        <Pill label={`${dids.length} total`} color={C.gbr} />
        <Pill label={`${free} available`} color={free ? C.grn : C.gold} />
        <button onClick={load} style={{ marginLeft: "auto", background: "none",
          border: "1px solid " + C.bord, color: C.dim, borderRadius: 7,
          padding: "5px 11px", fontSize: TYPE.xs, cursor: "pointer" }}>Refresh</button>
      </div>

      {/* Nothing could put a number INTO inventory — assign and release both
          act on rows that had to be created by hand in Supabase first. */}
      <Card>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const }}>
          <div style={{ color: C.mid, fontSize: TYPE.sm, fontWeight: 700 }}>Add a number</div>
          <input
            value={newNum}
            onChange={e => setNewNum(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && newNum.trim()) addDid(); }}
            placeholder="10-digit number from Jio"
            inputMode="numeric"
            style={{
              padding: "7px 10px", borderRadius: 7, fontSize: TYPE.sm, minWidth: 200,
              background: C.hi, color: C.txt, border: `1px solid ${C.bord}`,
            }} />
          <button onClick={addDid} disabled={adding || newNum.replace(/\D/g, "").length < 10}
            style={{
              padding: "7px 14px", borderRadius: 7, border: "none",
              background: adding || newNum.replace(/\D/g, "").length < 10 ? C.bord : C.grn,
              color: adding || newNum.replace(/\D/g, "").length < 10 ? C.dim : "#04120a",
              fontSize: TYPE.sm, fontWeight: 800,
              cursor: adding || newNum.replace(/\D/g, "").length < 10 ? "not-allowed" : "pointer",
            }}>{adding ? "Adding…" : "Add to inventory"}</button>
          <span style={{ color: C.dim, fontSize: TYPE.xs }}>
            Lands as <strong style={{ color: C.grn }}>available</strong>, ready to assign.
          </span>
        </div>
      </Card>

      <div style={{ height: SPACE.sm }} />

      {error && <Card style={{ borderColor: C.red + "55", marginBottom: SPACE.sm }}>
        <div style={{ color: C.red, fontSize: TYPE.sm }}>{error}</div></Card>}

      {loading ? <div style={{ color: C.dim, fontSize: TYPE.sm }}>Loading…</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: SPACE.sm }}>
          {dids.map(d => {
            const assigned = d.status === "assigned";
            return (
              <Card key={d.number} hover>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800, fontFamily: "monospace" }}>
                      {d.number}
                    </div>
                    <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 3 }}>
                      {d.provider || "—"} · routing {d.routing_mode || "ai"}
                      {d.tenant_name ? ` · ${d.tenant_name}` : ""}
                    </div>
                  </div>
                  <Pill label={d.status || "unknown"} color={assigned ? C.grn : C.dim} />
                  {assigned ? (
                    <button
                      onClick={() => {
                        // Detaches a live number from a paying business, and
                        // the only undo is assigning it back.
                        if (window.confirm(`Release ${d.number} from ${d.tenant_name || "its tenant"}? Calls to it stop working immediately.`))
                          act(d.number, "release");
                      }}
                      disabled={acting === d.number + "release"}
                      style={{ background: C.red + "18", color: C.red, border: "1px solid " + C.red + "44",
                               borderRadius: 6, padding: "6px 12px", fontSize: TYPE.xs, fontWeight: 700, cursor: "pointer" }}>
                      Release
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: 6 }}>
                      <select value={pick[d.number] || ""}
                        onChange={e => setPick(p => ({ ...p, [d.number]: e.target.value }))}
                        style={{ background: C.bg, border: "1px solid " + C.bord, borderRadius: 6,
                                 padding: "6px 9px", color: C.txt, fontSize: TYPE.xs }}>
                        <option value="">Assign to…</option>
                        {tenants.map(t => <option key={t.id} value={t.id}>{t.name || t.id.slice(0, 8)}</option>)}
                      </select>
                      <button
                        onClick={() => act(d.number, "assign", { tenant_id: pick[d.number] })}
                        disabled={!pick[d.number] || acting === d.number + "assign"}
                        style={{ background: pick[d.number] ? C.grn + "22" : "none",
                                 color: pick[d.number] ? C.grn : C.dim,
                                 border: "1px solid " + (pick[d.number] ? C.grn + "55" : C.bord),
                                 borderRadius: 6, padding: "6px 12px", fontSize: TYPE.xs,
                                 fontWeight: 700, cursor: pick[d.number] ? "pointer" : "not-allowed" }}>
                        Assign
                      </button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Audit log — who did what.
 *
 * Every privileged action already writes here: suspensions, plan overrides,
 * KYC decisions, DID assignments. Nothing read it back, so the record existed
 * for no one. On a platform where one account can suspend a business or
 * detach its phone number, that record is the only account of what happened.
 */
function AuditPanel({ token }: { token: string }) {
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ]             = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/admin/audit-log`,
        { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      setRows(Array.isArray(j) ? j : []);
    } catch { setRows([]); }
    setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const tone = (a: string) =>
    /suspend|reject|release|delete/i.test(a) ? C.red
    : /approve|assign|unsuspend/i.test(a)    ? C.grn
    : C.gbr;

  const shown = rows.filter(r => !q ||
    JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: SPACE.md }}>
        <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 900 }}>Audit log</div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter…"
          style={{ background: C.bg, border: "1px solid " + C.bord, borderRadius: 7,
                   padding: "6px 10px", color: C.txt, fontSize: TYPE.xs, marginLeft: "auto", width: 200 }} />
        <button onClick={load} style={{ background: "none", border: "1px solid " + C.bord,
          color: C.dim, borderRadius: 7, padding: "5px 11px", fontSize: TYPE.xs, cursor: "pointer" }}>Refresh</button>
      </div>

      {loading ? <div style={{ color: C.dim, fontSize: TYPE.sm }}>Loading…</div>
      : shown.length === 0 ? (
        <Card><div style={{ color: C.dim, fontSize: TYPE.sm, textAlign: "center", padding: SPACE.md }}>
          {rows.length ? "Nothing matches that filter." : "No admin actions recorded yet."}
        </div></Card>
      ) : (
        <Card>
          {shown.map((r, i) => (
            <div key={r.id || i} style={{ display: "flex", gap: 12, alignItems: "flex-start",
              padding: "10px 0", borderBottom: i < shown.length - 1 ? "1px solid " + C.bord + "55" : "none" }}>
              <span style={{ color: tone(r.action), fontSize: TYPE.xs, fontWeight: 800,
                             minWidth: 130, fontFamily: "monospace" }}>{r.action}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: C.mid, fontSize: TYPE.xs, wordBreak: "break-word" }}>
                  {r.details ? JSON.stringify(r.details) : "—"}
                </div>
                {r.target_tenant_id && (
                  <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 2 }}>
                    tenant {String(r.target_tenant_id).slice(0, 8)}…
                  </div>
                )}
              </div>
              <span style={{ color: C.dim, fontSize: TYPE.xs, whiteSpace: "nowrap" }}>
                {r.created_at ? new Date(r.created_at).toLocaleString("en-IN") : ""}
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}


/**
 * Call quality across every tenant.
 *
 * A tenant sees its own scores; nobody could see the platform's. A business
 * whose agent quietly got worse looked exactly like one that never called.
 * Worst tenant first, because that is the order they need help in.
 */
function QualityPanel({ token }: { token: string }) {
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`${API}/api/admin/quality`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setD).catch(() => setD(null)).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={{ color: C.dim, fontSize: TYPE.sm }}>Loading…</div>;
  const p = d?.platform, rows = d?.tenants || [];
  const tone = (n: number) => n >= 70 ? C.grn : n >= 45 ? C.gold : C.red;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
                    gap: SPACE.sm, marginBottom: SPACE.md }}>
        {[
          { l: "Scored calls", v: String(p?.scored ?? 0), c: C.txt },
          { l: "Avg score",    v: String(p?.avg_score ?? 0), c: tone(p?.avg_score ?? 0) },
          { l: "Ended with next step", v: (p?.next_step_pct ?? 0) + "%",
            c: (p?.next_step_pct ?? 0) >= 40 ? C.grn : C.red },
          { l: "Negative callers", v: String(p?.negative ?? 0), c: p?.negative ? C.red : C.grn },
        ].map(k => (
          <Card key={k.l}>
            <div style={{ color: C.dim, fontSize: TYPE.xs, textTransform: "uppercase" as const,
                          letterSpacing: "0.08em" }}>{k.l}</div>
            <div style={{ color: k.c, fontSize: 22, fontWeight: 900, marginTop: 4 }}>{k.v}</div>
          </Card>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card><div style={{ color: C.dim, fontSize: TYPE.sm, textAlign: "center" as const, padding: SPACE.md }}>
          No calls scored yet. Scoring runs every 15 minutes over calls with four or more turns.
        </div></Card>
      ) : (
        <Card>
          {rows.map((t: any, i: number) => (
            <div key={t.tenant_id} style={{ display: "flex", gap: 12, alignItems: "center",
              padding: "10px 0", borderBottom: i < rows.length - 1 ? "1px solid " + C.bord + "55" : "none" }}>
              <span style={{ color: tone(t.avg_score), fontSize: 18, fontWeight: 900, minWidth: 38 }}>
                {t.avg_score}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 700 }}>
                  {t.tenant_name || t.tenant_id.slice(0, 8)}
                </div>
                <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 2 }}>
                  {t.scored} scored · {t.next_step_pct}% next step · {t.negative} negative
                  {t.risk_flags ? ` · ${t.risk_flags} risk flags` : ""}
                </div>
              </div>
              {t.risk_flags > 0 && <Pill label={`${t.risk_flags} risks`} color={C.red} />}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/** Campaigns across tenants — and which are running with nothing left to dial. */
function CampaignsPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`${API}/api/admin/campaigns`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(j => setRows(j.campaigns || []))
      .catch(() => setRows([])).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={{ color: C.dim, fontSize: TYPE.sm }}>Loading…</div>;
  if (!rows.length) return (
    <Card><div style={{ color: C.dim, fontSize: TYPE.sm, textAlign: "center" as const, padding: SPACE.md }}>
      No campaigns yet.
    </div></Card>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: SPACE.sm }}>
      {rows.map(c => (
        <Card key={c.id} hover>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" as const, alignItems: "center" }}>
            <div style={{ flex: "1 1 240px", minWidth: 0 }}>
              <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 700 }}>
                {c.name || "Untitled"} <span style={{ color: C.dim, fontWeight: 400 }}>
                  · {c.tenant_name || c.tenant_id?.slice(0, 8)}</span>
              </div>
              <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 3 }}>
                {c.total} recipients · {c.window_start}–{c.window_end} IST · up to {c.max_concurrent} at once
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, marginTop: 6 }}>
                {Object.entries(c.counts || {}).map(([k, v]) => (
                  <span key={k} style={{ color: C.mid, fontSize: TYPE.xs }}>{k}: <b>{String(v)}</b></span>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
              {/* Consent is what permits dialling at all — a campaign without
                  it should be visible at a glance, not found by clicking in. */}
              {!c.consent_declared && <Pill label="no consent" color={C.red} />}
              {c.idle && <Pill label="running, nothing queued" color={C.gold} />}
              <Pill label={c.status} color={c.status === "running" ? C.grn : C.dim} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/** Agent edits across tenants — what the profile looked like before each change. */
// ── WHATSAPP NUMBERS ─────────────────────────────────────────
// Every tenant currently sends from the platform's own number, which is
// fine for one client and wrong for ten: a customer of another business
// gets messaged by "HeyNikki" from a number they have never seen. This is
// where that stops being invisible.
// Ring a customer so Nikki can interview them. Lives beside the tenant it
// acts on rather than in a screen of its own — the decision to make this call
// is made while looking at a tenant who has not finished setup.
function OnboardingCallButton({ token, tenantId }: { token: string; tenantId: string }) {
  const [state, setState] = useState<"idle" | "calling" | "done" | "failed">("idle");
  const [msg, setMsg]     = useState("");

  const call = async () => {
    setState("calling"); setMsg("");
    try {
      const r = await fetch(`${API}/api/admin/onboarding-call/${tenantId}`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      if (j.ok) { setState("done"); setMsg(`Ringing ${j.calling}`); }
      else { setState("failed"); setMsg(j.reason || j.error || "Could not place the call"); }
    } catch (e: any) { setState("failed"); setMsg(e.message); }
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
      <button onClick={call} disabled={state === "calling"}
        style={{
          padding: "5px 11px", borderRadius: 7, fontSize: TYPE.xs, fontWeight: 700,
          background: "transparent", color: state === "failed" ? C.red : C.txt,
          border: `1px solid ${state === "failed" ? C.red : C.bord}`,
          cursor: state === "calling" ? "wait" : "pointer",
        }}>
        {state === "calling" ? "Dialling…" : "Interview by phone"}
      </button>
      {msg && (
        <span style={{ fontSize: TYPE.xs, color: state === "done" ? C.grn : C.red }}>{msg}</span>
      )}
    </div>
  );
}

// ── VOICE LAB ────────────────────────────────────────────────
// How each tenant's names are pronounced, and the noisy-Telugu test set.
// A receptionist mispronouncing her employer's name is the most
// trust-costly mistake she can make; this is where it gets fixed, per
// tenant, in one field.
function VoiceLabPanel({ token }: { token: string }) {
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [rows, setRows] = useState<Array<{ k: string; v: string }>>([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    fetch(`${API}/api/admin/voice-lab`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setD).catch(() => setD(null)).finally(() => setLoading(false));
  };
  useEffect(load, [token]);

  const openEditor = (p: any) => {
    setEditing(p.id);
    const m = p.pronunciation_map || {};
    setRows(Object.entries(m).map(([k, v]) => ({ k, v: String(v) })));
  };
  const save = async (profileId: string) => {
    setBusy(true);
    const map: Record<string, string> = {};
    rows.forEach(r => { if (r.k.trim() && r.v.trim()) map[r.k.trim()] = r.v.trim(); });
    const r = await fetch(`${API}/api/admin/voice-lab/${profileId}/pronunciations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ pronunciation_map: map }),
    });
    if (!r.ok) alert((await r.json()).error || "Save failed");
    else { setEditing(null); load(); }
    setBusy(false);
  };

  if (loading) return <div style={{ color: C.dim, fontSize: TYPE.sm }}>Loading…</div>;

  return (
    <div>
      <Card>
        <div style={{ color: C.mid, fontSize: TYPE.sm, lineHeight: 1.55 }}>
          Written form → how Nikki should say it, applied just before speech.
          Fixes a mispronounced business name in one entry —
          <span style={{ color: C.txt }}> రామ్య → రామ్యా</span> — without touching the model.
        </div>
      </Card>
      <div style={{ height: SPACE.sm }} />
      <div style={{ display: "grid", gap: SPACE.sm }}>
        {(d?.profiles || []).map((p: any) => (
          <Card key={p.id}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: SPACE.sm, flexWrap: "wrap" as const }}>
              <div>
                <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 800 }}>{p.business_name}</div>
                <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 3 }}>
                  {p.tenant_name || p.tenant_id} · {Object.keys(p.pronunciation_map || {}).length} pronunciation(s)
                </div>
              </div>
              <button onClick={() => editing === p.id ? setEditing(null) : openEditor(p)}
                style={{ padding: "6px 12px", borderRadius: 7, fontSize: TYPE.xs, fontWeight: 700,
                  background: "transparent", color: C.txt, border: `1px solid ${C.bord}`,
                  cursor: "pointer", alignSelf: "flex-start" }}>
                {editing === p.id ? "Close" : "Edit"}
              </button>
            </div>
            {editing === p.id && (
              <div style={{ marginTop: SPACE.sm, paddingTop: SPACE.sm, borderTop: `1px solid ${C.bord}` }}>
                {rows.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 7 }}>
                    <input value={r.k} placeholder="written (రామ్య)"
                      onChange={e => setRows(v => v.map((x, j) => j === i ? { ...x, k: e.target.value } : x))}
                      style={{ flex: 1, padding: "7px 10px", borderRadius: 7, fontSize: TYPE.sm,
                        background: C.hi, color: C.txt, border: `1px solid ${C.bord}` }} />
                    <input value={r.v} placeholder="spoken (రామ్యా)"
                      onChange={e => setRows(v => v.map((x, j) => j === i ? { ...x, v: e.target.value } : x))}
                      style={{ flex: 1, padding: "7px 10px", borderRadius: 7, fontSize: TYPE.sm,
                        background: C.hi, color: C.txt, border: `1px solid ${C.bord}` }} />
                    <button onClick={() => setRows(v => v.filter((_, j) => j !== i))}
                      style={{ padding: "0 11px", borderRadius: 7, background: "transparent",
                        border: `1px solid ${C.bord}`, color: C.dim, cursor: "pointer" }}>×</button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setRows(v => [...v, { k: "", v: "" }])}
                    style={{ padding: "6px 12px", borderRadius: 7, fontSize: TYPE.xs,
                      background: "transparent", color: C.txt, border: `1px solid ${C.bord}`, cursor: "pointer" }}>
                    + Add word
                  </button>
                  <button onClick={() => save(p.id)} disabled={busy}
                    style={{ padding: "6px 14px", borderRadius: 7, fontSize: TYPE.xs, fontWeight: 800,
                      background: C.grn, color: "#04120a", border: "none",
                      cursor: busy ? "wait" : "pointer" }}>
                    {busy ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>

      <div style={{ height: SPACE.md }} />
      <Card>
        <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 800 }}>Telugu entity test set</div>
        <div style={{ color: C.mid, fontSize: TYPE.sm, marginTop: 6, lineHeight: 1.55 }}>
          {d?.samples?.total ?? 0} sample(s), {d?.samples?.annotated ?? 0} annotated.
          Every STT vendor scores 33–47% WER on noisy Telugu — entity accuracy on OUR
          calls is the only ruler that matters, and nobody else has the corpus.
          Add samples from any call&apos;s detail view once real calls exist.
        </div>
      </Card>
    </div>
  );
}

function WhatsAppNumbersPanel({ token }: { token: string }) {
  const [rows, setRows]         = useState<any[]>([]);
  const [fallback, setFallback] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState("");
  const [binding, setBinding]   = useState<string | null>(null);
  const [form, setForm]         = useState({ waba_id: "", phone_number_id: "", display_name: "" });
  const [busy, setBusy]         = useState(false);

  const load = () => {
    setLoading(true);
    fetch(`${API}/api/admin/whatsapp-numbers`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setRows(d.numbers || []); setFallback(d.platform_fallback || null); setErr(d.error || ""); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [token]);

  const bind = async (tenantId: string) => {
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/admin/whatsapp-numbers/${tenantId}/bind`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Bind failed"); return; }
      setBinding(null); setForm({ waba_id: "", phone_number_id: "", display_name: "" }); load();
    } finally { setBusy(false); }
  };

  const tone = (st: string) =>
    st === "active" ? C.grn : st === "failed" ? C.red
      : st === "pending_kyc" ? C.dim : C.gold;

  if (loading) return <div style={{ color: C.dim, fontSize: TYPE.sm }}>Loading…</div>;

  return (
    <div>
      {err && <div style={{ color: C.red, fontSize: TYPE.sm, marginBottom: SPACE.sm }}>{err}</div>}

      <Card>
        <div style={{ color: C.mid, fontSize: TYPE.sm, lineHeight: 1.55 }}>
          Anything not <strong style={{ color: C.grn }}>active</strong> sends from the platform
          number{fallback ? <> (<span style={{ color: C.txt }}>{fallback}</span>)</> : null} — so the
          customer sees HeyNikki, not the business they called.
        </div>
      </Card>

      <div style={{ height: SPACE.sm }} />

      {rows.length === 0 ? (
        <Card>
          <div style={{ color: C.dim, fontSize: TYPE.sm, textAlign: "center" as const, padding: SPACE.md }}>
            No tenant has started WhatsApp provisioning. A row opens automatically when KYC is approved.
          </div>
        </Card>
      ) : (
        <div style={{ display: "grid", gap: SPACE.sm }}>
          {rows.map(r => (
            <Card key={r.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: SPACE.sm, flexWrap: "wrap" as const }}>
                <div>
                  <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 800 }}>
                    {r.tenant_name || r.tenant_id}
                  </div>
                  <div style={{ color: C.mid, fontSize: TYPE.sm, marginTop: 4 }}>
                    {r.phone_number || "no number yet"}{r.display_name ? ` · ${r.display_name}` : ""}
                  </div>
                  {r.phone_number_id && (
                    <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 4 }}>
                      phone_number_id {r.phone_number_id}
                    </div>
                  )}
                  {r.review_note && (
                    <div style={{ color: C.red, fontSize: TYPE.xs, marginTop: 4 }}>{r.review_note}</div>
                  )}
                </div>
                <div style={{ textAlign: "right" as const }}>
                  <span style={{
                    display: "inline-block", padding: "3px 10px", borderRadius: 999,
                    fontSize: TYPE.xs, fontWeight: 800,
                    background: tone(r.status) + "22", color: tone(r.status),
                  }}>{String(r.status).replace(/_/g, " ")}</span>
                  {r.status !== "active" && (
                    <div>
                      <button onClick={() => setBinding(binding === r.tenant_id ? null : r.tenant_id)}
                        style={{
                          marginTop: 8, padding: "6px 12px", borderRadius: 7, cursor: "pointer",
                          background: "transparent", color: C.txt,
                          border: `1px solid ${C.bord}`, fontSize: TYPE.sm,
                        }}>
                        {binding === r.tenant_id ? "Cancel" : "Bind number"}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {binding === r.tenant_id && (
                <div style={{ marginTop: SPACE.sm, paddingTop: SPACE.sm, borderTop: `1px solid ${C.bord}` }}>
                  <div style={{ color: C.dim, fontSize: TYPE.xs, marginBottom: 8 }}>
                    From Embedded Signup. Both are checked against Meta before saving — a typo here
                    would send this tenant&apos;s messages as somebody else&apos;s number.
                  </div>
                  <div style={{ display: "grid", gap: 8,
                                gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
                    {([["waba_id", "WABA ID"], ["phone_number_id", "Phone number ID"],
                       ["display_name", "Display name (optional)"]] as const).map(([k, label]) => (
                      <input key={k} placeholder={label} value={(form as any)[k]}
                        onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                        style={{
                          padding: "8px 10px", borderRadius: 7, fontSize: TYPE.sm,
                          background: C.hi, color: C.txt, border: `1px solid ${C.bord}`,
                        }} />
                    ))}
                  </div>
                  <button disabled={busy || !form.waba_id || !form.phone_number_id}
                    onClick={() => bind(r.tenant_id)}
                    style={{
                      marginTop: 10, padding: "8px 16px", borderRadius: 7,
                      background: busy ? C.dim : C.grn, color: "#04120a", border: "none",
                      fontSize: TYPE.sm, fontWeight: 800,
                      cursor: busy || !form.waba_id || !form.phone_number_id ? "not-allowed" : "pointer",
                    }}>
                    {busy ? "Verifying with Meta…" : "Verify and activate"}
                  </button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentVersionsPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`${API}/api/admin/agent-versions`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(j => setRows(j.versions || []))
      .catch(() => setRows([])).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={{ color: C.dim, fontSize: TYPE.sm }}>Loading…</div>;
  if (!rows.length) return (
    <Card><div style={{ color: C.dim, fontSize: TYPE.sm, textAlign: "center" as const, padding: SPACE.md }}>
      No agent changes recorded yet. History starts from when migration 022 was applied.
    </div></Card>
  );

  return (
    <Card>
      {rows.map((v, i) => (
        <div key={v.id} style={{ padding: "10px 0",
          borderBottom: i < rows.length - 1 ? "1px solid " + C.bord + "55" : "none" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" as const }}>
            <span style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 700 }}>
              {v.tenant_name || v.tenant_id?.slice(0, 8)}
            </span>
            <span style={{ color: C.dim, fontSize: TYPE.xs, marginLeft: "auto" }}>
              {new Date(v.created_at).toLocaleString("en-IN")}
            </span>
          </div>
          <div style={{ color: C.mid, fontSize: TYPE.xs, marginTop: 4, wordBreak: "break-word" as const }}>
            was: {Object.entries(v.previous || {}).map(([k, val]) =>
              `${k}=${Array.isArray(val) ? val.join("/") : String(val)}`).join(" · ") || "—"}
          </div>
        </div>
      ))}
    </Card>
  );
}

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
    // FIXED: was only setting tenant_id, but voice-pipeline's real
    // call-routing lookup needs voice_profile_id too (a tenant can have
    // more than one voice_profiles row — no unique constraint on
    // tenant_id). Resolves the tenant's voice profile (most recently
    // created, if they have several) and sets both fields, so an
    // assignment here actually routes real calls correctly.
    const { data: profiles } = await sb.from("voice_profiles")
      .select("id").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1);
    const voiceProfileId = profiles?.[0]?.id || null;
    if (!voiceProfileId) {
      alert("This tenant hasn't completed voice profile setup yet — the number will be marked assigned, but real calls won't route until they finish setup.");
    }
    await sb.from("dids").update({
      tenant_id: tenantId,
      voice_profile_id: voiceProfileId,
      status: "assigned",
      assigned_at: new Date().toISOString(),
    }).eq("id", didId);
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
