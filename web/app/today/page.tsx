// app/today/page.tsx — the day as a board.
//
// Every customer who needs something TODAY, in the order the work should be
// done: promises that are already late, then calls nobody returned, then
// people who rang in new, then who is coming in. The last column is what
// the day has produced so far.
//
// One card shape throughout, and one action on every card: Call, which
// opens the Desk with that number ready — the board is where you see the
// day, the Desk is where you work it.
"use client";
import { useCallback, useEffect, useState } from "react";
import { BellRing, CalendarCheck, CircleCheck, PhoneCall, PhoneMissed, RefreshCw, Sparkles, UserPlus } from "lucide-react";
import Shell from "../../components/Shell";
import { toast } from "../../components/Toast";
import { NIKKI } from "../../lib/brand";
import { deskApi } from "../../lib/desk-api";

const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border, glow: NIKKI.teal,
  gold: NIKKI.gold, grn: NIKKI.emerald, red: NIKKI.red,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

type Card = {
  id: string; phone: string; name: string | null; lead_id?: string | null;
  at?: string; time?: string | null; overdue?: boolean; note?: string | null; by?: string | null;
  times?: number; outcome?: string; status?: string; ref?: string | null;
};
type Board = {
  date: string; scope: "team" | "mine"; can_see_team: boolean;
  columns: { callbacks: Card[]; missed: Card[]; new_leads: Card[]; appointments: Card[]; done: Card[] };
  counts: { overdue: number; callbacks: number; appointments: number; missed: number; new_leads: number; done: number };
};

const pretty = (n: string) => n.length === 10 ? `${n.slice(0, 5)} ${n.slice(5)}` : n || "Unknown";
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
const slot = (t: string | null | undefined) => {
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? `${+m[1] % 12 || 12}:${m[2]} ${+m[1] < 12 ? "AM" : "PM"}` : "Time not set";
};
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m} min late` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min late` : `${Math.floor(m / 1440)} day${m >= 2880 ? "s" : ""} late`;
};
const callHref = (c: Card) => `/desk?call=${c.phone}${c.lead_id ? `&lead=${c.lead_id}` : ""}`;

function Column({ title, icon, color, cards, empty, children }: {
  title: string; icon: React.ReactNode; color: string; cards: Card[]; empty: string;
  children: (c: Card) => React.ReactNode;
}) {
  return (
    <section aria-label={title} style={{ background: C.hi, borderRadius: 12, padding: 12, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: C.txt }}>
        <span style={{ color, display: "inline-flex" }}>{icon}</span>{title}
        <span style={{ marginLeft: "auto", background: cards.length ? color : C.bord, color: cards.length ? "#fff" : C.mid,
          borderRadius: 999, padding: "1px 9px", fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{cards.length}</span>
      </h2>
      {cards.length === 0
        ? <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.5, padding: "4px 2px" }}>{empty}</div>
        : cards.map(c => <div key={c.id}>{children(c)}</div>)}
    </section>
  );
}

function CardBox({ c, accent, top, children }: { c: Card; accent: string; top: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderLeft: `3px solid ${accent}`, borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: accent, marginBottom: 2 }}>{top}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, overflowWrap: "anywhere" }}>{c.name || pretty(c.phone)}</div>
      {c.name && <div style={{ fontSize: 12.5, color: C.mid, fontVariantNumeric: "tabular-nums" }}>{pretty(c.phone)}</div>}
      {c.note && <div style={{ fontSize: 13, color: C.mid, marginTop: 4, lineHeight: 1.45, overflowWrap: "anywhere" }}>{c.note}</div>}
      {c.by && <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>{c.by}</div>}
      {children && <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>{children}</div>}
    </div>
  );
}

const act = (bg: string, fg = "#fff"): React.CSSProperties => ({
  background: bg, color: fg, border: "none", borderRadius: 8, padding: "7px 12px", minHeight: 36, fontSize: 13, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none",
});

