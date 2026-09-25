"use client";

/**
 * The Human Desk — the second brain.
 *
 * The marketing page has promised "two brains, one number" from the start:
 * Nikki, and the business's own people on the same line. The server side of
 * that (click-to-call, the human/hybrid ring group, seat phones) has existed
 * since the CRM migrations — but nothing in the dashboard let a business
 * SEE or USE it. Routing mode was a super-admin table, the seat's phone was a
 * lone field on /setup, and the only dial button lived on a lead card.
 *
 * This page is the desk: dial any number (your phone rings first, then the
 * customer, who sees the business number), watch calls that are live right
 * now, choose whether Nikki or your team answers the number, and give every
 * seat a phone so it rings.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "../../components/Toast";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import { NIKKI } from "../../lib/brand";
import {
  Headset, PhoneCall, PhoneOff, Radio, Users, Bot, GitBranch, Check,
  Clock, Pencil, X, PhoneIncoming, PhoneOutgoing, LogIn, LogOut, Target,
  ListChecks, SkipForward, MessageCircle, Play, Pause, Star, Bell, Sparkles, CalendarClock,
  ChartColumn, TriangleAlert,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";
const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, acc: NIKKI.terracotta,
  gold: NIKKI.gold, grn: NIKKI.emerald, red: NIKKI.red, cyn: NIKKI.cyan,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

type Seat = {
  id: string; user_id: string; role: string; phone: string | null;
  display_name: string | null; email: string | null; is_you: boolean;
  outbound_did?: string | null;   // their own calling number (065); null = shared
};
type Recent = {
  id: string; number: string; lead_id: string | null; lead_name: string | null;
  lead_stage: string | null; by: string | null; disposition: string | null;
  notes: string | null; duration_seconds: number; created_at: string; live: boolean;
  call_id?: string | null; has_recording?: boolean; ai_summary?: string | null;
  ai_disposition?: string | null;
  qa_score?: number | null; qa_note?: string | null;
};
/** A lead as the queue and the customer card see it. */
type QLead = {
  id: string; name: string | null; phone: string; stage: string; score: number | null;
  interest: string | null; notes: string | null; call_count: number | null;
  last_contacted_at: string | null; assigned_to: string | null;
  follow_up_at: string | null; follow_up_note: string | null; follow_up_done_at: string | null;
};
/** What the queue hands the dialer: a number, which lead it is, and whether to ring now. */
type Prefill = { n: string; k: number; leadId?: string | null; auto?: boolean };
type TeamCall = {
  id: string; number: string; status: "transferred" | "missed"; duration_seconds: number;
  created_at: string; wa_sent: boolean; has_recording: boolean; lead_id: string | null; lead_name: string | null;
};
type Desk = {
  did: string | null; routing_mode: "ai" | "hybrid" | "human"; seats: Seat[];
  numbers?: { number: string; use_for_outbound: boolean }[];
  ring_count: number; you: { id: string; role: string; phone: string | null; display_name: string | null; outbound_did?: string | null } | null;
  you_are_owner: boolean; recent: Recent[]; team_calls: TeamCall[];
  // Shifts and targets (migration 061). attendance_ready is false until the
  // migration is applied; the cards say so instead of breaking.
  attendance_ready?: boolean; conversation_secs?: number;
  you_today?: DayStats | null; team_today?: (DayStats & TeamDay)[] | null;
};
type DayStats = {
  checked_in: boolean; since: string | null; first_in: string | null; worked_seconds: number; earlier_seconds: number;
  calls: number; conversations: number; target_calls: number; target_conversations: number;
};
type TeamDay = { member_id: string; user_id: string; name: string | null; is_you: boolean };
type LiveCall = {
  id: string; caller_number: string; direction: string; intent: string | null;
  created_at: string; status: string;
};
type LeadLite = { id: string; name: string | null; stage: string; interest: string | null; notes: string | null; call_count: number };

const OUTCOMES: { key: string; label: string; color: string; hint: string }[] = [
  { key: "booked",         label: "Booked",         color: C.grn,  hint: "Lead moves to Won" },
  { key: "interested",     label: "Interested",     color: C.cyn,  hint: "Lead moves to Qualified" },
  { key: "callback",       label: "Call back",      color: C.gold, hint: "Stays in Contacted" },
  { key: "not_interested", label: "Not interested", color: C.red,  hint: "Lead moves to Lost" },
  { key: "no_answer",      label: "No answer",      color: C.dim,  hint: "Back to New" },
];
const OUTCOME_COLOR: Record<string, string> = Object.fromEntries(OUTCOMES.map(o => [o.key, o.color]));
const OUTCOME_LABEL: Record<string, string> = Object.fromEntries(OUTCOMES.map(o => [o.key, o.label]));

