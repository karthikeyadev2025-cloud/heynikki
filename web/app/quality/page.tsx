"use client";

/**
 * Call quality — the supervisor view.
 *
 * Every call has stored a full transcript since the beginning, and until the
 * scoring job existed nothing read them back except a person opening one call
 * at a time. Nobody reviews two hundred calls that way, so in practice no
 * call was reviewed at all.
 *
 * Worst-first by default, deliberately. A list sorted newest-first is a log;
 * a list sorted worst-first is a work queue, and a supervisor's attention is
 * worth most on the calls that went badly.
 *
 * Reads Supabase directly with the user's JWT. call_quality's RLS grants
 * select to the owning tenant and write only to the service role, so a
 * business can read its scores here but cannot mark its own calls perfect.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import { NIKKI } from "../../lib/brand";
import { AlertTriangle, TrendingUp, MessageSquare, ShieldCheck, Target } from "lucide-react";

const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
  grn: NIKKI.emerald, red: NIKKI.red, gold: NIKKI.gold, cyn: NIKKI.cyan,
};

type Row = {
  id: string; call_id: string;
  overall_score: number; resolution_score: number;
  courtesy_score: number; compliance_score: number;
  sentiment: string; next_step_captured: boolean;
  objections: string[] | null; topics: string[] | null; risk_flags: string[] | null;
  summary: string | null; coaching: string | null; analysed_at: string;
  calls: { caller_number: string | null; created_at: string; duration_seconds: number | null } | null;
};

const scoreColor = (s: number) => s >= 70 ? C.grn : s >= 45 ? C.gold : C.red;

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 11, color: C.mid, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color || C.txt, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function QualityPage() {
  const [rows, setRows]     = useState<Row[]>([]);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState("");
  const [sort, setSort]     = useState<"worst" | "recent">("worst");

  const load = useCallback(async () => {
    setLoad(true);
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) { window.location.href = "/login"; return; }

    const q = sb.from("call_quality")
      .select("*, calls(caller_number, created_at, duration_seconds)")
      .limit(200);
    const { data, error: e } = sort === "worst"
      ? await q.order("overall_score", { ascending: true })
      : await q.order("analysed_at",   { ascending: false });
    if (e) setError(e.message); else setRows((data || []) as Row[]);
    setLoad(false);
  }, [sort]);

  useEffect(() => { load(); }, [load]);

  // Aggregates are computed here rather than in SQL: the set is capped at 200
  // rows, and a view would have to be re-deployed every time a supervisor
  // wants to count something differently.
  const agg = useMemo(() => {
    const n = rows.length || 1;
    const avg = (k: keyof Row) => Math.round(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) / n);
    const tally = (k: "topics" | "objections" | "risk_flags") => {
      const m = new Map<string, number>();
      rows.forEach(r => (r[k] || []).forEach(t => m.set(t, (m.get(t) || 0) + 1)));
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    };
    return {
      overall: avg("overall_score"), resolution: avg("resolution_score"),
      courtesy: avg("courtesy_score"), compliance: avg("compliance_score"),
      nextStep: rows.filter(r => r.next_step_captured).length,
      negative: rows.filter(r => r.sentiment === "negative").length,
      topics: tally("topics"), objections: tally("objections"), risks: tally("risk_flags"),
    };
  }, [rows]);

  const Chips = ({ title, icon, items, color }: any) => (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
        {icon}<strong style={{ fontSize: 13, color: C.txt }}>{title}</strong>
      </div>
      {items.length === 0
        ? <div style={{ fontSize: 12, color: C.dim }}>Nothing recorded yet.</div>
        : <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {items.map(([t, c]: [string, number]) => (
              <span key={t} style={{
                background: (color || C.cyn) + "18", border: `1px solid ${(color || C.cyn)}44`,
                color: color || C.cyn, borderRadius: 20, padding: "4px 10px", fontSize: 12,
              }}>{t} <b>{c}</b></span>
            ))}
          </div>}
    </div>
  );

  return (
    <Shell>
      <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: C.txt, margin: "0 0 4px" }}>Call quality</h1>
        <p style={{ color: C.mid, fontSize: 14, margin: "0 0 20px" }}>
          Every call with a real conversation is scored from its transcript — not a sample.
        </p>

        {error && (
          <div role="alert" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: C.red,
                                     padding: "10px 12px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>{error}</div>
        )}

        {loading ? <div style={{ color: C.mid }}>Loading…</div> : rows.length === 0 ? (
          <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12, padding: 28, textAlign: "center" }}>
            <div style={{ color: C.txt, fontWeight: 700, marginBottom: 6 }}>No calls scored yet</div>
            <div style={{ color: C.mid, fontSize: 13 }}>
              Scoring runs every 15 minutes over calls with at least four turns.
              Calls where nobody spoke are skipped — there is nothing to judge.
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
              <Stat label="Overall"    value={String(agg.overall)}    color={scoreColor(agg.overall)} sub={`${rows.length} calls`} />
              <Stat label="Resolution" value={String(agg.resolution)} color={scoreColor(agg.resolution)} sub="got what they rang for" />
              <Stat label="Courtesy"   value={String(agg.courtesy)}   color={scoreColor(agg.courtesy)} />
              <Stat label="Compliance" value={String(agg.compliance)} color={scoreColor(agg.compliance)} />
              {/* The commercial number. A call that ends politely with nothing
                  agreed is a call the business paid for and got nothing from. */}
              <Stat label="Next step"  value={`${agg.nextStep}/${rows.length}`}
                    color={agg.nextStep / rows.length < 0.4 ? C.red : C.grn} sub="booking / callback / number" />
              <Stat label="Negative"   value={`${agg.negative}/${rows.length}`}
                    color={agg.negative ? C.red : C.grn} sub="caller sentiment" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginBottom: 20 }}>
              <Chips title="What callers want"   icon={<MessageSquare size={14} color={C.cyn} />}  items={agg.topics} color={C.cyn} />
              <Chips title="Objections raised"   icon={<Target size={14} color={C.gold} />}        items={agg.objections} color={C.gold} />
              <Chips title="Risk flags"          icon={<ShieldCheck size={14} color={C.red} />}    items={agg.risks} color={C.red} />
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {(["worst", "recent"] as const).map(s => (
                <button key={s} onClick={() => setSort(s)} style={{
                  background: sort === s ? C.txt : C.surf, color: sort === s ? "#fff" : C.mid,
                  border: `1px solid ${C.bord}`, borderRadius: 8, padding: "7px 14px",
                  fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}>{s === "worst" ? "Worst first" : "Most recent"}</button>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {rows.map(r => (
                <div key={r.id} style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12, padding: 16 }}>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
                    <div style={{
                      background: scoreColor(r.overall_score) + "1A",
                      border: `1px solid ${scoreColor(r.overall_score)}44`,
                      borderRadius: 10, padding: "8px 12px", minWidth: 62, textAlign: "center",
                    }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: scoreColor(r.overall_score) }}>{r.overall_score}</div>
                      <div style={{ fontSize: 10, color: C.dim }}>/100</div>
                    </div>

                    <div style={{ flex: "1 1 300px", minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                        <span style={{ fontFamily: "monospace", fontSize: 13, color: C.txt }}>
                          {r.calls?.caller_number || "unknown"}
                        </span>
                        <span style={{ fontSize: 12, color: C.dim }}>
                          {r.calls?.duration_seconds ?? 0}s · {r.calls ? new Date(r.calls.created_at).toLocaleDateString("en-IN") : ""}
                        </span>
                        {r.sentiment === "negative" && (
                          <span style={{ background: C.red + "18", color: C.red, border: `1px solid ${C.red}44`,
                                         borderRadius: 20, padding: "2px 9px", fontSize: 11, fontWeight: 700 }}>negative</span>
                        )}
                        {!r.next_step_captured && (
                          <span style={{ background: C.gold + "18", color: C.gold, border: `1px solid ${C.gold}44`,
                                         borderRadius: 20, padding: "2px 9px", fontSize: 11, fontWeight: 700 }}>no next step</span>
                        )}
                      </div>

                      {r.summary && <div style={{ fontSize: 13, color: C.mid, lineHeight: 1.5 }}>{r.summary}</div>}

                      {(r.risk_flags || []).length > 0 && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                          {(r.risk_flags || []).map(f => (
                            <span key={f} style={{ display: "inline-flex", alignItems: "center", gap: 4,
                                                   color: C.red, fontSize: 12 }}>
                              <AlertTriangle size={12} />{f}
                            </span>
                          ))}
                        </div>
                      )}

                      {r.coaching && (
                        <div style={{ marginTop: 8, background: C.hi, border: `1px solid ${C.bord}`,
                                      borderRadius: 8, padding: "8px 10px", fontSize: 12, color: C.txt,
                                      display: "flex", gap: 7 }}>
                          <TrendingUp size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                          <span>{r.coaching}</span>
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 12, fontSize: 11, color: C.mid }}>
                      {([["Res", r.resolution_score], ["Crt", r.courtesy_score], ["Cmp", r.compliance_score]] as const).map(([l, v]) => (
                        <div key={l} style={{ textAlign: "center" }}>
                          <div style={{ fontWeight: 800, fontSize: 14, color: scoreColor(v) }}>{v}</div>
                          <div>{l}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
