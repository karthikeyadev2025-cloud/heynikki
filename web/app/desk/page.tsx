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
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import { NIKKI } from "../../lib/brand";
import {
  Headset, PhoneCall, PhoneOff, Radio, Users, Bot, GitBranch, Check,
  Clock, Pencil, X, PhoneIncoming, PhoneOutgoing,
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
};
type Recent = {
  id: string; number: string; lead_id: string | null; lead_name: string | null;
  lead_stage: string | null; by: string | null; disposition: string | null;
  notes: string | null; duration_seconds: number; created_at: string; live: boolean;
};
type TeamCall = {
  id: string; number: string; status: "transferred" | "missed"; duration_seconds: number;
  created_at: string; wa_sent: boolean; has_recording: boolean; lead_id: string | null; lead_name: string | null;
};
type Desk = {
  did: string | null; routing_mode: "ai" | "hybrid" | "human"; seats: Seat[];
  ring_count: number; you: { id: string; role: string; phone: string | null; display_name: string | null } | null;
  you_are_owner: boolean; recent: Recent[]; team_calls: TeamCall[];
};
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
const elapsed = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
const digits10 = (v: string) => v.replace(/\D/g, "").slice(-10);
const prettyNum = (n: string) => n.length === 10 ? `${n.slice(0, 5)} ${n.slice(5)}` : n;

function Card({ title, icon, children, style, right }: {
  title: React.ReactNode; icon?: React.ReactNode; children: React.ReactNode;
  style?: React.CSSProperties; right?: React.ReactNode;
}) {
  return (
    <section style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12, padding: 18, ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ color: C.txt, fontSize: 14.5, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
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
  const [prefill, setPrefill] = useState<{ n: string; k: number }>({ n: "", k: 0 });
  const callBack = (n: string) => { setPrefill(p => ({ n, k: p.k + 1 })); window.scrollTo({ top: 0, behavior: "smooth" }); };

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
          customer, who sees <strong style={{ color: C.txt }}>{d?.did ? prettyNum(d.did) : "your business number"}</strong>.
          Choose who answers incoming calls, and give every seat a phone so it rings.
        </p>
        {err && (
          <div style={{ background: C.red + "11", border: `1px solid ${C.red}44`, color: C.red, borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
            {err}
          </div>
        )}

        <div className="desk-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)", gap: 16, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 16 }}>
            <Dialer d={d} api={api} onDone={load} prefill={prefill} />
            <LiveBoard calls={live} tick={tick} />
            <TeamCalls d={d} onCallBack={callBack} />
            <RecentCalls d={d} api={api} onSaved={load} />
          </div>
          <div style={{ display: "grid", gap: 16 }}>
            <Routing d={d} api={api} onSaved={load} />
            <Seats d={d} api={api} onSaved={load} />
          </div>
        </div>
      </div>
      <style>{`
        @media (max-width: 900px) { .desk-grid { grid-template-columns: 1fr !important; } }
        @keyframes deskpulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
      `}</style>
    </Shell>
  );
}

// ── Dialer ────────────────────────────────────────────────────────────
type DialState =
  | { phase: "idle" }
  | { phase: "ringing_you" }
  | { phase: "connected"; ctcId: string; startedAt: number }
  | { phase: "ended"; ctcId: string; seconds: number }
  | { phase: "failed"; reason: string };

