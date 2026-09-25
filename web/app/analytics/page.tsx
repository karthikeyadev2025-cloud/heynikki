// app/analytics/page.tsx — ROI Analytics Dashboard v4.0
"use client";
import { useState, useEffect } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid, ComposedChart } from "recharts";
import { NIKKI } from "../../lib/brand";
import { intentColor, intentLabel } from "../../lib/intent";

const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: NIKKI.gold,
  grn: NIKKI.emerald, red: NIKKI.red, cyn: NIKKI.cyan, org: NIKKI.terracotta,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

// Slice labels and colours come from lib/intent.ts — the one map that knows
// both intent vocabularies. This page carried its own, which meant a lead
// vocabulary key (or anything new from the pipeline) drew a grey slice with
// a database string next to it. `wa_otp_<code>` rows still fold into one
// "WhatsApp OTP" bucket there, so the pie never shows a six-digit code.

// Every date-based figure on this page is IST — open_time/close_time are
// local business hours and the customers are in India — so bucketing by the
// browser's clock put a 9 AM Hyderabad call at 3:30 AM for anyone viewing
// from a UTC machine (or a laptop with the wrong zone).
const IST = "Asia/Kolkata";
function istHour(iso: string): number {
  return Number(new Date(iso).toLocaleString("en-GB", { timeZone: IST, hour: "2-digit", hour12: false }).slice(0, 2));
}
function istDay(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: IST }); // YYYY-MM-DD
}

// Used only when a won lead has no deal value recorded against it. Shown
// next to the figure it produces, so nobody mistakes an assumption for a
// measured number.
const ASSUMED_DEAL_VALUE = 5000; // ₹ per won lead

// ── Client-facing value constants ─────────────────────────────
// AI_COST_PER_CALL (₹4 — our Sarvam + Gemini + infra unit cost) used to
// live here and was rendered to the CUSTOMER as "AI Running Cost". A
// tenant paying ₹5,999/month could read our cost basis straight off
// their own dashboard and compute the margin. Removed entirely: our
// cost of goods is not a customer-facing metric, and the number they
// actually want is what the service is worth to them.
const HUMAN_SALARY_PER_CALL = 35;   // ₹ per call — cost of doing this with staff
const WA_CONVERSION_VALUE   = 800;  // ₹ revenue per WhatsApp lead that converts

function Card({ children, title, subtitle, style }: {
  children: React.ReactNode; title?: string; subtitle?: string; style?: React.CSSProperties;
}) {
  return (
    <div style={{ background: C.surf, border: "1px solid #E4E9F0", borderRadius: 12, padding: 20,
      boxShadow: "0 1px 2px rgba(15,23,42,0.04)", ...style }}>
      {title && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: C.txt, fontSize: 15, fontWeight: 700 }}>{title}</div>
          {subtitle && <div style={{ color: C.mid, fontSize: 13, marginTop: 3 }}>{subtitle}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

function KpiCard({ label, value, sub, color, trend }: {
  label: string; value: string | number; sub?: string; color: string; trend?: number;
}) {
  return (
    // Figure in ink, colour only on the edge — as on the dashboard.
    <Card style={{ position: "relative", overflow: "hidden", padding: "16px 18px 14px" }}>
      <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color }} />
      <div style={{ color: C.mid, fontSize: 13, fontWeight: 600 }}>{label}</div>
      <div style={{ color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 30, fontWeight: 700, lineHeight: 1.1,
        marginTop: 6, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ color: C.mid, fontSize: 12.5, marginTop: 4 }}>{sub}</div>}
      {trend !== undefined && (
        <div style={{ color: trend >= 0 ? C.grn : C.red, fontSize: 12.5, marginTop: 4, fontWeight: 600 }}>
          {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}% vs last period
        </div>
      )}
    </Card>
  );
}

