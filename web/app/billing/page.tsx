// app/billing/page.tsx
"use client";
import { useState, useEffect } from "react";
import Script from "next/script";
import { toast } from "../../components/Toast";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import type { Tenant, CallMinutes } from "../../lib/supabase";
import { NIKKI } from "../../lib/brand";
import { Check } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: NIKKI.gold,
  grn: NIKKI.emerald, red: NIKKI.red, txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

// Concurrency can never exceed what the trunk physically carries. The Jio
// circuit is 10 channels TOTAL across the whole platform, so a plan
// advertising more than that is a promise no amount of software can keep.
// Raise these only after buying channels, not before.
// Prices and caps here are a FALLBACK: the live catalogue comes from
// /api/platform/pricing (the plans table), and these literals only render if
// the API is unreachable — never edit them to change a price.
// The `features` bullets are NOT a fallback: they are shown for every tier
// even when the API answers, so they must say what the pricing page says.
// "Custom integrations" sat on Scale here while /pricing quotes them
// separately, and "Advanced analytics" was never a plan feature.
const PLANS_FALLBACK = [
  /* "Pay as you go" was removed: the checkout endpoint rejects the id with
     400 "Invalid plan" because no such row exists in `plans`, so the
     left-most, most prominent card on this page was a dead end for every
     customer who pressed it. Offer it again when it exists end to end. */
  {
    id: "starter", name: "Starter", price: 1999, annual: 1333,
    minutes: 200, profiles: 1, seats: 1, numbers: 1, concurrent: 2,
    color: C.mid,
    features: ["Telugu, Hindi or English","Inbound reception on your number","Appointments & WhatsApp confirmations","Telecaller Desk & call summaries","Recordings 90 days"],
  },
  {
    id: "growth", name: "Growth", price: 4999, annual: 3333,
    minutes: 600, profiles: 3, seats: 3, numbers: 3, concurrent: 5,
    color: C.gbr, popular: true,
    features: ["Everything in Starter","Team members (3 seats)","Outbound campaigns","3 voice profiles","Recordings 1 year"],
  },
  {
    id: "scale", name: "Scale", price: 9999, annual: 6666,
    minutes: 1500, profiles: 10, seats: 10, numbers: 10, concurrent: 10,
    color: C.gold,
    features: ["Everything in Growth","Team members (10 seats)","API access + webhooks","10 voice profiles","Priority support on WhatsApp"],
  },
];