function Dialer({ d, api, onDone, prefill }: {
  d: Desk | null; api: (p: string, b?: any) => Promise<any>; onDone: () => void; prefill: { n: string; k: number };
}) {
  const [num, setNum] = useState("");
  useEffect(() => { if (prefill.n) setNum(prefill.n); }, [prefill]);
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

  async function dial() {
    if (!ok || !havePhone) return;
    setSt({ phase: "ringing_you" });
    try {
      // The request returns once YOUR phone is answered — up to ~30 s.
      const j = await api("/api/calls/click-to-call", { customer_number: num, lead_id: lead?.id || null });
      const started = Date.now();
      setSt({ phase: "connected", ctcId: j.ctc_log_id, startedAt: started });
      pollRef.current = setInterval(async () => {
        try {
          const s = await api(`/api/calls/click-to-call/${j.ctc_log_id}`);
          if (s.ended) {
            if (pollRef.current) clearInterval(pollRef.current);
            setSt({ phase: "ended", ctcId: j.ctc_log_id, seconds: s.duration_seconds || Math.round((Date.now() - started) / 1000) });
            onDone();
          }
        } catch { /* keep polling */ }
      }, 3000);
    } catch (e: any) {
      const m = String(e.message || "");
      const reason = /NO_ANSWER|ORIGINATOR_CANCEL|timeout/i.test(m)
        ? `Your phone (${prettyNum(d?.you?.phone || "")}) didn't pick up. Try again when you're ready.`
        : /USER_BUSY/i.test(m) ? "Your phone is busy on another call."
        : /no_outbound_cli|assigned DID/i.test(m) ? "No business number is assigned to this account yet."
        : m || "Call failed";
      setSt({ phase: "failed", reason });
    }
  }

  async function outcome(key: string) {
    if (st.phase !== "ended") return;
    setSaving(key);
    try {
      await api("/api/calls/disposition", { ctc_log_id: st.ctcId, disposition: key, notes });
      setSt({ phase: "idle" }); setNotes(""); setNum(""); onDone();
    } catch (e: any) { alert(e.message); }
    setSaving("");
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
          <button style={btnStyle(C.grn, ok && havePhone)} disabled={!ok || !havePhone} onClick={dial}>
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
          <div style={{ fontSize: 13, color: C.txt, fontWeight: 700, marginBottom: 8 }}>
            Call ended · {fmtDur(st.seconds)}. How did it go?
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {OUTCOMES.map(o => (
              <button key={o.key} title={o.hint} disabled={!!saving}
                style={{ ...btnStyle(o.color), opacity: saving && saving !== o.key ? 0.5 : 1 }}
                onClick={() => outcome(o.key)}>
                {saving === o.key ? "Saving…" : o.label}
              </button>
            ))}
          </div>
          <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} placeholder="Notes (optional) — what they asked, what you promised"
            value={notes} onChange={e => setNotes(e.target.value)} />
          <div style={{ fontSize: 11.5, color: C.dim, marginTop: 6 }}>
            The outcome moves the lead's stage on the Leads page; Booked and Interested also send the brochure on WhatsApp if one is set.
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

// ── Seats ──────────────────────────────────────────────────────────────
function Seats({ d, api, onSaved }: { d: Desk | null; api: (p: string, b?: any) => Promise<any>; onSaved: () => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  function start(s: Seat) { setEdit(s.id); setPhone(s.phone || ""); setName(s.display_name || ""); setMsg(""); }
  async function save(s: Seat) {
    setBusy(true); setMsg("");
    try { await api("/api/desk/seat", { member_id: s.id, phone, display_name: name }); setEdit(null); onSaved(); }
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
          {d.routing_mode === "ai" ? "Nikki is answering everything — switch to Hybrid or Team on the right to see calls here." : "Calls that ring the seats' phones will show here, answered or missed."}
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
    catch (e: any) { alert(e.message); }
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
                    </td>
                    <td style={{ padding: "9px 8px", color: C.mid }}>{r.by || "—"}</td>
                    <td style={{ padding: "9px 8px" }}>
                      {r.disposition ? (
                        <span style={{ background: OUTCOME_COLOR[r.disposition] + "22", color: OUTCOME_COLOR[r.disposition] || C.mid,
                          borderRadius: 999, padding: "2px 9px", fontSize: 11.5, fontWeight: 700 }}>{OUTCOME_LABEL[r.disposition] || r.disposition}</span>
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
                    <td style={{ padding: "9px 8px" }}>
                      {r.lead_id && <a href={`/leads?lead=${r.lead_id}`} style={{ color: C.glow, fontSize: 12 }}>lead →</a>}
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
