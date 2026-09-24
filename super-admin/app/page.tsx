// super-admin/app/page.tsx
// Deploy to: admin.heynikki.in (separate Vercel project)
// Access: super_admin role only
"use client";
import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer } from "recharts";
import { NIKKI } from "../lib/brand";
import VoiceAssistant from "../components/VoiceAssistant";
import NikkiLogo from "../components/NikkiLogo";
import {
  LayoutDashboard, Building2, Phone, IndianRupee, Plug, Megaphone,
  Settings, SignalHigh, CreditCard, Lock, BarChart3, TrendingUp,
  Check, AlertTriangle, RefreshCw, Bot, User, Users,
  X, Tag, Clock, Download, UserPlus, MessageSquare, Activity, ShieldCheck, Gauge, MessageCircle, Menu, Mic,
  HeartPulse, Beaker, Mail, Send, Eye, Ban, Timer,
  Headphones, Siren, CircleCheck, Radio, Hourglass, Search, LogOut, ChevronRight, CornerDownLeft } from "lucide-react";

// ── ENV ──────────────────────────────────────────────────
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// ── DESIGN ───────────────────────────────────────────────
// The control room. Brand navy marks what is selected and what acts;
// terracotta is kept for what is live or wrong; status colours are toned
// down so a screen full of them still reads calmly. Every panel draws from
// these, so changing a value here re-colours all 24 screens.
const C = {
  bg: "#F2F4F7", surf: "#FFFFFF", hi: "#F6F8FA", bord: "#E2E7EE",
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: "#C9820A",
  grn: "#0F9D6E", red: "#D9432F", cyn: "#0E8FB0", org: NIKKI.terracotta,
  txt: "#0B1524", mid: "#4B5A6B", dim: "#8593A3",
};
// The sidebar: deep ink, so the working area is the brightest thing on screen.
const RAIL = { bg: "#0A1929", hi: "#13283F", line: "#1C3148", txt: "#C3CFDC", dim: "#7F92A8", lamp: "#3FA7F5" };
// Type roles (fonts loaded in layout.tsx): interface, titles/figures, data.
const F = {
  ui:   "var(--f-ui), system-ui, -apple-system, 'Segoe UI', sans-serif",
  cond: "var(--f-cond), var(--f-ui), system-ui, sans-serif",
  mono: "var(--f-mono), ui-monospace, 'SF Mono', Menlo, monospace",
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
        background: C.surf,
        border: "1px solid " + (hovered ? "#CBD4DF" : C.bord),
        borderRadius: 10,
        padding: 18,
        boxShadow: hovered
          ? "0 2px 10px rgba(11,21,36,0.07)"
          : "0 1px 2px rgba(11,21,36,0.04)",
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
// Loading, empty and error looked different in every panel: "Loading..." in
// four sizes, empty states from a bare line to a 48px block, and errors that
// mostly vanished into a console. Three components, used by all of them.
function Loading({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" style={{ padding: "4px 0" }}>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{label}…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="nk-skel"
          style={{ height: 14, marginBottom: 10, width: `${100 - (i % 3) * 14}%` }} />
      ))}
    </div>
  );
}

function Empty({ icon: Icon, title, hint }: {
  icon: React.ComponentType<{ size?: number; color?: string }>; title: string; hint?: string;
}) {
  return (
    <div style={{ textAlign: "center" as const, padding: "36px 16px" }}>
      <Icon size={26} color={C.dim} />
      <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 800, marginTop: 10 }}>{title}</div>
      {hint && <div style={{ color: C.dim, fontSize: TYPE.sm, marginTop: 4, maxWidth: 420, marginInline: "auto" }}>{hint}</div>}
    </div>
  );
}

function ErrorNote({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" as const,
      background: C.red + "12", border: "1px solid " + C.red + "44", borderRadius: 8,
      padding: "10px 14px", color: C.red, fontSize: TYPE.sm, marginBottom: 12 }}>
      <AlertTriangle size={14} /><span style={{ flex: 1, minWidth: 180 }}>{msg}</span>
      {onRetry && <button onClick={onRetry} style={{ background: "none", border: "1px solid " + C.red + "66",
        color: C.red, borderRadius: 6, padding: "4px 10px", fontSize: TYPE.xs, fontWeight: 700, cursor: "pointer" }}>
        Try again</button>}
    </div>
  );
}

/** The line under the page's own h1: what this screen is for. The three
 *  panels that printed their own title repeated the heading above them. */
