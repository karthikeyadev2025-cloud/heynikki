// app/my-day/page.tsx — one telecaller's own dashboard.
//
// The Desk shows today's count. This shows whether the work is going
// somewhere: today against the target, this week against last, fourteen
// days in a row, what the reviews said, the hour calls actually connect —
// and, at the top, the one thing to do next.
//
// Only this person's numbers are here. Where they stand in the team is a
// position ("2nd of 5"), never a colleague's figures.
"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Clock, Flame, Minus, PhoneCall, Star, Target, Trophy, TriangleAlert } from "lucide-react";
import Shell from "../../components/Shell";
import { NIKKI } from "../../lib/brand";
import { deskApi } from "../../lib/desk-api";

const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border, glow: NIKKI.teal,
  gold: NIKKI.gold, grn: NIKKI.emerald, red: NIKKI.red,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

type Day = { date: string; calls: number; connected: number; talk_seconds: number; booked: number; interested: number };
type Sum = Omit<Day, "date">;
type Me = {
  name: string; today: Day; targets: { daily_calls: number; daily_conversations: number };
  series: Day[]; this_week: Sum; last_week: Sum;
  change: { calls: number | null; connected: number | null; booked: number | null };
  connect_rate: number | null; outcomes: Record<string, number>;
  streak_days: number; best_hour: { hour: number; rate: number; calls: number } | null;
  followups: { overdue: number; later_today: number }; open_leads: number;
  quality: { average: number | null; reviews: number; recent: { score: number; note: string; at: string }[] };
  rank: { position: number; of: number } | null;
};

const dur = (s: number) => s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.round(s / 60)} min`;
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}–${(h + 1) % 12 || 12} ${(h + 1) % 24 < 12 ? "AM" : "PM"}`;
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const shortDay = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short" });
const fullDay = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" });

function Panel({ title, icon, children, style }: { title: string; icon?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section aria-label={title} style={{ background: C.surf, border: "1px solid #E4E9F0", borderRadius: 12, padding: 18, minWidth: 0,
      boxShadow: "0 1px 2px rgba(15,23,42,0.04)", ...style }}>
      <h2 style={{ margin: "0 0 12px", color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 15.5, fontWeight: 700,
        letterSpacing: "-0.01em", display: "flex", alignItems: "center", gap: 8 }}>{icon}{title}</h2>
      {children}
    </section>
  );
}

function Bar({ label, value, target, color }: { label: string; value: number; target: number; color: string }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const met = target > 0 && value >= target;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, marginBottom: 5 }}>
        <span style={{ color: C.mid, fontWeight: 600 }}>{label}</span>
        <span style={{ color: C.txt, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {value}{target > 0 ? ` of ${target}` : ""}{met ? " ✓" : ""}
        </span>
      </div>
      {target > 0 ? (
        <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(value, target)}
          style={{ height: 8, background: C.hi, borderRadius: 999, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: met ? C.grn : color, borderRadius: 999, transition: "width 300ms ease" }} />
        </div>
      ) : <div style={{ fontSize: 12, color: C.dim }}>No target set for this yet.</div>}
    </div>
  );
}

