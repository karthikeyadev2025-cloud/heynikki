// app/analytics/page.tsx — ROI Analytics Dashboard v4.0
"use client";
import { useState, useEffect } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { NIKKI } from "../../lib/brand";

const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: NIKKI.gold,
  grn: NIKKI.emerald, red: NIKKI.red, cyn: NIKKI.cyan, org: NIKKI.terracotta,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

const INTENT_COLORS: Record<string, string> = {
  appointment: C.grn, enquiry: C.cyn, callback: C.gold,
  transfer: C.gbr, emergency: C.red, unknown: C.dim,
};

// Cost constants for ROI calculation
const HUMAN_SALARY_PER_CALL = 35;   // ₹ per call (receptionist salary amortised)
const AI_COST_PER_CALL      = 4;    // ₹ per call (Sarvam STT + Gemini + infra)
const WA_CONVERSION_VALUE   = 800;  // ₹ revenue per WhatsApp lead that converts

function Card({ children, title, subtitle, style }: {
  children: React.ReactNode; title?: string; subtitle?: string; style?: React.CSSProperties;
}) {
  return (
    <div style={{ background: C.surf, border: "1px solid " + C.bord, borderRadius: 10, padding: 16, ...style }}>
      {title && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: C.txt, fontSize: 13, fontWeight: 800 }}>{title}</div>
          {subtitle && <div style={{ color: C.dim, fontSize: 11, marginTop: 2 }}>{subtitle}</div>}
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
    <Card>
      <div style={{ color: C.mid, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{label}</div>
      <div style={{ color, fontSize: 26, fontWeight: 900 }}>{value}</div>
      {sub && <div style={{ color: C.dim, fontSize: 11, marginTop: 3 }}>{sub}</div>}
      {trend !== undefined && (
        <div style={{ color: trend >= 0 ? C.grn : C.red, fontSize: 11, marginTop: 4, fontWeight: 700 }}>
          {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}% vs last period
        </div>
      )}
    </Card>
  );
}

const Tooltip2 = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.hi, border: "1px solid " + C.bord, borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
      <div style={{ color: C.mid, marginBottom: 4 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: p.color || C.gbr, fontWeight: 700 }}>
          {p.name}: {p.value}
        </div>
      ))}
    </div>
  );
};