function PanelIntro({ icon: Icon, children }: {
  icon: React.ComponentType<{ size?: number; color?: string }>; children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, color: C.mid,
      fontSize: 13.5, marginBottom: 20, maxWidth: 760, lineHeight: 1.6 }}>
      <Icon size={15} color={C.dim} />
      <span>{children}</span>
    </div>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: color + "14", color,
    borderRadius: 999, padding: "2px 9px 2px 7px", fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap" as const,
    lineHeight: 1.5 }}>
    <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flex: "none" }} />{label}</span>;
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
    // The figure is ink, not the status colour: a wall of coloured numbers
    // reads as alarm. Colour is the thin edge on the left, and the icon.
    <Card hover style={{ position: "relative", overflow: "hidden", padding: "16px 18px 14px" }}>
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ color: C.mid, fontSize: 12.5, fontWeight: 600 }}>{label}</span>
        <IconComp size={15} color={color} />
      </div>
      <div style={{ color: C.txt, fontFamily: F.cond, fontSize: 34, fontWeight: 600, lineHeight: 1.1,
        marginTop: 8, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>
        {typeof value === "number" ? value.toLocaleString("en-IN") : value}
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
  { title: "Customers", labels: ["Tenants", "Demo Tenants", "KYC Review", "Billing", "Usage & Limits", "CRM", "Revenue"] },
  { title: "Telephony", labels: ["Live Calls", "Telecallers", "Numbers", "WhatsApp", "FreeSWITCH"] },
  { title: "Quality",   labels: ["Call Quality", "Agent Versions", "Voice Lab"] },
  { title: "Outreach",  labels: ["Campaigns", "Broadcast"] },
  // Platform Health leads the group because it is the screen an operator
  // opens first: it is the only one that answers "is anything stuck, and
  // since when" without knowing which subsystem to suspect.
  { title: "Platform",  labels: ["Platform Health", "Operations", "API Health", "Platform Config",
                                 "Pricing Engine", "Audit Log"] },
];

const TABS = [
  { label: "Dashboard",       icon: LayoutDashboard },
  { label: "Tenants",         icon: Building2 },
  { label: "Live Calls",      icon: Phone },
  { label: "CRM",             icon: Users },
  { label: "Revenue",         icon: IndianRupee },
  { label: "Billing",         icon: CreditCard },
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
  // Appended, never inserted: `panels` below is indexed by position in this
  // array, so putting a new tab in the middle silently renders the wrong
  // screen for every tab after it. NAV_GROUPS decides the visible order.
  { label: "Demo Tenants",    icon: Beaker },
  { label: "Platform Health", icon: HeartPulse },
  { label: "Telecallers",     icon: Headphones },
  { label: "Usage & Limits",  icon: Hourglass },
];


export default function SuperAdminPage() {
  const [tab, setTab]           = useState(0);
  const [navOpen, setNavOpen]   = useState(false);
  const [authed, setAuthed]     = useState(false);
  const [checking, setChecking] = useState(true);
  const [token, setToken]       = useState("");
  // Most panels answer a failed load with an empty list, which reads exactly
  // like "nothing to show". An operator seeing "0 tenants" during an API
  // outage is being misled, and rewriting every panel's error handling is a
  // bigger change than the problem needs: one poll of the API's own health
  // says it once, for all of them.
  const [apiDown, setApiDown]   = useState(false);
  // Ctrl/Cmd+K, or "/" outside a text field, opens "Jump to…".
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName || "")
        || (e.target as HTMLElement)?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(o => !o); }
      else if (e.key === "/" && !typing) { e.preventDefault(); setPaletteOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const r = await fetch(`${API}/health`, { cache: "no-store" });
        if (alive) setApiDown(!r.ok);
      } catch { if (alive) setApiDown(true); }
    };
    ping();
    const t = setInterval(ping, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

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

  if (checking) return (
    <div style={{ background: RAIL.bg, minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", gap: 12, color: RAIL.txt, fontFamily: F.ui, fontSize: 14 }}>
      <NikkiLogo size={28} variant="icon" dark /> Opening the control room…
    </div>
  );

  if (!authed) return <AdminLogin onSuccess={(t) => { setToken(t); setAuthed(true); }} />;

  const panels = [
    <PlatformDashboard key="dash" token={token} />,
    <TenantsPanel      key="ten"  token={token} />,
    <LiveCallsPanel    key="live" token={token} />,
    <CrmPanel          key="crm"  token={token} />,
    <RevenuePanel      key="rev"  token={token} />,
    <BillingPanel      key="bill" token={token} />,
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
    <DemoTenantsPanel    key="demo"  token={token} />,
    <PlatformHealthPanel key="hlth"  token={token} />,
    <TelecallersPanel    key="tele"  token={token} />,
    <UsagePanel          key="use"   token={token} />,
  ];


  const groupOf = (label: string) => NAV_GROUPS.find(g => g.labels.includes(label))?.title || "";
  const go = (i: number) => { setTab(i); setNavOpen(false); window.scrollTo({ top: 0 }); };

  return (
    <div className="cr-app">
      <style>{CR_CSS}</style>

      <Rail token={token} tab={tab} onGo={go} open={navOpen} />
      {navOpen && <div className="cr-scrim" onClick={() => setNavOpen(false)} />}

      <div className="cr-main">
        <header className="cr-top">
          <button className="cr-burger" onClick={() => setNavOpen(o => !o)} aria-label="Menu" aria-expanded={navOpen}>
            <Menu size={17} />
          </button>
          <nav className="cr-crumbs" aria-label="Breadcrumb">
            <span>{groupOf(TABS[tab].label)}</span>
            <ChevronRight size={13} />
            <span className="cr-crumb-here">{TABS[tab].label}</span>
          </nav>
          <div style={{ flex: 1 }} />
          <button className="cr-jump" onClick={() => setPaletteOpen(true)} aria-label="Jump to a screen">
            <Search size={14} /><span className="cr-hide-sm">Jump to…</span><kbd className="cr-hide-sm">Ctrl K</kbd>
          </button>
          <LineStatus token={token} apiDown={apiDown}
            onOpen={() => go(TABS.findIndex(t => t.label === "Platform Health"))} />
        </header>

        {apiDown && (
          <div role="alert" className="cr-banner">
            <AlertTriangle size={14} />
            <span>Can&apos;t reach the API. Screens below may be empty or out of date — that is this banner, not your data.</span>
          </div>
        )}

        <main className="cr-page">
          <div className="cr-eyebrow">{groupOf(TABS[tab].label)}</div>
          <h1 className="cr-h1">{TABS[tab].label}</h1>
          {panels[tab]}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onGo={go} />

      {/* Inside the auth gate, on purpose. Mounted in layout.tsx it rendered
          on the login screen — an unauthenticated page — where it had no
          session to ask with and nothing to ask about. */}
      <VoiceAssistant />
    </div>
  );
}

// ── CONTROL ROOM SHELL ────────────────────────────────────
// One stylesheet for the frame, tables and form controls. Panels keep their
// inline styles; what they share (fonts, tables, focus, the grid helpers)
// lives here so all 24 screens change together.
const CR_CSS = `
  *{box-sizing:border-box;margin:0;padding:0} a{color:inherit}
  html,body{background:${C.bg}}
  body{font-family:${F.ui};color:${C.txt};-webkit-font-smoothing:antialiased;font-size:14px}
  button,input,select,textarea{font-family:inherit}
  input,select,textarea{color:${C.txt}}
  .cr-mono,code,kbd{font-family:${F.mono}}
  .cr-app{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:100vh}

  /* Sidebar */
  .cr-rail{position:sticky;top:0;height:100vh;background:${RAIL.bg};color:${RAIL.txt};
           display:flex;flex-direction:column;border-right:1px solid ${RAIL.line}}
  .cr-brand{display:flex;align-items:center;gap:10px;padding:18px 18px 16px;border-bottom:1px solid ${RAIL.line}}
  .cr-brand-t{font-family:${F.cond};font-weight:600;font-size:17px;color:#fff;letter-spacing:.01em;line-height:1.1}
  .cr-brand-s{font-size:11px;color:${RAIL.dim};letter-spacing:.08em;text-transform:uppercase;margin-top:2px}
  .cr-nav{flex:1;overflow-y:auto;padding:14px 10px 20px;scrollbar-width:thin;scrollbar-color:${RAIL.line} transparent}
  .cr-group{font-size:10.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:${RAIL.dim};
            padding:18px 10px 6px}
  .cr-nav > div:first-child .cr-group{padding-top:2px}
  .cr-item{display:flex;align-items:center;gap:10px;width:100%;padding:7px 10px;margin:1px 0;border:0;border-radius:7px;
           background:transparent;color:${RAIL.txt};font-size:13.5px;font-weight:500;cursor:pointer;text-align:left;
           position:relative}
  .cr-item svg{opacity:.7;flex:none}
  .cr-item:hover{background:${RAIL.hi};color:#fff}
  .cr-item[aria-current=page]{background:${RAIL.hi};color:#fff;font-weight:600}
  .cr-item[aria-current=page]::before{content:"";position:absolute;left:-10px;top:7px;bottom:7px;width:3px;
           border-radius:0 3px 3px 0;background:${RAIL.lamp}}
  .cr-item[aria-current=page] svg{opacity:1;color:${RAIL.lamp}}
  .cr-badge{margin-left:auto;min-width:20px;height:18px;padding:0 6px;border-radius:9px;font-size:11px;font-weight:600;
            display:inline-flex;align-items:center;justify-content:center;font-family:${F.mono}}
  .cr-foot{border-top:1px solid ${RAIL.line};padding:12px 14px;display:flex;align-items:center;gap:10px;font-size:12px}
  .cr-env{display:inline-flex;align-items:center;gap:6px;color:${RAIL.txt}}
  .cr-env i{width:7px;height:7px;border-radius:50%;background:#22C55E;box-shadow:0 0 0 3px #22C55E22}
  .cr-signout{margin-left:auto;display:inline-flex;align-items:center;gap:6px;background:transparent;border:1px solid ${RAIL.line};
              color:${RAIL.txt};border-radius:7px;padding:5px 9px;font-size:12px;cursor:pointer}
  .cr-signout:hover{background:${RAIL.hi};color:#fff}
  .cr-item:focus-visible,.cr-signout:focus-visible{outline:2px solid ${RAIL.lamp};outline-offset:-2px}

  /* Top bar */
  .cr-main{min-width:0;display:flex;flex-direction:column}
  .cr-top{position:sticky;top:0;z-index:40;height:56px;display:flex;align-items:center;gap:12px;padding:0 24px;
          background:rgba(242,244,247,.86);backdrop-filter:saturate(1.4) blur(8px);border-bottom:1px solid ${C.bord}}
  .cr-burger{display:none;background:${C.surf};border:1px solid ${C.bord};color:${C.mid};border-radius:7px;padding:6px 8px;
             cursor:pointer;line-height:0}
  .cr-crumbs{display:flex;align-items:center;gap:6px;color:${C.dim};font-size:13px;white-space:nowrap;min-width:0}
  .cr-crumb-here{color:${C.txt};font-weight:600}
  .cr-jump{display:inline-flex;align-items:center;gap:8px;background:${C.surf};border:1px solid ${C.bord};color:${C.mid};
           border-radius:8px;padding:6px 8px 6px 10px;font-size:13px;cursor:pointer;min-width:0}
  .cr-jump:hover{border-color:#CBD4DF;color:${C.txt}}
  .cr-jump kbd{font-size:10.5px;color:${C.dim};border:1px solid ${C.bord};border-bottom-width:2px;border-radius:4px;padding:0 5px;
               background:${C.hi}}
  .cr-banner{display:flex;align-items:center;gap:8px;background:${C.red}12;border-bottom:1px solid ${C.red}44;color:${C.red};
             font-size:13px;padding:8px 24px;position:sticky;top:56px;z-index:39}

  /* The line lamps: one per trunk channel. */
  .cr-lines{display:inline-flex;align-items:center;gap:10px;background:${C.surf};border:1px solid ${C.bord};border-radius:8px;
            padding:6px 10px;cursor:pointer;color:${C.mid};font-size:12.5px}
  .cr-lines:hover{border-color:#CBD4DF}
  .cr-lamps{display:inline-flex;gap:3px}
  .cr-lamp{width:7px;height:16px;border-radius:2px;background:#E7ECF2;border:1px solid #D5DDE7}
  .cr-lamp.use{background:${RAIL.lamp};border-color:#2A8EDA;box-shadow:0 0 6px ${RAIL.lamp}88}
  .cr-lamp.res{background:${C.gold}AA;border-color:${C.gold}}
  .cr-lamp.inb{background:repeating-linear-gradient(-45deg,#D5DDE7 0 2px,transparent 2px 4px);border-color:#D5DDE7}
  .cr-lamp.hot.use{background:${C.org};border-color:#C9412D;box-shadow:0 0 6px ${C.org}88}
  .cr-lines b{font-family:${F.mono};font-weight:500;color:${C.txt};font-size:12.5px}
  .cr-api{width:8px;height:8px;border-radius:50%;flex:none}

  /* Page */
  .cr-page{padding:26px 28px 72px;max-width:1440px;width:100%}
  .cr-eyebrow{font-size:11.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:${C.dim};margin-bottom:4px}
  .cr-h1{font-family:${F.cond};font-size:30px;font-weight:600;letter-spacing:-.01em;color:${C.txt};line-height:1.15;margin-bottom:18px}

  /* Command palette */
  .cr-pal-back{position:fixed;inset:0;z-index:90;background:rgba(10,25,41,.42);display:flex;align-items:flex-start;
               justify-content:center;padding:12vh 16px 16px}
  .cr-pal{width:560px;max-width:100%;background:${C.surf};border:1px solid ${C.bord};border-radius:12px;
          box-shadow:0 24px 60px rgba(10,25,41,.28);overflow:hidden}
  .cr-pal input{width:100%;border:0;border-bottom:1px solid ${C.bord};padding:15px 16px 15px 44px;font-size:15px;outline:none;
                background:transparent}
  .cr-pal input:focus-visible{outline:none}
  .cr-pal-list{max-height:52vh;overflow-y:auto;padding:6px}
  .cr-pal-g{font-size:10.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:${C.dim};padding:10px 10px 4px}
  .cr-pal-i{display:flex;align-items:center;gap:10px;width:100%;border:0;background:transparent;border-radius:7px;
            padding:8px 10px;font-size:14px;color:${C.txt};cursor:pointer;text-align:left}
  .cr-pal-i svg{color:${C.dim}}
  .cr-pal-i.on{background:${C.glow}10;color:${C.glow}}
  .cr-pal-i.on svg{color:${C.glow}}

  /* Shared by panels */
  .nk-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
  .nk-2col{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
  .nk-cc{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:16px}
  .nk-3col{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
  .nk-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .nk-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13.5px}
  .nk-table th{color:${C.mid};font-size:11.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;text-align:left;
               padding:9px 12px;background:${C.hi};border-bottom:1px solid ${C.bord};white-space:nowrap}
  .nk-table td{padding:11px 12px;border-bottom:1px solid ${C.bord}AA;vertical-align:middle;white-space:nowrap}
  .nk-table tr:hover td{background:#F9FAFC}
  .nk-table thead th{position:sticky;top:0;z-index:1}
  .nk-table tbody tr:last-child td{border-bottom:none}
  .nk-num{text-align:right;font-variant-numeric:tabular-nums}
  button:focus-visible,select:focus-visible,input:focus-visible,a:focus-visible,textarea:focus-visible{
    outline:2px solid ${C.glow};outline-offset:2px;border-radius:6px}
  .nk-skel{background:linear-gradient(90deg,${C.hi} 25%,${C.bord}88 37%,${C.hi} 63%);background-size:400% 100%;
           animation:nk-shimmer 1.4s ease infinite;border-radius:6px}
  @keyframes nk-shimmer{0%{background-position:100% 50%}100%{background-position:0 50%}}
  @keyframes nk-pulse{0%,100%{opacity:1}50%{opacity:.45}}
  .cr-hide-sm{}
  @media (max-width:1100px){ .nk-kpis{grid-template-columns:repeat(2,minmax(0,1fr))} }
  @media (max-width:900px){
    .cr-app{grid-template-columns:minmax(0,1fr)}
    .cr-rail{position:fixed;left:0;top:0;bottom:0;width:264px;z-index:80;transform:translateX(-100%);transition:transform .18s ease}
    .cr-rail.open{transform:none}
    .cr-scrim{position:fixed;inset:0;z-index:70;background:rgba(10,25,41,.45)}
    .cr-burger{display:inline-flex}
    .cr-top{padding:0 14px}
    .cr-page{padding:20px 16px 64px}
    .nk-2col,.nk-cc{grid-template-columns:minmax(0,1fr)}
  }
  @media (max-width:760px){ .nk-3col{grid-template-columns:minmax(0,1fr)} }
  @media (max-width:600px){ .cr-hide-sm{display:none} .cr-crumbs span:first-child,.cr-crumbs svg{display:none}
    .nk-kpis{grid-template-columns:minmax(0,1fr)} .cr-h1{font-size:25px} }
  @media (prefers-reduced-motion: reduce){ .nk-skel{animation:none} .nk-pulse{animation:none!important}
    .cr-rail{transition:none} }
`;

/** Sidebar: grouped screens, live counts where there is something waiting. */
function Rail({ token, tab, onGo, open }: { token: string; tab: number; onGo: (i: number) => void; open: boolean }) {
  // Two numbers worth a glance from any screen: unread WhatsApp and calls
  // live right now. Polled quietly; a failure just hides the badge.
  const [counts, setCounts] = useState<{ wa: number; live: number }>({ wa: 0, live: 0 });
  useEffect(() => {
    let alive = true;
    const H = { Authorization: `Bearer ${token}` };
    const load = async () => {
      const [wa, cc] = await Promise.all([
        fetch(`${API}/api/admin/whatsapp/inbox`, { headers: H }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API}/api/admin/ops/command-center`, { headers: H }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (!alive) return;
      setCounts({
        wa: (wa?.conversations || []).reduce((n: number, c: any) => n + (c.unread || 0), 0),
        live: Number(cc?.trunk?.in_use || 0),
      });
    };
    load(); const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [token]);
  const badge = (label: string) =>
    label === "WhatsApp" && counts.wa > 0 ? <span className="cr-badge" style={{ background: "#22C55E", color: "#04210F" }}>{counts.wa}</span>
    : label === "Live Calls" && counts.live > 0 ? <span className="cr-badge" style={{ background: C.org, color: "#fff" }}>{counts.live}</span>
    : null;

  return (
    <aside className={"cr-rail" + (open ? " open" : "")} aria-label="Sections">
      <div className="cr-brand">
        <NikkiLogo size={30} variant="icon" dark />
        <div>
          <div className="cr-brand-t">HeyNikki</div>
          <div className="cr-brand-s">Control room</div>
        </div>
      </div>
      <nav className="cr-nav">
        {NAV_GROUPS.map(g => (
          <div key={g.title}>
            <div className="cr-group">{g.title}</div>
            {g.labels.map(label => {
              const i = TABS.findIndex(t => t.label === label);
              if (i < 0) return null;           // a renamed tab loses its icon, not the console
              const Icon = TABS[i].icon;
              return (
                <button key={label} className="cr-item" onClick={() => onGo(i)}
                  aria-current={tab === i ? "page" : undefined}>
                  <Icon size={15} /><span>{label}</span>{badge(label)}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="cr-foot">
        <span className="cr-env" title="admin.heynikki.in"><i />Production</span>
        <button className="cr-signout" onClick={() => sb.auth.signOut().then(() => window.location.reload())}>
          <LogOut size={13} />Sign out
        </button>
      </div>
    </aside>
  );
}

/**
 * The line lamps: one per trunk channel, on every screen. Lit for a call in
 * progress, amber for a line held for a call being set up, hatched for the
 * lines kept back for inbound. Terracotta once outbound has reached its
 * ceiling. Opens Platform Health.
 */
function LineStatus({ token, apiDown, onOpen }: { token: string; apiDown: boolean; onOpen: () => void }) {
  const { data } = useAdminJson<any>(token, "/api/admin/ops/command-center", 15000);
  const t = data?.trunk;
  const alerts = (data?.alerts || []).length;
  if (!t) {
    return (
      <button className="cr-lines" onClick={onOpen} title={apiDown ? "API unreachable" : "Loading line status"}>
        <span className="cr-api" style={{ background: apiDown ? C.red : C.dim }} />
        <span className="cr-hide-sm">{apiDown ? "API down" : "Lines…"}</span>
      </button>
    );
  }
  const channels = Math.max(1, Math.min(Number(t.channels) || 10, 30));
  const inUse = Math.min(Number(t.in_use) || 0, channels);
  const res = Math.min(Number(t.reserved) || 0, channels - inUse);
  const ceiling = Math.min(Number(t.ceiling) || channels, channels);
  const hot = inUse + res >= ceiling;
  const lamps = Array.from({ length: channels }, (_, i) =>
    i < inUse ? "use" : i < inUse + res ? "res" : i >= ceiling ? "inb" : "free");
  return (
    <button className="cr-lines" onClick={onOpen}
      title={`${inUse} of ${channels} lines in use${res ? `, ${res} being set up` : ""}; ${channels - ceiling} kept for inbound${alerts ? ` · ${alerts} alert(s)` : ""}`}
      aria-label={`${inUse} of ${channels} phone lines in use`}>
      <span className="cr-lamps" aria-hidden>
        {lamps.map((k, i) => <span key={i} className={`cr-lamp ${k}${hot ? " hot" : ""}`} />)}
      </span>
      <span className="cr-hide-sm"><b>{inUse}</b>/{channels} lines</span>
      <span className="cr-api" title={apiDown ? "API unreachable" : alerts ? `${alerts} alert(s)` : "API healthy"}
        style={{ background: apiDown ? C.red : alerts ? C.gold : "#22C55E" }} />
    </button>
  );
}

/** Ctrl/Cmd+K or "/": jump to any of the screens by name. */
function CommandPalette({ open, onClose, onGo }: { open: boolean; onClose: () => void; onGo: (i: number) => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  useEffect(() => { if (open) { setQ(""); setSel(0); } }, [open]);
  const items = NAV_GROUPS.flatMap(g => g.labels.map(label => ({ group: g.title, label, i: TABS.findIndex(t => t.label === label) })))
    .filter(x => x.i >= 0 && (x.label + " " + x.group).toLowerCase().includes(q.trim().toLowerCase()));
  if (!open) return null;
  const pick = (k: number) => { const it = items[k]; if (it) { onGo(it.i); onClose(); } };
  return (
    <div className="cr-pal-back" onMouseDown={onClose}>
      <div className="cr-pal" role="dialog" aria-modal aria-label="Jump to a screen" onMouseDown={e => e.stopPropagation()}>
        <div style={{ position: "relative" }}>
          <Search size={16} color={C.dim} style={{ position: "absolute", left: 16, top: 17 }} />
          <input autoFocus value={q} placeholder="Jump to a screen…" aria-label="Screen name"
            onChange={e => { setQ(e.target.value); setSel(0); }}
            onKeyDown={e => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(s + 1, items.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); pick(sel); }
              else if (e.key === "Escape") onClose();
            }} />
        </div>
        <div className="cr-pal-list">
          {items.length === 0 && <div style={{ padding: 14, color: C.dim, fontSize: 13.5 }}>No screen called “{q}”.</div>}
          {items.map((it, k) => {
            const Icon = TABS[it.i].icon;
            const newGroup = k === 0 || items[k - 1].group !== it.group;
            return (
              <div key={it.label}>
                {newGroup && <div className="cr-pal-g">{it.group}</div>}
                <button className={"cr-pal-i" + (k === sel ? " on" : "")} onMouseEnter={() => setSel(k)} onClick={() => pick(k)}>
                  <Icon size={15} /><span>{it.label}</span>
                  {k === sel && <CornerDownLeft size={13} style={{ marginLeft: "auto" }} />}
                </button>
              </div>
            );
          })}
        </div>
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

  const field: React.CSSProperties = {
    width: "100%", padding: "11px 12px", fontSize: 15, borderRadius: 8,
    border: "1px solid " + C.bord, background: C.surf, color: C.txt, fontFamily: F.ui,
  };
  const lbl: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 600, color: C.mid, marginBottom: 6 };
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, fontFamily: F.ui,
      background: `radial-gradient(1200px 600px at 20% -10%, #16324F 0%, ${RAIL.bg} 55%)` }}>
      <div style={{ width: 380, maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22, color: "#fff" }}>
          <NikkiLogo size={36} variant="icon" dark />
          <div>
            <div style={{ fontFamily: F.cond, fontSize: 22, fontWeight: 600, lineHeight: 1.1 }}>HeyNikki</div>
            <div style={{ fontSize: 11.5, letterSpacing: ".1em", textTransform: "uppercase", color: RAIL.dim }}>Control room</div>
          </div>
        </div>
        <div style={{ background: C.surf, borderRadius: 12, padding: 26, boxShadow: "0 24px 60px rgba(0,0,0,.35)" }}>
          <div style={{ fontFamily: F.cond, fontSize: 22, fontWeight: 600, color: C.txt }}>Sign in</div>
          <div style={{ color: C.mid, fontSize: 13.5, marginTop: 4, marginBottom: 20 }}>
            Super admin accounts only. Everything done here is recorded in the audit log.
          </div>
          {error && <div role="alert" style={{ background: C.red + "12", color: C.red, borderRadius: 8,
            padding: "10px 12px", fontSize: 13.5, marginBottom: 16 }}>{error}</div>}
          <form onSubmit={handleLogin}>
            <label style={lbl} htmlFor="cr-email">Email</label>
            <input id="cr-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="username" required style={{ ...field, marginBottom: 14 }} />
            <label style={lbl} htmlFor="cr-pass">Password</label>
            <input id="cr-pass" type="password" value={password} onChange={e => setPassword(e.target.value)}
              autoComplete="current-password" required style={{ ...field, marginBottom: 20 }} />
            <button type="submit" disabled={loading} style={{
              width: "100%", background: C.glow, color: "#fff", border: "none", borderRadius: 8,
              padding: "12px", fontSize: 15, fontWeight: 600, cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.75 : 1 }}>
              {loading ? "Checking…" : "Sign in"}
            </button>
          </form>
        </div>
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

  if (loading) return <Loading rows={6} label="Loading the dashboard" />;

  return (
    <div>
      <CommandCenter token={token} />

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

      <div className="nk-kpis" style={{ marginBottom: 20 }}>
        <KPI value={stats?.tenants || 0}       label="Total Tenants"   color={C.gbr}  icon={Building2} />
        <KPI value={stats?.paid || 0}           label="Paid Customers"  color={C.grn}  icon={IndianRupee} />
        <KPI value={stats?.active_calls || 0}   label="Live Calls Now"  color={C.red}  icon={Phone} />
        <KPI value={stats?.calls_today || 0}    label="Calls Today"     color={C.gold} icon={BarChart3} />
      </div>

      <div className="nk-2col" style={{ marginBottom: 16 }}>
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
        {loading ? <Loading rows={6} label="Loading tenants" /> : (
          <div className="nk-scroll">
            <table className="nk-table">
              <thead>
                <tr>{["Business","Plan","Status","Free minutes","Actions"].map(h => (
                  <th key={h}>{h}</th>
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
                      {/* Was the trial_ends_at date, which nothing enforces. The
                          number an operator actually needs when a customer rings
                          saying "my calls stopped" is the balance that stopped them. */}
                      {t.credit_minutes != null ? `${Math.round(Number(t.credit_minutes))} min` : "—"}
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
                        {["trial", "suspended", "cancelled"].includes(t.status) && (
                          <button
                            onClick={async () => {
                              if (!confirm(`DELETE "${t.name}" permanently? Numbers return to inventory; everything else is gone.`)) return;
                              const r = await fetch(`${API}/api/admin/tenants/${t.id}`, {
                                method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
                              if (!r.ok) alert((await r.json()).error || "Delete failed");
                              else window.location.reload();
                            }}
                            style={{ background: "transparent", color: C.red,
                              border: "1px solid " + C.red + "44", borderRadius: 5,
                              padding: "4px 10px", fontSize: TYPE.xs, fontWeight: 700, cursor: "pointer" }}>
                            Delete
                          </button>
                        )}
                        <StaffButton token={token} tenantId={t.id} />
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
          </div>
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
        {loading ? <Loading rows={5} label="Loading leads" /> :
         filtered.length === 0 ? <Empty icon={Users} title="No leads match"
             hint="Try a different stage or search term." /> : (
          <div style={{ overflowX: "auto" }}>
            <div className="nk-scroll">
              <table className="nk-table">
                <thead>
                  <tr>{["","Business","Name","Phone","Stage","Deal Value","Tags","Score","Last Contact"].map(h => (
                    <th key={h}>{h}</th>
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
        <Card><Empty icon={Phone} title="No active calls right now"
          hint="Calls appear here the moment they connect, across every tenant." /></Card>
      ) : (
        <Card>
          <div className="nk-scroll">
            <table className="nk-table">
              <thead>
                <tr>{["Tenant","Profile","Caller","Direction","Duration","Intent","Latency"].map(h => (
                  <th key={h}>{h}</th>
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
          </div>
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
      <div className="nk-3col" style={{ marginBottom: 20 }}>
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

      <div style={{ height: SPACE.md }} />
      <WaTriage token={token} />
    </div>
  );
}

// Failed WhatsApp messages, with a resend that goes back through the same
// template machinery. The Operations counters said HOW MANY failed;
// nobody could see WHICH, or try again.
function WaTriage({ token }: { token: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch(`${API}/api/admin/wa-log?status=failed`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(j => setRows(j.rows || [])).catch(() => setRows([]));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  return (
    <Card>
      <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 800, marginBottom: 8 }}>
        Failed WhatsApp messages
      </div>
      {rows.length === 0
        ? <div style={{ color: C.dim, fontSize: TYPE.sm }}>None. Delivery statuses reconcile from Meta&apos;s webhook.</div>
        : rows.map(r => (
          <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center",
            padding: "6px 0", borderBottom: `1px solid ${C.bord}33`, fontSize: TYPE.sm }}>
            <span style={{ color: C.txt, fontWeight: 700, minWidth: 110 }}>{r.to_number}</span>
            <span style={{ color: C.dim, fontSize: TYPE.xs, minWidth: 120 }}>{r.message_type}</span>
            <span style={{ color: C.mid, flex: 1, overflow: "hidden", textOverflow: "ellipsis",
              whiteSpace: "nowrap" as const }}>{r.message_body}</span>
            <button disabled={busy === r.id}
              onClick={async () => {
                setBusy(r.id);
                const x = await fetch(`${API}/api/admin/wa-log/${r.id}/resend`,
                  { method: "POST", headers: { Authorization: `Bearer ${token}` } });
                const j = await x.json();
                alert(j.ok ? "Resent" : "Send failed again — check the number has WhatsApp");
                setBusy(null); load();
              }}
              style={{ padding: "3px 10px", borderRadius: 6, fontSize: TYPE.xs, fontWeight: 700,
                background: "transparent", color: C.gbr, border: `1px solid ${C.gbr}66`,
                cursor: "pointer" }}>
              {busy === r.id ? "…" : "Resend"}
            </button>
          </div>
        ))}
    </Card>
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
                      {/* /api/admin/dids returns the business under `tenant`,
                          never `tenant_name` — so an assigned number never
                          showed who owns it. */}
                      {d.tenant?.name ? ` · ${d.tenant.name}` : ""}
                    </div>
                  </div>
                  <Pill label={d.status || "unknown"} color={assigned ? C.grn : C.dim} />
                  {assigned ? (
                    <button
                      onClick={() => {
                        // Detaches a live number from a paying business, and
                        // the only undo is assigning it back.
                        if (window.confirm(`Release ${d.number} from ${d.tenant?.name || "its tenant"}? Calls to it stop working immediately.`))
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
                  {/* metadata, not details: admin_audit_log has no `details`
                      column, so every entry's payload rendered as "—" — the
                      plan an override set, the reason a tenant was suspended. */}
                  {r.metadata && Object.keys(r.metadata).length ? JSON.stringify(r.metadata) : "—"}
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
                <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 700,
                  display: "flex", gap: 8, alignItems: "center" }}>
                  {t.tenant_name || t.tenant_id.slice(0, 8)}
                  <button
                    onClick={async () => {
                      if (!confirm("Clear this tenant's scores? The scheduler re-analyses everything within 15 minutes.")) return;
                      const r = await fetch(`${API}/api/admin/quality/rescore/${t.tenant_id}`,
                        { method: "POST", headers: { Authorization: `Bearer ${token}` } });
                      alert(r.ok ? "Cleared — rescoring within 15 min" : "Failed");
                    }}
                    style={{ padding: "2px 8px", borderRadius: 5, fontSize: 10, fontWeight: 700,
                      background: "transparent", color: C.dim, border: `1px solid ${C.bord}`,
                      cursor: "pointer" }}>
                    re-score
                  </button>
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
  const [acting, setActing] = useState<string | null>(null);
  const act = async (id: string, verb: "pause" | "resume", reload: () => void) => {
    setActing(id);
    const r = await fetch(`${API}/api/admin/campaigns/${id}/${verb}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) alert((await r.json()).error || "Failed");
    else reload();
    setActing(null);
  };
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    fetch(`${API}/api/admin/campaigns`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(j => setRows(j.campaigns || []))
      .catch(() => setRows([])).finally(() => setLoading(false));
  }, [token]);
  useEffect(() => { load(); }, [load]);

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
              {/* The audit's finding: a no-consent campaign was visible but
                  the only lever was suspending the whole tenant. */}
              {(c.status === "running" || c.status === "paused") && (
                <button disabled={acting === c.id}
                  onClick={() => act(c.id, c.status === "running" ? "pause" : "resume", load)}
                  style={{ padding: "4px 11px", borderRadius: 7, fontSize: TYPE.xs, fontWeight: 700,
                    background: "transparent",
                    color: c.status === "running" ? C.red : C.grn,
                    border: `1px solid ${c.status === "running" ? C.red : C.grn}66`,
                    cursor: "pointer" }}>
                  {acting === c.id ? "…" : c.status === "running" ? "Pause" : "Resume"}
                </button>
              )}
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
// Roles, inline on the tenant row. The one guard lives server-side: an
// operator cannot demote their own super_admin — a panel that can lock out
// its last operator eventually will, at the worst moment.
function StaffButton({ token, tenantId }: { token: string; tenantId: string }) {
  const [open, setOpen]   = useState(false);
  const [staff, setStaff] = useState<any[]>([]);
  const load = async () => {
    const r = await fetch(`${API}/api/admin/staff/${tenantId}`,
      { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    setStaff(j.staff || []);
  };
  return (
    <span style={{ position: "relative" }}>
      <button onClick={() => { setOpen(o => !o); if (!open) load(); }}
        style={{ background: "transparent", color: C.mid,
          border: "1px solid " + C.bord, borderRadius: 5,
          padding: "4px 10px", fontSize: TYPE.xs, cursor: "pointer" }}>Staff</button>
      {open && (
        <div style={{ position: "absolute", zIndex: 40, top: "110%", right: 0,
          background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 10,
          padding: 10, minWidth: 260, boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
          {staff.length === 0 && <div style={{ color: C.dim, fontSize: TYPE.xs }}>No staff rows.</div>}
          {staff.map(m => (
            <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center",
              padding: "5px 0", fontSize: TYPE.xs }}>
              <span style={{ color: C.txt, flex: 1, overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                {m.display_name || m.user_id.slice(0, 8)}{m.phone ? ` · ${m.phone}` : ""}
              </span>
              <select value={m.role}
                onChange={async e => {
                  const r = await fetch(`${API}/api/admin/staff/${m.id}/role`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ role: e.target.value }),
                  });
                  if (!r.ok) alert((await r.json()).error || "Failed");
                  load();
                }}
                style={{ background: C.hi, color: C.txt, border: `1px solid ${C.bord}`,
                  borderRadius: 5, padding: "3px 6px", fontSize: TYPE.xs }}>
                {["owner", "member", "support", "super_admin"].map(x =>
                  <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

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
// ── BILLING ──────────────────────────────────────────────────
// The audit's disqualifying gap. "Where did my minutes go" is the named
// first support ticket in migration 025, and until now the only answer was
// service-key SQL. This panel answers it, grants and corrects credits with
// a reason the customer can read, extends trials, fixes a mistyped owner
// phone, and marks invoices refunded.
function BillingPanel({ token }: { token: string }) {
  const [tenants, setTenants] = useState<any[]>([]);
  const [sel, setSel]         = useState<string>("");
  const [d, setD]             = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [delta, setDelta]     = useState("");
  const [reason, setReason]   = useState("");
  const [phone, setPhone]     = useState("");
  const [msg, setMsg]         = useState("");

  useEffect(() => {
    fetch(`${API}/api/admin/tenants`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(t => setTenants(Array.isArray(t) ? t : []))
      .catch(() => setTenants([]));
  }, [token]);

  const load = useCallback((tid: string) => {
    if (!tid) return;
    setLoading(true); setMsg("");
    fetch(`${API}/api/admin/tenants/${tid}/ledger`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setD).catch(() => setD(null)).finally(() => setLoading(false));
  }, [token]);
  useEffect(() => { if (sel) load(sel); }, [sel, load]);

  const post = async (path: string, body: any, okMsg: string) => {
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`${API}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) setMsg(j.error || `Failed (${r.status})`);
      else { setMsg(okMsg); load(sel); }
    } catch (e: any) { setMsg(e.message); }
    setBusy(false);
  };

  const inp = { padding: "8px 10px", borderRadius: 7, fontSize: TYPE.sm,
    background: C.hi, color: C.txt, border: `1px solid ${C.bord}` } as const;
  const btn = (bg: string) => ({ padding: "8px 14px", borderRadius: 7, border: "none",
    background: bg, color: "#04120a", fontSize: TYPE.sm, fontWeight: 800,
    cursor: busy ? "wait" : "pointer" } as const);

  return (
    <div>
      <select value={sel} onChange={e => setSel(e.target.value)}
        style={{ ...inp, minWidth: 260, marginBottom: 14 }}>
        <option value="">Choose a tenant…</option>
        {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      {loading && <div style={{ color: C.dim, fontSize: TYPE.sm }}>Loading…</div>}
      {msg && <div style={{ color: msg.startsWith("Failed") || msg.includes("required") ? C.red : C.grn,
        fontSize: TYPE.sm, marginBottom: 10 }}>{msg}</div>}

      {d?.tenant && (
        <>
          <div style={{ display: "grid", gap: SPACE.sm, marginBottom: SPACE.md,
            gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
            {[["Balance", `${Math.round(d.tenant.credit_minutes ?? 0)} min`, C.grn],
              ["Plan", `${d.tenant.plan} · ${d.tenant.status}`, C.txt],
              ["Free minutes", d.tenant.credit_minutes != null
                 ? `${Math.round(Number(d.tenant.credit_minutes))} min` : "—", C.gold],
             ].map(([l, v, c]) => (
              <Card key={String(l)}>
                <div style={{ color: C.dim, fontSize: TYPE.xs, textTransform: "uppercase" as const,
                  letterSpacing: "0.08em" }}>{l}</div>
                <div style={{ color: c as string, fontSize: 20, fontWeight: 900, marginTop: 4 }}>{v}</div>
              </Card>
            ))}
          </div>

          <Card>
            <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 800, marginBottom: 10 }}>Levers</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, alignItems: "center" }}>
              <input value={delta} onChange={e => setDelta(e.target.value)}
                placeholder="±minutes" inputMode="numeric" style={{ ...inp, width: 90 }} />
              <input value={reason} onChange={e => setReason(e.target.value)}
                placeholder="reason (shown to the customer)" style={{ ...inp, minWidth: 220, flex: 1 }} />
              <button disabled={busy} style={btn(C.grn)}
                onClick={() => post(`/api/admin/tenants/${sel}/credits`,
                  { delta: Number(delta), reason }, "Credits adjusted")}>Adjust credits</button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, marginTop: 10 }}>
              <button disabled={busy} style={btn(C.gold)}
                onClick={() => post(`/api/admin/tenants/${sel}/trial`, { days: 7 }, "Trial +7 days")}>
                Trial +7 days
              </button>
              <input value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="fix owner phone (98765…)" inputMode="numeric" style={{ ...inp, width: 190 }} />
              <button disabled={busy} style={btn(C.cyn)}
                onClick={() => post(`/api/admin/tenants/${sel}/owner-phone`, { phone }, "Phone updated")}>
                Save phone
              </button>
              <button disabled={busy}
                style={{ ...btn(C.red), color: "#fff" }}
                onClick={() => { if (confirm("Mark this tenant cancelled?"))
                  post(`/api/admin/tenants/${sel}/cancel`, {}, "Cancelled"); }}>
                Cancel tenant
              </button>
            </div>
          </Card>

          <div style={{ height: SPACE.sm }} />
          <Card>
            <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 800, marginBottom: 8 }}>
              Credit ledger
            </div>
            {(d.ledger || []).length === 0
              ? <div style={{ color: C.dim, fontSize: TYPE.sm }}>No entries.</div>
              : (d.ledger || []).map((r: any, i: number) => (
                <div key={i} style={{ display: "flex", gap: 10, fontSize: TYPE.sm,
                  padding: "6px 0", borderBottom: `1px solid ${C.bord}33` }}>
                  <span style={{ color: r.delta >= 0 ? C.grn : C.red, minWidth: 62,
                    fontWeight: 800 }}>{r.delta >= 0 ? "+" : ""}{r.delta}</span>
                  <span style={{ color: C.mid, flex: 1 }}>{r.reason}</span>
                  <span style={{ color: C.dim }}>{`→ ${r.balance_after}`}</span>
                  <span style={{ color: C.dim, fontSize: TYPE.xs }}>
                    {new Date(r.created_at).toLocaleString()}</span>
                </div>
              ))}
          </Card>

          <div style={{ height: SPACE.sm }} />
          <ApiKeysCard token={token} tenantId={sel} />

          <div style={{ height: SPACE.sm }} />
          <Card>
            <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 800, marginBottom: 8 }}>
              Invoices
            </div>
            {(d.invoices || []).length === 0
              ? <div style={{ color: C.dim, fontSize: TYPE.sm }}>None yet.</div>
              : (d.invoices || []).map((iv: any) => (
                <div key={iv.id} style={{ display: "flex", gap: 10, fontSize: TYPE.sm,
                  padding: "6px 0", borderBottom: `1px solid ${C.bord}33`, alignItems: "center" }}>
                  <span style={{ color: C.txt, fontWeight: 700 }}>
                    {"₹"}{(iv.amount_paise / 100).toLocaleString("en-IN")}</span>
                  <span style={{ color: C.mid, flex: 1 }}>{iv.plan_id || iv.description || "—"}</span>
                  <span style={{ color: iv.status === "refunded" ? C.gold
                    : iv.status === "paid" ? C.grn : C.red }}>{iv.status}</span>
                  {iv.status === "paid" && (
                    <button disabled={busy}
                      style={{ padding: "3px 10px", borderRadius: 6, fontSize: TYPE.xs,
                        background: "transparent", color: C.gold,
                        border: `1px solid ${C.gold}66`, cursor: "pointer" }}
                      onClick={() => { if (confirm("Mark refunded? (Do the actual refund in Razorpay.)"))
                        post(`/api/admin/invoices/${iv.id}/refund`, {}, "Marked refunded"); }}>
                      Mark refunded
                    </button>
                  )}
                </div>
              ))}
          </Card>
        </>
      )}
    </div>
  );
}

// Type what the caller ACTUALLY said; entity accuracy is scored against it.
function SampleAnnotator({ token, sample }: { token: string; sample: any }) {
  const [truth, setTruth] = useState("");
  const [done, setDone] = useState(false);
  if (done) return null;
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.bord}55` }}>
      <div style={{ color: C.dim, fontSize: TYPE.xs, marginBottom: 5 }}>
        sample {String(sample.id).slice(0, 8)} · {sample.noise_band} · {new Date(sample.created_at).toLocaleString()}
      </div>
      <textarea value={truth} onChange={e => setTruth(e.target.value)} rows={2}
        placeholder="ground-truth transcript — exactly what the caller said"
        style={{ width: "100%", padding: "7px 10px", borderRadius: 7, fontSize: TYPE.sm,
          background: C.hi, color: C.txt, border: `1px solid ${C.bord}`, resize: "vertical" }} />
      <button disabled={truth.trim().length < 4}
        onClick={async () => {
          const r = await fetch(`${API}/api/admin/voice-lab/samples/${sample.id}/annotate`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ truth_transcript: truth }),
          });
          if (r.ok) setDone(true); else alert("Failed");
        }}
        style={{ marginTop: 6, padding: "5px 12px", borderRadius: 6, fontSize: TYPE.xs,
          fontWeight: 800, background: C.grn, color: "#04120a", border: "none", cursor: "pointer" }}>
        Save annotation
      </button>
    </div>
  );
}

// API keys behind the operator's JWT — the internal routes needed the
// server-to-server secret, which an operator does not have.
function ApiKeysCard({ token, tenantId }: { token: string; tenantId: string }) {
  const [keys, setKeys] = useState<any[]>([]);
  const load = useCallback(() => {
    fetch(`${API}/api/admin/api-keys/${tenantId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(j => setKeys(j.keys || [])).catch(() => setKeys([]));
  }, [token, tenantId]);
  useEffect(() => { load(); }, [load]);
  return (
    <Card>
      <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 800, marginBottom: 8 }}>API keys</div>
      {keys.length === 0
        ? <div style={{ color: C.dim, fontSize: TYPE.sm }}>None issued.</div>
        : keys.map(k => (
          <div key={k.id} style={{ display: "flex", gap: 10, alignItems: "center",
            padding: "5px 0", borderBottom: `1px solid ${C.bord}33`, fontSize: TYPE.sm }}>
            <span style={{ color: C.txt, fontWeight: 700 }}>{k.name}</span>
            <span style={{ color: C.dim, fontFamily: "monospace", fontSize: TYPE.xs }}>{k.prefix}…</span>
            <span style={{ flex: 1 }} />
            {k.revoked_at
              ? <Pill label="revoked" color={C.dim} />
              : <button
                  onClick={async () => {
                    if (!confirm(`Revoke "${k.name}"? Integrations using it stop working immediately.`)) return;
                    const r = await fetch(`${API}/api/admin/api-keys/${k.id}/revoke`,
                      { method: "POST", headers: { Authorization: `Bearer ${token}` } });
                    if (!r.ok) alert("Failed"); load();
                  }}
                  style={{ padding: "3px 10px", borderRadius: 6, fontSize: TYPE.xs, fontWeight: 700,
                    background: "transparent", color: C.red, border: `1px solid ${C.red}66`,
                    cursor: "pointer" }}>
                  Revoke
                </button>}
          </div>
        ))}
    </Card>
  );
}

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
        </div>
        {(d?.samples?.recent || []).filter((x: any) => !x.annotated).slice(0, 5).map((sm: any) => (
          <SampleAnnotator key={sm.id} token={token} sample={sm} />
        ))}
        <div style={{ color: C.mid, fontSize: TYPE.sm, marginTop: 6, lineHeight: 1.55 }}>
          Every STT vendor scores 33–47% WER on noisy Telugu — entity accuracy on OUR
          calls is the only ruler that matters, and nobody else has the corpus.
          Add samples from any call&apos;s detail view once real calls exist.
        </div>
      </Card>
    </div>
  );
}


// Turn a client's assigned DID into their own WhatsApp sender.
//
// The reason this works for a SIP number that cannot receive SMS: Meta will
// CALL the number and read the code out, that call lands on our trunk, Nikki
// answers it, and every call is transcribed — so the digits show up in the
// call's transcript on the Calls list. No handset needed.
function ProvisionWhatsApp({ token, onDone }: { token: string; onDone: () => void }) {
  const [tenants, setTenants] = useState<any[]>([]);
  const [sel, setSel]   = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg]   = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    fetch(`${API}/api/admin/tenants`, { headers: { Authorization: `Bearer ${token}` } })
      // The endpoint returns a bare array. Reading `d.tenants` left the
      // dropdown empty, so no tenant could be selected and the whole
      // three-step WhatsApp provisioning wizard was unreachable.
      .then(r => r.json()).then(d => setTenants(Array.isArray(d) ? d : (d?.tenants || []))).catch(() => {});
  }, [token]);

  const step = async (path: string, body: any, label: string) => {
    setBusy(label); setMsg("");
    try {
      const r = await fetch(`${API}/api/admin/whatsapp/${sel}/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      setMsg(r.ok ? (d.message || "Done.") : (d.error || "Failed"));
      if (r.ok) onDone();
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(""); }
  };

  return (
    <Card>
      <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 800, marginBottom: 4 }}>
        Give a client their own WhatsApp number
      </div>
      <div style={{ color: C.dim, fontSize: TYPE.xs, marginBottom: 10, lineHeight: 1.55 }}>
        Registers the tenant&apos;s assigned HeyNikki number as a sender on our WABA.
        Meta rings it with the code — Nikki answers, so the digits appear in that
        call&apos;s transcript on the Calls list. Voice service on the number is unaffected.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, alignItems: "center" }}>
        <select value={sel} onChange={e => setSel(e.target.value)}
          style={{ background: C.hi, color: C.txt, border: `1px solid ${C.bord}`,
            borderRadius: 6, padding: "6px 9px", fontSize: TYPE.xs, minWidth: 170 }}>
          <option value="">Select a business…</option>
          {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="Display name shown to customers"
          style={{ padding: "6px 10px", borderRadius: 6, fontSize: TYPE.xs, minWidth: 210,
            background: C.hi, color: C.txt, border: `1px solid ${C.bord}` }} />
        <button type="button" disabled={!sel || name.trim().length < 3 || !!busy}
          onClick={() => step("add-number", { display_name: name.trim() }, "add")}
          style={btn(C.gbr)}>{busy === "add" ? "Adding…" : "1. Add to WABA"}</button>
        <button type="button" disabled={!sel || !!busy}
          onClick={() => step("request-code", { method: "VOICE" }, "code")}
          style={btn(C.gold)}>{busy === "code" ? "Calling…" : "2. Call with code"}</button>
        <input value={code} onChange={e => setCode(e.target.value)} placeholder="6-digit code"
          style={{ width: 110, padding: "6px 10px", borderRadius: 6, fontSize: TYPE.xs,
            background: C.hi, color: C.txt, border: `1px solid ${C.bord}` }} />
        <button type="button" disabled={!sel || code.replace(/\D/g, "").length < 4 || !!busy}
          onClick={() => step("verify-code", { code }, "verify")}
          style={btn(C.grn)}>{busy === "verify" ? "Verifying…" : "3. Verify & go live"}</button>
      </div>
      {msg && <div style={{ color: C.mid, fontSize: TYPE.xs, marginTop: 9, lineHeight: 1.5 }}>{msg}</div>}
    </Card>
  );
}

function btn(color: string) {
  return {
    padding: "6px 12px", borderRadius: 6, fontSize: 11.5, fontWeight: 800,
    background: "transparent", color, border: `1px solid ${color}66`, cursor: "pointer",
  } as const;
}

/**
 * Every business's incoming WhatsApp, and the platform's own.
 *
 * The shared platform number (+91 94407 69495) is on the Cloud API, which
 * means it cannot also run in the WhatsApp app on a phone — so this is where
 * its messages are read and answered. Messages from someone no business has
 * spoken to are kept under the platform tenant (they used to be dropped).
 * Replies go out as the conversation's business, free text inside Meta's
 * 24-hour window only.
 */
function WhatsAppInbox({ token }: { token: string }) {
  const H = { Authorization: `Bearer ${token}` };
  const [convos, setConvos] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<any | null>(null);
  const [thread, setThread] = useState<any | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread" | "platform">("all");

  const load = useCallback(() => {
    fetch(`${API}/api/admin/whatsapp/inbox`, { headers: H })
      .then(r => r.json()).then(j => { if (j.error) setErr(j.error); else { setConvos(j.conversations || []); setErr(""); } })
      .catch(e => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);

  const open = useCallback((c: any) => {
    setSel(c); setThread(null); setText("");
    fetch(`${API}/api/admin/whatsapp/thread?tenant_id=${c.tenant_id}&number=${c.number}`, { headers: H })
      .then(r => r.json()).then(j => { setThread(j); load(); }).catch(() => setThread({ messages: [], error: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, load]);

  async function send() {
    if (!sel || !text.trim()) return;
    setSending(true);
    try {
      const r = await fetch(`${API}/api/admin/whatsapp/reply`, { method: "POST",
        headers: { ...H, "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: sel.tenant_id, number: sel.number, text }) });
      const j = await r.json();
      if (!r.ok) alert(j.error || "Send failed"); else { setText(""); open(sel); }
    } finally { setSending(false); }
  }

  const shown = (convos || []).filter(c =>
    filter === "unread" ? c.unread > 0 : filter === "platform" ? c.tenant_name === "HeyNikki (platform)" : true);
  const time = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: SPACE.sm, marginBottom: SPACE.sm, flexWrap: "wrap" as const }}>
        <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 800 }}>WhatsApp inbox</div>
        <div style={{ color: C.dim, fontSize: TYPE.xs }}>every business&apos;s incoming messages · the platform&apos;s own (support) · refreshes every 20 s</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {(["all", "unread", "platform"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding: "3px 10px", borderRadius: 999, fontSize: TYPE.xs, fontWeight: 700,
              cursor: "pointer", background: filter === f ? C.glow + "22" : "transparent", color: filter === f ? C.gbr : C.mid,
              border: `1px solid ${filter === f ? C.glow : C.bord}` }}>{f === "platform" ? "HeyNikki support" : f}</button>
          ))}
        </div>
      </div>
      {err ? <ErrorNote msg={err} onRetry={load} /> : !convos ? <Loading rows={3} label="Loading messages" /> : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(0, 2fr)", gap: SPACE.md, minHeight: 360 }}>
          <div style={{ borderRight: `1px solid ${C.bord}`, paddingRight: SPACE.sm, maxHeight: 520, overflowY: "auto" as const }}>
            {shown.length === 0 ? <div style={{ color: C.dim, fontSize: TYPE.sm }}>No messages.</div> : shown.map(c => {
              const on = sel && sel.tenant_id === c.tenant_id && sel.number === c.number;
              return (
                <button key={`${c.tenant_id}|${c.number}`} onClick={() => open(c)} style={{ display: "block", width: "100%", textAlign: "left" as const,
                  background: on ? C.hi : "transparent", border: "none", borderBottom: `1px solid ${C.bord}33`, padding: "8px 6px",
                  cursor: "pointer", color: C.txt, fontFamily: "inherit" }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontWeight: 800, fontSize: TYPE.sm }}>{c.name || c.number}</span>
                    {c.unread > 0 && <span style={{ background: C.grn, color: "#04120a", borderRadius: 999, padding: "0 7px", fontSize: TYPE.xs, fontWeight: 800 }}>{c.unread}</span>}
                    <span style={{ marginLeft: "auto", color: C.dim, fontSize: TYPE.xs }}>{time(c.last_at)}</span>
                  </div>
                  <div style={{ color: C.gbr, fontSize: TYPE.xs }}>{c.tenant_name}{c.name ? ` · ${c.number}` : ""}</div>
                  <div style={{ color: C.mid, fontSize: TYPE.xs, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{c.last}</div>
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", flexDirection: "column" as const, minWidth: 0 }}>
            {!sel ? <div style={{ color: C.dim, fontSize: TYPE.sm, margin: "auto" }}>Pick a conversation.</div> : (
              <>
                <div style={{ fontSize: TYPE.sm, color: C.txt, fontWeight: 800, marginBottom: 6 }}>
                  {sel.name || sel.number} <span style={{ color: C.dim, fontWeight: 400 }}>· {sel.number} · {sel.tenant_name}</span>
                </div>
                <div style={{ flex: 1, overflowY: "auto" as const, maxHeight: 400, display: "flex", flexDirection: "column" as const, gap: 6, padding: "4px 2px" }}>
                  {!thread ? <Loading rows={2} label="Loading conversation" /> : (thread.messages || []).map((m: any) => (
                    <div key={`${m.dir}-${m.id}`} style={{ alignSelf: m.dir === "in" ? "flex-start" : "flex-end", maxWidth: "80%",
                      background: m.dir === "in" ? C.hi : C.glow + "22", border: `1px solid ${C.bord}`, borderRadius: 10, padding: "6px 10px" }}>
                      <div style={{ fontSize: TYPE.sm, color: C.txt, whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const }}>{m.body}</div>
                      <div style={{ fontSize: TYPE.xs, color: C.dim, marginTop: 2 }}>
                        {time(m.at)}{m.dir === "out" ? ` · ${m.type}${m.status ? ` · ${m.status}` : ""}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
                {thread && (
                  <div style={{ marginTop: SPACE.sm }}>
                    {thread.window_open ? (
                      <div style={{ display: "flex", gap: SPACE.sm }}>
                        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") send(); }}
                          placeholder={`Reply as ${sel.tenant_name}…`} style={{ flex: 1, padding: "8px 10px", borderRadius: 8,
                          border: `1px solid ${C.bord}`, background: C.hi, color: C.txt, fontSize: TYPE.sm }} />
                        <button onClick={send} disabled={sending || !text.trim()} style={{ padding: "8px 16px", borderRadius: 8, border: "none",
                          background: C.grn, color: "#04120a", fontWeight: 800, cursor: "pointer", opacity: sending ? 0.6 : 1 }}>
                          {sending ? "…" : "Send"}
                        </button>
                      </div>
                    ) : (
                      <div style={{ fontSize: TYPE.xs, color: C.gold }}>
                        Their last message was over 24 hours ago, so WhatsApp only allows an approved template now — free replies reopen when they write again.
                      </div>
                    )}
                    {thread.window_open && thread.window_closes_at && (
                      <div style={{ fontSize: TYPE.xs, color: C.dim, marginTop: 4 }}>Free replies until {time(thread.window_closes_at)}.</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </Card>
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
      <WhatsAppInbox token={token} />
      <div style={{ height: SPACE.md }} />
      <ProvisionWhatsApp token={token} onDone={load} />
      <div style={{ height: SPACE.sm }} />
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
            <button
              onClick={async () => {
                if (!confirm("Restore this version? The current state is snapshotted first, so this is undoable.")) return;
                const r = await fetch(
                  `${API}/api/admin/voice-profiles/${v.profile_id}/restore/${v.id}`,
                  { method: "POST", headers: { Authorization: `Bearer ${token}` } });
                alert(r.ok ? "Restored" : ((await r.json()).error || "Failed"));
              }}
              style={{ padding: "3px 10px", borderRadius: 6, fontSize: TYPE.xs, fontWeight: 700,
                background: "transparent", color: C.gbr, border: `1px solid ${C.gbr}66`,
                cursor: "pointer" }}>
              Restore
            </button>
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
/**
 * Broadcast — an announcement that actually leaves the building.
 *
 * The channel is email, one message per tenant OWNER, through the same Resend
 * account that sends billing and usage mail. WhatsApp is not an option:
 * Meta approves templates by name and there is no approved operator
 * announcement template, so free text would be rejected and would cost the
 * business number its quality rating. Push is not configured.
 *
 * Two things this screen refuses to do, both of which the old one did:
 *   1. Send without showing who. The dry run lists every business and the
 *      exact address it would be mailed at, and Send stays disabled until the
 *      preview matches the message and audience currently on screen.
 *   2. Report a total. "Sent to 40 tenants" hides the three that bounced.
 *      Every recipient gets its own line and its own outcome.
 */
function BroadcastPanel({ token }: { token: string }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [plan, setPlan]       = useState("all");
  const [status, setStatus]   = useState("all");
  const [hasDid, setHasDid]   = useState("any");
  const [includeDemo, setIncludeDemo] = useState(false);

  const [preview, setPreview] = useState<any>(null);
  // The exact filters + text the preview was taken for. Change any of them
  // and Send locks again — a preview of the Growth plan followed by a send to
  // everyone is the mistake this exists to make impossible.
  const [previewOf, setPreviewOf] = useState("");
  const [busy, setBusy]       = useState<"preview" | "send" | null>(null);
  const [error, setError]     = useState("");
  const [result, setResult]   = useState<any>(null);
  const [history, setHistory] = useState<any>(null);

  const audience = { plan, status, has_did: hasDid, include_demo: includeDemo };
  const stamp    = JSON.stringify({ ...audience, subject, message });
  const ready    = subject.trim().length > 0 && message.trim().length >= 10;
  const canSend  = ready && preview && previewOf === stamp
                   && (preview.counts?.reachable || 0) > 0 && busy === null;

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/admin/broadcast/history`, {
        headers: { Authorization: `Bearer ${token}` } });
      setHistory(await r.json());
    } catch { setHistory(null); }
  }, [token]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const call = async (path: string, body: any) => {
    const r = await fetch(`${API}/api/admin/broadcast/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
    return j;
  };

  const runPreview = async () => {
    setBusy("preview"); setError(""); setResult(null);
    try {
      const j = await call("preview", audience);
      setPreview(j); setPreviewOf(stamp);
    } catch (e: any) { setError(e.message); setPreview(null); }
    setBusy(null);
  };

  const send = async () => {
    const n = preview?.counts?.reachable || 0;
    if (!window.confirm(`Email this announcement to ${n} business owner${n === 1 ? "" : "s"}? It cannot be un-sent.`)) return;
    setBusy("send"); setError("");
    try {
      const j = await call("send", { ...audience, subject, message });
      setResult(j);
      setPreview(null); setPreviewOf("");
      loadHistory();
    } catch (e: any) { setError(e.message); }
    setBusy(null);
  };

  const stateColor = (s: string) =>
    s === "sent" ? C.grn : s === "failed" ? C.red : s === "no_email" ? C.gold : C.dim;

  const Recipient = ({ r }: { r: any }) => (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" as const,
      padding: "6px 0", borderBottom: `1px solid ${C.bord}33`, fontSize: TYPE.sm }}>
      <span style={{ color: C.txt, fontWeight: 700, minWidth: 150 }}>{r.tenant_name || r.tenant}</span>
      <span style={{ color: C.mid, flex: "1 1 200px", overflow: "hidden",
        textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
        {r.email || "— no owner email on file —"}
      </span>
      {r.plan && <span style={{ color: C.dim, fontSize: TYPE.xs }}>{r.plan} · {r.status}</span>}
      <Pill label={r.state === "ready" ? "will send" : r.state.replace("_", " ")}
        color={r.state === "ready" ? C.gbr : stateColor(r.state)} />
      {r.error && <span style={{ color: C.red, fontSize: TYPE.xs, flexBasis: "100%" }}>{r.error}</span>}
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: SPACE.md,
        flexWrap: "wrap" as const }}>
        <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 900 }}>Broadcast</div>
        <Pill label="email only" color={C.gbr} />
        {preview && preview.channel_ready === false &&
          <Pill label="RESEND_API_KEY not set" color={C.red} />}
      </div>

      <Card style={{ marginBottom: SPACE.sm }}>
        <div style={{ color: C.dim, fontSize: TYPE.xs, lineHeight: 1.6 }}>
          Goes to each tenant&apos;s <strong style={{ color: C.mid }}>owner</strong> by email, from{" "}
          {preview?.sender || "noreply@heynikki.in"}. There is no approved WhatsApp template for an
          operator announcement and push is not configured, so email is the only channel that can
          honestly say it delivered.
        </div>
      </Card>

      <Card style={{ marginBottom: SPACE.sm }}>
        <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800, marginBottom: 12 }}>
          1 · Audience
        </div>
        <div style={{ display: "flex", gap: SPACE.sm, flexWrap: "wrap" as const, alignItems: "center" }}>
          <select value={plan} onChange={e => { setPlan(e.target.value); setPreview(null); }}
            style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
              borderRadius: 8, padding: "8px 10px", fontSize: TYPE.sm }}>
            <option value="all">Every plan</option>
            <option value="trial">Trial</option>
            <option value="starter">Starter</option>
            <option value="growth">Growth</option>
            <option value="scale">Scale</option>
          </select>
          <select value={status} onChange={e => { setStatus(e.target.value); setPreview(null); }}
            style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
              borderRadius: 8, padding: "8px 10px", fontSize: TYPE.sm }}>
            <option value="all">Any status</option>
            <option value="trial">Trial</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <PillToggle
            options={[{ label: "Any number", value: "any" },
                      { label: "Has a DID", value: "yes" },
                      { label: "No DID", value: "no" }]}
            value={hasDid} onChange={v => { setHasDid(v); setPreview(null); }} />
          <label style={{ color: C.dim, fontSize: TYPE.xs, display: "inline-flex",
            alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={includeDemo}
              onChange={e => { setIncludeDemo(e.target.checked); setPreview(null); }} />
            {/* A demo is a sandbox with a throwaway address, not a customer. */}
            Include demo tenants
          </label>
          <button onClick={runPreview} disabled={busy !== null}
            style={{ marginLeft: "auto", background: "none", border: "1px solid " + C.gbr + "66",
              color: C.gbr, borderRadius: 7, padding: "7px 14px", fontSize: TYPE.xs,
              fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Eye size={13} /> {busy === "preview" ? "Checking…" : "Dry run — who gets this"}
          </button>
        </div>
      </Card>

      {preview && (
        <Card style={{ marginBottom: SPACE.sm, borderColor: C.gbr + "55" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8,
            flexWrap: "wrap" as const }}>
            <span style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800 }}>Dry run — nothing sent</span>
            <Pill label={`${preview.counts?.reachable || 0} will receive`} color={C.grn} />
            {(preview.counts?.no_email || 0) > 0 &&
              <Pill label={`${preview.counts.no_email} have no owner email`} color={C.gold} />}
            {previewOf !== stamp &&
              <Pill label="message or audience changed — run again" color={C.red} />}
          </div>
          {(preview.recipients || []).length === 0
            ? <Empty icon={Building2} title="No tenant matches this filter" />
            : (preview.recipients || []).map((r: any) => <Recipient key={r.tenant_id} r={r} />)}
        </Card>
      )}

      <Card style={{ marginBottom: SPACE.sm }}>
        <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800, marginBottom: 12 }}>
          2 · Message
        </div>
        <input value={subject} onChange={e => setSubject(e.target.value)}
          placeholder="Subject line — this is what lands in their inbox"
          maxLength={150}
          style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
            borderRadius: 8, padding: "10px 12px", fontSize: TYPE.sm, width: "100%",
            marginBottom: SPACE.sm }} />
        <textarea value={message} onChange={e => setMessage(e.target.value)}
          placeholder="Plain text. Blank lines become paragraphs; the business name is greeted for you."
          rows={6} maxLength={4000}
          style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
            borderRadius: 8, padding: "10px 12px", fontSize: TYPE.sm, width: "100%",
            resize: "vertical" }} />
        <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 6 }}>{message.length}/4000</div>
      </Card>

      {error && <Card style={{ borderColor: C.red + "55", marginBottom: SPACE.sm }}>
        <div style={{ color: C.red, fontSize: TYPE.sm }}>{error}</div></Card>}

      <Card style={{ marginBottom: SPACE.md }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" as const }}>
          <button onClick={send} disabled={!canSend}
            style={{ background: canSend ? C.glow : C.bord, color: canSend ? "#fff" : C.dim,
              border: "none", borderRadius: 8, padding: "11px 22px", fontSize: TYPE.sm,
              fontWeight: 800, cursor: canSend ? "pointer" : "not-allowed",
              display: "inline-flex", alignItems: "center", gap: 7 }}>
            <Send size={14} /> {busy === "send"
              ? `Sending to ${preview?.counts?.reachable || 0}…`
              : `Send to ${preview && previewOf === stamp ? preview.counts?.reachable || 0 : "…"}`}
          </button>
          <span style={{ color: C.dim, fontSize: TYPE.xs }}>
            {!ready ? "A subject and at least ten characters of message."
              : !preview || previewOf !== stamp ? "Run the dry run for this exact message and audience first."
              : (preview.counts?.reachable || 0) === 0 ? "Nobody in this audience has an owner email."
              : "Sent in batches of 25 with a rate-limit gap, so a hundred owners do not hammer Resend."}
          </span>
        </div>
      </Card>

      {result && (
        <Card style={{ marginBottom: SPACE.md,
          borderColor: (result.counts?.failed || 0) ? C.red + "55" : C.grn + "55" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10,
            flexWrap: "wrap" as const }}>
            {/* Counted, never summarised: three failures out of forty is a
                sentence about three businesses, not a green tick. */}
            <span style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800 }}>Delivery result</span>
            <Pill label={`${result.counts?.sent || 0} sent`} color={C.grn} />
            {(result.counts?.failed || 0) > 0 && <Pill label={`${result.counts.failed} failed`} color={C.red} />}
            {(result.counts?.no_email || 0) > 0 && <Pill label={`${result.counts.no_email} no email`} color={C.gold} />}
          </div>
          {(result.recipients || []).map((r: any) => <Recipient key={r.tenant_id} r={r} />)}
          {/* "sent" is what Resend accepted, which is not the same as what an
              inbox received — a later bounce arrives on Resend's webhook and
              nothing subscribes to it yet. Said here rather than implied. */}
          <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 10 }}>
            &ldquo;Sent&rdquo; means Resend accepted the message and gave it an id. A bounce after
            that is not reported back here.
          </div>
          {(result.counts?.failed || 0) > 0 && (
            <div style={{ color: C.gold, fontSize: TYPE.xs, marginTop: 10, lineHeight: 1.6 }}>
              A failed row was never delivered. Fix the address and send again to just those
              tenants — Resend reports the reason on each line above.
            </div>
          )}
        </Card>
      )}

      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Mail size={14} color={C.dim} />
          <span style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800 }}>Previous broadcasts</span>
          {history?.source === "audit_log" &&
            <Pill label="from the audit log" color={C.gold} />}
        </div>
        {history?.note && <div style={{ color: C.dim, fontSize: TYPE.xs, marginBottom: 8 }}>{history.note}</div>}
        {!history?.broadcasts?.length
          ? <div style={{ color: C.dim, fontSize: TYPE.sm }}>Nothing has been broadcast yet.</div>
          : history.broadcasts.map((b: any) => (
            <details key={b.id} style={{ borderBottom: `1px solid ${C.bord}33`, padding: "8px 0" }}>
              <summary style={{ cursor: "pointer", color: C.txt, fontSize: TYPE.sm,
                display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const }}>
                <span style={{ fontWeight: 700 }}>{b.subject || "(no subject)"}</span>
                <span style={{ color: C.dim, fontSize: TYPE.xs }}>
                  {new Date(b.created_at).toLocaleString("en-IN")}
                </span>
                <Pill label={`${b.sent_count ?? 0} sent`} color={C.grn} />
                {(b.failed_count || 0) > 0 && <Pill label={`${b.failed_count} failed`} color={C.red} />}
                {(b.no_email_count || 0) > 0 && <Pill label={`${b.no_email_count} no email`} color={C.gold} />}
              </summary>
              <div style={{ paddingLeft: SPACE.sm, marginTop: 6 }}>
                {(b.recipients || []).map((r: any, i: number) => <Recipient key={r.tenant_id || i} r={r} />)}
              </div>
            </details>
          ))}
      </Card>
    </div>
  );
}

