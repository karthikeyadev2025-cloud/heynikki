// components/Shell.tsx — Main dashboard shell with sidebar
"use client";
import { useState, useEffect } from "react";
import { createClient } from "../lib/supabase";
import type { Tenant } from "../lib/supabase";

const C = {
  bg:"#07070D", surf:"#0F0F1A", hi:"#161625", bord:"#1E1E35",
  acc:"#6D28D9", glow:"#8B5CF6", gbr:"#A78BFA",
  gold:"#F59E0B", grn:"#10B981", red:"#EF4444",
  txt:"#EEEEFF", mid:"#8888AA", dim:"#44445A",
};

const NAV_ITEMS = [
  { href: "/dashboard",   icon: "📟", label: "Reception"   },
  { href: "/calls",       icon: "📞", label: "All Calls"   },
  { href: "/leads",       icon: "👥", label: "Leads"       },
  { href: "/appointments",icon: "📅", label: "Appointments"},
  { href: "/campaigns",   icon: "📢", label: "Campaigns"   },
  { href: "/analytics",   icon: "📊", label: "Analytics"   },
  // "/whatsapp" was listed here but web/app/whatsapp/ does not exist --
  // clicking it produced a 404. Removed 2026-07-24; restore when the page
  // is actually built (WhatsApp isn't wired to the call pipeline yet either).
  { href: "/knowledge",   icon: "🧠", label: "Teach Nikki" },
  { href: "/setup",       icon: "⚙️",  label: "Setup"       },
  { href: "/billing",     icon: "💳", label: "Billing"     },
];

export default function Shell({ children, title }: { children: React.ReactNode; title?: string }) {
  const [tenant, setTenant]     = useState<Tenant | null>(null);
  const [pathname, setPathname] = useState("/dashboard");
  const [sideOpen, setSideOpen] = useState(false);

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

  const daysLeft = tenant?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86400000))
    : null;

  const Sidebar = () => (
    <div style={{
      width: 220, background: C.surf, borderRight: "1px solid " + C.bord,
      display: "flex", flexDirection: "column", height: "100vh",
      position: "fixed", left: 0, top: 0, zIndex: 40,
    }}>
      {/* Logo */}
      <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid " + C.bord }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.glow,
            boxShadow: "0 0 8px " + C.glow, flexShrink: 0 }} />
          <span style={{ color: C.txt, fontSize: 15, fontWeight: 900 }}>Nikki</span>
        </div>
        {tenant && (
          <div style={{ color: C.dim, fontSize: 11, marginTop: 4, paddingLeft: 16 }}>
            {tenant.name}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto" }}>
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <a key={item.href} href={item.href} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "9px 10px", borderRadius: 8, marginBottom: 2,
              background: active ? C.glow + "33" : "transparent",
              border: "1px solid " + (active ? C.glow + "44" : "transparent"),
              color: active ? C.gbr : C.mid, fontSize: 13, fontWeight: active ? 700 : 400,
              transition: "all 0.15s",
            }}>
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>

      {/* Trial / Plan badge */}
      {tenant && (
        <div style={{ padding: "12px 12px 16px", borderTop: "1px solid " + C.bord }}>
          {tenant.status === "trial" && daysLeft !== null ? (
            <div style={{ background: C.gold + "22", border: "1px solid " + C.gold + "44",
              borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ color: C.gold, fontSize: 11, fontWeight: 800 }}>Trial — {daysLeft} days left</div>
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