export default function AnalyticsPage() {
  const [calls, setCalls]   = useState<any[]>([]);
  const [leads, setLeads]   = useState<any[]>([]);
  const [ctcLogs, setCtcLogs] = useState<any[]>([]);
  const [waLogs, setWaLogs]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange]     = useState<"7" | "30" | "90">("30");

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = "/login"; return; }
      const { data: tu } = await sb.from("tenant_users")
        .select("tenant_id").eq("user_id", data.user.id).single();
      if (!tu) return;

      const since = new Date(Date.now() - parseInt(range) * 86400000).toISOString();
      const [c, l, ctc, wa] = await Promise.all([
        sb.from("calls").select("*").eq("tenant_id", tu.tenant_id)
          .gte("created_at", since).order("created_at", { ascending: true }),
        sb.from("leads").select("*").eq("tenant_id", tu.tenant_id)
          .gte("created_at", since),
        sb.from("click_to_call_log").select("*").eq("tenant_id", tu.tenant_id)
          .gte("created_at", since),
        sb.from("wa_dispatch_log").select("*").eq("tenant_id", tu.tenant_id)
          .gte("created_at", since),
      ]);
      setCalls(c.data || []);
      setLeads(l.data || []);
      setCtcLogs(ctc.data || []);
      setWaLogs(wa.data || []);
      setLoading(false);
    });
  }, [range]);

  // ── Derived metrics ───────────────────────────────────────
  const totalCalls       = calls.length;
  const aiHandled        = calls.filter(c => c.status === "completed" && c.duration_seconds && c.duration_seconds > 5).length;
  const missedCalls      = calls.filter(c => c.status === "missed").length;
  const appointments     = calls.filter(c => c.appointment_created).length;
  const waSent           = waLogs.length;
  const waDelivered      = waLogs.filter(w => w.status === "delivered" || w.status === "read").length;
  const avgDur           = totalCalls ? Math.round(calls.reduce((s, c) => s + (c.duration_seconds || 0), 0) / totalCalls) : 0;

  // ROI
  const humanCostSaved   = aiHandled * HUMAN_SALARY_PER_CALL;
  const aiTotalCost      = aiHandled * AI_COST_PER_CALL;
  const netSaving        = humanCostSaved - aiTotalCost;
  const roiPercent       = aiTotalCost > 0 ? Math.round((netSaving / aiTotalCost) * 100) : 0;

  // Lead funnel
  const newLeads         = leads.filter(l => l.stage === "new").length;
  const qualified        = leads.filter(l => l.stage === "qualified").length;
  const won              = leads.filter(l => l.stage === "won").length;
  const conversionRate   = leads.length ? Math.round((won / leads.length) * 100) : 0;

  // CTC disposition breakdown
  const ctcDispositions  = ctcLogs.reduce((acc: Record<string, number>, l) => {
    const k = l.disposition || "pending";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  // WhatsApp conversion rate
  const waConversionRate = waSent ? Math.round((waDelivered / waSent) * 100) : 0;
  const waRevenue        = waDelivered * WA_CONVERSION_VALUE * 0.15; // 15% of delivered convert

  // ── Chart data ────────────────────────────────────────────
  const days = parseInt(range);
  const dailyData = Array.from({ length: Math.min(days, 30) }, (_, i) => {
    const d = new Date(Date.now() - (Math.min(days, 30) - 1 - i) * 86400000);
    const label = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    const dayStr = d.toISOString().split("T")[0];
    const dayCalls  = calls.filter(c => c.created_at?.startsWith(dayStr));
    const dayLeads  = leads.filter(l => l.created_at?.startsWith(dayStr));
    return {
      day:          label,
      calls:        dayCalls.length,
      ai_handled:   dayCalls.filter(c => c.status === "completed").length,
      missed:       dayCalls.filter(c => c.status === "missed").length,
      appointments: dayCalls.filter(c => c.appointment_created).length,
      leads:        dayLeads.length,
      cost_saved:   dayCalls.filter(c => c.status === "completed").length * (HUMAN_SALARY_PER_CALL - AI_COST_PER_CALL),
    };
  });

  const intentCounts = calls.reduce((acc: Record<string, number>, c) => {
    const k = c.intent || "unknown";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const intentData = Object.entries(intentCounts).map(([name, value]) => ({ name, value: value as number }));

  const hourCounts = Array.from({ length: 24 }, (_, h) => ({
    hour: `${h}:00`,
    calls: calls.filter(c => c.created_at && new Date(c.created_at).getHours() === h).length,
  })).filter(h => h.calls > 0 || [9,10,11,12,13,14,15,16,17,18].includes(parseInt(h.hour)));

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
        <div style={{ textAlign: "center", padding: 48, color: C.mid }}>Loading analytics...</div>
      ) : (
        <>
          {/* Range selector */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ color: C.txt, fontSize: 16, fontWeight: 900 }}>📊 ROI Analytics</div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["7", "30", "90"] as const).map(r => (
                <button key={r} onClick={() => { setLoading(true); setRange(r); }}
                  style={{ padding: "6px 14px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 700,
                    cursor: "pointer", background: range === r ? C.glow : C.hi,
                    color: range === r ? "#fff" : C.mid }}>
                  {r}d
                </button>
              ))}
            </div>
          </div>

          {/* ── ROI Summary Strip ──────────────────────────────── */}
          <div style={{ background: `linear-gradient(135deg, ${C.glow}18, ${C.grn}0D)`,
            border: "1px solid " + C.glow + "33", borderRadius: 10,
            padding: "16px 20px", marginBottom: 20,
            display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: 12 }}>
            {[
              { label: "Human Cost Saved",   value: `₹${humanCostSaved.toLocaleString()}`, color: C.grn },
              { label: "AI Running Cost",    value: `₹${aiTotalCost.toLocaleString()}`,    color: C.gold },
              { label: "Net Saving",         value: `₹${netSaving.toLocaleString()}`,      color: C.gbr },
              { label: "ROI",                value: `${roiPercent}×`,                      color: C.glow },
              { label: "WA Revenue Est.",    value: `₹${Math.round(waRevenue).toLocaleString()}`, color: C.cyn },
            ].map(s => (
              <div key={s.label} style={{ textAlign: "center" }}>
                <div style={{ color: s.color, fontSize: 22, fontWeight: 900 }}>{s.value}</div>
                <div style={{ color: C.mid, fontSize: 10, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* ── KPI Row ────────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 20 }}>
            <KpiCard label="Total Calls"      value={totalCalls}         color={C.gbr}  />
            <KpiCard label="AI Handled"       value={aiHandled}          color={C.glow} sub={`${totalCalls ? Math.round(aiHandled/totalCalls*100) : 0}% auto-resolved`} />
            <KpiCard label="Appointments"     value={appointments}       color={C.grn}  sub={`${totalCalls ? Math.round(appointments/totalCalls*100) : 0}% booking rate`} />
            <KpiCard label="Missed (WA sent)" value={missedCalls}        color={C.gold} sub={`${waSent} WhatsApp follow-ups`} />
            <KpiCard label="Avg Duration"     value={`${avgDur}s`}       color={C.cyn}  />
          </div>

          {/* ── Daily Calls + Cost Saved ───────────────────────── */}
          <Card title="Daily Call Volume & Savings" subtitle="AI handled calls vs savings vs missed"
            style={{ marginBottom: 16 }}>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={dailyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
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
                <XAxis dataKey="day" tick={{ fill: C.dim, fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.mid, fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<Tooltip2 />} cursor={{ fill: C.hi + "88" }} />
                <Legend iconType="circle" iconSize={8}
                  wrapperStyle={{ fontSize: 11, color: C.mid, paddingTop: 8 }} />
                <Area type="monotone" dataKey="ai_handled"   name="AI Handled"    stroke={C.glow} fill="url(#gAI)"  strokeWidth={2} />
                <Area type="monotone" dataKey="appointments" name="Appointments"  stroke={C.grn}  fill="url(#gGrn)" strokeWidth={2} />
                <Bar  dataKey="missed"       name="Missed"       fill={C.gold} radius={[2,2,0,0]} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          {/* ── Lead Funnel + CTC Dispositions ──────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <Card title="Lead Funnel" subtitle={`${leads.length} total leads · ${conversionRate}% conversion`}>
              {leadFunnelData.map((s, i) => (
                <div key={s.stage} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ color: C.mid, fontSize: 12 }}>{s.stage}</span>
                    <span style={{ color: s.color, fontSize: 12, fontWeight: 700 }}>{s.count}</span>
                  </div>
                  <div style={{ height: 6, background: C.bord, borderRadius: 3 }}>
                    <div style={{
                      width: leads.length ? `${(s.count / leads.length) * 100}%` : "0%",
                      height: "100%", borderRadius: 3,
                      background: s.color,
                      boxShadow: s.count > 0 ? `0 0 8px ${s.color}66` : "none",
                      transition: "width 0.6s ease",
                    }} />
                  </div>
                </div>
              ))}
              <div style={{ color: C.grn, fontSize: 12, fontWeight: 700, marginTop: 12, textAlign: "center" }}>
                🏆 {won} Clients Won · ₹{(won * 5000).toLocaleString()} est. revenue
              </div>
            </Card>

            <Card title="CTC Call Dispositions" subtitle="Outcomes from Click-to-Call sales calls">
              {ctcDispData.length === 0 ? (
                <div style={{ color: C.dim, fontSize: 12, textAlign: "center", padding: 40 }}>
                  No Click-to-Call calls yet
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
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 4 }}>
                    {ctcDispData.map(d => (
                      <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: DISP_COLORS[d.name] || C.mid, flexShrink: 0 }} />
                        <span style={{ color: C.mid, fontSize: 10 }}>{d.name}: {d.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </div>

          {/* ── WhatsApp + Intent ────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <Card title="WhatsApp Dispatch Performance" subtitle={`${waSent} sent · ${waConversionRate}% delivered`}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                {[
                  { label: "Sent",      value: waSent,                                  color: C.gbr  },
                  { label: "Delivered", value: waDelivered,                              color: C.grn  },
                  { label: "Failed",    value: waLogs.filter(w => w.status === "failed").length, color: C.red },
                  { label: "Est. Revenue", value: `₹${Math.round(waRevenue).toLocaleString()}`, color: C.gold },
                ].map(s => (
                  <div key={s.label} style={{ background: C.hi, borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ color: C.mid, fontSize: 10, marginBottom: 4 }}>{s.label}</div>
                    <div style={{ color: s.color, fontSize: 18, fontWeight: 900 }}>{s.value}</div>
                  </div>
                ))}
              </div>
              {/* Delivery bar */}
              <div style={{ height: 6, background: C.bord, borderRadius: 3 }}>
                <div style={{ width: `${waConversionRate}%`, height: "100%", borderRadius: 3,
                  background: `linear-gradient(90deg, ${C.grn}, ${C.cyn})`,
                  boxShadow: `0 0 10px ${C.grn}88`, transition: "width 0.6s ease" }} />
              </div>
              <div style={{ color: C.dim, fontSize: 10, marginTop: 4, textAlign: "right" }}>{waConversionRate}% delivery rate</div>
            </Card>

            <Card title="Call Intent Breakdown" subtitle="What callers wanted (30-day)">
              {intentData.length === 0 ? (
                <div style={{ color: C.dim, fontSize: 12, textAlign: "center", padding: 40 }}>No calls yet</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={140}>
                    <PieChart>
                      <Pie data={intentData} dataKey="value" nameKey="name"
                        cx="50%" cy="50%" outerRadius={55} innerRadius={28}>
                        {intentData.map((entry, i) => (
                          <Cell key={i} fill={INTENT_COLORS[entry.name] || C.dim} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any, n: any) => [v, n]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 4 }}>
                    {intentData.map(d => (
                      <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: INTENT_COLORS[d.name] || C.dim, flexShrink: 0 }} />
                        <span style={{ color: C.mid, fontSize: 10 }}>{d.name}: {d.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </div>

          {/* ── Peak Hours ─────────────────────────────────────── */}
          <Card title="Peak Call Hours" subtitle="When your customers call most — use to plan staff coverage">
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={hourCounts} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="hour" tick={{ fill: C.dim, fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.mid, fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<Tooltip2 />} cursor={{ fill: C.hi + "88" }} />
                <Bar dataKey="calls" name="Calls" fill={C.gold} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </>
      )}
    </Shell>
  );
}