/**
 * Demo tenants.
 *
 * POST /api/admin/demo-tenants has existed since migration 007 with no caller
 * anywhere — the only way to make a demo was an HTTP request typed by hand,
 * so demos were made as ordinary tenants instead and two of them sat on the
 * platform for two months.
 *
 * The expiry is not decoration. jobs/scheduler.ts suspends a demo whose
 * demo_expires_at has passed AND whose status is still 'trial'; anything else
 * it skips. So this screen shows the expiry, whether the sweeper can still
 * see the row, and what the demo actually used while it was alive.
 */
function DemoTenantsPanel({ token }: { token: string }) {
  const [rows, setRows]     = useState<any[]>([]);
  const [counts, setCounts] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState("");
  const [name, setName]     = useState("");
  const [days, setDays]     = useState(7);
  const [busy, setBusy]     = useState<string | null>(null);
  const [extend, setExtend] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch(`${API}/api/admin/demo-tenants`, {
        headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (!r.ok) setError(j.error || `Failed (${r.status})`);
      else { setRows(j.demos || []); setCounts(j.counts || {}); }
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const post = async (path: string, body?: any) => {
    const r = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
    return j;
  };

  const create = async () => {
    setBusy("create"); setError("");
    try {
      await post("/api/admin/demo-tenants", { name: name.trim(), days });
      setName(""); await load();
    } catch (e: any) { setError(e.message); }
    setBusy(null);
  };

  const act = async (id: string, what: "extend" | "expire") => {
    setBusy(id + what); setError("");
    try {
      await post(`/api/admin/demo-tenants/${id}/${what}`,
                 what === "extend" ? { days: extend[id] || 7 } : undefined);
      await load();
    } catch (e: any) { setError(e.message); }
    setBusy(null);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: SPACE.md,
        flexWrap: "wrap" as const }}>
        <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 900 }}>Demo tenants</div>
        <Pill label={`${counts.live ?? 0} live`} color={C.grn} />
        {(counts.expired ?? 0) > 0 && <Pill label={`${counts.expired} expired`} color={C.dim} />}
        {(counts.unswept ?? 0) > 0 &&
          <Pill label={`${counts.unswept} past expiry the sweeper cannot see`} color={C.gold} />}
        <button onClick={load} style={{ marginLeft: "auto", background: "none",
          border: "1px solid " + C.bord, color: C.dim, borderRadius: 7,
          padding: "5px 11px", fontSize: TYPE.xs, cursor: "pointer" }}>Refresh</button>
      </div>

      <Card style={{ marginBottom: SPACE.sm }}>
        <div style={{ display: "flex", gap: SPACE.sm, alignItems: "center", flexWrap: "wrap" as const }}>
          <div style={{ color: C.mid, fontSize: TYPE.sm, fontWeight: 700 }}>New demo</div>
          <input value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && name.trim().length >= 3) create(); }}
            placeholder="Business name shown in the demo"
            style={{ padding: "7px 10px", borderRadius: 7, fontSize: TYPE.sm, minWidth: 230,
              background: C.hi, color: C.txt, border: `1px solid ${C.bord}` }} />
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
              borderRadius: 7, padding: "7px 10px", fontSize: TYPE.sm }}>
            {[3, 7, 14, 30].map(d => <option key={d} value={d}>{d} days</option>)}
          </select>
          <button onClick={create} disabled={busy === "create" || name.trim().length < 3}
            style={{ padding: "7px 14px", borderRadius: 7, border: "none",
              background: name.trim().length < 3 ? C.bord : C.grn,
              color: name.trim().length < 3 ? C.dim : "#04120a",
              fontSize: TYPE.sm, fontWeight: 800,
              cursor: name.trim().length < 3 ? "not-allowed" : "pointer" }}>
            {busy === "create" ? "Creating…" : "Create demo"}
          </button>
          <span style={{ color: C.dim, fontSize: TYPE.xs }}>
            Created as <strong style={{ color: C.mid }}>[demo] name</strong>, trial plan, with a
            stamped expiry the scheduler enforces.
          </span>
        </div>
      </Card>

      {error && <Card style={{ borderColor: C.red + "55", marginBottom: SPACE.sm }}>
        <div style={{ color: C.red, fontSize: TYPE.sm }}>{error}</div></Card>}

      {loading ? <div style={{ color: C.dim, fontSize: TYPE.sm }}>Loading…</div>
        : rows.length === 0
        ? <Card><div style={{ color: C.dim, fontSize: TYPE.sm }}>
            No demo tenants. Anything created here is disposable by construction — the sweeper
            suspends it on its expiry date without anyone remembering to.
          </div></Card>
        : (
        <div style={{ display: "flex", flexDirection: "column", gap: SPACE.sm }}>
          {rows.map(d => (
            <Card key={d.id} hover>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" as const, alignItems: "center" }}>
                <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                  <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800 }}>{d.name}</div>
                  <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 3 }}>
                    {d.plan} · {d.status}
                    {d.demo_phone ? ` · ${d.demo_phone}` : ""}
                    {` · ${d.calls_total} call${d.calls_total === 1 ? "" : "s"}, ${d.minutes_used} min`}
                    {d.last_call_ist ? ` · last ${d.last_call_ist}` : " · never called"}
                  </div>
                </div>
                <div style={{ textAlign: "right" as const, minWidth: 150 }}>
                  <div style={{ color: d.expired ? C.red : C.txt, fontSize: TYPE.sm, fontWeight: 700 }}>
                    {d.expired ? "Expired" : "Expires"} {d.expires_in || "—"}
                  </div>
                  <div style={{ color: C.dim, fontSize: TYPE.xs }}>{d.expires_at_ist || "no expiry set"} IST</div>
                </div>
                {/* Past its date but not status 'trial': runExpireDemos filters
                    on status = 'trial', so this row will never be swept. */}
                {d.expired && !d.swept_by_scheduler &&
                  <Pill label="sweeper skips this" color={C.gold} />}
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select value={extend[d.id] || 7}
                    onChange={e => setExtend(p => ({ ...p, [d.id]: Number(e.target.value) }))}
                    style={{ background: C.bg, border: "1px solid " + C.bord, borderRadius: 6,
                      padding: "6px 8px", color: C.txt, fontSize: TYPE.xs }}>
                    {[3, 7, 14, 30].map(x => <option key={x} value={x}>+{x}d</option>)}
                  </select>
                  <button onClick={() => act(d.id, "extend")} disabled={busy === d.id + "extend"}
                    style={{ background: C.grn + "22", color: C.grn, border: "1px solid " + C.grn + "55",
                      borderRadius: 6, padding: "6px 12px", fontSize: TYPE.xs, fontWeight: 700,
                      cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <Timer size={12} /> {busy === d.id + "extend" ? "…" : "Extend"}
                  </button>
                  <button
                    onClick={() => {
                      // Suspends the tenant immediately — a demo in front of a
                      // prospect stops working the moment this is clicked.
                      if (window.confirm(`Expire ${d.name} now? It is suspended immediately.`))
                        act(d.id, "expire");
                    }}
                    disabled={busy === d.id + "expire" || d.status === "suspended"}
                    style={{ background: C.red + "18", color: d.status === "suspended" ? C.dim : C.red,
                      border: "1px solid " + C.red + "44", borderRadius: 6, padding: "6px 12px",
                      fontSize: TYPE.xs, fontWeight: 700,
                      cursor: d.status === "suspended" ? "not-allowed" : "pointer",
                      display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <Ban size={12} /> {busy === d.id + "expire" ? "…" : "Expire now"}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Platform Health — the page an operator opens at 9am.
 *
 * Operations answers "did the automations run last night". This answers the
 * other question: "is anything stuck right now, and since when". Every row
 * carries exactly three things — what is wrong, how long it has been wrong,
 * and the single action that fixes it. A row whose own query failed reads
 * "unknown", never green, because a check that breaks quietly is the fault
 * this board exists to catch.
 *
 * Read-only except for closing calls stuck 'active'. Requeueing a stuck
 * campaign recipient is deliberately not a button: it makes the dispatcher
 * ring a real person's phone.
 */
function PlatformHealthPanel({ token }: { token: string }) {
  const [data, setData]     = useState<any>(null);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState("");
  const [busy, setBusy]     = useState(false);
  const [open, setOpen]     = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoad(true); setError("");
    try {
      const r = await fetch(`${API}/api/admin/platform-health`, {
        headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (!r.ok) setError(j.error || `Failed (${r.status})`);
      else setData(j);
    } catch (e: any) { setError(e.message); }
    setLoad(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const closeStuck = async () => {
    if (!window.confirm("Close every call row stuck 'active' for over two hours? They are marked failed; no live call can be that old.")) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/admin/platform-health/close-stuck-calls`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ older_than_minutes: 120 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setError(j.error || `Failed (${r.status})`);
      else await load();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const tone = (s: string) =>
    s === "critical" ? C.red : s === "warn" ? C.gold : s === "unknown" ? C.dim : C.grn;

  const s = data?.summary || {};
  const groups: string[] = Array.from(new Set((data?.rows || []).map((r: any) => String(r.group))));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: SPACE.md,
        flexWrap: "wrap" as const }}>
        <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 900 }}>Platform health</div>
        {(s.critical || 0) > 0 && <Pill label={`${s.critical} critical`} color={C.red} />}
        {(s.warn || 0) > 0 && <Pill label={`${s.warn} needs attention`} color={C.gold} />}
        {(s.unknown || 0) > 0 && <Pill label={`${s.unknown} unknown`} color={C.dim} />}
        {!s.critical && !s.warn && !s.unknown && data && <Pill label="all clear" color={C.grn} />}
        <button onClick={load} style={{ marginLeft: "auto", background: "none",
          border: "1px solid " + C.bord, color: C.dim, borderRadius: 7,
          padding: "5px 11px", fontSize: TYPE.xs, cursor: "pointer" }}>Re-check</button>
      </div>

      {error && <Card style={{ borderColor: C.red + "55", marginBottom: SPACE.sm }}>
        <div style={{ color: C.red, fontSize: TYPE.sm }}>{error}</div></Card>}

      {loading && !data ? <div style={{ color: C.dim, fontSize: TYPE.sm }}>Checking…</div> : (
        <div>
          {groups.map(g => (
            <div key={g} style={{ marginBottom: SPACE.md }}>
              <div style={{ color: C.dim, fontSize: 10, fontWeight: 800, letterSpacing: "0.12em",
                textTransform: "uppercase" as const, marginBottom: SPACE.xs + 2 }}>{g}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: SPACE.sm }}>
                {(data?.rows || []).filter((r: any) => r.group === g).map((r: any) => (
                  <Card key={r.id} hover style={{
                    borderColor: r.severity === "ok" ? C.bord : tone(r.severity) + "55" }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" as const }}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                        background: tone(r.severity), marginTop: 6, flexShrink: 0,
                        boxShadow: r.severity === "ok" ? "none" : "0 0 8px " + tone(r.severity) }} />
                      <div style={{ flex: "1 1 340px", minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" as const }}>
                          <span style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 700 }}>{r.title}</span>
                          {/* Since when. A count without an age cannot tell a
                              backlog that is clearing from one that is stuck. */}
                          {r.since_label && <span style={{ color: tone(r.severity), fontSize: TYPE.xs,
                            fontWeight: 700 }}>{r.since_label}</span>}
                        </div>
                        <div style={{ color: C.mid, fontSize: TYPE.xs, marginTop: 4, lineHeight: 1.6 }}>
                          {r.detail}
                        </div>
                        {r.severity !== "ok" && (
                          <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 6, lineHeight: 1.6 }}>
                            <strong style={{ color: C.gbr }}>Fix:</strong> {r.action}
                          </div>
                        )}
                        {r.action_endpoint?.includes("close-stuck-calls") && (
                          <button onClick={closeStuck} disabled={busy}
                            style={{ marginTop: 8, background: C.gold + "18", color: C.gold,
                              border: "1px solid " + C.gold + "55", borderRadius: 6,
                              padding: "5px 12px", fontSize: TYPE.xs, fontWeight: 700, cursor: "pointer" }}>
                            {busy ? "Closing…" : "Close the ones over two hours"}
                          </button>
                        )}
                        {(r.items || []).length > 0 && (
                          <button onClick={() => setOpen(p => ({ ...p, [r.id]: !p[r.id] }))}
                            style={{ marginTop: 8, background: "none", border: "none", padding: 0,
                              color: C.gbr, fontSize: TYPE.xs, fontWeight: 700, cursor: "pointer" }}>
                            {open[r.id] ? "Hide" : `Show ${r.items.length}`}
                          </button>
                        )}
                        {open[r.id] && (
                          <div style={{ marginTop: 8 }}>
                            {r.items.map((it: any, i: number) => (
                              <div key={it.id || it.tenant_id || i}
                                style={{ display: "flex", gap: 10, flexWrap: "wrap" as const,
                                  padding: "5px 0", borderBottom: `1px solid ${C.bord}33`,
                                  fontSize: TYPE.xs, color: C.mid }}>
                                <span style={{ color: C.txt, fontWeight: 700, minWidth: 140 }}>
                                  {it.name || it.phone || it.to || it.caller || it.file_name || it.id?.slice(0, 8)}
                                </span>
                                {it.pct !== undefined &&
                                  <span style={{ color: it.blocked ? C.red : C.gold, fontWeight: 700 }}>
                                    {it.used}/{it.limit} min ({it.pct}%)
                                    {it.blocked ? " — not answering" : it.credits ? ` · ${it.credits} credit min left` : ""}
                                  </span>}
                                {it.doc_type && <span>{it.doc_type}</span>}
                                {it.type && <span>{it.type}</span>}
                                {it.window && <span>window {it.window}</span>}
                                {it.has_recipients_waiting && <span style={{ color: C.gold }}>recipients waiting</span>}
                                {it.plan && <span>{it.plan} · {it.status}</span>}
                                {it.since_label && <span style={{ marginLeft: "auto", color: C.dim }}>{it.since_label}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {r.count !== null && r.count !== undefined && (
                        <div style={{ color: tone(r.severity), fontSize: 20, fontWeight: 900 }}>{r.count}</div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
          {data?.generated_at_ist && (
            <div style={{ color: C.dim, fontSize: TYPE.xs }}>
              Checked {data.generated_at_ist} IST · day boundaries are IST, not UTC
            </div>
          )}
        </div>
      )}
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
  const [secretSet, setSecretSet] = useState<Record<string, boolean>>({});
  const [rzp, setRzp] = useState<Record<string, string>>({});
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  useEffect(() => {
    fetch(`${API_URL}/api/platform/config`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then((rows: any[]) => {
      const m: Record<string, string> = {};
      const secrets: Record<string, boolean> = {};
      // A secret comes back with an empty value and has_value — the API never
      // hands one out again once it is set (see SECRET_CONFIG_KEYS).
      for (const r of rows) { m[r.key] = r.value; if (r.is_secret) secrets[r.key] = !!r.has_value; }
      setCfg(m); setSecretSet(secrets);
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
      <PanelIntro icon={Settings}>
        Engines, URLs and global defaults, applied within a minute — no redeployment.
      </PanelIntro>

      {cfg["telephony_engine"] && cfg["telephony_engine"] !== "freeswitch" && (
        <div style={{ background: C.red + "14", border: "1px solid " + C.red + "44",
          borderRadius: 8, padding: "10px 14px", fontSize: TYPE.sm, color: C.red, marginBottom: 16,
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" as const }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: 1, minWidth: 220 }}>
            <AlertTriangle size={14} /> telephony_engine is "{cfg["telephony_engine"]}". Every click-to-call is refused until it is FreeSWITCH.
          </span>
          <button onClick={() => saveKey("telephony_engine", "freeswitch")}
            style={{ background: C.red, color: "#fff", border: "none", borderRadius: 7,
              padding: "6px 12px", fontSize: TYPE.sm, fontWeight: 700, cursor: "pointer" }}>
            Reset to FreeSWITCH
          </button>
        </div>
      )}

      <Card>
        {/* Payments. These three used to live only in infra/.env, so switching
            online payment on meant editing a file on the server and
            redeploying — and the platform ran for weeks with all three empty
            and no customer able to pay. Set here, they apply everywhere
            within a minute. A value set in the environment still wins. */}
        <Row label="Razorpay Key ID" desc={`Public key from Razorpay → Settings → API Keys. ${cfg["razorpay_key_id"] ? "" : "Not set — customers cannot pay."}`}>
          <input
            type="text" placeholder="rzp_live_…"
            defaultValue={cfg["razorpay_key_id"] || ""}
            onChange={e => setRzp(p => ({ ...p, razorpay_key_id: e.target.value }))}
            style={{ background: C.bg, color: C.txt, border: "1px solid " + C.bord, borderRadius: 8, padding: "7px 10px", fontSize: TYPE.sm, width: 260, fontFamily: "monospace" }}
          />
          <button onClick={() => saveKey("razorpay_key_id", (rzp["razorpay_key_id"] ?? cfg["razorpay_key_id"] ?? "").trim())}
            disabled={saving === "razorpay_key_id"}
            style={{ background: C.glow, color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: TYPE.xs, fontWeight: 700, cursor: "pointer" }}>
            {saving === "razorpay_key_id" ? "Saving…" : "Save"}
          </button>
        </Row>

        {([["razorpay_key_secret", "Razorpay Key Secret", "Shown by Razorpay once, when the key is created."],
           ["razorpay_webhook_secret", "Razorpay Webhook Secret", "From Razorpay → Settings → Webhooks. Without it, payment webhooks are refused."]] as const).map(([key, label, desc]) => (
          <Row key={key} label={label} desc={`${desc} ${secretSet[key] ? "Set — type a new value to replace it." : "Not set."}`}>
            <input
              type="password" placeholder={secretSet[key] ? "••••••••  (unchanged)" : "paste secret"}
              value={rzp[key] || ""}
              onChange={e => setRzp(p => ({ ...p, [key]: e.target.value }))}
              style={{ background: C.bg, color: C.txt, border: "1px solid " + C.bord, borderRadius: 8, padding: "7px 10px", fontSize: TYPE.sm, width: 260, fontFamily: "monospace" }}
            />
            <button
              onClick={async () => {
                const v = (rzp[key] || "").trim();
                if (!v) return;
                await saveKey(key, v);
                // Never keep it in the page after it is stored.
                setRzp(p => ({ ...p, [key]: "" }));
                setSecretSet(p => ({ ...p, [key]: true }));
              }}
              disabled={saving === key || !(rzp[key] || "").trim()}
              style={{ background: (rzp[key] || "").trim() ? C.glow : C.bord, color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: TYPE.xs, fontWeight: 700, cursor: (rzp[key] || "").trim() ? "pointer" : "not-allowed" }}>
              {saving === key ? "Saving…" : "Save"}
            </button>
          </Row>
        ))}

        <Row label="Morning Briefing" desc="08:30 IST WhatsApp/email to every owner: yesterday's calls, today's bookings, who to ring back. OFF stops it platform-wide, immediately.">
          <PillToggle
            options={[{ label: "ON", value: "on" }, { label: "OFF", value: "off" }]}
            value={cfg["morning_briefing"] || "on"}
            onChange={v => saveKey("morning_briefing", v)}
          />
        </Row>

        {/* Was a FreeSWITCH / Exotel toggle. The Exotel path was deleted from
            the API, and the click-to-call route refuses every call when this
            is anything but "freeswitch", so the toggle could only break
            calling. It is a fact now, not a choice. */}
        <Row label="Telephony Engine" desc="All calls run on FreeSWITCH over the Jio SIP trunk. Exotel was removed.">
          <Pill label="FreeSWITCH" color={C.grn} />
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
      // NOT .eq("status","active") — a tenant that just signed up is
      // 'trial', which is precisely who needs a number assigned. The filter
      // hid every new customer from the only dropdown that can give them one.
      sb.from("tenants").select("id, name, status")
        .in("status", ["trial", "active"]).order("name"),
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
    // Through the API, not a direct Supabase write. The direct path skipped
    // BOTH the plan-limit check (a Starter tenant could be handed a tenth
    // number from this screen while the Numbers screen refused) and
    // admin_audit_log — two panels disagreeing about the rules is worse
    // than either rule alone. The endpoint also auto-creates the voice
    // profile, which this path only warned about.
    const { data: didRow } = await sb.from("dids").select("number").eq("id", didId).single();
    if (!didRow) { alert("Number not found"); return; }
    const r = await fetch(`${API}/api/admin/dids/${didRow.number}/assign`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId }),
    });
    if (!r.ok) alert((await r.json()).error || "Assign failed");
    await loadFS();
  };

  // up/down is FreeSWITCH's ping verdict. The Jio trunk is IP-authenticated
  // and never registers, so registration state said nothing about it.
  // not_configured is a gateway that was never set up (Vi today): amber, not
  // red, so a real outage still stands out.
  const statusColor = (s: string) => s === "up" ? C.grn : s === "not_configured" ? C.gold : C.red;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ color: C.dim, fontSize: TYPE.sm }}>
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
      <div className="nk-2col" style={{ marginBottom: 20 }}>
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
          <Empty icon={Phone} title="No channels in use" hint="FreeSWITCH is idle: no call is on the trunk right now." />
        ) : (
          <div className="nk-scroll">
            <table className="nk-table">
              <thead>
                <tr>{["UUID", "Caller", "Called", "Direction", "Duration", ""].map(h => (
                  <th key={h}>{h}</th>
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
          </div>
        )}
      </Card>

      {/* DID Management */}
      <Card>
        <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800, marginBottom: 12 }}>DID Inventory</div>
        {loading ? <Loading rows={4} label="Loading numbers" /> : (
          <div className="nk-scroll">
            <table className="nk-table">
              <thead>
                <tr>{["Number", "Provider", "Tenant", "Routing", "Status", "Monthly Cost", "Action"].map(h => (
                  <th key={h}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {dids.map((did: any) => (
                  <tr key={did.id} style={{ borderBottom: "1px solid " + C.bord + "33" }}>
                    <td style={{ padding: "10px", color: C.txt, fontSize: TYPE.sm, fontWeight: 700 }}>{did.number}</td>
                    <td style={{ padding: "10px" }}><Pill label={did.provider} color={C.cyn} /></td>
                    <td style={{ padding: "10px", color: C.mid, fontSize: TYPE.sm }}>{did.tenants?.name || "—"}</td>
                    {/* Was a read-only pill, which meant NOTHING anywhere could
                        set routing_mode to 'ivr' — so the call menu a tenant
                        configures on /setup was collected, stored, and never
                        once consulted on a call. */}
                    <td style={{ padding: "10px" }}>
                      <select
                        value={did.routing_mode || "ai"}
                        onChange={async e => {
                          const mode = e.target.value;
                          const r = await fetch(`${API_URL}/api/admin/dids/${did.number}/routing`, {
                            method: "POST",
                            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                            body: JSON.stringify({ routing_mode: mode }),
                          });
                          if (!r.ok) alert((await r.json()).error || "Failed");
                          loadFS();
                        }}
                        style={{ background: C.hi, color: C.txt, border: `1px solid ${C.bord}`,
                          borderRadius: 6, padding: "4px 7px", fontSize: TYPE.xs, fontWeight: 700 }}>
                        {["ai", "ivr", "human", "hybrid"].map(m =>
                          <option key={m} value={m}>{m}</option>)}
                      </select>
                    </td>
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
          </div>
        )}
      </Card>

      <div style={{ height: SPACE.md }} />
      <TrunksCard token={token} />
    </div>
  );
}

// SIP trunk management — credential rotation was SQL-only. Passwords go up,
// never come back down: the list is metadata, and a rotate writes a fresh
// AES-256-GCM blob server-side.
function TrunksCard({ token }: { token: string }) {
  const [trunks, setTrunks] = useState<any[]>([]);
  const [pw, setPw] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    fetch(`${API}/api/admin/trunks`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(j => setTrunks(j.trunks || [])).catch(() => setTrunks([]));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  const patch = async (id: string, body: any) => {
    const r = await fetch(`${API}/api/admin/trunks/${id}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) alert((await r.json()).error || "Failed");
    load();
  };
  return (
    <Card>
      <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 800, marginBottom: 8 }}>SIP trunks</div>
      {trunks.length === 0 && <div style={{ color: C.dim, fontSize: TYPE.sm }}>No trunk rows.</div>}
      {trunks.map(t => (
        <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" as const,
          padding: "8px 0", borderBottom: `1px solid ${C.bord}33`, fontSize: TYPE.sm }}>
          <span style={{ color: C.txt, fontWeight: 700, minWidth: 130 }}>{t.display_name}</span>
          <span style={{ color: C.mid }}>{t.provider} · {t.host}:{t.port} · {t.transport} · p{t.priority}</span>
          <Pill label={t.status} color={t.status === "active" ? C.grn : t.status === "error" ? C.red : C.gold} />
          <select value={t.status}
            onChange={e => patch(t.id, { status: e.target.value })}
            style={{ background: C.hi, color: C.txt, border: `1px solid ${C.bord}`,
              borderRadius: 5, padding: "3px 6px", fontSize: TYPE.xs }}>
            {["active", "standby", "disabled"].map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          <input type="password" placeholder="new password" value={pw[t.id] || ""}
            onChange={e => setPw(v => ({ ...v, [t.id]: e.target.value }))}
            style={{ width: 130, padding: "4px 8px", borderRadius: 5, fontSize: TYPE.xs,
              background: C.hi, color: C.txt, border: `1px solid ${C.bord}` }} />
          <button disabled={!(pw[t.id] || "").trim()}
            onClick={() => { patch(t.id, { password: pw[t.id] }); setPw(v => ({ ...v, [t.id]: "" })); }}
            style={{ padding: "3px 10px", borderRadius: 5, fontSize: TYPE.xs, fontWeight: 700,
              background: "transparent", color: C.gold, border: `1px solid ${C.gold}66`,
              cursor: "pointer" }}>
            Rotate
          </button>
        </div>
      ))}
      <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 8 }}>
        Rotating a password stores it encrypted; FreeSWITCH gateway config is separate — reload after changing.
      </div>
    </Card>
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
    // Through the API so every price change lands in admin_audit_log.
    // Pricing edits were the one mutation in the panel with no paper trail —
    // and price history is the first thing a billing dispute asks for.
    for (const [planId, changes] of Object.entries(edited)) {
      const r = await fetch(`${API}/api/admin/plans/${planId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!r.ok) { alert((await r.json()).error || `Failed saving ${planId}`); break; }
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
          <div style={{ color: C.dim, fontSize: TYPE.sm }}>
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
          <div className="nk-scroll">
            <table className="nk-table">
              <thead>
                <tr>{["Plan", "Monthly (₹)", "Annual (₹)", "Minutes", "Max Profiles", "Max DIDs", "Concurrent", "Recording Days"].map(h => (
                  <th key={h}>{h}</th>
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
      <div className="nk-3col">
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

// ── OPS HELPERS ───────────────────────────────────────────
// Durations and "how long ago", in the words an operator reads at a glance.
function fmtSecs(total: number): string {
  const s = Math.max(0, Math.round(total || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
function agoText(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}
const pctText = (x: number) => `${Math.round((x || 0) * 100)}%`;

/** A usage bar that turns amber at 80% and red at the limit. */
function Meter({ used, limit, label }: { used: number; limit: number; label?: string }) {
  const pct = limit > 0 ? used / limit : 0;
  const color = pct >= 1 ? C.red : pct >= 0.8 ? C.gold : C.glow;
  return (
    <div style={{ minWidth: 140 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: TYPE.xs, marginBottom: 4 }}>
        <span style={{ color: C.txt, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {used.toLocaleString("en-IN")} <span style={{ color: C.dim, fontWeight: 500 }}>/ {limit.toLocaleString("en-IN")}</span>
        </span>
        <span style={{ color, fontWeight: 800 }}>{label ?? pctText(pct)}</span>
      </div>
      <div role="meter" aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit}
        style={{ height: 6, background: C.hi, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, pct * 100)}%`, height: "100%", background: color,
          borderRadius: 3, transition: "width .3s ease" }} />
      </div>
    </div>
  );
}

function useAdminJson<T = any>(token: string, path: string, refreshMs = 0) {
  const [data, setData]   = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j); setError(null);
    } catch (e: any) {
      setError(e?.message || "Request failed");
    } finally {
      setLoading(false);
    }
  }, [token, path]);
  useEffect(() => {
    setLoading(true);
    load();
    if (!refreshMs) return;
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);
  return { data, error, loading, reload: load };
}

