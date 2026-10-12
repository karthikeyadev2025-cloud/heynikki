// components/Shell.tsx — Main dashboard shell with sidebar
"use client";
import { planLabel } from "../lib/plans";
import { useState, useEffect } from "react";
import { createClient } from "../lib/supabase";
import { forgetDevice } from "../lib/native";
import type { Tenant } from "../lib/supabase";
import {
  Radio, Phone, Users, Calendar, Megaphone, BarChart3,
  MessageCircle, Brain, Settings, CreditCard, ShieldCheck, Gauge, Headset, KeyRound, ShoppingBag, Menu, X, LogOut, ListTodo, Trophy, Activity } from "lucide-react";
import OwnerVoiceAssistant from "./OwnerVoiceAssistant";
import Toaster from "./Toast";
import ConfirmHost from "./Confirm";
import NikkiLogo from "./NikkiLogo";
import { NIKKI } from "../lib/brand";
import { useWaUnread } from "../lib/wa-notify";

const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  acc: NIKKI.terracotta, glow: NIKKI.teal, gbr: NIKKI.tealLight,
  gold: NIKKI.gold, grn: NIKKI.emerald, red: NIKKI.red,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

// Grouped by what the person came to do, not listed flat. `staff: true` is
// what a telecaller (member/support) sees: their Desk and the customer
// records they work from — not billing, keys or the owner's settings, which
// the API refuses them anyway.
const NAV_GROUPS: { title: string; items: { href: string; icon: any; label: string; staff?: boolean }[] }[] = [
  { title: "Front desk", items: [
    { href: "/dashboard",    icon: Radio,         label: "Reception" },
    { href: "/desk",         icon: Headset,       label: "Human Desk",   staff: true },
    { href: "/today",        icon: ListTodo,      label: "Today's Board", staff: true },
    { href: "/my-day",       icon: Trophy,        label: "My Dashboard",  staff: true },
  ]},
  { title: "Customers", items: [
    { href: "/calls",        icon: Phone,         label: "All Calls",    staff: true },
    { href: "/leads",        icon: Users,         label: "Leads",        staff: true },
    { href: "/appointments", icon: Calendar,      label: "Appointments", staff: true },
    { href: "/orders",       icon: ShoppingBag,   label: "Orders",       staff: true },
    { href: "/whatsapp",     icon: MessageCircle, label: "WhatsApp",     staff: true },
  ]},
  { title: "Grow", items: [
    { href: "/campaigns",    icon: Megaphone,     label: "Campaigns" },
    { href: "/analytics",    icon: BarChart3,     label: "Analytics" },
    { href: "/floor",        icon: Activity,      label: "Team Floor" },
    { href: "/quality",      icon: Gauge,         label: "Call Quality" },
  ]},
  { title: "Nikki", items: [
    { href: "/knowledge",    icon: Brain,         label: "Teach Nikki" },
    { href: "/setup",        icon: Settings,      label: "Setup" },
  ]},
  { title: "Account", items: [
    { href: "/verification", icon: ShieldCheck,   label: "Verification" },
    { href: "/billing",      icon: CreditCard,    label: "Billing" },
    { href: "/api-keys",     icon: KeyRound,      label: "API keys" },
  ]},
];