export default function TodayPage() {
  const [b, setB] = useState<Board | null>(null);
  const [err, setErr] = useState("");
  // "?scope=mine" is how My Dashboard links here.
  const [scope, setScope] = useState<"team" | "mine">("team");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("scope") === "mine") setScope("mine");
  }, []);
  const [busy, setBusy] = useState("");
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const j: Board = await deskApi(`/api/desk/day-board?scope=${scope}`);
      setB(j); setErr(""); setLoadedAt(new Date());
    } catch (e: any) { if (e.message !== "Signed out") setErr(e.message || "Couldn't load today's board."); }
  }, [scope]);
  useEffect(() => {
    load();
    // A board that is a minute stale is fine; one from this morning is not.
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function done(c: Card) {
    setBusy(c.id);
    try {
      await deskApi("/api/desk/followup", { lead_id: c.lead_id, at: null });
      toast.ok("Callback marked done.");
      await load();
    } catch (e: any) { toast.err(e.message); }
    setBusy("");
  }

  const k = b?.counts;
  const dateLine = b ? new Date(b.date + "T00:00:00Z").toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }) : "";

  return (
    <Shell title="Today">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: 0, color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>
            Today&apos;s board
          </h1>
          <p style={{ margin: "4px 0 0", color: C.mid, fontSize: 14 }}>
            {dateLine}{dateLine ? " · " : ""}everyone who needs something today, most urgent first.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {b?.can_see_team && (
            <div role="radiogroup" aria-label="Whose work" style={{ display: "flex", gap: 4, background: C.hi, borderRadius: 9, padding: 4 }}>
              {(["team", "mine"] as const).map(s => (
                <button key={s} type="button" role="radio" aria-checked={scope === s} onClick={() => setScope(s)}
                  style={{ ...act(scope === s ? C.surf : "transparent", scope === s ? C.txt : C.mid), boxShadow: scope === s ? "0 1px 2px rgba(15,23,42,0.12)" : "none" }}>
                  {s === "team" ? "Whole team" : "Mine"}
                </button>
              ))}
            </div>
          )}
          <button type="button" style={act(C.hi, C.txt)} onClick={load} aria-label="Refresh the board">
            <RefreshCw size={14} /> {loadedAt ? `Updated ${loadedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : "Refresh"}
          </button>
        </div>
      </div>

      {err && (
        <div role="alert" style={{ background: C.red + "11", border: `1px solid ${C.red}44`, color: C.red, borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 14 }}>
          {err} <button type="button" style={{ ...act(C.red), marginLeft: 8 }} onClick={load}>Try again</button>
        </div>
      )}

      {!b && !err && <div style={{ color: C.mid, padding: 40, textAlign: "center" }}>Loading today&apos;s board…</div>}

      {b && k && (
        <>
          {/* What to do first, in one line. */}
          <div role="status" style={{
            background: k.overdue ? C.red + "0F" : k.missed ? C.gold + "14" : C.grn + "10",
            border: `1px solid ${(k.overdue ? C.red : k.missed ? C.gold : C.grn)}44`,
            borderRadius: 10, padding: "12px 14px", marginBottom: 14, fontSize: 14, color: C.txt, display: "flex", gap: 10, alignItems: "center" }}>
            <Sparkles size={16} color={k.overdue ? C.red : k.missed ? C.gold : C.grn} style={{ flexShrink: 0 }} />
            <span>
              {k.overdue ? <><strong>{k.overdue} promised callback{k.overdue === 1 ? " is" : "s are"} late.</strong> Start there — these customers were told a time.</>
                : k.missed ? <><strong>{k.missed} missed call{k.missed === 1 ? "" : "s"} not returned yet.</strong> Ring them back before they ring someone else.</>
                : k.callbacks ? <><strong>Nothing is late.</strong> {k.callbacks} callback{k.callbacks === 1 ? "" : "s"} still to come today.</>
                : k.new_leads ? <><strong>Nothing is late.</strong> {k.new_leads} new lead{k.new_leads === 1 ? "" : "s"} waiting for a first call.</>
                : <><strong>All clear.</strong> No callbacks, missed calls or new leads waiting.</>}
            </span>
          </div>

          <style>{`
            .day-board { display: grid; gap: 12px; grid-template-columns: repeat(5, minmax(0, 1fr)); align-items: start; }
            @media (max-width: 1280px) { .day-board { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
            @media (max-width: 900px)  { .day-board { grid-template-columns: minmax(0, 1fr); } }
          `}</style>
          <div className="day-board">
            <Column title="Callbacks" icon={<BellRing size={16} />} color={k.overdue ? C.red : C.gold} cards={b.columns.callbacks}
              empty="No callbacks due today. When a customer asks to be rung later, set it on the Desk and it appears here.">
              {c => (
                <CardBox c={c} accent={c.overdue ? C.red : C.gold} top={c.overdue ? `${clock(c.at!)} · ${ago(c.at!)}` : `Due ${clock(c.at!)}`}>
                  <a href={callHref(c)} style={act(C.grn)}><PhoneCall size={14} /> Call</a>
                  <button type="button" style={act(C.hi, C.txt)} disabled={busy === c.id} onClick={() => done(c)}>
                    {busy === c.id ? "Saving…" : "Done"}
                  </button>
                </CardBox>
              )}
            </Column>

            <Column title="Missed calls" icon={<PhoneMissed size={16} />} color={C.red} cards={b.columns.missed}
              empty="Every missed call today has been returned or got through later.">
              {c => (
                <CardBox c={c} accent={C.red} top={`Rang ${clock(c.at!)}${(c.times || 1) > 1 ? ` · ${c.times} times` : ""}`}>
                  <a href={callHref(c)} style={act(C.grn)}><PhoneCall size={14} /> Call back</a>
                </CardBox>
              )}
            </Column>

            <Column title="New today" icon={<UserPlus size={16} />} color={C.glow} cards={b.columns.new_leads}
              empty="No new leads waiting for a first call.">
              {c => (
                <CardBox c={c} accent={C.glow} top={`Came in ${clock(c.at!)}`}>
                  <a href={callHref(c)} style={act(C.grn)}><PhoneCall size={14} /> Call</a>
                </CardBox>
              )}
            </Column>

            <Column title="Coming in" icon={<CalendarCheck size={16} />} color={C.glow} cards={b.columns.appointments}
              empty="No appointments booked for today.">
              {c => (
                <CardBox c={c} accent={c.status === "no_show" ? C.red : c.status === "completed" ? C.grn : C.glow}
                  top={`${slot(c.time)}${c.ref ? ` · No. ${c.ref}` : ""}${c.status === "completed" ? " · came" : c.status === "no_show" ? " · didn't come" : ""}`}>
                  <a href={callHref(c)} style={act(C.hi, C.txt)}><PhoneCall size={14} /> Call</a>
                </CardBox>
              )}
            </Column>

            <Column title="Won today" icon={<CircleCheck size={16} />} color={C.grn} cards={b.columns.done}
              empty="No bookings or interested customers yet today. They appear here as outcomes are saved.">
              {c => (
                <CardBox c={c} accent={C.grn} top={`${c.outcome === "booked" ? "Booked" : "Interested"} · ${clock(c.at!)}`} />
              )}
            </Column>
          </div>
        </>
      )}
    </Shell>
  );
}