const Tooltip2 = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.surf, border: "1px solid #E4E9F0", borderRadius: 8, padding: "8px 12px", fontSize: 12.5,
      boxShadow: "0 8px 24px rgba(15,23,42,0.12)" }}>
      <div style={{ color: C.mid, marginBottom: 4 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color || C.gbr, fontWeight: 600 }}>
          {p.name}: {p.value}
        </div>
      ))}
    </div>
  );
};

export default function AnalyticsPage() {
  const [calls, setCalls]   = useState<any[]>([]);
  const [appts, setAppts] = useState<any[]>([]);
  const [leads, setLeads]   = useState<any[]>([]);
  const [ctcLogs, setCtcLogs] = useState<any[]>([]);
  const [waLogs, setWaLogs]   = useState<any[]>([]);
  const [quality, setQuality] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange]     = useState<"7" | "30" | "90">("30");

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = "/login"; return; }
      const { data: tu } = await sb.from("tenant_users")
        .select("tenant_id").eq("user_id", data.user.id).maybeSingle();
      // A failed lookup used to `return` with loading still true, so the page
      // span forever with no way to tell why.
      if (!tu) { setLoading(false); return; }

      const since = new Date(Date.now() - parseInt(range) * 86400000).toISOString();
      const [c, l, ctc, wa, q, ap] = await Promise.all([
        sb.from("calls").select("*").eq("tenant_id", tu.tenant_id)
          .gte("created_at", since).order("created_at", { ascending: true }),
        sb.from("leads").select("*").eq("tenant_id", tu.tenant_id)
          .gte("created_at", since),
        sb.from("click_to_call_log").select("*").eq("tenant_id", tu.tenant_id)
          .gte("created_at", since),
        sb.from("wa_dispatch_log").select("*").eq("tenant_id", tu.tenant_id)
          .gte("sent_at", since),
        // Scored conversations. Joined to calls for the timestamp, because
        // analysed_at is when the JOB ran — batching a backlog would stack
        // every one of them on a single day and invent a cliff in the trend.
        sb.from("call_quality")
          .select("overall_score, resolution_score, next_step_captured, sentiment, calls!inner(created_at)")
          .eq("tenant_id", tu.tenant_id)
          .gte("calls.created_at", since),
        // The bookings themselves. calls.appointment_created is never set by
        // the live pipeline, so counting that flag reported zero appointments
        // on accounts that had them.
        sb.from("appointments").select("id, created_at, status")
          .eq("tenant_id", tu.tenant_id).gte("created_at", since),
      ]);
      setAppts(ap.data || []);
      setCalls(c.data || []);
      setLeads(l.data || []);
      setCtcLogs(ctc.data || []);
      setWaLogs(wa.data || []);
      setQuality(q.data || []);
      setLoading(false);
    });
  }, [range]);

  // ── Derived metrics ───────────────────────────────────────
  const totalCalls       = calls.length;
  const aiHandled        = calls.filter(c => c.status === "completed" && c.duration_seconds && c.duration_seconds > 5).length;
  const missedCalls      = calls.filter(c => c.status === "missed").length;
  // calls.appointment_created is false on all 52 live calls while the
  // appointments table holds real bookings — so this KPI, the booking rate
  // and the chart series all read 0 on an account that has appointments.
  // Count the bookings themselves.
  const appointments     = appts.length;
  // Only messages sent to the business's CUSTOMERS. wa_dispatch_log also
  // holds HeyNikki's own onboarding messages TO THE OWNER, so a tenant that
  // had never messaged a customer still showed WhatsApp volume — and the
  // revenue estimate below turned our own welcome message into rupees.
  const CUSTOMER_WA = ["missed_call", "confirmation", "reminder", "brochure",
                       "manual_template", "manual_reply", "interested_lead"];
  const custWa           = waLogs.filter(w => CUSTOMER_WA.includes(String(w.message_type)));
  const waSent           = custWa.length;
  const waDelivered      = custWa.filter(w => w.status === "delivered" || w.status === "read").length;
  // The follow-ups that belong next to the missed-call count. `waSent`
  // is every customer message (confirmations, reminders, brochures…).
  const waMissedFollowups = custWa.filter(w => w.message_type === "missed_call").length;
  const avgDur           = totalCalls ? Math.round(calls.reduce((s, c) => s + (c.duration_seconds || 0), 0) / totalCalls) : 0;

  // ROI
  // Value delivered, not our cost of delivering it.
  const humanCostSaved   = aiHandled * HUMAN_SALARY_PER_CALL;

  // Lead funnel
  const newLeads         = leads.filter(l => l.stage === "new").length;
  const qualified        = leads.filter(l => l.stage === "qualified").length;
  const wonLeads         = leads.filter(l => l.stage === "won");
  const won              = wonLeads.length;
  const conversionRate   = leads.length ? Math.round((won / leads.length) * 100) : 0;
  // Revenue from won leads: the deal value the business recorded on the
  // lead (leads.deal_value_paise, editable in the lead panel) where it
  // exists, and the visible assumption for the rest.
  const wonWithValue     = wonLeads.filter(l => Number(l.deal_value_paise) > 0);
  const recordedRevenue  = wonWithValue.reduce((s, l) => s + Math.round(Number(l.deal_value_paise) / 100), 0);
  const assumedCount     = won - wonWithValue.length;
  const wonRevenue       = recordedRevenue + assumedCount * ASSUMED_DEAL_VALUE;

  // CTC disposition breakdown
  const ctcDispositions  = ctcLogs.reduce((acc: Record<string, number>, l) => {
    const k = l.disposition || "pending";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  // WhatsApp conversion rate
  const waConversionRate = waSent ? Math.round((waDelivered / waSent) * 100) : 0;
  // Deliberately an ESTIMATE, and labelled as one where it is rendered. It
  // multiplies delivered messages by a fixed assumed value — it is not
  // revenue, nothing measures a sale, and presenting it as "WA Revenue"
  // reported rupees a business never earned.
  const waRevenue        = waDelivered * WA_CONVERSION_VALUE * 0.15;

  // ── Chart data ────────────────────────────────────────────
  const days = parseInt(range);
  // The chart caps at 30 points so 90 days does not become an unreadable
  // hairline — but it said "90 days" and drew 30 without mentioning it, so
  // a business comparing the chart to the KPI tiles saw two different
  // periods. The cap is now stated where the chart is drawn.
  const chartDays = Math.min(days, 30);
  // Bucketed by IST calendar day (istDay), matching the hour chart below
  // and the after-hours figures on the dashboard.
  const dailyData = Array.from({ length: chartDays }, (_, i) => {
    const d = new Date(Date.now() - (chartDays - 1 - i) * 86400000);
    const label = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
    const dayStr = istDay(d);
    const dayCalls  = calls.filter(c => c.created_at && istDay(c.created_at) === dayStr);
    const dayLeads  = leads.filter(l => l.created_at && istDay(l.created_at) === dayStr);
    return {
      day:          label,
      calls:        dayCalls.length,
      ai_handled:   dayCalls.filter(c => c.status === "completed").length,
      missed:       dayCalls.filter(c => c.status === "missed").length,
      // A booking call carries intent = 'appointment' and, on current
      // rows, appointment_created; older rows only have the intent. The
      // series used to read appointment_created alone and drew a flat zero
      // under a KPI tile that counted real appointments.
      appointments: dayCalls.filter(c => c.intent === "appointment" || c.appointment_created).length,
      leads:        dayLeads.length,
      cost_saved:   dayCalls.filter(c => c.status === "completed").length * HUMAN_SALARY_PER_CALL,
    };
  });

  // Bucketed by the LABEL, so two stored keys that mean the same thing to a
  // reader ("appointment" and "book_appointment") cannot draw two slices with
  // identical captions. The colour is carried along from the first row in
  // each bucket rather than looked up from the label afterwards.
  const intentCounts = calls.reduce((acc: Record<string, { value: number; color: string }>, c) => {
    const k = intentLabel(c.intent);
    if (!acc[k]) acc[k] = { value: 0, color: intentColor(c.intent) };
    acc[k].value += 1;
    return acc;
  }, {});
  const intentData = Object.entries(intentCounts)
    .map(([name, d]) => ({ name, value: d.value, color: d.color }))
    .sort((a, b) => b.value - a.value);

  const hourCounts = Array.from({ length: 24 }, (_, h) => ({
    hour: `${h}:00`,
    calls: calls.filter(c => c.created_at && istHour(c.created_at) === h).length,
  }));
  // A continuous window: from the first hour with a call (or 8:00) to the
  // last (or 20:00). Dropping empty hours in the middle used to put 4:00
  // beside 9:00 and made the busy stretch look adjacent to the quiet one.
  const hoursWithCalls = hourCounts.map((h, i) => (h.calls > 0 ? i : -1)).filter(i => i >= 0);
  const hFrom = Math.min(8, ...(hoursWithCalls.length ? [hoursWithCalls[0]] : [8]));
  const hTo   = Math.max(20, ...(hoursWithCalls.length ? [hoursWithCalls[hoursWithCalls.length - 1]] : [20]));
  const hourWindow = hourCounts.slice(hFrom, hTo + 1);

  const leadFunnelData = [
    { stage: "New",       count: newLeads,                       color: C.cyn  },
    { stage: "Contacted", count: leads.filter(l => l.stage === "contacted").length, color: C.gbr },
    { stage: "Qualified", count: qualified,                      color: C.gold },
    { stage: "Won",       count: won,                            color: C.grn  },
    { stage: "Lost",      count: leads.filter(l => l.stage === "lost").length, color: C.dim },
  ];

  const ctcDispData = Object.entries(ctcDispositions).map(([name, value]) => ({ name, value: value as number }));

  const DISP_COLORS: Record<string, string> = {
    interested: C.grn, booked: C.gbr, callback: C.gold,
    not_interested: C.red, no_answer: C.dim, pending: C.mid, busy: C.mid,
  };

  return (
    <Shell title="Analytics">
      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: C.mid }}>Loading analytics…</div>
      ) : (
        <>
          {/* Range selector */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
            <div>
              <h1 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", color: C.txt, margin: "0 0 4px" }}>Analytics</h1>
              <p style={{ color: C.mid, fontSize: 14, margin: 0 }}>What Nikki handled, what it saved you, and whether calls are getting better.</p>
            </div>
            {/* Segmented control: one choice, so one bordered group. */}
            <div style={{ display: "inline-flex", background: C.surf, border: "1px solid #E4E9F0", borderRadius: 10, padding: 3 }}>
              {(["7", "30", "90"] as const).map(r => (
                <button key={r} onClick={() => { setLoading(true); setRange(r); }}
                  style={{ padding: "6px 14px", borderRadius: 7, border: "none", fontSize: 13, fontWeight: 600,
                    cursor: "pointer", background: range === r ? C.glow : "transparent",
                    color: range === r ? "#fff" : C.mid }}>
                  {r} days
                </button>
              ))}
            </div>
          </div>

          {/* ── ROI Summary Strip ──────────────────────────────── */}
          {/* The one dark band on the page: the answer to "is Nikki worth it". */}
          <div style={{ background: C.glow, borderRadius: 12, padding: "18px 22px", marginBottom: 20,
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
            {[
              { label: "Staff cost avoided",   value: `₹${humanCostSaved.toLocaleString("en-IN")}` },
              { label: "Calls Nikki resolved", value: `${aiHandled}` },
              { label: "Est. value (assumed)", value: `₹${Math.round(waRevenue).toLocaleString("en-IN")}` },
            ].map(s => (
              <div key={s.label}>
                <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: 600 }}>{s.label}</div>
                <div style={{ color: "#fff", fontFamily: "var(--font-display), sans-serif", fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em",
                  marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* ── Conversation quality over time ─────────────────────
              The ROI strip above answers "what did this save us". This
              answers "is it getting better", which is the question that
              decides whether a prompt change worked. Both are needed: cost
              avoided keeps rising simply because calls keep arriving, even
              while the calls themselves get worse. */}
          {quality.length > 0 && (() => {
            // Bucket by the DAY THE CALL HAPPENED, not when it was scored.
            const byDay = new Map<string, { n: number; sum: number; next: number }>();
            quality.forEach((q: any) => {
              const d = q.calls?.created_at ? istDay(q.calls.created_at) : "";
              if (!d) return;
              const e = byDay.get(d) || { n: 0, sum: 0, next: 0 };
              e.n += 1; e.sum += q.overall_score || 0;
              if (q.next_step_captured) e.next += 1;
              byDay.set(d, e);
            });
            const series = [...byDay.entries()].sort().map(([d, e]) => ({
              day: d.slice(5),
              score: Math.round(e.sum / e.n),
              next: Math.round((e.next / e.n) * 100),
            }));
            const n = quality.length;
            const avg = Math.round(quality.reduce((s: number, q: any) => s + (q.overall_score || 0), 0) / n);
            const nextRate = Math.round(quality.filter((q: any) => q.next_step_captured).length / n * 100);
            const negative = quality.filter((q: any) => q.sentiment === "negative").length;

            return (
              <div style={{ background: C.surf, border: "1px solid #E4E9F0", borderRadius: 12,
                            padding: 20, marginBottom: 20, boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
                <div style={{ color: C.txt, fontSize: 15, fontWeight: 700, marginBottom: 3 }}>
                  Conversation quality
                </div>
                <div style={{ color: C.mid, fontSize: 13, marginBottom: 16 }}>
                  {n} scored conversation{n === 1 ? "" : "s"} · calls with fewer than four turns are not scored
                </div>

                <div style={{ display: "flex", gap: 32, flexWrap: "wrap", marginBottom: 16 }}>
                  {[
                    { l: "Avg score",     v: `${avg}`,        c: avg >= 70 ? C.grn : avg >= 45 ? C.gold : C.red },
                    // The commercial number: a call that ends politely with
                    // nothing agreed is one the business paid for and got
                    // nothing from.
                    { l: "Ended with a next step", v: `${nextRate}%`, c: nextRate >= 40 ? C.grn : C.red },
                    { l: "Negative callers", v: `${negative}/${n}`, c: negative ? C.red : C.grn },
                  ].map(s => (
                    <div key={s.l} style={{ borderLeft: `3px solid ${s.c}`, paddingLeft: 12 }}>
                      <div style={{ color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em",
                        fontVariantNumeric: "tabular-nums", lineHeight: 1.15 }}>{s.v}</div>
                      <div style={{ color: C.mid, fontSize: 13, fontWeight: 600, marginTop: 2 }}>{s.l}</div>
                    </div>
                  ))}
                </div>

                {series.length > 1 && (
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={series}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F6" vertical={false} />
                      <XAxis dataKey="day" stroke={C.dim} fontSize={11} />
                      <YAxis domain={[0, 100]} stroke={C.dim} fontSize={11} />
                      <Tooltip content={<Tooltip2 />} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12.5, color: C.mid, paddingTop: 8 }} />
                      <Line type="monotone" dataKey="score" name="Quality" stroke={C.gbr} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="next"  name="Next step %" stroke={C.grn} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
                {series.length <= 1 && (
                  <div style={{ color: C.mid, fontSize: 13 }}>
                    A trend needs calls on more than one day.
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── KPI Row ────────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
            <KpiCard label="Total calls"      value={totalCalls}         color={C.gbr}  />
            <KpiCard label="Nikki handled"    value={aiHandled}          color={C.glow} sub={`${totalCalls ? Math.round(aiHandled/totalCalls*100) : 0}% resolved without staff`} />
            <KpiCard label="Appointments"     value={appointments}       color={C.grn}  sub={`${totalCalls ? Math.round(appointments/totalCalls*100) : 0}% booking rate`} />
            <KpiCard label="Missed calls"     value={missedCalls}        color={C.gold} sub={`${waMissedFollowups} WhatsApp follow-up${waMissedFollowups === 1 ? "" : "s"} sent`} />
            <KpiCard label="Average length"   value={`${avgDur}s`}       color={C.cyn}  />
          </div>

          {/* ── Daily Calls + Cost Saved ───────────────────────── */}
          <Card title="Calls per day"
            subtitle={`Handled by Nikki, appointments booked, and missed${chartDays < parseInt(range) ? ` — last ${chartDays} days` : ""}`}
            style={{ marginBottom: 16 }}>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={dailyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gAI" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={C.glow} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={C.glow} stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gGrn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={C.grn} stopOpacity={0.25}/>
                    <stop offset="95%" stopColor={C.grn} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" tick={{ fill: C.dim, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.dim, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<Tooltip2 />} cursor={{ fill: C.hi + "88" }} />
                <Legend iconType="circle" iconSize={8}
                  wrapperStyle={{ fontSize: 12.5, color: C.mid, paddingTop: 8 }} />
                <Area type="monotone" dataKey="ai_handled"   name="Nikki handled"    stroke={C.glow} fill="url(#gAI)"  strokeWidth={2} />
                <Area type="monotone" dataKey="appointments" name="Appointments"  stroke={C.grn}  fill="url(#gGrn)" strokeWidth={2} />
                <Bar  dataKey="missed"       name="Missed"       fill={C.gold} radius={[2,2,0,0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>

          {/* ── Lead Funnel + CTC Dispositions ──────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 16 }}>
            <Card title="Lead funnel" subtitle={`${leads.length} total leads · ${conversionRate}% conversion`}>
              {leadFunnelData.map((s, i) => (
                <div key={s.stage} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ color: C.txt, fontSize: 13 }}>{s.stage}</span>
                    <span style={{ color: C.txt, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{s.count}</span>
                  </div>
                  <div style={{ height: 8, background: "#EEF2F6", borderRadius: 999 }}>
                    <div style={{
                      width: leads.length ? `${(s.count / leads.length) * 100}%` : "0%",
                      height: "100%", borderRadius: 999,
                      background: s.color,
                      transition: "width 0.6s ease",
                    }} />
                  </div>
                </div>
              ))}
              {won > 0 && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #EEF2F6" }}>
                  <div style={{ color: C.grn, fontSize: 13.5, fontWeight: 600 }}>
                    {won} client{won === 1 ? "" : "s"} won · ₹{wonRevenue.toLocaleString("en-IN")}
                    {assumedCount > 0 ? " est." : ""}
                  </div>
                  <div style={{ color: C.dim, fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
                    {assumedCount === 0
                      ? "Deal values you recorded on each lead"
                      : assumedCount === won
                        ? `Estimate: assumes ₹${ASSUMED_DEAL_VALUE.toLocaleString("en-IN")} per won lead — record deal values on your leads for a real figure`
                        : `₹${recordedRevenue.toLocaleString("en-IN")} recorded on ${wonWithValue.length} lead${wonWithValue.length === 1 ? "" : "s"} + ₹${ASSUMED_DEAL_VALUE.toLocaleString("en-IN")} assumed for ${assumedCount} without a deal value`}
                  </div>
                </div>
              )}
            </Card>

            <Card title="Desk call outcomes" subtitle="What happened on the calls your team made from the Desk">
              {ctcDispData.length === 0 ? (
                <div style={{ color: C.mid, fontSize: 13, textAlign: "center", padding: 40 }}>
                  No Desk calls yet
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={140}>
                    <PieChart>
                      <Pie data={ctcDispData} dataKey="value" nameKey="name"
                        cx="50%" cy="50%" outerRadius={55} innerRadius={28}>
                        {ctcDispData.map((entry, i) => (
                          <Cell key={i} fill={DISP_COLORS[entry.name] || C.mid} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any, n: any) => [v, n]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", justifyContent: "center", marginTop: 8 }}>
                    {ctcDispData.map(d => (
                      <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: DISP_COLORS[d.name] || C.mid, flexShrink: 0 }} />
                        <span style={{ color: C.mid, fontSize: 12 }}>{d.name.replace(/_/g, " ").replace(/^./, (x: string) => x.toUpperCase())}: <strong style={{ color: C.txt, fontWeight: 600 }}>{d.value}</strong></span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </div>

          {/* ── WhatsApp + Intent ────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 16 }}>
            <Card title="WhatsApp messages" subtitle={`${waSent} sent · ${waConversionRate}% delivered`}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                {[
                  { label: "Sent",      value: waSent,                                  color: C.gbr  },
                  { label: "Delivered", value: waDelivered,                              color: C.grn  },
                  // custWa, not waLogs. "Sent" and "Delivered" count only
                  // messages to CUSTOMERS; counting failures across every row
                  // meant HeyNikki's own onboarding message to the owner —
                  // which fails whenever their number isn't on WhatsApp —
                  // rendered as "Sent 0 · Delivered 0 · Failed 1", i.e. the
                  // shop being told its customer follow-ups are failing when
                  // it has never sent one.
                  { label: "Failed",    value: custWa.filter(w => w.status === "failed").length, color: C.red },
                  { label: "Est. revenue", value: `₹${Math.round(waRevenue).toLocaleString()}`, color: C.gold },
                ].map(s => (
                  <div key={s.label} style={{ background: "#F8FAFC", borderRadius: 8, padding: "10px 12px",
                    borderLeft: `3px solid ${s.color}` }}>
                    <div style={{ color: C.mid, fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>{s.label}</div>
                    <div style={{ color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
                  </div>
                ))}
              </div>
              {/* Delivery bar */}
              <div style={{ height: 8, background: "#EEF2F6", borderRadius: 999 }}>
                <div style={{ width: `${waConversionRate}%`, height: "100%", borderRadius: 999,
                  background: C.grn, transition: "width 0.6s ease" }} />
              </div>
              <div style={{ color: C.mid, fontSize: 12, marginTop: 6, textAlign: "right" }}>{waConversionRate}% delivery rate</div>
            </Card>

            <Card title="Why people called" subtitle={`What callers wanted (last ${range} days)`}>
              {intentData.length === 0 ? (
                <div style={{ color: C.mid, fontSize: 13, textAlign: "center", padding: 40 }}>No calls yet</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={140}>
                    <PieChart>
                      <Pie data={intentData} dataKey="value" nameKey="name"
                        cx="50%" cy="50%" outerRadius={55} innerRadius={28}>
                        {intentData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any, n: any) => [v, String(n)]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", justifyContent: "center", marginTop: 8 }}>
                    {intentData.map(d => (
                      <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
                        <span style={{ color: C.mid, fontSize: 12 }}>{d.name}: <strong style={{ color: C.txt, fontWeight: 600 }}>{d.value}</strong></span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </div>

          {/* ── Peak Hours ─────────────────────────────────────── */}
          <Card title="Busiest hours" subtitle="When your customers call most (IST) — use to plan staff coverage">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={hourWindow} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="hour" tick={{ fill: C.dim, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.dim, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<Tooltip2 />} cursor={{ fill: C.hi + "88" }} />
                <Bar dataKey="calls" name="Calls" fill={C.glow} radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </>
      )}
    </Shell>
  );
}