const fmtDur = (s: number) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** The carrier's reason a Desk call never reached the customer, in words. */
const failText = (cause: string): string => {
  const c = cause.toUpperCase();
  if (/UNALLOCATED_NUMBER|INVALID_NUMBER_FORMAT|NO_ROUTE_DESTINATION/.test(c)) return "this number doesn't exist. Check it before calling again.";
  if (/USER_BUSY/.test(c)) return "busy on another call. Try again in a few minutes.";
  if (/NO_ANSWER|NO_USER_RESPONSE|ALLOTTED_TIMEOUT/.test(c)) return "it rang but nobody answered.";
  if (/CALL_REJECTED/.test(c)) return "they rejected the call.";
  if (/ORIGINATOR_CANCEL/.test(c)) return "you hung up before they answered.";
  if (/NORMAL_TEMPORARY_FAILURE|INTERWORKING|SWITCH_CONGESTION|NETWORK_OUT_OF_ORDER|RECOVERY_ON_TIMER_EXPIRE/.test(c))
    return "the phone network couldn't connect. Try again in a minute.";
  return "switched off, out of coverage, or not reachable right now. Redialling straight away won't help.";
};
/** A Date/ISO as a datetime-local value, in the browser's time. */
const toLocalInput = (iso: string) => {
  const t = new Date(iso); if (isNaN(t.getTime())) return "";
  return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
/** Tomorrow 11:00, or in two hours if that is still today and before 7 pm. */
const defaultCallback = () => {
  const n = new Date(); const inTwo = new Date(n.getTime() + 2 * 3600e3);
  if (inTwo.getDate() === n.getDate() && inTwo.getHours() < 19) return inTwo.toISOString();
  const t = new Date(n); t.setDate(t.getDate() + 1); t.setHours(11, 0, 0, 0); return t.toISOString();
};
const elapsed = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
const digits10 = (v: string) => v.replace(/\D/g, "").slice(-10);
const prettyNum = (n: string) => n.length === 10 ? `${n.slice(0, 5)} ${n.slice(5)}` : n;

function Card({ title, icon, children, style, right }: {
  title: React.ReactNode; icon?: React.ReactNode; children: React.ReactNode;
  style?: React.CSSProperties; right?: React.ReactNode;
}) {
  return (
    <section style={{ background: C.surf, border: "1px solid #E4E9F0", borderRadius: 12, padding: 18, minWidth: 0,
      boxShadow: "0 1px 2px rgba(15,23,42,0.04)", ...style }}>
      {/* flexWrap + minWidth:0 — "Dial a number" beside "rings +91 90000
          00001 first" could not shrink on a phone, and that single row set
          a 436px floor under the whole column. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 15.5, fontWeight: 700,
          letterSpacing: "-0.01em", display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {icon}{title}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  background: C.hi, border: `1px solid ${C.bord}`, borderRadius: 8, padding: "9px 12px",
  color: C.txt, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", width: "100%",
};
const btnStyle = (color: string, on = true): React.CSSProperties => ({
  background: on ? color : C.hi, color: on ? "#fff" : C.dim, border: "none", borderRadius: 8,
  padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: on ? "pointer" : "not-allowed",
  fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6,
});

export default function DeskPage() {
  const [d, setD] = useState<Desk | null>(null);
  const [err, setErr] = useState("");
  const [live, setLive] = useState<LiveCall[]>([]);
  const [tick, setTick] = useState(0);
  // A number handed to the dialer from the lists below ("call back").
  const [prefill, setPrefill] = useState<Prefill>({ n: "", k: 0 });
  const callBack = (n: string) => { setPrefill(p => ({ n, k: p.k + 1 })); window.scrollTo({ top: 0, behavior: "smooth" }); };
  // From the queue: straight to ringing, with the lead attached.
  const callLead = (l: QLead) => { setPrefill(p => ({ n: digits10(l.phone), k: p.k + 1, leadId: l.id, auto: true })); };
  // Bumped after every saved outcome so the queue fetches the next lead.
  const [queueKey, setQueueKey] = useState(0);
  const afterCall = () => { load(); setQueueKey(k => k + 1); };

  const token = useCallback(async () => {
    const { data: { session } } = await createClient().auth.getSession();
    return session?.access_token || "";
  }, []);
  const api = useCallback(async (path: string, body?: any) => {
    const t = await token();
    const r = await fetch(`${API}${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${t}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }, [token]);

  const load = useCallback(async () => {
    try { setD(await api("/api/desk")); setErr(""); }
    catch (e: any) { setErr(e.message); }
  }, [api]);

  // Live calls straight from the table under RLS, the way the Reception
  // page does — a call is "live" while its row is still `active`.
  const loadLive = useCallback(async () => {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = "/login"; return; }
    const { data } = await sb.from("calls")
      .select("id, caller_number, direction, intent, created_at, status")
      .eq("status", "active").order("created_at", { ascending: false }).limit(10);
    setLive((data || []) as LiveCall[]);
  }, []);

  useEffect(() => { load(); loadLive(); }, [load, loadLive]);
  useEffect(() => {
    const t = setInterval(() => { loadLive(); setTick(x => x + 1); }, 4000);
    return () => clearInterval(t);
  }, [loadLive]);

  return (
    <Shell title="Human Desk">
      <div style={{ maxWidth: 1100 }}>
        <p style={{ color: C.mid, fontSize: 13.5, margin: "0 0 18px", maxWidth: 680, lineHeight: 1.6 }}>
          Your team on the same number as Nikki. Dial out from here — your phone rings first, then the
          customer, who sees {(() => {
            if (d?.you?.outbound_did) {
              return <><strong style={{ color: C.txt }}>{prettyNum(d.you.outbound_did)}</strong> — your calling number. Customers who ring it back reach you first while you&apos;re checked in</>;
            }
            const out = (d?.numbers || []).filter(n => n.use_for_outbound);
            return out.length > 1
              ? <>one of <strong style={{ color: C.txt }}>{out.map(n => prettyNum(n.number)).join(" / ")}</strong> — always the same one for that customer</>
              : <strong style={{ color: C.txt }}>{out[0] ? prettyNum(out[0].number) : d?.did ? prettyNum(d.did) : "your business number"}</strong>;
          })()}.
          Choose who answers incoming calls, and give every seat a phone so it rings.
        </p>
        {err && (
          <div style={{ background: C.red + "11", border: `1px solid ${C.red}44`, color: C.red, borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
            {err}
          </div>
        )}

        <div className="desk-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)", gap: 16, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 16 }}>
            <Shift d={d} api={api} onChanged={load} tick={tick} />
            <NextCall api={api} onCall={callLead} reloadKey={queueKey} />
            <Dialer d={d} api={api} onDone={afterCall} prefill={prefill} />
            <LiveBoard calls={live} tick={tick} />
            <NeedsCallback d={d} onCallBack={callBack} />
            <TeamCalls d={d} onCallBack={callBack} />
            <RecentCalls d={d} api={api} onSaved={load} />
          </div>
          <div style={{ display: "grid", gap: 16 }}>
            {d?.you_are_owner && <Insights api={api} />}
            <Stats d={d} api={api} reloadKey={queueKey} />
            <TeamToday d={d} api={api} onSaved={load} tick={tick} />
            <Routing d={d} api={api} onSaved={load} />
            <Numbers d={d} api={api} onSaved={load} />
            <Seats d={d} api={api} onSaved={load} />
          </div>
        </div>
      </div>
      <style>{`
        /* minmax(0,1fr), not 1fr. A bare 1fr is minmax(auto,1fr), so the
           column refuses to go below the widest card's min-content — the
           dialer row and the card headers — and on a 360px phone the whole
           page grew to 488px and scrolled sideways. */
        @media (max-width: 900px) { .desk-grid { grid-template-columns: minmax(0, 1fr) !important; } }
        @keyframes deskpulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
      `}</style>
    </Shell>
  );
}

// ── Next call (the queue) ──────────────────────────────────────────────
// Callbacks that are due, then the next lead to ring: the telecaller's own
// leads first, then the shared pool, hottest first. "Call" rings straight
// away; "Skip" moves on for this session only. A callback coming due also
// raises a browser notification while the Desk is open.
function NextCall({ api, onCall, reloadKey }: {
  api: (p: string, b?: any) => Promise<any>; onCall: (l: QLead) => void; reloadKey: number;
}) {
  const [q, setQ] = useState<{ due: QLead[]; next: QLead | null; mine_open: number; pool_open: number } | null>(null);
  const [err, setErr] = useState("");
  const [skip, setSkip] = useState<string[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const [notif, setNotif] = useState<string>(() =>
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported");

  const load = useCallback(async () => {
    try {
      const j = await api(`/api/desk/queue${skip.length ? `?skip=${skip.join(",")}` : ""}`);
      setQ(j); setErr("");
      // Notify once per callback as it comes due.
      for (const l of j.due as QLead[]) {
        if (seen.current.has(l.id)) continue;
        seen.current.add(l.id);
        if (notif === "granted" && l.follow_up_at && new Date(l.follow_up_at).getTime() <= Date.now() + 10 * 60e3) {
          try { new Notification(`Call back ${l.name || prettyNum(digits10(l.phone))}`, { body: l.follow_up_note || `Due ${fmtTime(l.follow_up_at)}` }); } catch {}
        }
      }
    } catch (e: any) { setErr(e.message); }
  }, [api, skip, notif]);

  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => { const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  const overdue = (l: QLead) => !!l.follow_up_at && new Date(l.follow_up_at).getTime() < Date.now();
  const n = q?.next;

  return (
    <Card title="Next call" icon={<ListChecks size={15} />}
      right={notif === "default"
        ? <button onClick={async () => setNotif(await Notification.requestPermission())}
            style={{ background: "none", border: "none", color: C.glow, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", gap: 4, alignItems: "center" }}>
            <Bell size={12} /> remind me here
          </button>
        : q ? <span style={{ fontSize: 12, color: C.dim }}>{q.mine_open} yours · {q.pool_open} unassigned</span> : null}>
      {err ? <div style={{ fontSize: 13, color: C.red }}>{err}</div> : !q ? <div style={{ fontSize: 13, color: C.dim }}>Loading…</div> : (
        <div style={{ display: "grid", gap: 10 }}>
          {q.due.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Callbacks due · {q.due.length}
              </div>
              {q.due.map(l => (
                <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, background: C.hi, borderRadius: 8, padding: "8px 10px",
                  border: `1px solid ${overdue(l) ? C.red + "66" : C.gold + "55"}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: C.txt }}>{l.name || prettyNum(digits10(l.phone))}</div>
                    <div style={{ fontSize: 11.5, color: overdue(l) ? C.red : C.mid }}>
                      {overdue(l) ? "overdue · " : ""}{l.follow_up_at ? fmtTime(l.follow_up_at) : ""}{l.follow_up_note ? ` · ${l.follow_up_note}` : ""}
                    </div>
                  </div>
                  <button style={btnStyle(C.grn)} onClick={() => onCall(l)}><PhoneCall size={13} /> Call</button>
                </div>
              ))}
            </div>
          )}
          {n ? (
            <div style={{ background: C.hi, border: `1px solid ${C.bord}`, borderRadius: 10, padding: "11px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong style={{ color: C.txt, fontSize: 15 }}>{n.name || "Unnamed lead"}</strong>
                <span style={{ fontSize: 12.5, color: C.mid, fontVariantNumeric: "tabular-nums" }}>{prettyNum(digits10(n.phone))}</span>
                <span style={{ background: C.bg, borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 700, color: C.glow }}>{n.stage}</span>
                {n.score != null && <span style={{ fontSize: 11.5, color: n.score >= 60 ? C.grn : C.dim, fontWeight: 700 }}>score {n.score}</span>}
                {!n.assigned_to && <span style={{ fontSize: 11, color: C.dim }}>· unassigned</span>}
              </div>
              <div style={{ fontSize: 12.5, color: C.mid, marginTop: 5, lineHeight: 1.5 }}>
                {n.interest ? <>Wants: {n.interest}. </> : null}
                {n.last_contacted_at ? <>Last contacted {fmtTime(n.last_contacted_at)}. </> : <>Not called yet. </>}
                {n.notes ? <span style={{ color: C.dim }}>“{n.notes.slice(0, 140)}{n.notes.length > 140 ? "…" : ""}”</span> : null}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button style={btnStyle(C.grn)} onClick={() => onCall(n)}><PhoneCall size={14} /> Call now</button>
                <button style={{ ...btnStyle(C.hi), border: `1px solid ${C.bord}` }} onClick={() => setSkip(s => [...s, n.id])}>
                  <SkipForward size={14} color={C.mid} /><span style={{ color: C.mid }}>Skip</span>
                </button>
                <a href={`/leads?lead=${n.id}`} style={{ marginLeft: "auto", alignSelf: "center", color: C.glow, fontSize: 12 }}>open lead →</a>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: C.dim }}>
              {q.due.length ? "No other leads waiting." : "Nothing waiting — every open lead was contacted in the last day. New leads and callbacks appear here."}
              {skip.length > 0 && <> <button onClick={() => setSkip([])} style={{ background: "none", border: "none", color: C.glow, cursor: "pointer", fontSize: 13 }}>Show skipped ({skip.length})</button></>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Customer card ──────────────────────────────────────────────────────
// Everything the Desk knows about the number in the dialer: the lead, the
// promised callback, what was said on earlier calls, bookings and orders.
function CustomerCard({ api, phone }: { api: (p: string, b?: any) => Promise<any>; phone: string }) {
  const [c, setC] = useState<any>(null);
  useEffect(() => {
    let cancelled = false; setC(null);
    api(`/api/desk/customer?phone=${phone}`).then(j => { if (!cancelled) setC(j); }).catch(() => {});
    return () => { cancelled = true; };
  }, [api, phone]);
  if (!c) return null;
  const inbound = (c.calls || []).filter((x: any) => x.direction === "inbound").length;
  const desk = (c.desk || []).filter((x: any) => x.disposition || x.notes || x.ai_summary).slice(0, 3);
  const nothing = !c.lead && !c.calls?.length && !desk.length && !c.appointments?.length && !c.orders?.length;
  if (nothing && !c.opted_out) return null;
  return (
    <div style={{ marginTop: 10, background: C.hi, border: `1px solid ${C.bord}`, borderRadius: 8, padding: "10px 12px", fontSize: 12.5, color: C.mid, display: "grid", gap: 6 }}>
      {c.opted_out && (
        <div style={{ color: C.red, fontWeight: 700, display: "flex", gap: 6, alignItems: "center" }}>
          <TriangleAlert size={14} /> This number asked not to be called.
        </div>
      )}
      <div>
        {c.calls?.length ? <>{c.calls.length} call{c.calls.length === 1 ? "" : "s"} on record ({inbound} incoming). </> : null}
        {c.lead?.follow_up_at && !c.lead?.follow_up_done_at && (
          <span style={{ color: C.gold, fontWeight: 700 }}>Callback promised for {fmtTime(c.lead.follow_up_at)}{c.lead.follow_up_note ? ` — ${c.lead.follow_up_note}` : ""}. </span>
        )}
      </div>
      {desk.map((x: any) => (
        <div key={x.id} style={{ borderLeft: `2px solid ${OUTCOME_COLOR[x.disposition] || C.bord}`, paddingLeft: 8 }}>
          <span style={{ color: C.dim }}>{fmtTime(x.created_at)}</span>
          {x.disposition && <> · <strong style={{ color: OUTCOME_COLOR[x.disposition] || C.txt }}>{OUTCOME_LABEL[x.disposition] || x.disposition}</strong></>}
          {(x.ai_summary || x.notes) && <div style={{ color: C.mid }}>{x.notes || x.ai_summary}</div>}
        </div>
      ))}
      {c.appointments?.length > 0 && (
        <div>Bookings: {c.appointments.map((a: any) => `${a.service || "appointment"} ${a.slot_date || ""} ${a.slot_time || ""} (${a.status})`.replace(/\s+/g, " ")).join("; ")}</div>
      )}
      {c.orders?.length > 0 && (
        <div>Orders: {c.orders.map((o: any) => `${o.reference} (${o.status})`).join(", ")}</div>
      )}
    </div>
  );
}

// ── What the calls taught us (owner) ───────────────────────────────────
// The day's Desk calls read together: objections, questions, what worked,
// tips, a line per telecaller — and answers Nikki could learn, which reach
// live calls only when the owner approves them.
function Insights({ api }: { api: (p: string, b?: any) => Promise<any> }) {
  const [st, setSt] = useState<{ insight: any; ready: boolean; today?: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const load = useCallback(() => { api("/api/desk/insights").then(setSt).catch(() => setSt({ insight: null, ready: false })); }, [api]);
  useEffect(() => { load(); }, [load]);
  if (!st || !st.ready) return null;
  const ins = st.insight;
  async function run() {
    setBusy("run");
    try { const j = await api("/api/desk/insights/run", {}); setSt(v => ({ ...(v as any), insight: j.insight })); }
    catch (e: any) { toast.err(e.message); }
    setBusy("");
  }
  async function act(sid: string, action: "approve" | "dismiss", answer: string) {
    setBusy(sid);
    try {
      const j = await api(`/api/desk/insights/${ins.id}/suggestion`, { suggestion_id: sid, action, answer });
      setSt(v => ({ ...(v as any), insight: { ...ins, suggestions: j.suggestions } }));
      if (action === "approve") toast.ok("Nikki will use this answer from the next call.");
    } catch (e: any) { toast.err(e.message); }
    setBusy("");
  }
  const list = (title: string, items: string[]) => items?.length ? (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: C.mid, lineHeight: 1.55 }}>
        {items.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </div>
  ) : null;
  const dg = ins?.digest || {};
  return (
    <Card title="What the calls taught us" icon={<Sparkles size={15} />}
      right={<button onClick={run} disabled={busy === "run"} style={{ background: "none", border: "none", color: C.glow, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
        {busy === "run" ? "Reading today's calls…" : ins?.day === st.today ? "refresh" : "build today's now"}
      </button>}>
      {!ins ? (
        <div style={{ fontSize: 13, color: C.dim }}>Every evening at 9 pm, today&apos;s Desk calls are read together here. Press “build today&apos;s now” to see it early.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, color: C.dim }}>{new Date(ins.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {ins.calls} calls</div>
          {dg.headline && <div style={{ fontSize: 13.5, color: C.txt, fontWeight: 700, lineHeight: 1.5 }}>{dg.headline}</div>}
          {list("Customers pushed back with", dg.objections)}
          {list("Customers asked", dg.questions)}
          {list("What worked", dg.what_worked)}
          {list("For tomorrow", dg.tips)}
          {dg.per_seat && (
            <div style={{ fontSize: 12, color: C.mid }}>
              {Object.entries(dg.per_seat).map(([n, v]: any) => (
                <div key={n}><strong style={{ color: C.txt }}>{n}</strong>: {v.calls} calls, {v.conversations} conversations, {v.interested} interested, {v.booked} booked{v.unreachable ? `, ${v.unreachable} unreachable` : ""}</div>
              ))}
            </div>
          )}
          {(ins.suggestions || []).length > 0 && (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: "0.05em" }}>Answers Nikki could learn</div>
              {(ins.suggestions as any[]).map(x => (
                <div key={x.id} style={{ background: C.hi, border: `1px solid ${C.bord}`, borderRadius: 8, padding: "8px 10px", fontSize: 12.5 }}>
                  <div style={{ color: C.txt, fontWeight: 700, marginBottom: 4 }}>“{x.question}”</div>
                  {x.status === "pending" ? (
                    <>
                      <textarea style={{ ...inputStyle, minHeight: 50, fontSize: 12.5, resize: "vertical" }}
                        value={edits[x.id] ?? x.answer} onChange={e => setEdits(v => ({ ...v, [x.id]: e.target.value }))} />
                      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                        <button style={btnStyle(C.grn, busy !== x.id)} disabled={busy === x.id} onClick={() => act(x.id, "approve", edits[x.id] ?? x.answer)}>Teach Nikki</button>
                        <button style={{ ...btnStyle(C.hi), border: `1px solid ${C.bord}` }} disabled={busy === x.id} onClick={() => act(x.id, "dismiss", x.answer)}>
                          <span style={{ color: C.mid }}>Dismiss</span>
                        </button>
                      </div>
                    </>
                  ) : (
                    <div style={{ color: x.status === "approved" ? C.grn : C.dim }}>
                      {x.answer} <span style={{ fontWeight: 700 }}>· {x.status === "approved" ? "Nikki uses this" : "dismissed"}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Stats ──────────────────────────────────────────────────────────────
// The telecaller's own numbers; the owner also sees the team, ranked by
// bookings, then conversations.
function Stats({ d, api, reloadKey }: { d: Desk | null; api: (p: string, b?: any) => Promise<any>; reloadKey: number }) {
  const [days, setDays] = useState(1);
  const [s, setS] = useState<any>(null);
  useEffect(() => { api(`/api/desk/stats?days=${days}`).then(setS).catch(() => setS(null)); }, [api, days, reloadKey]);
  const y = s?.you;
  const rate = (a: number, b: number) => b ? `${Math.round((a / b) * 100)}%` : "—";
  const tile = (label: string, value: string, sub?: string) => (
    <div style={{ background: C.hi, borderRadius: 8, padding: "9px 10px" }}>
      <div style={{ fontSize: 11, color: C.dim, fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 22, fontWeight: 700, color: C.txt,
        letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.dim }}>{sub}</div>}
    </div>
  );
  return (
    <Card title="Your numbers" icon={<ChartColumn size={15} />}
      right={<div style={{ display: "flex", gap: 4 }}>
        {[[1, "Today"], [7, "7 days"], [30, "30 days"]].map(([v, l]) => (
          <button key={v} onClick={() => setDays(v as number)} style={{ background: days === v ? C.glow + "22" : "none",
            border: `1px solid ${days === v ? C.glow : C.bord}`, color: days === v ? C.glow : C.mid, borderRadius: 999,
            padding: "2px 9px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
        ))}
      </div>}>
      {!y ? <div style={{ fontSize: 13, color: C.dim }}>Loading…</div> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {tile("Calls", String(y.calls))}
            {tile("Conversations", String(y.connected), `${rate(y.connected, y.calls)} connect`)}
            {tile("Talk time", hm(y.talk_seconds))}
            {tile("Booked", String(y.booked), `${rate(y.booked, y.connected)} of conversations`)}
            {tile("Interested", String(y.interested))}
            {tile("Callbacks set", String(y.callbacks))}
          </div>
          {d?.you_are_owner && s?.team?.length > 1 && (
            <div style={{ marginTop: 12, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead><tr style={{ color: C.dim, fontSize: 10.5, textTransform: "uppercase" }}>
                  {["Team", "Calls", "Conv.", "Talk", "Booked"].map(h => <th key={h} style={{ textAlign: h === "Team" ? "left" : "right", padding: "5px 6px", borderBottom: `1px solid ${C.bord}` }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {s.team.map((t: any, i: number) => (
                    <tr key={t.user_id} style={{ borderBottom: `1px solid ${C.bord}` }}>
                      <td style={{ padding: "6px", color: C.txt, fontWeight: 700 }}>{i === 0 && t.booked > 0 ? "🏆 " : ""}{t.name}{t.is_you ? " (you)" : ""}</td>
                      <td style={{ padding: "6px", textAlign: "right", color: C.mid }}>{t.calls}</td>
                      <td style={{ padding: "6px", textAlign: "right", color: C.mid }}>{t.connected}</td>
                      <td style={{ padding: "6px", textAlign: "right", color: C.mid }}>{hm(t.talk_seconds)}</td>
                      <td style={{ padding: "6px", textAlign: "right", color: C.grn, fontWeight: 700 }}>{t.booked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ── Dialer ────────────────────────────────────────────────────────────
type DialState =
  | { phase: "idle" }
  | { phase: "ringing_you" }
  | { phase: "connected"; ctcId: string; startedAt: number }
  | { phase: "ended"; ctcId: string; seconds: number; fail?: string | null }
  | { phase: "failed"; reason: string };

function Dialer({ d, api, onDone, prefill }: {
  d: Desk | null; api: (p: string, b?: any) => Promise<any>; onDone: () => void; prefill: Prefill;
}) {
  const [num, setNum] = useState("");
  // A queue "Call" rings straight away, once the number is in the box.
  const [autoLead, setAutoLead] = useState<{ id: string | null; k: number } | null>(null);
  useEffect(() => {
    if (!prefill.n) return;
    setNum(prefill.n);
    if (prefill.auto) setAutoLead({ id: prefill.leadId || null, k: prefill.k });
  }, [prefill]);
  // After the call: the model's summary, and a callback time if needed.
  const [ai, setAi] = useState<{ state: "idle" | "waiting" | "done" | "none"; summary?: string; disposition?: string | null; follow_up_at?: string | null }>({ state: "idle" });
  const [cbAt, setCbAt] = useState<string>("");
  const [cbOpen, setCbOpen] = useState(false);
  const [waBusy, setWaBusy] = useState(false);
  const [lead, setLead] = useState<LeadLite | null | undefined>(undefined);
  const [st, setSt] = useState<DialState>({ phase: "idle" });
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState("");
  const [myPhone, setMyPhone] = useState("");
  const [phoneMsg, setPhoneMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ok = /^[6-9]\d{9}$/.test(num);
  const havePhone = !!d?.you?.phone;

  // Who is this? The lead row, if the number has one.
  useEffect(() => {
    if (!ok) { setLead(undefined); return; }
    let cancelled = false;
    createClient().from("leads").select("id, name, stage, interest, notes, call_count")
      .eq("phone", num).maybeSingle()
      .then(({ data }) => { if (!cancelled) setLead((data as LeadLite) || null); });
    return () => { cancelled = true; };
  }, [num, ok]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  useEffect(() => {
    // Not only from idle: after a call the dialer waits on an outcome, and
    // "Call now" from the queue used to fill the number and then do nothing
    // until one was picked — telecallers read it as the second call not going.
    if (!autoLead || !ok || !havePhone || !["idle", "ended", "failed"].includes(st.phase)) return;
    if (st.phase === "ended") toast("Last call's outcome isn't saved — set it under “Calls from the desk”.");
    const id = autoLead.id;
    setAutoLead(null);
    dial(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLead, ok, havePhone, st.phase]);

  // When the call ends, ask for the summary. The recording lands a few
  // seconds after hangup, so "not ready" means ask again, for about 40 s.
  useEffect(() => {
    if (st.phase !== "ended") return;
    if (st.fail) { setAi({ state: "idle" }); return; }   // nobody to summarise
    let cancelled = false;
    setAi({ state: "waiting" });
    (async () => {
      for (let i = 0; i < 8 && !cancelled; i++) {
        try {
          const j = await api(`/api/desk/calls/${st.ctcId}/summary`, {});
          if (cancelled) return;
          if (j.summary || j.disposition) {
            setAi({ state: "done", summary: j.summary, disposition: j.disposition, follow_up_at: j.follow_up_at });
            if (j.summary) setNotes(n => n || j.summary);
            if (j.follow_up_at) setCbAt(toLocalInput(j.follow_up_at));
          } else setAi({ state: "none" });
          return;
        } catch (e: any) {
          if (!/not_ready/.test(String(e.message))) { if (!cancelled) setAi({ state: "none" }); return; }
        }
        await new Promise(r => setTimeout(r, 5000));
      }
      if (!cancelled) setAi({ state: "none" });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.phase === "ended" ? (st as any).ctcId : null]);

  async function dial(leadId?: string | null) {
    if (!ok || !havePhone) return;
    setSt({ phase: "ringing_you" }); setAi({ state: "idle" }); setCbOpen(false); setCbAt("");
    try {
      // The request returns once YOUR phone is answered — up to ~30 s.
      const j = await api("/api/calls/click-to-call", { customer_number: num, lead_id: leadId || lead?.id || null });
      const started = Date.now();
      setSt({ phase: "connected", ctcId: j.ctc_log_id, startedAt: started });
      pollRef.current = setInterval(async () => {
        try {
          const s = await api(`/api/calls/click-to-call/${j.ctc_log_id}`);
          if (s.ended) {
            if (pollRef.current) clearInterval(pollRef.current);
            // The customer-leg cause (068) is posted a moment before hangup;
            // one more read catches it if this poll raced it.
            let fail = s.customer_fail_cause || null;
            if (!fail) { try { fail = (await api(`/api/calls/click-to-call/${j.ctc_log_id}`)).customer_fail_cause || null; } catch {} }
            setSt({ phase: "ended", ctcId: j.ctc_log_id, fail,
                    seconds: fail ? 0 : (s.duration_seconds || Math.round((Date.now() - started) / 1000)) });
            onDone();
          }
        } catch { /* keep polling */ }
      }, 3000);
    } catch (e: any) {
      const m = String(e.message || "").replace(/^Click-to-Call failed:\s*/i, "");
      const reason = /INTERWORKING|NORMAL_TEMPORARY_FAILURE|RECOVERY_ON_TIMER_EXPIRE|NETWORK_OUT_OF_ORDER|SWITCH_CONGESTION/i.test(m)
        ? "The phone network couldn't connect to your phone just now. Wait a few seconds and press Call again."
        : /CALL_REJECTED/i.test(m) ? "Your phone rejected the call."
        : /trunk busy/i.test(m) ? "All lines are busy right now — try again in a minute."
        : /NO_ANSWER|ORIGINATOR_CANCEL|timeout/i.test(m)
        ? `Your phone (${prettyNum(d?.you?.phone || "")}) didn't pick up. Try again when you're ready.`
        : /USER_BUSY/i.test(m) ? "Your phone is busy on another call."
        : /no_outbound_cli|assigned DID/i.test(m) ? "No business number is assigned to this account yet."
        : m || "Call failed";
      setSt({ phase: "failed", reason });
    }
  }

  // A second look before a lead is written off against what the call
  // summary heard. On 25 Sep two customers who agreed to receive details or
  // to be called back were saved "Not interested" with that summary on
  // screen, and dropped out of every queue. The telecaller still decides.
  const [second, setSecond] = useState("");
  async function outcome(key: string, confirmed = false) {
    if (st.phase !== "ended") return;
    const positive = ["booked", "interested", "callback"];
    if (!confirmed && ai.state === "done" && ai.disposition && positive.includes(ai.disposition)
        && (key === "not_interested" || key === "no_answer")) {
      setSecond(key);
      return;
    }
    setSecond("");
    // "Call back" asks when, first.
    if (key === "callback" && !cbOpen) {
      setCbOpen(true);
      if (!cbAt) setCbAt(toLocalInput(defaultCallback()));
      return;
    }
    setSaving(key);
    try {
      const body: any = { ctc_log_id: st.ctcId, disposition: key, notes };
      if (key === "callback" && cbAt) body.follow_up_at = new Date(cbAt).toISOString();
      await api("/api/calls/disposition", body);
      if (key === "callback" && cbAt) toast.ok(`Callback set for ${fmtTime(new Date(cbAt).toISOString())}`);
      setSt({ phase: "idle" }); setNotes(""); setNum(""); setCbOpen(false); setCbAt(""); setAi({ state: "idle" }); setSecond(""); onDone();
    } catch (e: any) { toast.err(e.message); }
    setSaving("");
  }

  async function sendBrochure() {
    setWaBusy(true);
    try { await api("/api/desk/whatsapp", lead?.id ? { lead_id: lead.id } : { phone: num }); toast.ok("Brochure sent on WhatsApp."); }
    catch (e: any) { toast.err(e.message); }
    setWaBusy(false);
  }

  async function savePhone() {
    setPhoneMsg("");
    try { await api("/api/desk/seat", { phone: myPhone }); setPhoneMsg("Saved."); onDone(); }
    catch (e: any) { setPhoneMsg(e.message); }
  }

  const busy = st.phase === "ringing_you" || st.phase === "connected";

  return (
    <Card title="Dial a number" icon={<PhoneCall size={15} />}
      right={d?.you?.phone
        ? <span style={{ fontSize: 12, color: C.dim }}>rings <strong style={{ color: C.mid }}>{prettyNum(d.you.phone)}</strong> first</span>
        : null}>
      {!havePhone && d && (
        <div style={{ background: C.gold + "14", border: `1px solid ${C.gold}55`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: C.txt, fontWeight: 700, marginBottom: 6 }}>Add your mobile first</div>
          <div style={{ fontSize: 12.5, color: C.mid, marginBottom: 8 }}>
            The desk works by ringing <em>your</em> phone, then joining the customer. We need a number to ring.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input style={{ ...inputStyle, maxWidth: 220 }} inputMode="numeric" placeholder="10-digit mobile"
              value={myPhone} onChange={e => setMyPhone(digits10(e.target.value))} />
            <button style={btnStyle(C.glow, /^[6-9]\d{9}$/.test(myPhone))} disabled={!/^[6-9]\d{9}$/.test(myPhone)} onClick={savePhone}>Save</button>
          </div>
          {phoneMsg && <div style={{ fontSize: 12, color: phoneMsg === "Saved." ? C.grn : C.red, marginTop: 6 }}>{phoneMsg}</div>}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          style={{ ...inputStyle, flex: "1 1 220px", fontSize: 22, letterSpacing: "0.06em", fontVariantNumeric: "tabular-nums", padding: "10px 14px" }}
          inputMode="tel" autoComplete="off" placeholder="98765 43210"
          value={prettyNum(num)} disabled={busy}
          onChange={e => setNum(digits10(e.target.value))}
          onKeyDown={e => { if (e.key === "Enter") dial(); }}
        />
        {busy ? (
          <button style={btnStyle(C.red)} onClick={() => { /* hang up from your handset */ }} title="Hang up from your phone">
            <PhoneOff size={15} /> {st.phase === "ringing_you" ? "Ringing you…" : "On call"}
          </button>
        ) : (
          <button style={btnStyle(C.grn, ok && havePhone)} disabled={!ok || !havePhone} onClick={() => dial()}>
            <PhoneCall size={15} /> Call
          </button>
        )}
      </div>

      {/* who you're about to call */}
      {ok && lead !== undefined && st.phase === "idle" && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: C.mid, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {lead ? (
            <>
              <strong style={{ color: C.txt }}>{lead.name || "Unnamed lead"}</strong>
              <span style={{ background: C.hi, borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 700, color: C.glow }}>{lead.stage}</span>
              {lead.interest && <span>· {lead.interest}</span>}
              {lead.call_count > 0 && <span>· {lead.call_count} call{lead.call_count === 1 ? "" : "s"}</span>}
              {lead.id && <a href={`/leads?lead=${lead.id}`} style={{ color: C.glow }}>open lead →</a>}
            </>
          ) : (
            <span>New number — a lead is created when you save the outcome.</span>
          )}
        </div>
      )}
      {ok && st.phase !== "ended" && <CustomerCard api={api} phone={num} />}

      {/* call state */}
      {st.phase === "ringing_you" && (
        <StateLine color={C.gold} text={`Ringing your phone ${prettyNum(d?.you?.phone || "")} — answer it and we'll connect ${prettyNum(num)}.`} />
      )}
      {st.phase === "connected" && (
        <StateLine color={C.grn} text={`Connected to ${lead?.name || prettyNum(num)} · ${fmtDur(Math.round((Date.now() - st.startedAt) / 1000))} · hang up from your phone when done.`} live />
      )}
      {st.phase === "failed" && (
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <StateLine color={C.red} text={st.reason} />
          <button style={btnStyle(C.hi)} onClick={() => setSt({ phase: "idle" })}><span style={{ color: C.mid }}>Dismiss</span></button>
        </div>
      )}
      {st.phase === "ended" && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${C.bord}`, paddingTop: 12 }}>
          {st.fail ? (
            <div style={{ fontSize: 13, color: C.red, fontWeight: 700, marginBottom: 8, display: "flex", gap: 6, alignItems: "center" }}>
              <TriangleAlert size={14} /> Didn&apos;t reach {prettyNum(num)} — {failText(st.fail)}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: C.txt, fontWeight: 700, marginBottom: 8 }}>
              Call ended · {fmtDur(st.seconds)}. How did it go?
            </div>
          )}
          {ai.state !== "idle" && (
            <div style={{ background: C.glow + "10", border: `1px solid ${C.glow}44`, borderRadius: 8, padding: "9px 11px", marginBottom: 10, fontSize: 12.5, color: C.mid, lineHeight: 1.55 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: C.txt, marginBottom: 3 }}>
                <Sparkles size={13} color={C.glow} /> Call summary
              </div>
              {ai.state === "waiting" ? "Listening to the recording…"
                : ai.state === "none" ? "No summary for this call — add your own notes below."
                : <>{ai.summary || "Nobody really spoke on this call."}
                    {ai.disposition && <> Suggested outcome: <strong style={{ color: OUTCOME_COLOR[ai.disposition] || C.txt }}>{OUTCOME_LABEL[ai.disposition]}</strong>.</>}</>}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {OUTCOMES.map(o => (
              <button key={o.key} title={o.hint} disabled={!!saving}
                style={{ ...btnStyle(o.color), opacity: saving && saving !== o.key ? 0.5 : 1,
                  boxShadow: (st.fail ? o.key === "no_answer" : ai.disposition === o.key) ? `0 0 0 2px ${C.bg}, 0 0 0 4px ${o.color}` : undefined }}
                onClick={() => outcome(o.key)}>
                {saving === o.key ? "Saving…" : o.label}
              </button>
            ))}
          </div>
          {second && ai.disposition && (
            <div role="alert" style={{ background: C.gold + "12", border: `1px solid ${C.gold}66`, borderRadius: 8,
              padding: "10px 12px", marginBottom: 8, fontSize: 13, color: C.txt, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                The summary says <span style={{ color: OUTCOME_COLOR[ai.disposition] }}>{OUTCOME_LABEL[ai.disposition]}</span>, not {OUTCOME_LABEL[second]}.
              </div>
              <div style={{ color: C.mid, marginBottom: 8 }}>&ldquo;{ai.summary}&rdquo;</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={btnStyle(OUTCOME_COLOR[ai.disposition] || C.glow)} disabled={!!saving}
                  onClick={() => { const k = ai.disposition as string; setSecond(""); outcome(k, true); }}>
                  Save {OUTCOME_LABEL[ai.disposition]}
                </button>
                <button style={{ ...btnStyle(C.hi), border: `1px solid ${C.bord}`, color: C.txt }} disabled={!!saving}
                  onClick={() => outcome(second, true)}>
                  {saving === second ? "Saving…" : `Yes, ${OUTCOME_LABEL[second]}`}
                </button>
              </div>
            </div>
          )}
          {cbOpen && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: C.gold + "12",
              border: `1px solid ${C.gold}55`, borderRadius: 8, padding: "9px 11px", marginBottom: 8 }}>
              <CalendarClock size={15} color={C.gold} />
              <span style={{ fontSize: 12.5, color: C.txt, fontWeight: 700 }}>Call back at</span>
              <input type="datetime-local" style={{ ...inputStyle, width: "auto", padding: "6px 9px" }}
                value={cbAt} onChange={e => setCbAt(e.target.value)} />
              <button style={btnStyle(C.gold, !!cbAt && !saving)} disabled={!cbAt || !!saving} onClick={() => outcome("callback")}>
                {saving === "callback" ? "Saving…" : "Save callback"}
              </button>
              <span style={{ fontSize: 11.5, color: C.dim }}>You&apos;ll get a reminder 10 minutes before, and it tops your queue.</span>
            </div>
          )}
          <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} placeholder="Notes (optional) — what they asked, what you promised"
            value={notes} onChange={e => setNotes(e.target.value)} />
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
            <div style={{ fontSize: 11.5, color: C.dim }}>
              The outcome moves the lead's stage on the Leads page; Booked and Interested also send the brochure on WhatsApp.
            </div>
            <button style={{ ...btnStyle(C.hi), border: `1px solid ${C.bord}` }} disabled={waBusy} onClick={sendBrochure}>
              <MessageCircle size={14} color={C.grn} /><span style={{ color: C.txt }}>{waBusy ? "Sending…" : "Send brochure now"}</span>
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function StateLine({ color, text, live }: { color: string; text: string; live?: boolean }) {
  return (
    <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: C.mid }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0,
        animation: live ? "deskpulse 1.6s infinite" : undefined }} />
      <span>{text}</span>
    </div>
  );
}

// ── Live board ─────────────────────────────────────────────────────────
function LiveBoard({ calls, tick }: { calls: LiveCall[]; tick: number }) {
  void tick; // re-render every 4 s so elapsed times move
  return (
    <Card title={`Live now${calls.length ? ` · ${calls.length}` : ""}`} icon={<Radio size={15} />}>
      {calls.length === 0 ? (
        <div style={{ fontSize: 13, color: C.dim }}>No calls in progress. Incoming calls appear here the moment they ring.</div>
      ) : calls.map(c => (
        <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
          padding: "10px 12px", background: C.hi, borderRadius: 8, marginBottom: 8, border: `1px solid ${C.grn}44` }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: C.grn, animation: "deskpulse 1.6s infinite" }} />
            <div>
              <div style={{ color: C.txt, fontSize: 13.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{prettyNum(c.caller_number)}</div>
              <div style={{ color: C.dim, fontSize: 11.5 }}>{c.direction === "outbound" ? "Outbound" : "Incoming"} · {fmtDur(elapsed(c.created_at))}</div>
            </div>
          </div>
          <a href={`/leads?phone=${digits10(c.caller_number)}`} style={{ color: C.glow, fontSize: 12.5, fontWeight: 600 }}>lead →</a>
        </div>
      ))}
    </Card>
  );
}

// ── Routing ────────────────────────────────────────────────────────────
function Routing({ d, api, onSaved }: { d: Desk | null; api: (p: string, b?: any) => Promise<any>; onSaved: () => void }) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ bad?: boolean; text: string } | null>(null);
  const modes = [
    { key: "ai",     icon: <Bot size={16} />,       label: "Nikki answers",
      desc: "Every call is handled by the AI. She transfers to your team only when a caller asks for a person." },
    { key: "hybrid", icon: <GitBranch size={16} />, label: "Nikki first, team on request",
      desc: "Same as above, and the team is the named path for anything she can't settle — bookings she can't place, prices, complaints." },
    { key: "human",  icon: <Users size={16} />,     label: "Your team answers",
      desc: `Every seat with a phone rings together. If nobody picks up in 20 s, Nikki takes a message and the caller gets a WhatsApp.` },
  ] as const;

  async function set(key: string) {
    if (!d || key === d.routing_mode) return;
    setBusy(key); setMsg(null);
    try { await api("/api/desk/routing", { routing_mode: key }); setMsg({ text: "Saved — applies to the next call." }); onSaved(); }
    catch (e: any) { setMsg({ bad: true, text: e.message }); }
    setBusy("");
  }

  return (
    <Card title="Who answers incoming calls" icon={<Headset size={15} />}
      right={d?.did ? <span style={{ fontSize: 12, color: C.dim, fontVariantNumeric: "tabular-nums" }}>{prettyNum(d.did)}</span> : null}>
      {!d ? <div style={{ fontSize: 13, color: C.dim }}>Loading…</div> : !d.did ? (
        <div style={{ fontSize: 13, color: C.mid }}>No number is assigned to this account yet — finish <a href="/setup" style={{ color: C.glow }}>Setup</a> first.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {modes.map(m => {
            const on = d.routing_mode === m.key;
            const can = d.you_are_owner;
            return (
              <button key={m.key} disabled={!can || !!busy} onClick={() => set(m.key)}
                style={{ textAlign: "left", background: on ? C.glow + "12" : C.hi, border: `1px solid ${on ? C.glow : C.bord}`,
                  borderRadius: 10, padding: "11px 12px", cursor: can ? "pointer" : "default", fontFamily: "inherit", color: C.txt }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700 }}>
                  <span style={{ color: on ? C.glow : C.mid }}>{m.icon}</span>
                  {m.label}
                  {on && <Check size={14} color={C.glow} style={{ marginLeft: "auto" }} />}
                  {busy === m.key && <span style={{ marginLeft: "auto", fontSize: 11, color: C.dim }}>Saving…</span>}
                </div>
                <div style={{ fontSize: 12, color: C.mid, marginTop: 4, lineHeight: 1.5 }}>{m.desc}</div>
              </button>
            );
          })}
          <div style={{ fontSize: 11.5, color: msg?.bad ? C.red : msg ? C.grn : C.dim, marginTop: 2 }}>
            {msg?.text || (d.you_are_owner
              ? (d.ring_count === 0 ? "Add a phone to at least one seat before choosing your team." : `${d.ring_count} phone${d.ring_count === 1 ? "" : "s"} will ring.`)
              : "Only the owner can change this.")}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Numbers ────────────────────────────────────────────────────────────
// Which numbers outgoing calls show as caller ID. Every number answers
// incoming calls; switching one off here only keeps it off outgoing calls,
// so a business can publish one number and dial out from the others.
function Numbers({ d, api, onSaved }: { d: Desk | null; api: (p: string, b?: any) => Promise<any>; onSaved: () => void }) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ bad?: boolean; text: string } | null>(null);
  const nums = d?.numbers || [];
  if (!d || nums.length < 2) return null;   // one number: nothing to choose

  async function toggle(n: { number: string; use_for_outbound: boolean }) {
    setBusy(n.number); setMsg(null);
    try {
      await api(`/api/desk/numbers/${encodeURIComponent(n.number)}/outbound`, { enabled: !n.use_for_outbound });
      setMsg({ text: "Saved — applies to the next call." }); onSaved();
    } catch (e: any) { setMsg({ bad: true, text: e.message }); }
    setBusy("");
  }

  return (
    <Card title="Your numbers" icon={<PhoneOutgoing size={15} />}>
      <div style={{ display: "grid", gap: 8 }}>
        {nums.map(n => (
          <div key={n.number} style={{ display: "flex", alignItems: "center", gap: 10, background: C.hi,
            border: `1px solid ${C.bord}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{prettyNum(n.number)}</div>
              <div style={{ fontSize: 11.5, color: C.mid, marginTop: 2 }}>
                {n.use_for_outbound ? "Answers calls · makes outgoing calls" : "Answers calls only"}
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.mid,
              cursor: d.you_are_owner ? "pointer" : "default" }}>
              <input type="checkbox" checked={n.use_for_outbound}
                disabled={!d.you_are_owner || !!busy} onChange={() => toggle(n)} />
              {busy === n.number ? "Saving…" : "Outgoing"}
            </label>
          </div>
        ))}
        <div style={{ fontSize: 11.5, color: msg?.bad ? C.red : msg ? C.grn : C.dim }}>
          {msg?.text || (d.you_are_owner
            ? "Outgoing calls share the ticked numbers, and each customer always sees the same one."
            : "Only the owner can change this.")}
        </div>
      </div>
    </Card>
  );
}

// ── Seats ──────────────────────────────────────────────────────────────
function Seats({ d, api, onSaved }: { d: Desk | null; api: (p: string, b?: any) => Promise<any>; onSaved: () => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [callNum, setCallNum] = useState("");
  const outNums = (d?.numbers || []).filter(n => n.use_for_outbound);
  // Giving people their own number only means something with two or more.
  const canAssign = !!d?.you_are_owner && outNums.length > 1;

  function start(s: Seat) { setEdit(s.id); setPhone(s.phone || ""); setName(s.display_name || ""); setCallNum(s.outbound_did || ""); setMsg(""); }
  async function save(s: Seat) {
    setBusy(true); setMsg("");
    const body: any = { member_id: s.id, phone, display_name: name };
    if (canAssign && callNum !== (s.outbound_did || "")) body.outbound_did = callNum || null;
    try { await api("/api/desk/seat", body); setEdit(null); onSaved(); }
    catch (e: any) { setMsg(e.message); }
    setBusy(false);
  }

  return (
    <Card title="Seats" icon={<Users size={15} />}
      right={<a href="/setup" style={{ fontSize: 12, color: C.glow, fontWeight: 600 }}>invite people →</a>}>
      {!d ? <div style={{ fontSize: 13, color: C.dim }}>Loading…</div> : (
        <div style={{ display: "grid", gap: 8 }}>
          {d.seats.map(s => {
            const canEdit = s.is_you || d.you_are_owner;
            const editing = edit === s.id;
            return (
              <div key={s.id} style={{ background: C.hi, border: `1px solid ${C.bord}`, borderRadius: 10, padding: "10px 12px" }}>
                {editing ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <input style={inputStyle} placeholder="Name (shown on the Leads page)" value={name} onChange={e => setName(e.target.value)} />
                    <input style={inputStyle} inputMode="numeric" placeholder="10-digit mobile — leave blank to stop ringing" value={phone} onChange={e => setPhone(digits10(e.target.value))} />
                    {canAssign && (
                      <label style={{ display: "grid", gap: 4, fontSize: 11.5, color: C.mid }}>
                        Calls out as
                        <select style={inputStyle} value={callNum} onChange={e => setCallNum(e.target.value)}>
                          <option value="">Shared numbers (default)</option>
                          {outNums.map(n => <option key={n.number} value={n.number}>{prettyNum(n.number)}</option>)}
                        </select>
                        <span style={{ color: C.dim }}>
                          Their Desk calls show this number, and calls to it ring them first while they&apos;re checked in.
                        </span>
                      </label>
                    )}
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button style={btnStyle(C.glow, !busy)} disabled={busy} onClick={() => save(s)}>{busy ? "Saving…" : "Save"}</button>
                      <button style={btnStyle(C.hi)} onClick={() => setEdit(null)}><span style={{ color: C.mid }}>Cancel</span></button>
                      {msg && <span style={{ fontSize: 12, color: C.red }}>{msg}</span>}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: C.txt, fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.display_name || s.email || "Seat"}{s.is_you && <span style={{ color: C.dim, fontWeight: 500 }}> (you)</span>}
                      </div>
                      <div style={{ color: C.dim, fontSize: 11.5, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ textTransform: "capitalize" }}>{s.role.replace("_", " ")}</span>
                        <span>·</span>
                        {s.phone
                          ? <span style={{ color: C.grn, fontWeight: 600 }}>rings {prettyNum(s.phone)}</span>
                          : <span style={{ color: C.gold, fontWeight: 600 }}>no phone — won't ring</span>}
                        {s.outbound_did && <>
                          <span>·</span>
                          <span style={{ color: C.glow, fontWeight: 600 }}>calls out as {prettyNum(s.outbound_did)}</span>
                        </>}
                      </div>
                    </div>
                    {canEdit && (
                      <button onClick={() => start(s)} title="Edit" style={{ background: "none", border: "none", cursor: "pointer", color: C.mid, padding: 4 }}>
                        <Pencil size={14} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Needs callback ────────────────────────────────────────────────────
/**
 * The promises the desk has made and not yet kept.
 *
 * "Call back" is the most-used outcome on the dispositions below, and until
 * now it went straight into the flat log with everything else — the seat had
 * to remember, or scroll. This is the same rows, filtered to the ones still
 * outstanding, so the queue is a list rather than a memory.
 *
 * Outstanding means: the MOST RECENT desk call to that number was dispositioned
 * "callback". A later call to the same number — whatever its outcome, or still
 * running — is the callback happening, so the number drops off by itself and
 * nothing has to be ticked off by hand.
 *
 * Derived entirely from what /api/desk already returned. No extra request.
 */
function NeedsCallback({ d, onCallBack }: { d: Desk | null; onCallBack: (n: string) => void }) {
  // d.recent arrives newest-first, so the first row seen for a number is the
  // latest attempt at it.
  const latest = new Map<string, Recent>();
  for (const r of d?.recent || []) if (!latest.has(r.number)) latest.set(r.number, r);
  const due = [...latest.values()].filter(r => r.disposition === "callback");

  if (!d || due.length === 0) return null;   // an empty queue is not news

  return (
    <Card title="Needs a callback" icon={<PhoneOutgoing size={15} />}
      right={<span style={{ background: C.gold + "18", color: C.gold, borderRadius: 999, padding: "2px 9px", fontSize: 11.5, fontWeight: 700 }}>{due.length}</span>}>
      <div style={{ display: "grid", gap: 8 }}>
        {due.map(r => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
            gap: 10, flexWrap: "wrap", background: C.hi, border: `1px solid ${C.bord}`,
            borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ minWidth: 0, flex: "1 1 180px" }}>
              <div style={{ color: C.txt, fontSize: 13.5, fontWeight: 700 }}>
                {r.lead_name || prettyNum(r.number)}
              </div>
              <div style={{ color: C.dim, fontSize: 11.5 }}>
                {r.lead_name && <span style={{ fontVariantNumeric: "tabular-nums" }}>{prettyNum(r.number)} · </span>}
                asked for a callback {fmtTime(r.created_at)}
              </div>
              {r.notes && (
                <div style={{ color: C.mid, fontSize: 12, marginTop: 3, fontStyle: "italic" }}>{r.notes}</div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
              {r.number.length === 10 && (
                <button onClick={() => onCallBack(r.number)} style={{ ...btnStyle(C.gold), padding: "5px 12px", fontSize: 12 }}>
                  <PhoneOutgoing size={12} /> Call back
                </button>
              )}
              {r.lead_id && <a href={`/leads?lead=${r.lead_id}`} style={{ color: C.glow, fontSize: 12 }}>lead →</a>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Calls to the team ─────────────────────────────────────────────────
// Incoming calls that went to people rather than Nikki: answered by a seat,
// or rang out to the Missed Call Guard. The missed ones are the reason the
// desk exists — one press rings them back.
function TeamCalls({ d, onCallBack }: { d: Desk | null; onCallBack: (n: string) => void }) {
  const rows = d?.team_calls || [];
  const missed = rows.filter(r => r.status === "missed").length;
  return (
    <Card title="Calls to the team" icon={<PhoneIncoming size={15} />}
      right={missed ? <span style={{ background: C.red + "18", color: C.red, borderRadius: 999, padding: "2px 9px", fontSize: 11.5, fontWeight: 700 }}>{missed} missed</span> : null}>
      {!d ? <div style={{ fontSize: 13, color: C.dim }}>Loading…</div> : rows.length === 0 ? (
        <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.6 }}>
          No calls have reached the team in the last 7 days.{" "}
          {d.routing_mode === "ai" ? "Nikki is answering everything — switch to Hybrid or Team under “Who answers” to see calls here." : "Calls that ring the seats' phones will show here, answered or missed."}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: C.dim, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {["Caller", "What happened", "Length", "When", ""].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 8px", borderBottom: `1px solid ${C.bord}`, fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${C.bord}` }}>
                  <td style={{ padding: "9px 8px" }}>
                    <div style={{ color: C.txt, fontWeight: 700 }}>{r.lead_name || prettyNum(r.number)}</div>
                    {r.lead_name && <div style={{ color: C.dim, fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>{prettyNum(r.number)}</div>}
                  </td>
                  <td style={{ padding: "9px 8px" }}>
                    {r.status === "missed" ? (
                      <span style={{ color: C.red, fontWeight: 700, fontSize: 12 }}>Missed{r.wa_sent ? " · WhatsApp sent" : ""}</span>
                    ) : (
                      <span style={{ color: C.grn, fontWeight: 700, fontSize: 12 }}>Answered by team{r.has_recording ? " · recorded" : ""}</span>
                    )}
                  </td>
                  <td style={{ padding: "9px 8px", color: C.mid, fontVariantNumeric: "tabular-nums" }}>{r.duration_seconds ? fmtDur(r.duration_seconds) : "—"}</td>
                  <td style={{ padding: "9px 8px", color: C.dim, whiteSpace: "nowrap" }}>{fmtTime(r.created_at)}</td>
                  <td style={{ padding: "9px 8px", whiteSpace: "nowrap" }}>
                    {r.number.length === 10 && (
                      <button onClick={() => onCallBack(r.number)} style={{ ...btnStyle(C.glow), padding: "4px 10px", fontSize: 12 }}>
                        <PhoneOutgoing size={12} /> Call back
                      </button>
                    )}
                    {r.lead_id && <a href={`/leads?lead=${r.lead_id}`} style={{ color: C.glow, fontSize: 12, marginLeft: 10 }}>lead →</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Recent desk calls ──────────────────────────────────────────────────
function RecentCalls({ d, api, onSaved }: { d: Desk | null; api: (p: string, b?: any) => Promise<any>; onSaved: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState("");

  async function outcome(id: string, key: string) {
    setBusy(key);
    try { await api("/api/calls/disposition", { ctc_log_id: id, disposition: key, notes }); setOpen(null); setNotes(""); onSaved(); }
    catch (e: any) { toast.err(e.message); }
    setBusy("");
  }

  const rows = d?.recent || [];
  return (
    <Card title="Calls from the desk" icon={<Clock size={15} />}>
      {!d ? <div style={{ fontSize: 13, color: C.dim }}>Loading…</div> : rows.length === 0 ? (
        <div style={{ fontSize: 13, color: C.dim }}>Nothing dialled yet. Calls you place from here show up with their outcome.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: C.dim, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {["Who", "By", "Outcome", "Length", "When", ""].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 8px", borderBottom: `1px solid ${C.bord}`, fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <Fragment key={r.id}>
                  <tr style={{ borderBottom: `1px solid ${C.bord}` }}>
                    <td style={{ padding: "9px 8px" }}>
                      <div style={{ color: C.txt, fontWeight: 700 }}>{r.lead_name || prettyNum(r.number)}</div>
                      {r.lead_name && <div style={{ color: C.dim, fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>{prettyNum(r.number)}</div>}
                      {r.ai_summary && (
                        <div title={r.ai_summary} style={{ color: C.mid, fontSize: 11.5, marginTop: 2, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <Sparkles size={10} color={C.glow} /> {r.ai_summary}
                        </div>
                      )}
                      {r.qa_note && <div style={{ color: C.gold, fontSize: 11.5, marginTop: 2 }}>Review: {r.qa_note}</div>}
                    </td>
                    <td style={{ padding: "9px 8px", color: C.mid }}>{r.by || "—"}</td>
                    <td style={{ padding: "9px 8px" }}>
                      {r.disposition ? (
                        <>
                        <span style={{ background: OUTCOME_COLOR[r.disposition] + "22", color: OUTCOME_COLOR[r.disposition] || C.mid,
                          borderRadius: 999, padding: "2px 9px", fontSize: 11.5, fontWeight: 700 }}>{OUTCOME_LABEL[r.disposition] || r.disposition}</span>
                        {/* Written off against what the summary heard: worth a look. */}
                        {(r.disposition === "not_interested" || r.disposition === "no_answer")
                          && r.ai_disposition && ["booked", "interested", "callback"].includes(r.ai_disposition) && (
                          <div title={r.ai_summary || ""} style={{ color: C.gold, fontSize: 11.5, fontWeight: 600, marginTop: 3, whiteSpace: "nowrap" }}>
                            Summary says {OUTCOME_LABEL[r.ai_disposition]}
                          </div>
                        )}
                        </>
                      ) : r.live ? (
                        <span style={{ color: C.grn, fontSize: 11.5, fontWeight: 700 }}>● live</span>
                      ) : (
                        <button onClick={() => { setOpen(open === r.id ? null : r.id); setNotes(r.notes || ""); }}
                          style={{ background: "none", border: `1px dashed ${C.bord}`, borderRadius: 999, padding: "2px 9px", fontSize: 11.5, color: C.mid, cursor: "pointer", fontFamily: "inherit" }}>
                          set outcome
                        </button>
                      )}
                    </td>
                    <td style={{ padding: "9px 8px", color: C.mid, fontVariantNumeric: "tabular-nums" }}>{r.duration_seconds ? fmtDur(r.duration_seconds) : "—"}</td>
                    <td style={{ padding: "9px 8px", color: C.dim, whiteSpace: "nowrap" }}>{fmtTime(r.created_at)}</td>
                    <td style={{ padding: "9px 8px", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {r.has_recording && r.call_id && <Player callId={r.call_id} />}
                        <Review r={r} owner={!!d?.you_are_owner} api={api} onSaved={onSaved} />
                        {r.lead_id && <a href={`/leads?lead=${r.lead_id}`} style={{ color: C.glow, fontSize: 12 }}>lead →</a>}
                      </div>
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={6} style={{ padding: "8px 8px 12px", background: C.hi }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                          {OUTCOMES.map(o => (
                            <button key={o.key} style={btnStyle(o.color)} disabled={!!busy} onClick={() => outcome(r.id, o.key)}>
                              {busy === o.key ? "Saving…" : o.label}
                            </button>
                          ))}
                          <button style={btnStyle(C.hi)} onClick={() => setOpen(null)}><X size={13} color={C.mid} /></button>
                        </div>
                        <input style={inputStyle} placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// Plays a desk call's recording. Fetched with the session (the endpoint
// streams the decrypted file), once, on first play.
function Player({ callId }: { callId: string }) {
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const el = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  async function toggle() {
    if (playing) { el.current?.pause(); return; }
    let u = url;
    if (!u) {
      setBusy(true);
      try {
        const { data: { session } } = await createClient().auth.getSession();
        const r = await fetch(`${API}/api/calls/${callId}/recording`, { headers: { Authorization: `Bearer ${session?.access_token || ""}` } });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Recording not available");
        u = URL.createObjectURL(await r.blob()); setUrl(u);
      } catch (e: any) { toast.err(e.message); setBusy(false); return; }
      setBusy(false);
    }
    if (!el.current) {
      el.current = new Audio(u);
      el.current.onplay = () => setPlaying(true);
      el.current.onpause = () => setPlaying(false);
      el.current.onended = () => setPlaying(false);
    }
    el.current.play().catch(() => {});
  }
  return (
    <button onClick={toggle} title={playing ? "Pause" : "Play recording"} disabled={busy}
      style={{ background: C.hi, border: `1px solid ${C.bord}`, borderRadius: 999, width: 26, height: 26, display: "inline-flex",
        alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.glow }}>
      {busy ? "…" : playing ? <Pause size={12} /> : <Play size={12} />}
    </button>
  );
}

// The owner's 1-5 review of a desk call; the telecaller sees it. A note is
// asked for when the score is low, because "2" alone teaches nobody anything.
function Review({ r, owner, api, onSaved }: { r: Recent; owner: boolean; api: (p: string, b?: any) => Promise<any>; onSaved: () => void }) {
  const [hover, setHover] = useState(0);
  if (!owner && !r.qa_score) return null;
  const score = r.qa_score || 0;
  async function set(n: number) {
    const note = n <= 3 ? window.prompt("What should they do differently? (optional)", r.qa_note || "") : r.qa_note;
    if (note === null) return;
    try { await api(`/api/desk/calls/${r.id}/review`, { score: n, note: note || "" }); onSaved(); }
    catch (e: any) { toast.err(e.message); }
  }
  return (
    <span style={{ display: "inline-flex", gap: 1 }} onMouseLeave={() => setHover(0)} title={owner ? "Review this call" : `Reviewed ${score}/5`}>
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} size={13}
          color={(hover || score) >= n ? C.gold : C.bord} fill={(hover || score) >= n ? C.gold : "none"}
          style={{ cursor: owner ? "pointer" : "default" }}
          onMouseEnter={() => owner && setHover(n)} onClick={() => owner && set(n)} />
      ))}
    </span>
  );
}

// ── Shift (check-in / check-out) ──────────────────────────────────────
const hm = (secs: number) => {
  const m = Math.floor(Math.max(0, secs) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

/** Progress toward a daily target. No target set: just the count. */
function Progress({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  const done = target > 0 && value >= target;
  const color = done ? C.grn : C.glow;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5, gap: 8 }}>
        <span style={{ color: C.mid }}>{label}</span>
        <span style={{ color: done ? C.grn : C.txt, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
          {value}{target > 0 ? <span style={{ color: C.dim, fontWeight: 500 }}> / {target}</span> : ""}
          {done ? " ✓" : ""}
        </span>
      </div>
      <div style={{ height: 6, background: C.hi, borderRadius: 3, overflow: "hidden" }}>
        {target > 0
          ? <div style={{ width: `${pct * 100}%`, height: "100%", background: color, borderRadius: 3, transition: "width .3s" }} />
          : <div style={{ height: "100%", background: `repeating-linear-gradient(90deg, ${C.bord} 0 6px, transparent 6px 12px)` }} />}
      </div>
      {target === 0 && <div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>No target set</div>}
    </div>
  );
}

function Shift({ d, api, onChanged, tick }: {
  d: Desk | null; api: (p: string, b?: any) => Promise<any>; onChanged: () => void; tick: number;
}) {
  const [busy, setBusy] = useState(false);
  void tick;                                   // re-render every 4s so the timer moves
  if (!d) return null;
  if (d.attendance_ready === false) {
    return (
      <Card title="Your shift" icon={<Clock size={15} />}>
        <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.55 }}>
          Check-in and daily targets need a one-time database update (migration 061). Ask your administrator to apply it.
        </div>
      </Card>
    );
  }
  const t = d.you_today;
  const on = !!t?.checked_in;
  // Live: the running shift ticks from its check-in; earlier shifts today
  // come from the server, so the total is right without a reload.
  const shiftSecs = on && t?.since ? elapsed(t.since) : 0;
  const todaySecs = (t?.earlier_seconds || 0) + shiftSecs;

  const go = async (path: string) => {
    setBusy(true);
    try {
      const j = await api(path, {});
      toast.ok(path.endsWith("check-in")
        ? (j.already ? "You're already on shift." : "Checked in. Have a good shift.")
        : `Checked out after ${hm(j.shift_seconds || 0)}.`);
      onChanged();
    } catch (e: any) { toast.err(e.message); }
    setBusy(false);
  };

  return (
    <Card title="Your shift" icon={<Clock size={15} />}
      right={on
        ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.grn, fontSize: 12, fontWeight: 800 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.grn, animation: "deskpulse 2s infinite" }} />
            On shift
          </span>
        : <span style={{ color: C.dim, fontSize: 12, fontWeight: 700 }}>Off shift</span>}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 180px", minWidth: 0 }}>
          {on && t?.since ? (
            <>
              <div style={{ color: C.txt, fontSize: 26, fontWeight: 900, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
                {hm(shiftSecs)}
              </div>
              <div style={{ color: C.dim, fontSize: 12, marginTop: 3 }}>
                since {clock(t.since)}{(t.earlier_seconds || 0) >= 60 ? ` · ${hm(todaySecs)} today in total` : ""}
              </div>
            </>
          ) : (
            <>
              <div style={{ color: C.txt, fontSize: 15, fontWeight: 800 }}>
                {t?.worked_seconds ? `${hm(t.worked_seconds)} worked today` : "Not checked in yet today"}
              </div>
              <div style={{ color: C.dim, fontSize: 12, marginTop: 3 }}>
                {t?.first_in ? `First in at ${clock(t.first_in)}` : "Check in when you start, so your hours count."}
              </div>
            </>
          )}
        </div>
        <button onClick={() => go(on ? "/api/desk/check-out" : "/api/desk/check-in")} disabled={busy}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 20px", borderRadius: 10,
            border: on ? `1px solid ${C.bord}` : "none", cursor: busy ? "wait" : "pointer",
            background: on ? C.surf : C.grn, color: on ? C.txt : "#fff",
            fontSize: 14, fontWeight: 800, opacity: busy ? 0.6 : 1, minHeight: 44,
          }}>
          {on ? <LogOut size={16} /> : <LogIn size={16} />}
          {busy ? "…" : on ? "Check out" : "Check in"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14, marginTop: 16,
        paddingTop: 14, borderTop: `1px solid ${C.bord}` }}>
        <Progress label="Calls today" value={t?.calls || 0} target={t?.target_calls || 0} />
        <Progress label={`Conversations (${d.conversation_secs || 15}s+)`} value={t?.conversations || 0} target={t?.target_conversations || 0} />
      </div>
    </Card>
  );
}

// ── Team today (owner) ────────────────────────────────────────────────
function TeamToday({ d, api, onSaved, tick }: {
  d: Desk | null; api: (p: string, b?: any) => Promise<any>; onSaved: () => void; tick: number;
}) {
  const [edit, setEdit] = useState<string | null>(null);
  const [calls, setCalls] = useState("");
  const [convs, setConvs] = useState("");
  const [saving, setSaving] = useState(false);
  void tick;
  if (!d?.you_are_owner || !d.team_today) return null;
  const team = d.team_today;
  const onShift = team.filter(m => m.checked_in).length;

  const save = async (memberId: string) => {
    setSaving(true);
    try {
      await api("/api/desk/targets", { member_id: memberId, daily_calls: Number(calls || 0), daily_conversations: Number(convs || 0) });
      toast.ok("Targets saved.");
      setEdit(null); onSaved();
    } catch (e: any) { toast.err(e.message); }
    setSaving(false);
  };
  const input: React.CSSProperties = { width: 64, background: C.bg, border: `1px solid ${C.bord}`, color: C.txt,
    borderRadius: 7, padding: "6px 8px", fontSize: 13 };

  return (
    <Card title="Team today" icon={<Target size={15} />}
      right={<span style={{ color: C.dim, fontSize: 12 }}>{onShift} of {team.length} on shift</span>}>
      <div style={{ display: "grid", gap: 12 }}>
        {team.map(m => {
          const status = m.checked_in && m.since
            ? { text: `On shift since ${clock(m.since)} · ${hm((m.earlier_seconds || 0) + elapsed(m.since))} today`, color: C.grn }
            : m.worked_seconds ? { text: `Checked out · ${hm(m.worked_seconds)} today`, color: C.mid }
            : { text: "Not in today", color: C.dim };
          return (
            <div key={m.member_id} style={{ paddingBottom: 12, borderBottom: `1px solid ${C.bord}88` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: C.txt, fontSize: 13.5, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {m.name || "Unnamed seat"}{m.is_you ? <span style={{ color: C.dim, fontWeight: 500 }}> (you)</span> : ""}
                  </div>
                  <div style={{ color: status.color, fontSize: 12, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                    {m.checked_in && <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.grn }} />}
                    {status.text}
                  </div>
                </div>
                {edit !== m.member_id && (
                  <button onClick={() => { setEdit(m.member_id); setCalls(String(m.target_calls || "")); setConvs(String(m.target_conversations || "")); }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: `1px solid ${C.bord}`,
                      color: C.mid, borderRadius: 7, padding: "5px 9px", fontSize: 12, cursor: "pointer" }}>
                    <Pencil size={12} /> Targets
                  </button>
                )}
              </div>
              {edit === m.member_id ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <label style={{ color: C.mid, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    Calls/day <input type="number" min={0} max={1000} value={calls} onChange={e => setCalls(e.target.value)} style={input} />
                  </label>
                  <label style={{ color: C.mid, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    Conversations/day <input type="number" min={0} max={1000} value={convs} onChange={e => setConvs(e.target.value)} style={input} />
                  </label>
                  <button onClick={() => save(m.member_id)} disabled={saving}
                    style={{ background: C.glow, color: "#fff", border: "none", borderRadius: 7, padding: "6px 12px",
                      fontSize: 12, fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <Check size={12} /> Save
                  </button>
                  <button onClick={() => setEdit(null)} aria-label="Cancel"
                    style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", lineHeight: 0 }}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                  <Progress label="Calls" value={m.calls || 0} target={m.target_calls || 0} />
                  <Progress label="Conversations" value={m.conversations || 0} target={m.target_conversations || 0} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
