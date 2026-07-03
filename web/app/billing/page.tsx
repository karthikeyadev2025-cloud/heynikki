// app/billing/page.tsx
"use client";
import { useState, useEffect } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import type { Tenant, CallMinutes } from "../../lib/supabase";

const C = {
  surf:"#0F0F1A", hi:"#161625", bord:"#1E1E35",
  glow:"#8B5CF6", gbr:"#A78BFA", gold:"#F59E0B",
  grn:"#10B981", red:"#EF4444", txt:"#EEEEFF", mid:"#8888AA", dim:"#44445A",
};

const PLANS = [
  {
    id: "starter", name: "Starter", price: 1999, annual: 1599,
    minutes: 200, profiles: 1, numbers: 1, concurrent: 2,
    color: C.mid,
    features: ["Telugu + Tanglish AI","Inbound reception","Recordings 90 days","WhatsApp automation","Appointment booking"],
  },
  {
    id: "growth", name: "Growth", price: 4999, annual: 3999,
    minutes: 600, profiles: 3, numbers: 3, concurrent: 5,
    color: C.gbr, popular: true,
    features: ["Everything in Starter","3 voice profiles","Outbound campaigns","Advanced analytics","Recordings 1 year"],
  },
  {
    id: "scale", name: "Scale", price: 9999, annual: 7999,
    minutes: 1500, profiles: 10, numbers: 10, concurrent: 15,
    color: C.gold,
    features: ["Everything in Growth","10 voice profiles","API access + webhooks","Team members (5 seats)","Custom integrations"],
  },
];

function UsageRing({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const r = 40, circ = 2 * Math.PI * r;
  const dash = circ * (pct / 100);
  const color = pct > 90 ? C.red : pct > 70 ? C.gold : C.grn;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <svg width={100} height={100}>
        <circle cx={50} cy={50} r={r} fill="none" stroke={C.hi} strokeWidth={10} />
        <circle cx={50} cy={50} r={r} fill="none" stroke={color} strokeWidth={10}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          style={{ transition: "stroke-dasharray 0.5s ease" }} />
        <text x={50} y={46} textAnchor="middle" fill={color} fontSize={16} fontWeight={900}>{pct}%</text>
        <text x={50} y={60} textAnchor="middle" fill={C.dim} fontSize={9}>used</text>
      </svg>
      <div>
        <div style={{ color: C.txt, fontSize: 16, fontWeight: 900 }}>
          {Math.round(used / 60)}
          <span style={{ color: C.mid, fontSize: 12, fontWeight: 400 }}> / {Math.round(total / 60)} min</span>
        </div>
        <div style={{ color: C.mid, fontSize: 12, marginTop: 4 }}>This month</div>
        <div style={{ color: C.dim, fontSize: 11, marginTop: 2 }}>
          {Math.max(0, Math.round((total - used) / 60))} minutes remaining
        </div>
      </div>
    </div>
  );
}