// ── COMMAND CENTER ────────────────────────────────────────
// The top of the dashboard answers two questions before anything else:
// is something broken right now, and is there room on the phone line.
// Alerts are the watchdog's own open episodes, so this says exactly what
// the email said; capacity is the ledger every outbound call is admitted
// through, so "room for 2" is what the next click will actually be told.
function CommandCenter({ token }: { token: string }) {
  const { data, error } = useAdminJson<any>(token, "/api/admin/ops/command-center", 15000);
  const alerts: any[] | null = data?.alerts ?? null;
  const t = data?.trunk;

  return (
    <div className="nk-cc" style={{ marginBottom: 16 }}>
      {/* Alerts */}
      <Card style={{
        borderColor: alerts?.length ? (alerts.some(a => a.critical) ? C.red : C.gold) + "66" : C.bord,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Siren size={16} color={alerts?.length ? C.red : C.dim} />
            <span style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800 }}>Alerts</span>
          </div>
          <span style={{ color: C.dim, fontSize: TYPE.xs }}>
            {data?.watchdog_read_at ? `watchdog ${agoText(data.watchdog_read_at)}` : ""}
          </span>
        </div>

        {error && !data ? (
          <div style={{ color: C.dim, fontSize: TYPE.sm }}>Couldn't reach the API: {error}</div>
        ) : !data ? (
          <div style={{ color: C.dim, fontSize: TYPE.sm }}>Checking…</div>
        ) : alerts === null ? (
          <div style={{ color: C.gold, fontSize: TYPE.sm }}>Watchdog state is unreadable, so this cannot say all clear.</div>
        ) : alerts.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
            <div style={{ background: C.grn + "18", borderRadius: 10, padding: 8, display: "flex" }}>
              <CircleCheck size={20} color={C.grn} />
            </div>
            <div>
              <div style={{ color: C.txt, fontSize: TYPE.base, fontWeight: 800 }}>All systems normal</div>
              <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 2 }}>
                Trunk, pipeline, API, vendors, stuck calls and dead lines are checked every 15 minutes.
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {alerts.map(a => {
              const col = a.critical ? C.red : C.gold;
              return (
                <div key={a.id} style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 8,
                  background: col + "0F", borderLeft: `3px solid ${col}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
                      <span style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800 }}>{a.title}</span>
                      <Pill label={a.critical ? "critical" : "warning"} color={col} />
                      {!a.emailed && <Pill label="confirming" color={C.dim} />}
                    </div>
                    <div style={{ color: C.mid, fontSize: TYPE.xs, marginTop: 4 }}>
                      Since {agoText(a.since).replace(" ago", "")} · {a.detail}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Line capacity */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Radio size={16} color={C.glow} />
            <span style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800 }}>Jio line capacity</span>
          </div>
          {t && <Pill label={t.status === "up" ? "trunk up" : t.status === "down" ? "trunk down" : t.status}
                      color={t.status === "up" ? C.grn : t.status === "down" ? C.red : C.dim} />}
        </div>
        {!t ? (
          <div style={{ color: C.dim, fontSize: TYPE.sm }}>{error ? `Couldn't read: ${error}` : "Checking…"}</div>
        ) : (
          <>
            <ChannelStrip trunk={t} />
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 14, flexWrap: "wrap" as const }}>
              <span style={{ color: t.telecallers_fit > 0 ? C.txt : C.red, fontSize: TYPE.xl, fontWeight: 900, lineHeight: 1 }}>
                {t.telecallers_fit}
              </span>
              <span style={{ color: C.mid, fontSize: TYPE.sm }}>
                more telecaller call{t.telecallers_fit === 1 ? "" : "s"} fit right now
              </span>
            </div>
            <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 6 }}>
              {t.in_use} in use · {t.reserved} reserved · {t.outbound_free} outbound free ·
              {" "}{t.inbound_reserved} always kept for callers ringing in
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/** One cell per channel Jio sold: in use, reserved, free for outbound, and
 *  the pair outbound never touches. Read left to right like a fuel gauge. */
function ChannelStrip({ trunk }: { trunk: any }) {
  const cells: { kind: "use" | "res" | "free" | "inb"; }[] = [];
  const inUse = Math.min(trunk.in_use, trunk.channels);
  const res   = Math.min(trunk.reserved, Math.max(0, trunk.channels - inUse));
  for (let i = 0; i < trunk.channels; i++) {
    if (i < inUse) cells.push({ kind: "use" });
    else if (i < inUse + res) cells.push({ kind: "res" });
    else if (i < trunk.ceiling) cells.push({ kind: "free" });
    else cells.push({ kind: "inb" });
  }
  const style = (k: string): React.CSSProperties => ({
    use:  { background: C.glow, border: "1px solid " + C.glow },
    res:  { background: `repeating-linear-gradient(45deg, ${C.gold}55 0 4px, ${C.gold}22 4px 8px)`, border: "1px solid " + C.gold },
    free: { background: C.surf, border: "1px dashed " + C.glow + "88" },
    inb:  { background: `repeating-linear-gradient(-45deg, ${C.dim}33 0 3px, transparent 3px 7px)`, border: "1px solid " + C.bord },
  } as any)[k];
  const legend: [string, string][] = [["use", "In use"], ["res", "Reserved"], ["free", "Free (outbound)"], ["inb", "Kept for inbound"]];
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${trunk.channels}, minmax(0,1fr))`, gap: 4 }}
        aria-label={`${trunk.in_use} of ${trunk.channels} channels in use`}>
        {cells.map((c, i) => (
          <div key={i} title={legend.find(l => l[0] === c.kind)?.[1]}
            style={{ height: 26, borderRadius: 5, ...style(c.kind) }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" as const }}>
        {legend.map(([k, label]) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: C.dim, fontSize: TYPE.xs }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, ...style(k) }} />{label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── TELECALLERS ───────────────────────────────────────────
// Human seats compared against each other. "Conversation" is a call of 15 s
// or more: the log records the telecaller's leg and has no "customer
// answered" signal, so this is labelled as the threshold it is.
function TelecallersPanel({ token }: { token: string }) {
  const [days, setDays] = useState("7");
  const [tenant, setTenant] = useState("");
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    sb.from("tenants").select("id, name").order("name").then(({ data }) => setTenants(data || []));
  }, []);
  const path = `/api/admin/ops/telecallers?days=${days}${tenant ? `&tenant_id=${tenant}` : ""}`;
  const { data, error, loading } = useAdminJson<any>(token, path, 30000);
  const seats: any[] = data?.seats || [];
  const tot = data?.total || { calls: 0, conversations: 0, talk_seconds: 0, outcomes_logged: 0 };

  const series = (data?.series || []).map((d: any) => ({
    day: new Date(d.day + "T00:00:00").toLocaleDateString("en-IN", days === "30" ? { day: "numeric", month: "short" } : { weekday: "short" }),
    conversations: d.conversations,
    other: d.calls - d.conversations,
  }));

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" as const, marginBottom: 16 }}>
        <PillToggle options={[{ label: "Today", value: "1" }, { label: "7 days", value: "7" }, { label: "30 days", value: "30" }]}
          value={days} onChange={setDays} />
        <select value={tenant} onChange={e => setTenant(e.target.value)} aria-label="Tenant"
          style={{ background: C.surf, border: "1px solid " + C.bord, color: C.txt, borderRadius: 8,
            padding: "8px 10px", fontSize: TYPE.sm }}>
          <option value="">All tenants</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {loading && <span style={{ color: C.dim, fontSize: TYPE.xs }}>Loading…</span>}
      </div>

      {error && <Card style={{ borderColor: C.red + "55", marginBottom: 16 }}>
        <span style={{ color: C.red, fontSize: TYPE.sm }}>Couldn't load telecaller activity: {error}</span></Card>}

      <div className="nk-kpis" style={{ marginBottom: 16 }}>
        <KPI value={tot.calls} label="Calls placed" color={C.gbr} icon={Phone} />
        <KPI value={tot.calls ? pctText(tot.conversations / tot.calls) : "—"} label="Conversations (15s+)" color={C.grn} icon={Headphones} />
        <KPI value={fmtSecs(tot.talk_seconds)} label="Talk time" color={C.gold} icon={Clock} />
        <KPI value={tot.calls ? pctText(tot.outcomes_logged / tot.calls) : "—"} label="Outcomes logged" color={tot.calls && tot.outcomes_logged / tot.calls < 0.5 ? C.red : C.glow} icon={Check} />
      </div>

      {seats.length === 0 && !loading ? (
        <Card><Empty icon={Headphones} title="No telecaller calls in this period"
          hint="Calls placed with click-to-call from the Desk or Leads pages appear here." /></Card>
      ) : (
        <>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ color: C.txt, fontSize: TYPE.sm, fontWeight: 800, marginBottom: 12 }}>Calls per day</div>
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={series} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="day" tick={{ fill: C.mid, fontSize: TYPE.xs }} axisLine={false} tickLine={false}
                  interval={days === "30" ? 4 : 0} />
                <YAxis allowDecimals={false} tick={{ fill: C.mid, fontSize: TYPE.xs }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: C.hi, border: "1px solid " + C.bord, borderRadius: 8, fontSize: TYPE.sm }} />
                <Bar dataKey="conversations" name="Conversations" stackId="c" fill={C.glow} />
                <Bar dataKey="other" name="Under 15s" stackId="c" fill={C.dim + "66"} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card style={{ padding: 0 }}>
            <div className="nk-scroll">
              <table className="nk-table">
                <thead><tr>
                  <th>Telecaller</th><th>Tenant</th><th className="nk-num">Calls</th>
                  <th>Conversations</th><th className="nk-num">Avg call</th><th className="nk-num">Talk time</th>
                  <th className="nk-num">Days in</th><th className="nk-num">On shift</th><th className="nk-num">Calls / hr</th>
                  <th>Daily target</th><th>Outcomes logged</th><th>Last call</th>
                </tr></thead>
                <tbody>
                  {seats.map(s => {
                    const logged = s.calls ? s.outcomes_logged / s.calls : 0;
                    return (
                      <tr key={s.agent_user_id + s.tenant_id}>
                        <td>
                          <div style={{ color: C.txt, fontWeight: 700 }}>{s.name || `Seat …${s.phone_last4 || "????"}`}</div>
                          <div style={{ color: C.dim, fontSize: TYPE.xs }}>{s.role || "member"}{s.phone_last4 ? ` · …${s.phone_last4}` : ""}</div>
                        </td>
                        <td style={{ color: C.mid }}>{s.tenant || "—"}</td>
                        <td className="nk-num" style={{ fontWeight: 800 }}>{s.calls}</td>
                        <td><Meter used={s.conversations} limit={s.calls} label={pctText(s.conversation_rate)} /></td>
                        <td className="nk-num">{fmtSecs(s.avg_call_seconds)}</td>
                        <td className="nk-num">{fmtSecs(s.talk_seconds)}</td>
                        <td className="nk-num">{s.days_present ?? "—"}</td>
                        <td className="nk-num">{s.shift_seconds ? fmtSecs(s.shift_seconds) : "—"}</td>
                        <td className="nk-num" style={{ fontWeight: 800 }}>{s.calls_per_hour ?? "—"}</td>
                        <td style={{ color: C.mid, fontSize: TYPE.xs }}>
                          {s.target_calls || s.target_conversations
                            ? `${s.target_calls || 0} calls · ${s.target_conversations || 0} conv.`
                            : <span style={{ color: C.dim }}>not set</span>}
                        </td>
                        <td>
                          <span style={{ color: logged < 0.5 ? C.red : C.grn, fontWeight: 800 }}>{s.outcomes_logged}/{s.calls}</span>
                          {Object.keys(s.outcomes || {}).length > 0 && (
                            <span style={{ color: C.dim, fontSize: TYPE.xs, marginLeft: 8 }}>
                              {Object.entries(s.outcomes).map(([k, v]) => `${k} ${v}`).join(" · ")}
                            </span>
                          )}
                        </td>
                        <td style={{ color: C.mid }}>{agoText(s.last_call_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 10 }}>
            A conversation is a call of {data?.conversation_secs ?? 15}s or more. The log records the telecaller's
            leg, so this is a threshold rather than a confirmed answer; logged outcomes are the ground truth.
            {data?.truncated ? " Showing the most recent 5,000 calls." : ""}
            {" "}Hours come from Desk check-ins; calls per hour needs at least 10 minutes on shift.
            {data?.attendance_ready === false ? " Attendance is not set up yet: apply database migration 061." : ""}
          </div>
        </>
      )}
    </div>
  );
}

// ── USAGE & LIMITS ────────────────────────────────────────
// Who is about to hit a wall. Seats count people plus unaccepted invites and
// minutes come from the same gate that blocks calls, so a tenant shown with
// room here really can invite and dial.
function UsagePanel({ token }: { token: string }) {
  const { data, error, loading, reload } = useAdminJson<any>(token, "/api/admin/ops/usage", 60000);
  const rows: any[] = data?.tenants || [];
  const counts = rows.reduce((a, r) => ({ ...a, [r.level]: (a[r.level] || 0) + 1 }), {} as Record<string, number>);
  const levelPill = (l: string) => l === "over" ? <Pill label="at limit" color={C.red} />
    : l === "near" ? <Pill label="near limit" color={C.gold} /> : <Pill label="ok" color={C.grn} />;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" as const, marginBottom: 16 }}>
        {(["over", "near", "ok"] as const).map(l => (
          <Card key={l} style={{ padding: "10px 14px", flex: "1 1 150px" }}>
            <div style={{ color: C.dim, fontSize: TYPE.xs, textTransform: "uppercase" as const, letterSpacing: "0.1em" }}>
              {l === "over" ? "At limit or blocked" : l === "near" ? "Above 80%" : "Within limits"}
            </div>
            <div style={{ color: l === "over" ? C.red : l === "near" ? C.gold : C.grn, fontSize: TYPE.xl, fontWeight: 900 }}>
              {counts[l] || 0}
            </div>
          </Card>
        ))}
        <button onClick={reload} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none",
          border: "1px solid " + C.bord, color: C.mid, borderRadius: 8, padding: "8px 12px", fontSize: TYPE.sm, cursor: "pointer" }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {error && <Card style={{ borderColor: C.red + "55", marginBottom: 16 }}>
        <span style={{ color: C.red, fontSize: TYPE.sm }}>Couldn't load usage: {error}</span></Card>}

      <Card style={{ padding: 0 }}>
        <div className="nk-scroll">
          <table className="nk-table">
            <thead><tr>
              <th>Tenant</th><th>Plan</th><th>Seats</th><th>Minutes this month</th>
              <th className="nk-num">Credit min</th><th>Calling</th><th>Status</th>
            </tr></thead>
            <tbody>
              {loading && rows.length === 0 && <tr><td colSpan={7} style={{ color: C.dim }}>Loading…</td></tr>}
              {rows.map(r => (
                <tr key={r.tenant_id}>
                  <td>
                    <div style={{ color: C.txt, fontWeight: 700 }}>{r.name}</div>
                    {r.status !== "active" && <div style={{ color: C.dim, fontSize: TYPE.xs }}>{r.status}</div>}
                  </td>
                  <td><Pill label={r.plan_name || r.plan} color={r.plan === "trial" ? C.dim : C.gbr} /></td>
                  <td>
                    <Meter used={r.seats_used} limit={r.seat_limit} />
                    {r.seats_pending > 0 && <div style={{ color: C.dim, fontSize: TYPE.xs, marginTop: 3 }}>
                      incl. {r.seats_pending} pending invite{r.seats_pending === 1 ? "" : "s"}</div>}
                  </td>
                  <td>{r.minute_limit > 0
                    ? <Meter used={r.minutes_used} limit={r.minute_limit} />
                    : <span style={{ color: C.dim, fontSize: TYPE.xs }}>No plan allowance · runs on credits</span>}
                  </td>
                  <td className="nk-num">{Number(r.credits || 0).toLocaleString("en-IN")}</td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <StatusDot ok={r.can_call} />
                      <span style={{ color: r.can_call ? C.mid : C.red, fontSize: TYPE.xs }}>
                        {r.can_call ? "Can call" : r.blocked_reason === "plan_minutes_exhausted" ? "Minutes used up" : "No credits"}
                      </span>
                    </span>
                  </td>
                  <td>{levelPill(r.level)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