export default function Shell({ children, title }: { children: React.ReactNode; title?: string }) {
  const [tenant, setTenant]     = useState<Tenant | null>(null);
  const [me, setMe]             = useState<{ role: string; name: string; email: string } | null>(null);
  const [pathname, setPathname] = useState("/dashboard");
  const [sideOpen, setSideOpen] = useState(false);
  // Where this screen sits in the menu, for the top bar and the browser tab.
  const here = (() => {
    for (const g of NAV_GROUPS) for (const i of g.items) {
      if (pathname === i.href || pathname.startsWith(i.href + "/")) return { group: g.title, label: i.label };
    }
    return null;
  })();
  useEffect(() => {
    const name = here?.label || title;
    if (name) document.title = `${name} · HeyNikki`;
  }, [here?.label, title]);

  // Redeem a team invite as soon as there is a session to redeem it with.

  // Runs here rather than on one page because the invited person may land

  // anywhere — the verification link, a pasted link while already signed

  // in, or a second tab. Clearing the stored token and the query string

  // means a refresh cannot try twice.

  useEffect(() => {

    let token: string | null = null;

    try {

      token = new URLSearchParams(window.location.search).get("invite")

           || localStorage.getItem("nikki_invite");

    } catch {}

    if (!token) return;

    (async () => {

      const sb = createClient();

      const { data: { session } } = await sb.auth.getSession();

      if (!session) return;

      // A refused invite (used, expired, replaced, no free seat) used to be

      // swallowed here, and the person stayed in the empty business signup

      // gave them with no idea why. Say why.

      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/team/accept`, {

        method: "POST",

        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },

        body: JSON.stringify({ token }),

      }).catch(() => null);

      const j: any = r ? await r.json().catch(() => ({})) : {};

      if (!r) {

        // Network failure: keep the token so the next load tries again.

        window.alert("Couldn't join the team just now — check your connection. We'll try again when you reload.");

        return;

      }

      // "Already on this team" is a second tab or a reload, not a problem.

      if (!r.ok && !/already on this team/i.test(String(j.error || ""))) {

        window.alert(`Couldn't join the team: ${j.error || "the invite was refused."}`);

      }

      try { localStorage.removeItem("nikki_invite"); } catch {}

      const u = new URL(window.location.href);

      u.searchParams.delete("invite");

      window.history.replaceState({}, "", u.toString());

      window.location.reload();

    })();

  }, []);


  useEffect(() => {
    setPathname(window.location.pathname);
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = "/login"; return; }
      const { data: tu } = await sb
        .from("tenant_users")
        .select("tenant_id, role, display_name")
        .eq("user_id", data.user.id)
        .single();
      setMe({ role: (tu as any)?.role || "member", name: (tu as any)?.display_name || "", email: data.user.email || "" });
      if (tu) {
        const { data: t } = await sb
          .from("tenants")
          .select("*")
          .eq("id", tu.tenant_id)
          .single();
        setTenant(t);
      }
    });
  }, []);

  // Was a countdown on trial_ends_at — a date nothing in the product
  // enforces. What actually stops calls is the free-minute balance, so the
  // badge shows that instead of a clock that never strikes.
  const minsLeft = tenant?.credit_minutes != null
    ? Math.max(0, Math.round(Number(tenant.credit_minutes)))
    : null;

  const staff = me ? !["owner", "super_admin"].includes(me.role) : false;
  // A WhatsApp reply rings and is counted on every page, not only its own.
  const waUnread = useWaUnread(!!me);
  const who = me?.name || (me?.email ? me.email.split("@")[0] : "");
  const initials = (who || tenant?.name || "?").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  const signOut = async () => {
    await forgetDevice();          // the phone app's listener + token
    await createClient().auth.signOut();
    window.location.href = "/login";
  };

  // Under 900px the sidebar is off-canvas (see .nk-side in globals.css).
  const Sidebar = () => (
    <div className={"nk-side" + (sideOpen ? " open" : "")}>
      <div style={{ padding: "18px 18px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <a href={staff ? "/desk" : "/dashboard"} aria-label="HeyNikki home" style={{ display: "inline-block" }}>
          <NikkiLogo size={30} dark />
        </a>
        <button className="nk-burger" aria-label="Close menu" onClick={() => setSideOpen(false)}
          style={{ background: "none", border: 0, color: C.mid, padding: 4 }}><X size={18} /></button>
      </div>

      <nav className="nk-nav" aria-label="Sections">
        {NAV_GROUPS.map(g => {
          const items = g.items.filter(it => !staff || it.staff);
          if (!items.length) return null;
          return (
            <div key={g.title}>
              <div className="nk-navgroup">{g.title}</div>
              {items.map(item => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <a key={item.href} href={item.href} className="nk-navitem" onClick={() => setSideOpen(false)}
                    aria-current={active ? "page" : undefined}>
                    <Icon size={16} /><span>{item.label}</span>
                    {item.href === "/whatsapp" && waUnread > 0 && (
                      <span aria-label={`${waUnread} unread`} style={{ marginLeft: "auto", background: "#16A34A", color: "#fff",
                        borderRadius: 999, minWidth: 20, padding: "1px 6px", fontSize: 12, fontWeight: 700, textAlign: "center" }}>
                        {waUnread > 99 ? "99+" : waUnread}
                      </span>
                    )}
                  </a>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Who is signed in, for which business, and what is left to spend.
          "Free minutes" is what actually stops calls on a trial. */}
      {tenant && (
        <div className="nk-user">
          <span className="nk-avatar" aria-hidden>{initials}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 650, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {who || tenant.name}
            </div>
            <div style={{ fontSize: 12, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {tenant.status === "trial" && minsLeft !== null
                ? <a href="/billing" style={{ color: C.gold, fontWeight: 650 }}>{minsLeft} free min left · upgrade</a>
                : <>{tenant.name}{!staff && tenant.plan ? <> · <span>{planLabel(tenant.plan)}</span></> : null}</>}
            </div>
          </div>
          <button onClick={signOut} aria-label="Sign out" title="Sign out"
            style={{ background: "none", border: 0, color: C.dim, padding: 4, lineHeight: 0 }}>
            <LogOut size={16} />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="nk-shell" style={{ display: "flex", minHeight: "100vh", color: C.txt }}>
      <Sidebar />
      {sideOpen && <div className="nk-scrim" onClick={() => setSideOpen(false)} />}
      <div className="nk-main">
        <div className="nk-topbar" style={{
          height: 60, borderBottom: "1px solid #E4E9F0",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 32px", position: "sticky", top: 0, zIndex: 30, gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <button className="nk-burger" aria-label="Open menu" onClick={() => setSideOpen(true)}
              style={{ background: "#fff", border: "1px solid #E4E9F0", borderRadius: 8, color: C.txt, padding: 6, alignItems: "center" }}>
              <Menu size={18} />
            </button>
            {/* A trail, not a second heading: the page below carries the <h1>.
                Read from the menu, so the bar can never name a screen
                differently from the link that opened it. */}
            <div className="nk-title">
              {here ? <><span className="nk-crumb">{here.group}</span><span className="nk-crumb-sep">›</span>{here.label}</> : (title || "Dashboard")}
            </div>
          </div>
          <LineStatus />
        </div>
        <div className="nk-page fade-in">
          {children}
        </div>
      </div>
      {/* On a phone the four screens a person lives in are one thumb away;
          everything else is behind More, which opens the full menu. */}
      {me && (
        <nav className="nk-tabbar" aria-label="Main screens">
          {(staff
            ? [{ href: "/desk", icon: Headset, label: "Desk" }, { href: "/today", icon: ListTodo, label: "Today" },
               { href: "/leads", icon: Users, label: "Leads" }, { href: "/whatsapp", icon: MessageCircle, label: "WhatsApp" }]
            : [{ href: "/dashboard", icon: Radio, label: "Reception" }, { href: "/calls", icon: Phone, label: "Calls" },
               { href: "/leads", icon: Users, label: "Leads" }, { href: "/whatsapp", icon: MessageCircle, label: "WhatsApp" }]
          ).map(t => {
            const on = pathname === t.href || pathname.startsWith(t.href + "/");
            const Icon = t.icon;
            return (
              <a key={t.href} href={t.href} className="nk-tab" aria-current={on ? "page" : undefined}>
                <span style={{ position: "relative", lineHeight: 0 }}>
                  <Icon size={21} />
                  {t.href === "/whatsapp" && waUnread > 0 && <span className="nk-tab-dot" aria-label={`${waUnread} unread`}>{waUnread > 9 ? "9+" : waUnread}</span>}
                </span>
                <span>{t.label}</span>
              </a>
            );
          })}
          <button type="button" className="nk-tab" aria-label="More screens" onClick={() => setSideOpen(true)}>
            <Menu size={21} /><span>More</span>
          </button>
        </nav>
      )}
      <OwnerVoiceAssistant />
      <Toaster />
      <ConfirmHost />
    </div>
  );
}

/**
 * The promise, on every screen: is Nikki answering this business's number
 * right now — and while calls are running, how many. Green and breathing when
 * she is on the line; terracotta with the count while calls are live; the
 * team's own mode when the Desk has the phones.
 */
function LineStatus() {
  const [live, setLive] = useState(0);
  const [line, setLine] = useState<{ number: string; mode: string } | null>(null);
  useEffect(() => {
    const sb = createClient();
    // Tenant-scoped by RLS (tenant_read_own_dids). The published number is
    // the incoming-only one when the business has marked one (064).
    sb.from("dids").select("number, routing_mode, use_for_outbound").eq("status", "assigned").order("number")
      .then(({ data, error }) => {
        const rows = (data || []) as any[];
        if (error || !rows.length) return;
        const pick = rows.find(r => r.use_for_outbound === false) || rows[0];
        setLine({ number: String(pick.number), mode: String(pick.routing_mode || "ai") });
      });
    const fetchActive = async () => {
      const { count: c } = await sb.from("calls").select("*", { count: "exact", head: true }).eq("status", "active");
      setLive(c || 0);
    };
    fetchActive();
    const interval = setInterval(fetchActive, 5000);
    return () => clearInterval(interval);
  }, []);

  const pretty = (n: string) => n.length === 10 ? `${n.slice(0, 5)} ${n.slice(5)}` : n;
  if (live > 0) {
    return (
      <div className="nk-status" style={{ color: "#E5533D", background: "#E5533D12", borderColor: "#E5533D40" }} role="status">
        <span className="dot" style={{ background: "#E5533D" }} />
        {live} live call{live > 1 ? "s" : ""}
      </div>
    );
  }
  if (!line) return null;
  const team = line.mode === "human";
  const color = team ? "#12457A" : "#0E9F6E";
  return (
    <a href="/desk" className="nk-status" style={{ color, background: color + "10", borderColor: color + "33" }}
      title={team ? "Your team answers incoming calls — change it on the Human Desk" : "Nikki answers incoming calls — change it on the Human Desk"}>
      <span className="dot" style={{ background: color }} />
      <span className="nk-hide-mobile">{team ? "Team answering" : "Nikki answering"}</span>
      <span className="num">{pretty(line.number)}</span>
    </a>
  );
}