function Change({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ fontSize: 12, color: C.dim }}>no calls last week to compare</span>;
  const up = pct > 0, flat = pct === 0;
  const color = flat ? C.mid : up ? C.grn : C.red;
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color, display: "inline-flex", alignItems: "center", gap: 2 }}>
      {flat ? <Minus size={13} /> : up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {flat ? "same as last week" : `${Math.abs(pct)}% ${up ? "up on" : "down on"} last week`}
    </span>
  );
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div style={{ background: C.hi, borderRadius: 10, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 12, color: C.mid, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, color: C.txt, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1.25 }}>{value}</div>
      {sub && <div style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const OUTCOMES: [string, string, string][] = [
  ["booked", "Booked", C.grn], ["interested", "Interested", C.glow], ["callback", "Callback", C.gold],
  ["not_interested", "Not interested", C.mid], ["no_answer", "No answer", C.dim], ["unsaved", "No outcome saved", C.red],
];

export default function MyDayPage() {
  const [m, setM] = useState<Me | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try { setM(await deskApi("/api/desk/me")); setErr(""); }
    catch (e: any) { if (e.message !== "Signed out") setErr(e.message || "Couldn't load your dashboard."); }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 120_000);
    return () => clearInterval(t);
  }, [load]);

  // The one thing to do next, in the order it matters.
  const next = (() => {
    if (!m) return null;
    const left = Math.max(0, m.targets.daily_calls - m.today.calls);
    if (m.followups.overdue) return { color: C.red, href: "/today?scope=mine",
      text: <><strong>{m.followups.overdue} callback{m.followups.overdue === 1 ? " is" : "s are"} late.</strong> Ring {m.followups.overdue === 1 ? "it" : "them"} first — you gave a time.</>, cta: "Open today's board" };
    if (m.outcomes.unsaved >= 3) return { color: C.gold, href: "/desk",
      text: <><strong>{m.outcomes.unsaved} of this week&apos;s calls have no outcome.</strong> An unsaved outcome loses the lead its next step.</>, cta: "Save them on the Desk" };
    if (m.targets.daily_calls > 0 && left > 0) return { color: C.glow, href: "/desk",
      text: <><strong>{left} more call{left === 1 ? "" : "s"} to today&apos;s target.</strong>{m.followups.later_today ? ` ${m.followups.later_today} callback${m.followups.later_today === 1 ? "" : "s"} due later today.` : ""}</>, cta: "Go to the Desk" };
    if (m.targets.daily_calls > 0) return { color: C.grn, href: "/desk",
      text: <><strong>Today&apos;s target is met.</strong> {m.open_leads} open lead{m.open_leads === 1 ? "" : "s"} still in your name.</>, cta: "Keep going" };
    return { color: C.glow, href: "/desk",
      text: <><strong>{m.open_leads} open lead{m.open_leads === 1 ? "" : "s"} in your name.</strong>{m.followups.later_today ? ` ${m.followups.later_today} callback${m.followups.later_today === 1 ? "" : "s"} due today.` : ""}</>, cta: "Go to the Desk" };
  })();

  const peak = m ? Math.max(1, ...m.series.map(d => d.calls)) : 1;
  const weekOutcomes = m ? OUTCOMES.map(([k, l, c]) => ({ k, l, c, n: m.outcomes[k] || 0 })) : [];
  const outcomeTotal = weekOutcomes.reduce((a, o) => a + o.n, 0);

  return (
    <Shell title="My Dashboard">
      <h1 style={{ margin: 0, color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em" }}>
        {m?.name ? `${m.name}'s Dashboard` : "My Dashboard"}
      </h1>
      <p style={{ margin: "4px 0 14px", color: C.mid, fontSize: 14 }}>Your own calls: today, this week against last, and the last fourteen days.</p>

      {err && (
        <div role="alert" style={{ background: C.red + "11", border: `1px solid ${C.red}44`, color: C.red, borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 14 }}>
          {err} <button type="button" onClick={load} style={{ marginLeft: 8, background: C.red, color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Try again</button>
        </div>
      )}
      {!m && !err && <div style={{ color: C.mid, padding: 40, textAlign: "center" }}>Loading your dashboard…</div>}

      {m && next && (
        <>
          <div role="status" style={{ background: next.color + "10", border: `1px solid ${next.color}44`, borderRadius: 10, padding: "12px 14px",
            marginBottom: 14, display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, color: C.txt, display: "flex", gap: 10, alignItems: "center", flex: "1 1 280px" }}>
              {next.color === C.red ? <TriangleAlert size={16} color={C.red} style={{ flexShrink: 0 }} /> : <PhoneCall size={16} color={next.color} style={{ flexShrink: 0 }} />}
              <span>{next.text}</span>
            </span>
            <a href={next.href} style={{ background: next.color, color: "#fff", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 700, textDecoration: "none", minHeight: 40, display: "inline-flex", alignItems: "center" }}>
              {next.cta}
            </a>
          </div>

          <style>{`
            .me-grid { display: grid; gap: 16px; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; }
            @media (max-width: 900px) { .me-grid { grid-template-columns: minmax(0, 1fr); } }
          `}</style>
          <div className="me-grid">
            <div style={{ display: "grid", gap: 16 }}>
              <Panel title="Today" icon={<Target size={15} />}>
                <div style={{ display: "grid", gap: 14 }}>
                  <Bar label="Calls made" value={m.today.calls} target={m.targets.daily_calls} color={C.glow} />
                  <Bar label="Real conversations" value={m.today.connected} target={m.targets.daily_conversations} color={C.glow} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginTop: 14 }}>
                  <Tile label="Talk time" value={dur(m.today.talk_seconds)} />
                  <Tile label="Booked" value={m.today.booked} />
                  <Tile label="Interested" value={m.today.interested} />
                </div>
              </Panel>

              <Panel title="Last 14 days" icon={<Clock size={15} />}>
                {m.series.every(d => d.calls === 0) ? (
                  <div style={{ fontSize: 13, color: C.dim }}>No calls in the last fourteen days. Your trend starts with your first call from the Desk.</div>
                ) : (
                  <>
                    <div role="img" aria-label={`Calls per day for the last 14 days. Today ${m.today.calls}, of which ${m.today.connected} were conversations.`}
                      style={{ display: "grid", gridTemplateColumns: "repeat(14, minmax(0, 1fr))", gap: 4, alignItems: "end", height: 140 }}>
                      {m.series.map((d, i) => (
                        <div key={d.date} title={`${fullDay(d.date)}: ${d.calls} calls, ${d.connected} conversations, ${d.booked} booked`}
                          style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", gap: 0 }}>
                          <div style={{ height: `${(d.calls / peak) * 100}%`, minHeight: d.calls ? 3 : 0, background: C.glow + "33", borderRadius: "4px 4px 0 0", position: "relative",
                            outline: i === 13 ? `2px solid ${C.glow}` : "none", outlineOffset: 1 }}>
                            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: d.calls ? `${(d.connected / d.calls) * 100}%` : 0, background: C.glow, borderRadius: d.connected === d.calls ? "4px 4px 0 0" : 0 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div aria-hidden style={{ display: "grid", gridTemplateColumns: "repeat(14, minmax(0, 1fr))", gap: 4, marginTop: 4 }}>
                      {m.series.map((d, i) => (
                        <div key={d.date} style={{ fontSize: 11, textAlign: "center", color: i === 13 ? C.txt : C.dim, fontWeight: i === 13 ? 700 : 500, overflow: "hidden" }}>
                          {i === 13 ? "Today" : shortDay(d.date).slice(0, 2)}
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12, color: C.mid, flexWrap: "wrap" }}>
                      <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: C.glow + "33", marginRight: 5 }} />Calls made</span>
                      <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: C.glow, marginRight: 5 }} />Real conversations</span>
                    </div>
                  </>
                )}
              </Panel>

              <Panel title="This week against last" icon={<ArrowUpRight size={15} />}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                  <Tile label="Calls" value={m.this_week.calls} sub={<Change pct={m.change.calls} />} />
                  <Tile label="Conversations" value={m.this_week.connected} sub={<Change pct={m.change.connected} />} />
                  <Tile label="Booked" value={m.this_week.booked} sub={<Change pct={m.change.booked} />} />
                  <Tile label="Calls that connect" value={m.connect_rate === null ? "—" : `${m.connect_rate}%`}
                    sub={<span style={{ fontSize: 12, color: C.dim }}>of the last 7 days</span>} />
                </div>
              </Panel>
            </div>

            <div style={{ display: "grid", gap: 16 }}>
              <Panel title="How it's going" icon={<Trophy size={15} />}>
                <div style={{ display: "grid", gap: 12, fontSize: 13.5, color: C.txt, lineHeight: 1.5 }}>
                  <div style={{ display: "flex", gap: 10 }}>
                    <Flame size={16} color={m.streak_days ? C.gold : C.dim} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>{m.targets.daily_calls <= 0 ? "No daily target is set yet, so there is no streak to keep."
                      : m.streak_days ? <><strong>{m.streak_days} day{m.streak_days === 1 ? "" : "s"} in a row</strong> on target.</>
                      : "No streak yet — hit today's calls target to start one."}</span>
                  </div>
                  {m.rank && (
                    <div style={{ display: "flex", gap: 10 }}>
                      <Trophy size={16} color={m.rank.position === 1 ? C.gold : C.dim} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span><strong>{ordinal(m.rank.position)} of {m.rank.of}</strong> in the team this week, by bookings.</span>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10 }}>
                    <Clock size={16} color={m.best_hour ? C.glow : C.dim} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>{m.best_hour
                      ? <><strong>{hourLabel(m.best_hour.hour)}</strong> is when your calls connect most: {Math.round(m.best_hour.rate * 100)}% of {m.best_hour.calls} calls became a conversation.</>
                      : "Not enough calls yet to say which hour works best for you."}</span>
                  </div>
                </div>
              </Panel>

              <Panel title="This week's outcomes">
                {outcomeTotal === 0 ? <div style={{ fontSize: 13, color: C.dim }}>No calls this week yet.</div> : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {weekOutcomes.filter(o => o.n > 0).map(o => (
                      <div key={o.k}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
                          <span style={{ color: o.k === "unsaved" ? C.red : C.mid, fontWeight: 600 }}>{o.l}</span>
                          <span style={{ color: C.txt, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{o.n}</span>
                        </div>
                        <div style={{ height: 6, background: C.hi, borderRadius: 999 }}>
                          <div style={{ width: `${(o.n / outcomeTotal) * 100}%`, height: "100%", background: o.c, borderRadius: 999 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Call reviews" icon={<Star size={15} />}>
                {m.quality.average === null ? (
                  <div style={{ fontSize: 13, color: C.dim }}>No calls reviewed yet. When the owner scores a call, the score and their note show here.</div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 26, fontWeight: 700, color: C.txt, fontVariantNumeric: "tabular-nums" }}>{m.quality.average.toFixed(1)}</span>
                      <span style={{ fontSize: 13, color: C.mid }}>out of 5 · {m.quality.reviews} review{m.quality.reviews === 1 ? "" : "s"}</span>
                    </div>
                    {m.quality.recent.map((r, i) => (
                      <div key={i} style={{ borderLeft: `2px solid ${r.score >= 4 ? C.grn : r.score === 3 ? C.gold : C.red}`, paddingLeft: 10, marginTop: 10 }}>
                        <div style={{ fontSize: 13.5, color: C.txt, lineHeight: 1.45, overflowWrap: "anywhere" }}>{r.note}</div>
                        <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{r.score} of 5</div>
                      </div>
                    ))}
                  </>
                )}
              </Panel>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
