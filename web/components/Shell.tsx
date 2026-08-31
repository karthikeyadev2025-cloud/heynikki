// components/Shell.tsx — Main dashboard shell with sidebar
"use client";
import { useState, useEffect } from "react";
import { createClient } from "../lib/supabase";
import type { Tenant } from "../lib/supabase";
import {
  Radio, Phone, Users, Calendar, Megaphone, BarChart3,
  MessageCircle, Brain, Settings, CreditCard, ShieldCheck, Gauge } from "lucide-react";
import OwnerVoiceAssistant from "./OwnerVoiceAssistant";
import NikkiLogo from "./NikkiLogo";
import { NIKKI } from "../lib/brand";

const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  acc: NIKKI.terracotta, glow: NIKKI.teal, gbr: NIKKI.tealLight,
  gold: NIKKI.gold, grn: NIKKI.emerald, red: NIKKI.red,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

const NAV_ITEMS = [
  { href: "/dashboard",   icon: Radio,         label: "Reception"   },
  { href: "/calls",       icon: Phone,         label: "All Calls"   },
  { href: "/leads",       icon: Users,         label: "Leads"       },
  { href: "/appointments",icon: Calendar,      label: "Appointments"},
  { href: "/campaigns",   icon: Megaphone,     label: "Campaigns"   },
  { href: "/analytics",   icon: BarChart3,     label: "Analytics"   },
  { href: "/quality",     icon: Gauge,         label: "Call Quality"},
  { href: "/whatsapp",    icon: MessageCircle, label: "WhatsApp"    },  // restored v4.0
  { href: "/knowledge",   icon: Brain,         label: "Teach Nikki" },
  { href: "/verification", icon: ShieldCheck,  label: "Verification" },
  { href: "/setup",       icon: Settings,      label: "Setup"       },
  { href: "/billing",     icon: CreditCard,    label: "Billing"     },
];


export default function Shell({ children, title }: { children: React.ReactNode; title?: string }) {
  const [tenant, setTenant]     = useState<Tenant | null>(null);
  const [pathname, setPathname] = useState("/dashboard");
  const [sideOpen, setSideOpen] = useState(false);

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

      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/team/accept`, {

        method: "POST",

        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },

        body: JSON.stringify({ token }),

      }).catch(() => {});

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
        .select("tenant_id")
        .eq("user_id", data.user.id)
        .single();
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

  const Sidebar = () => (
    <div style={{
      width: 220, background: C.surf, borderRight: "1px solid " + C.bord,
      display: "flex", flexDirection: "column", height: "100vh",
      position: "fixed", left: 0, top: 0, zIndex: 40,
    }}>
      {/* Logo — canonical NikkiLogo, same mark as the landing page and
          the favicon. This used to be a glowing green dot plus the bare
          word "Nikki", which shared nothing with the brand anywhere else
          on the site. */}
      <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid " + C.bord }}>
        <a href="/dashboard" aria-label="HeyNikki dashboard" style={{ textDecoration: "none", display: "inline-block" }}>
          <NikkiLogo size={30} dark />
        </a>
        {tenant && (
          <div style={{ color: C.dim, fontSize: 11, marginTop: 6 }}>
            {tenant.name}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto" }}>
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <a key={item.href} href={item.href} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "9px 10px", borderRadius: 8, marginBottom: 2,
              background: active ? C.glow + "33" : "transparent",
              border: "1px solid " + (active ? C.glow + "44" : "transparent"),
              color: active ? C.gbr : C.mid, fontSize: 13, fontWeight: active ? 700 : 400,
              transition: "all 0.15s",
            }}>
              <Icon size={16} />
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>

      {/* Trial / Plan badge */}
      {tenant && (
        <div style={{ padding: "12px 12px 16px", borderTop: "1px solid " + C.bord }}>
          {tenant.status === "trial" && minsLeft !== null ? (
            <div style={{ background: C.gold + "22", border: "1px solid " + C.gold + "44",
              borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ color: C.gold, fontSize: 11, fontWeight: 800 }}>{minsLeft} free minutes left</div>
              <a href="/billing" style={{ color: C.glow, fontSize: 11, display: "block", marginTop: 3 }}>
                Upgrade now →
              </a>
            </div>
          ) : (
            <div style={{ color: C.dim, fontSize: 11, padding: "4px 10px" }}>
              Plan: <span style={{ color: C.gbr, fontWeight: 700 }}>{tenant.plan}</span>
            </div>
          )}
        </div>
      )}

      {/* Logout */}
      <div style={{ padding: "0 8px 16px" }}>
        <button onClick={async () => {
          await createClient().auth.signOut();
          window.location.href = "/login";
        }} style={{
          width: "100%", background: "none", border: "1px solid " + C.bord,
          color: C.dim, borderRadius: 8, padding: "8px 0", fontSize: 12,
        }}>Sign Out</button>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      {/* Main content */}
      <div style={{ marginLeft: 220, flex: 1, minHeight: "100vh", background: C.bg }}>
        {/* Top bar */}
        <div style={{
          height: 56, borderBottom: "1px solid " + C.bord,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 24px", background: C.surf, position: "sticky", top: 0, zIndex: 30,
        }}>
          <div style={{ color: C.txt, fontSize: 16, fontWeight: 800 }}>{title || "Dashboard"}</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <LiveCallBadge />
            <div style={{ color: C.dim, fontSize: 12 }}>
              {tenant?.name || "Loading..."}
            </div>
          </div>
        </div>
        {/* Page */}
        <div style={{ padding: "24px", maxWidth: 1100 }} className="fade-in">
          {children}
        </div>
      </div>
      <OwnerVoiceAssistant />
    </div>
  );
}

function LiveCallBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const sb = createClient();
    const fetchActive = async () => {
      const { count: c } = await sb
        .from("calls")
        .select("*", { count: "exact", head: true })
        .eq("status", "active");
      setCount(c || 0);
    };
    fetchActive();
    const interval = setInterval(fetchActive, 5000);
    return () => clearInterval(interval);
  }, []);

  if (count === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6,
      background: C.grn + "22", border: "1px solid " + C.grn + "44",
      borderRadius: 20, padding: "4px 10px", fontSize: 11, color: C.grn }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.grn,
        animation: "pulse 2s infinite" }} />
      {count} live call{count > 1 ? "s" : ""}
    </div>
  );
}