// `used` and `total` are MINUTES. `period` says what the allowance is —
// "This month" for a plan tier, "Free trial" for a credit balance, which is
// a lifetime pool and not a monthly one. A trial tenant has no plan row and
// no call_minutes row, so this used to read "0% · 0 / 0 min · 0 minutes
// remaining" for every new account.
function UsageRing({ used, total, period }: { used: number; total: number; period: string }) {
  const hasTotal = total > 0;
  const pct = hasTotal ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const r = 40, circ = 2 * Math.PI * r;
  const dash = circ * (pct / 100);
  const color = !hasTotal ? C.mid : pct > 90 ? C.red : pct > 70 ? C.gold : C.grn;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <svg width={100} height={100}>
        <circle cx={50} cy={50} r={r} fill="none" stroke="#EEF2F6" strokeWidth={10} />
        <circle cx={50} cy={50} r={r} fill="none" stroke={color} strokeWidth={10}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          style={{ transition: "stroke-dasharray 0.5s ease" }} />
        {hasTotal ? (
          <>
            <text x={50} y={48} textAnchor="middle" fill={C.txt} fontSize={18} fontWeight={700}>{pct}%</text>
            <text x={50} y={62} textAnchor="middle" fill={C.dim} fontSize={10}>used</text>
          </>
        ) : (
          <>
            <text x={50} y={48} textAnchor="middle" fill={C.txt} fontSize={18} fontWeight={700}>{used}</text>
            <text x={50} y={62} textAnchor="middle" fill={C.dim} fontSize={10}>min used</text>
          </>
        )}
      </svg>
      <div>
        <div style={{ color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
          {used}
          <span style={{ color: C.mid, fontFamily: "var(--font-body), sans-serif", fontSize: 14, fontWeight: 500, letterSpacing: 0 }}>
            {hasTotal ? ` / ${total} min` : " min"}
          </span>
        </div>
        <div style={{ color: C.mid, fontSize: 13.5, marginTop: 4 }}>{period}</div>
        {hasTotal && (
          <div style={{ color: C.dim, fontSize: 12.5, marginTop: 2 }}>
            {Math.max(0, total - used)} minutes remaining
          </div>
        )}
      </div>
    </div>
  );
}

const PAID_PLANS = ["starter", "growth", "scale"];

export default function BillingPage() {
  const [PLANS, setPlans]     = useState<any[]>(PLANS_FALLBACK);
  const [tenant, setTenant]   = useState<Tenant | null>(null);
  // Paid plans: this month's call seconds vs the plan allowance.
  const [usage, setUsage]     = useState<CallMinutes | null>(null);
  // Trial: minutes granted and spent, from credit_ledger — the table the
  // deduction on every hangup actually writes to. `granted` is the sum of
  // positive rows (the 100-minute signup grant plus any admin top-ups), so
  // the allowance is read, not assumed.
  const [trial, setTrial]     = useState<{ granted: number; spent: number } | null>(null);
  const [annual, setAnnual]   = useState(false);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);

  // Pull the live catalogue so this page and the voice agent quote the same
  // numbers. Falls back silently to the literals above — a pricing page that
  // fails to render is worse than one a few minutes stale.
  useEffect(() => {
    fetch(`${API_URL}/api/platform/pricing`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d?.tiers?.length) return;
        const rupees = (x: number) => Math.round((Number(x) || 0) / 100);
        const tiers = d.tiers.map((t: any, i: number) => ({
          id: t.id, name: t.name,
          price:  rupees(t.monthly_paise),
          // The real annual figure from the plans table. This used to be
          // monthly x 0.8, which quietly disagreed with the row a customer
          // is actually charged from whenever the two were not exactly -20%.
          annual: t.annual_paise ? Math.round(rupees(t.annual_paise) / 12) : Math.round(rupees(t.monthly_paise) * 0.8),
          minutes: t.minutes,
          // profiles: t.seats was a straight mix-up of two different caps.
          // Growth has 3 voice profiles and 3 seats; Scale has 10 and 10.
          // Reading seats into profiles made this page tell a Scale customer
          // they got 5 of something, which was true of neither.
          profiles: t.profiles ?? 1,
          seats: t.seats ?? 1,
          numbers: t.numbers, concurrent: t.concurrent,
          color: [C.mid, C.gbr, C.gold][i] || C.mid,
          popular: i === 1,
          features: (PLANS_FALLBACK.find((p: any) => p.id === t.id)?.features || [])
            // Any hardcoded seat line is replaced with the number this tier
            // actually grants, so the page cannot drift from the plans table
            // again the moment someone edits a seat cap.
            .map((f: string) => /seat/i.test(f)
              ? `Team members (${t.seats ?? 1} seat${(t.seats ?? 1) === 1 ? "" : "s"})`
              : f),
        }));
        setPlans(tiers);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = "/login"; return; }
      const { data: tu } = await sb.from("tenant_users")
        .select("tenant_id").eq("user_id", data.user.id).single();
      if (!tu) return;
      const [{ data: t }, { data: monthCalls }, { data: u }, { data: ledger }] = await Promise.all([
        sb.from("tenants").select("*").eq("id", tu.tenant_id).single(),
        // call_minutes.used_seconds is a counter nothing increments — this
        // ring read empty for every customer forever. The month's calls are
        // the source of truth; the row is still read for plan_limit_seconds.
        sb.from("calls").select("duration_seconds").eq("tenant_id", tu.tenant_id)
          .gte("created_at", new Date().toISOString().slice(0, 7) + "-01T00:00:00"),
        sb.from("call_minutes").select("*").eq("tenant_id", tu.tenant_id)
          .eq("month", new Date().toISOString().slice(0, 7)).maybeSingle(),
        // RLS policy credit_ledger_select_own lets a tenant read its own rows.
        sb.from("credit_ledger").select("delta").eq("tenant_id", tu.tenant_id),
      ]);
      setTenant(t);
      setUsage({
        used_seconds: (monthCalls || [])
          .reduce((sum: number, c: any) => sum + (c.duration_seconds || 0), 0),
        // Only the call_minutes row is known here; the plan tier's allowance
        // comes from the live pricing catalogue and is resolved at render.
        plan_limit_seconds: u?.plan_limit_seconds ?? 0,
      });
      const rows = (ledger || []) as { delta: number | string }[];
      setTrial({
        granted: rows.reduce((s, r) => s + Math.max(0, Number(r.delta) || 0), 0),
        spent:   rows.reduce((s, r) => s + Math.max(0, -(Number(r.delta) || 0)), 0),
      });
      setLoading(false);
    });
  }, []);

  const handleUpgrade = async (planId: string) => {
    setUpgrading(planId);
    try {
      const plan = PLANS.find(p => p.id === planId);
      if (!plan) return;

      if (typeof window === "undefined" || !(window as any).Razorpay) {
        toast.err("Payment system is still loading — please try again in a moment.");
        return;
      }

      const sb = createClient();
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { window.location.href = "/login"; return; }

      // STEP 1 — create a real order server-side.
      // Previously the amount was computed in the browser and no order was
      // ever created, which meant Razorpay had nothing to reconcile against.
      // Amounts live on the server (api-server/src/index.ts planAmounts) so
      // a tampered client can't pay ₹1 for the Scale plan.
      const createRes = await fetch(`${API_URL}/api/billing/create-subscription`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ plan_id: planId, annual }),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        toast.err(err.error || "Could not start checkout. Please try again.");
        return;
      }
      const order = await createRes.json();

      // STEP 2 — open Razorpay checkout against that real order.
      const rzp = new (window as any).Razorpay({
        key:      order.key_id,
        order_id: order.order_id,
        amount:   order.amount,
        currency: order.currency,
        name:        "Hey Nikki",
        description: `${plan.name} plan — ${annual ? "annual" : "monthly"}`,
        theme: { color: C.glow },
        // STEP 3 — verify server-side before granting anything.
        // The old code simply alert()ed "Payment successful!" and reloaded,
        // trusting the browser. Anyone could have called that handler
        // directly and upgraded themselves for free. /api/billing/verify
        // recomputes the HMAC signature with the Razorpay secret (which
        // never leaves the server) and only then updates the plan.
        handler: async (response: any) => {
          const verifyRes = await fetch(`${API_URL}/api/billing/verify`, {
            method:  "POST",
            headers: {
              "Content-Type":  "application/json",
              "Authorization": `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature,
              plan_id:             planId,
            }),
          });
          if (verifyRes.ok) {
            window.location.reload();
          } else {
            // Money may still have been captured -- Razorpay's webhook is the
            // backstop and will reconcile. Never silently swallow this.
            alert(
              "Payment went through but we couldn't confirm it automatically. " +
              "Please contact support@heynikki.in with your payment ID: " +
              response.razorpay_payment_id
            );
          }
        },
        modal: {
          ondismiss: () => setUpgrading(null),
        },
      });
      rzp.open();
    } catch (err) {
      console.error("[billing] checkout failed", err);
      toast.err("Something went wrong starting checkout. Please try again.");
    } finally {
      setUpgrading(null);
    }
  };

  const daysLeft = tenant?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86400000))
    : null;

  // What the ring shows depends on what gates this tenant's calls: a plan
  // tier's monthly minutes, or — for everyone else — the trial credit pool.
  const planId  = String(tenant?.plan || "").toLowerCase();
  const onPaid  = PAID_PLANS.includes(planId);
  const ring = (() => {
    if (onPaid) {
      const tierMinutes = Number(PLANS.find(p => p.id === planId)?.minutes) || 0;
      const limitMin = usage?.plan_limit_seconds
        ? Math.round(usage.plan_limit_seconds / 60) : tierMinutes;
      return { used: Math.ceil((usage?.used_seconds || 0) / 60), total: limitMin, period: "This month" };
    }
    // Trial: credits are deducted per call, rounded up to the minute, so the
    // ledger is the same number the customer is actually charged against.
    if (trial && trial.granted > 0) {
      return { used: Math.round(trial.spent), total: Math.round(trial.granted), period: "Free trial credits" };
    }
    // No ledger visible: show what was talked, without inventing a denominator.
    return { used: Math.ceil((usage?.used_seconds || 0) / 60), total: 0, period: "This month" };
  })();

  // The saving shown on the toggle comes from the prices on the cards. It was
  // a fixed "-20%" while annual billing actually saves a third.
  const annualSave = (() => {
    const p = PLANS.find((x: any) => x.price > 0 && x.annual > 0);
    return p ? Math.round((1 - p.annual / p.price) * 100) : 0;
  })();

  return (
    <Shell title="Billing">
      {/* next/script, not a bare <script> in JSX. React does not render a
          raw script element the same way on the server and the client, and
          this one threw "Hydration failed …" on every visit to /billing —
          the one page where a customer hands over money. next/script also
          de-duplicates by src, so this and the site-wide lazyOnload copy in
          app/layout.tsx load Razorpay exactly once between them; this page
          asks for it sooner because it is the page that needs it. */}
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: C.mid }}>Loading billing…</div>
      ) : (
        <>
          <style>{`
            @media (max-width: 760px) { .billing-grid { grid-template-columns: 1fr !important; } }
          `}</style>
          <h1 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", color: C.txt, margin: "0 0 4px" }}>Billing</h1>
          <p style={{ color: C.mid, fontSize: 14, margin: "0 0 20px" }}>Your plan, the minutes you have used, and the plans you can move to.</p>
          {/* Current plan + usage */}
          <div className="billing-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <div style={{ background: C.surf, border: "1px solid #E4E9F0", borderRadius: 12, padding: 22, boxShadow: "0 1px 2px rgba(15,23,42,0.04)", }}>
              <div style={{ color: C.mid, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Current plan</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                {/* On a trial the `plan` column is just the tier the account
                    was created against — nothing is paid for yet. Printing
                    "Starter" beside a "FREE" badge read as though the shop
                    were already subscribed to Starter. */}
                <span style={{ color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", textTransform: "capitalize" }}>
                  {tenant?.status === "trial" ? "Free trial" : (tenant?.plan || "Trial")}
                </span>
                {tenant?.status === "trial" && (
                  <span style={{ background: C.gold + "14", color: C.gold, borderRadius: 999,
                    padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>
                    Free · {Math.max(0, Math.round(Number(tenant?.credit_minutes ?? 0)))} minutes left
                  </span>
                )}
              </div>
              <a href="#plans" style={{ color: C.glow, fontSize: 13.5, fontWeight: 600, textDecoration: "none" }}>
                Upgrade plan →
              </a>
            </div>

            <div style={{ background: C.surf, border: "1px solid #E4E9F0", borderRadius: 12, padding: 22, boxShadow: "0 1px 2px rgba(15,23,42,0.04)", }}>
              <div style={{ color: C.mid, fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Minutes used</div>
              {usage || trial ? (
                <>
                  <UsageRing used={ring.used} total={ring.total} period={ring.period} />
                  {/* What actually happens at zero. The owner watching this
                      ring needs to know calls stop rather than that a bill
                      quietly grows. */}
                  <div style={{ color: C.mid, fontSize: 12.5, lineHeight: 1.55, marginTop: 12 }}>
                    When these run out Nikki stops answering until you move up a plan —
                    nothing extra is charged to you.{" "}
                    {ring.total > 0 && ring.used >= ring.total
                      ? <span style={{ color: C.gold, fontWeight: 700 }}>They have run out now.</span>
                      : null}
                  </div>
                </>
              ) : (
                <div style={{ color: C.mid, fontSize: 13.5 }}>No calls yet this period.</div>
              )}
            </div>
          </div>

          {/* Plans */}
          <div id="plans">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
              <div style={{ color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 19, fontWeight: 700, letterSpacing: "-0.01em" }}>Choose a plan</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: annual ? C.mid : C.txt, fontSize: 13, fontWeight: 600 }}>Monthly</span>
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
                <span style={{ color: annual ? C.txt : C.mid, fontSize: 13, fontWeight: 600 }}>Annual{annualSave > 0 && (
                  <span style={{ marginLeft: 6, background: C.grn + "14", color: C.grn, borderRadius: 999, padding: "2px 8px", fontSize: 12 }}>save {annualSave}%</span>)}</span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 14 }}>
              {PLANS.map(plan => {
                // A tenant on a TRIAL carries a plan name in `tenants.plan`
                // (new accounts land on "starter") but has paid for nothing —
                // api-server only sets status:"active" once Razorpay confirms.
                // Keying "current" off the plan name alone put a disabled
                // "Current Plan" button on the Starter card for every trial
                // account, so the one plan most of them want to buy was the
                // one they could not click. Status is what says "subscribed".
                const isCurrent = tenant?.status !== "trial" && tenant?.plan === plan.id;
                // "Upgrade to Starter" on a Growth account was a lie; say
                // which way the switch goes.
                const rank = (id?: string | null) => PAID_PLANS.indexOf(String(id || ""));
                const verb = rank(tenant?.plan) > rank(plan.id) && rank(plan.id) >= 0 ? "Switch to" : "Upgrade to";
                const price = annual ? plan.annual : plan.price;
                return (
                  <div key={plan.id} style={{
                    background: C.surf,
                    border: "1px solid " + (plan.popular ? C.glow : isCurrent ? C.grn : "#E4E9F0"),
                    boxShadow: plan.popular ? "0 0 0 3px " + C.glow + "1F, 0 8px 24px rgba(15,23,42,0.06)" : "0 1px 2px rgba(15,23,42,0.04)",
                    borderRadius: 12, padding: 22, position: "relative", display: "flex", flexDirection: "column",
                  }}>
                    {plan.popular && !isCurrent && (
                      <div style={{ position: "absolute", top: -10, left: "50%",
                        transform: "translateX(-50%)", background: C.glow, color: "#fff",
                        fontSize: 11.5, fontWeight: 600, padding: "3px 12px", borderRadius: 999,
                        whiteSpace: "nowrap" }}>Most popular</div>
                    )}
                    {isCurrent && (
                      <div style={{ position: "absolute", top: -10, left: "50%",
                        transform: "translateX(-50%)", background: C.grn, color: "#fff",
                        fontSize: 11.5, fontWeight: 600, padding: "3px 12px", borderRadius: 999,
                        whiteSpace: "nowrap" }}>Your plan</div>
                    )}
                    <div style={{ color: C.txt, fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
                      {plan.name}
                    </div>
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                      {(plan as any).perMinute ? `₹${(plan as any).perMinute}` : `₹${price.toLocaleString()}`}
                    </span>
                      <span style={{ color: C.mid, fontSize: 13, marginLeft: 2 }}>{(plan as any).perMinute ? "/min" : "/month"}</span>
                      {annual && !(plan as any).perMinute && <div style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>billed yearly</div>}
                    </div>
                    <div style={{ color: C.mid, fontSize: 12.5, marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid #EEF2F6" }}>
                      {plan.minutes} mins · {plan.profiles} profile{plan.profiles > 1 ? "s" : ""} · {plan.numbers} number{plan.numbers > 1 ? "s" : ""}
                    </div>
                    {plan.features.map((f: string) => (
                      <div key={f} style={{ display: "flex", gap: 8, marginBottom: 7, alignItems: "flex-start" }}>
                        <Check size={14} color={C.grn} style={{ flexShrink: 0, marginTop: 2 }} />
                        <span style={{ color: C.txt, fontSize: 13.5, lineHeight: 1.45 }}>{f}</span>
                      </div>
                    ))}
                    <div style={{ height: 16 }} />
                    <button onClick={() => !isCurrent && handleUpgrade(plan.id)}
                      disabled={isCurrent || upgrading === plan.id}
                      style={{
                        width: "100%", marginTop: "auto",
                        background: isCurrent ? C.grn + "14" : plan.popular ? C.glow : C.surf,
                        color: isCurrent ? C.grn : plan.popular ? "#fff" : C.txt,
                        border: isCurrent || plan.popular ? "none" : "1px solid #D8DFE8",
                        borderRadius: 8, padding: "11px 0", fontSize: 14, fontWeight: 600,
                        cursor: isCurrent ? "default" : "pointer",
                        opacity: (isCurrent || upgrading === plan.id) ? 0.7 : 1,
                      }}>
                      {isCurrent ? "Your current plan" : upgrading === plan.id ? "Opening…" : `${verb} ${plan.name}`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* "Overage: Rs 15/extra minute" was a figure nobody is ever charged.
              minutesGate() in api-server/src/usage.ts REFUSES further calls
              once the plan's minutes are gone; there is no top-up purchase
              flow in the product, so nothing can be billed for going over.
              /pricing and /refund-policy already say this — this page was the
              last one quoting a price that does not exist. Do not put a rate
              back here unless a checkout that can actually sell minutes
              ships with it. */}
          <div style={{ textAlign: "center", marginTop: 18, color: C.mid, fontSize: 13, lineHeight: 1.6 }}>
            New accounts start with 100 free minutes · You are never charged for going over ·
            Cancel anytime
          </div>
        </>
      )}
    </Shell>
  );
}