export default function BillingPage() {
  const [tenant, setTenant]   = useState<Tenant | null>(null);
  const [usage, setUsage]     = useState<CallMinutes | null>(null);
  const [annual, setAnnual]   = useState(false);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = "/login"; return; }
      const { data: tu } = await sb.from("tenant_users")
        .select("tenant_id").eq("user_id", data.user.id).single();
      if (!tu) return;
      const [{ data: t }, { data: u }] = await Promise.all([
        sb.from("tenants").select("*").eq("id", tu.tenant_id).single(),
        sb.from("call_minutes").select("*").eq("tenant_id", tu.tenant_id)
          .eq("month", new Date().toISOString().slice(0, 7)).single(),
      ]);
      setTenant(t);
      setUsage(u);
      setLoading(false);
    });
  }, []);

  const handleUpgrade = async (planId: string) => {
    setUpgrading(planId);
    // In production: POST /api/billing/create-subscription → Razorpay checkout
    const plan = PLANS.find(p => p.id === planId);
    if (!plan) return;
    const amount = annual ? plan.annual * 12 * 100 : plan.price * 100;

    const options = {
      key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "rzp_test_placeholder",
      amount,
      currency: "INR",
      name: "Nikki",
      description: `${plan.name} Plan — ${annual ? "Annual" : "Monthly"}`,
      prefill: { email: "", contact: "" },
      theme: { color: C.glow },
      handler: async (response: any) => {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return;
        // Verify on server in production
        alert(`Payment successful! Plan upgraded to ${plan.name}. Refreshing...`);
        window.location.reload();
      },
    };

    if (typeof window !== "undefined" && (window as any).Razorpay) {
      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } else {
      alert("Razorpay not loaded. Add <script src='https://checkout.razorpay.com/v1/checkout.js'></script> to your layout.");
    }
    setUpgrading(null);
  };

  const daysLeft = tenant?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86400000))
    : null;

  return (
    <Shell title="Billing">
      <script src="https://checkout.razorpay.com/v1/checkout.js" async />

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: C.mid }}>Loading billing...</div>
      ) : (
        <>
          {/* Current plan + usage */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <div style={{ background: C.surf, border: "1px solid " + C.bord, borderRadius: 10, padding: 20 }}>
              <div style={{ color: C.mid, fontSize: 11, textTransform: "uppercase",
                letterSpacing: "0.1em", marginBottom: 10 }}>Current Plan</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ color: C.txt, fontSize: 22, fontWeight: 900, textTransform: "capitalize" }}>
                  {tenant?.plan || "Trial"}
                </span>
                {tenant?.status === "trial" && (
                  <span style={{ background: C.gold + "22", color: C.gold,
                    border: "1px solid " + C.gold + "44", borderRadius: 4,
                    padding: "2px 8px", fontSize: 10, fontWeight: 800 }}>
                    TRIAL — {daysLeft} days left
                  </span>
                )}
              </div>
              <a href="#plans" style={{ color: C.glow, fontSize: 13, fontWeight: 700 }}>
                Upgrade plan →
              </a>
            </div>

            <div style={{ background: C.surf, border: "1px solid " + C.bord, borderRadius: 10, padding: 20 }}>
              <div style={{ color: C.mid, fontSize: 11, textTransform: "uppercase",
                letterSpacing: "0.1em", marginBottom: 10 }}>Minutes Usage</div>
              {usage ? (
                <UsageRing used={usage.used_seconds} total={usage.plan_limit_seconds} />
              ) : (
                <div style={{ color: C.dim, fontSize: 12 }}>No usage data yet</div>
              )}
            </div>
          </div>

          {/* Plans */}
          <div id="plans">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ color: C.txt, fontSize: 14, fontWeight: 800 }}>Choose a Plan</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: C.mid, fontSize: 12 }}>Monthly</span>
                <button onClick={() => setAnnual(!annual)} style={{
                  width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
                  background: annual ? C.glow : C.bord, position: "relative",
                }}>
                  <span style={{
                    position: "absolute", top: 2, left: annual ? 20 : 2,
                    width: 18, height: 18, borderRadius: "50%", background: "#fff",
                    transition: "left 0.2s",
                  }} />
                </button>
                <span style={{ color: C.mid, fontSize: 12 }}>Annual <span style={{ color: C.grn, fontWeight: 700 }}>-20%</span></span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
              {PLANS.map(plan => {
                const isCurrent = tenant?.plan === plan.id;
                const price = annual ? plan.annual : plan.price;
                return (
                  <div key={plan.id} style={{
                    background: C.surf,
                    border: "1px solid " + (plan.popular ? C.glow : isCurrent ? C.grn : C.bord),
                    borderRadius: 10, padding: 18, position: "relative",
                  }}>
                    {plan.popular && !isCurrent && (
                      <div style={{ position: "absolute", top: -10, left: "50%",
                        transform: "translateX(-50%)", background: C.glow, color: "#fff",
                        fontSize: 9, fontWeight: 800, padding: "2px 12px", borderRadius: 20,
                        whiteSpace: "nowrap" }}>MOST POPULAR</div>
                    )}
                    {isCurrent && (
                      <div style={{ position: "absolute", top: -10, left: "50%",
                        transform: "translateX(-50%)", background: C.grn, color: "#fff",
                        fontSize: 9, fontWeight: 800, padding: "2px 12px", borderRadius: 20,
                        whiteSpace: "nowrap" }}>CURRENT PLAN</div>
                    )}
                    <div style={{ color: plan.color, fontSize: 14, fontWeight: 900, marginBottom: 6 }}>
                      {plan.name}
                    </div>
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ color: C.txt, fontSize: 22, fontWeight: 900 }}>₹{price.toLocaleString()}</span>
                      <span style={{ color: C.dim, fontSize: 11 }}>/mo</span>
                    </div>
                    <div style={{ color: C.dim, fontSize: 10, marginBottom: 14 }}>
                      {plan.minutes} mins · {plan.profiles} profile{plan.profiles > 1 ? "s" : ""} · {plan.numbers} number{plan.numbers > 1 ? "s" : ""}
                    </div>
                    {plan.features.map(f => (
                      <div key={f} style={{ display: "flex", gap: 6, marginBottom: 5 }}>
                        <span style={{ color: C.grn, fontSize: 11 }}>✓</span>
                        <span style={{ color: C.mid, fontSize: 11 }}>{f}</span>
                      </div>
                    ))}
                    <button onClick={() => !isCurrent && handleUpgrade(plan.id)}
                      disabled={isCurrent || upgrading === plan.id}
                      style={{
                        width: "100%", marginTop: 14,
                        background: isCurrent ? C.grn + "22" : plan.popular ? C.glow : "transparent",
                        color: isCurrent ? C.grn : plan.popular ? "#fff" : C.gbr,
                        border: "1px solid " + (isCurrent ? C.grn : plan.popular ? C.glow : C.bord),
                        borderRadius: 7, padding: "9px 0", fontSize: 12, fontWeight: 700,
                        opacity: (isCurrent || upgrading === plan.id) ? 0.7 : 1,
                      }}>
                      {isCurrent ? "Current Plan" : upgrading === plan.id ? "Opening..." : `Upgrade to ${plan.name}`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ textAlign: "center", marginTop: 14, color: C.dim, fontSize: 11 }}>
            All plans include 14-day free trial · Overage: ₹15/extra minute · Cancel anytime
          </div>
        </>
      )}
    </Shell>
  );
}
