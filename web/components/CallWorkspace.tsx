"use client";

/**
 * The working half of the call screen: what a telecaller does WHILE the
 * customer is talking.
 *
 * Three things a conversation produces, each one tap from the dialer and
 * none of them waiting for the call to end:
 *
 *   Remarks   — typed as it is said; Enter saves. Every remark is kept, with
 *               who wrote it and when, so the next call starts informed.
 *   Book      — a date, a time, a service; the customer gets the WhatsApp
 *               confirmation while they are still on the line.
 *   WhatsApp  — the brochure, an approved template, or a typed reply when
 *               WhatsApp allows one.
 *
 * It follows the NUMBER in the dialer, so it works the same for a call the
 * seat placed, one they answered, and a number they are about to ring.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarPlus, MessageCircle, NotebookPen, Send, Check, TriangleAlert, X } from "lucide-react";
import { NIKKI } from "../lib/brand";
import { toast } from "./Toast";
import { confirmDialog } from "./Confirm";

const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border, glow: NIKKI.teal,
  gold: NIKKI.gold, grn: NIKKI.emerald, red: NIKKI.red,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

type Api = (path: string, body?: any) => Promise<any>;
type Remark = { id: string; body: string; author_name: string | null; during_call: boolean; created_at: string };
type Appt = { id: string; caller_name: string | null; service: string | null; slot_date: string; slot_time: string; booking_ref: string | null };
type Workspace = {
  lead: { id: string; name: string | null; stage: string } | null;
  remarks_ready: boolean; remarks: Remark[]; legacy_notes: string;
  appointments: Appt[];
  business: { name: string; services: string[]; appointment_types: string[]; open_days: string[]; open_time: string; close_time: string } | null;
  whatsapp: { opted_out: boolean; can_type: boolean; last_message_at: string | null };
};
type Template = { name: string; language: string; variables: string[]; body_text?: string };

const input: React.CSSProperties = {
  background: C.hi, border: `1px solid ${C.bord}`, borderRadius: 8, padding: "9px 12px",
  color: C.txt, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", width: "100%",
};
const btn = (bg: string, on = true, fg = "#fff"): React.CSSProperties => ({
  background: on ? bg : C.hi, color: on ? fg : C.dim, border: "none", borderRadius: 8, padding: "9px 14px", minHeight: 40,
  fontSize: 13, fontWeight: 700, cursor: on ? "pointer" : "not-allowed", fontFamily: "inherit",
  display: "inline-flex", alignItems: "center", gap: 6,
});
const chip = (on = false): React.CSSProperties => ({
  background: on ? C.glow : C.hi, color: on ? "#fff" : C.txt, border: `1px solid ${on ? C.glow : C.bord}`,
  borderRadius: 999, padding: "6px 12px", minHeight: 32, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
});
const label: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: C.mid, marginBottom: 4, display: "block" };

const istDate = (addDays = 0) =>
  new Date(Date.now() + addDays * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", {
  timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const niceDate = (d: string) => {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return d;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
};
const niceTime = (t: string) => {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t;
  return `${+m[1] % 12 || 12}:${m[2]} ${+m[1] < 12 ? "AM" : "PM"}`;
};

const QUICK_REMARKS = [
  "Asked for the price", "Wants details on WhatsApp", "Will discuss at home and call back",
  "Decision maker not available", "Already using another provider", "Asked to call later",
];
const QUICK_TIMES = ["10:00", "11:30", "13:00", "16:00", "18:00"];

type Tab = "remarks" | "book" | "whatsapp";

export default function CallWorkspace({ api, phone, leadName, ctcId, live, onRemark, onBooked }: {
  api: Api; phone: string; leadName?: string | null; ctcId?: string | null; live: boolean;
  onRemark?: (text: string) => void; onBooked?: (summary: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("remarks");
  const [ws, setWs] = useState<Workspace | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try { setWs(await api(`/api/desk/workspace?phone=${phone}`)); setErr(""); }
    catch (e: any) { setErr(e.message || "Couldn't load this customer."); }
  }, [api, phone]);
  useEffect(() => { setWs(null); load(); }, [load]);

  const tabBtn = (t: Tab, icon: React.ReactNode, text: string, count?: number) => (
    <button type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
      style={{
        flex: 1, minHeight: 40, border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "inherit",
        fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        background: tab === t ? C.surf : "transparent", color: tab === t ? C.txt : C.mid,
        boxShadow: tab === t ? "0 1px 2px rgba(15,23,42,0.12)" : "none",
      }}>
      {icon}{text}{count ? <span style={{ color: C.dim, fontWeight: 600 }}>· {count}</span> : null}
    </button>
  );

  return (
    <div style={{ marginTop: 12, border: `1px solid ${C.bord}`, borderRadius: 10, padding: 12 }}>
      <div role="tablist" aria-label="During the call" style={{ display: "flex", gap: 4, background: C.hi, borderRadius: 9, padding: 4, marginBottom: 12 }}>
        {tabBtn("remarks", <NotebookPen size={14} />, "Remarks", ws?.remarks.length)}
        {tabBtn("book", <CalendarPlus size={14} />, "Book", ws?.appointments.length)}
        {tabBtn("whatsapp", <MessageCircle size={14} />, "WhatsApp")}
      </div>
      {err && <div role="alert" style={{ fontSize: 13, color: C.red, marginBottom: 8 }}>{err} <button type="button" style={{ ...chip(), marginLeft: 6 }} onClick={load}>Try again</button></div>}
      {tab === "remarks" && <Remarks api={api} phone={phone} ws={ws} ctcId={ctcId} live={live} leadName={leadName}
        onSaved={(r, legacy) => { setWs(w => w ? (r ? { ...w, remarks: [r, ...w.remarks] } : { ...w, legacy_notes: legacy || w.legacy_notes }) : w); }}
        onRemark={onRemark} />}
      {tab === "book" && <Book api={api} phone={phone} ws={ws} leadName={leadName} reload={load} onBooked={onBooked} />}
      {tab === "whatsapp" && <WhatsApp api={api} phone={phone} ws={ws} />}
    </div>
  );
}

/* ── Remarks ────────────────────────────────────────────────── */
function Remarks({ api, phone, ws, ctcId, live, leadName, onSaved, onRemark }: {
  api: Api; phone: string; ws: Workspace | null; ctcId?: string | null; live: boolean; leadName?: string | null;
  onSaved: (r: Remark | null, legacyNotes?: string) => void; onRemark?: (t: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  async function save(t = text) {
    const body = t.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const j = await api("/api/desk/remark", { phone, text: body, ctc_log_id: ctcId || null, during_call: live, name: leadName || "" });
      onSaved(j.remark || null, j.legacy_notes);
      onRemark?.(body);
      setText("");
      box.current?.focus();
    } catch (e: any) { toast.err(e.message || "Couldn't save the remark."); }
    setBusy(false);
  }

  return (
    <div>
      <label htmlFor="desk-remark" style={label}>What did they say?</label>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea id="desk-remark" ref={box} rows={2} style={{ ...input, resize: "vertical", minHeight: 44 }}
          placeholder="Type and press Enter to save" value={text} maxLength={2000}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); } }} />
        <button type="button" style={btn(C.glow, !!text.trim() && !busy)} disabled={!text.trim() || busy} onClick={() => save()}>
          <Send size={14} /> {busy ? "Saving…" : "Save"}
        </button>
      </div>
      <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>Enter saves · Shift+Enter for a new line</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        {QUICK_REMARKS.map(q => (
          <button key={q} type="button" style={chip()} disabled={busy} onClick={() => save(q)}>{q}</button>
        ))}
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 8, maxHeight: 260, overflowY: "auto" }}>
        {!ws ? <div style={{ fontSize: 13, color: C.dim }}>Loading…</div>
          : ws.remarks.length === 0 && !ws.legacy_notes ? (
            <div style={{ fontSize: 13, color: C.dim }}>No remarks on this customer yet. The first one starts their history.</div>
          ) : null}
        {ws?.remarks.map(r => (
          <div key={r.id} style={{ borderLeft: `2px solid ${r.during_call ? C.grn : C.bord}`, paddingLeft: 10 }}>
            <div style={{ fontSize: 13.5, color: C.txt, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.body}</div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>
              {r.author_name || "Team"} · {when(r.created_at)}{r.during_call ? " · on the call" : ""}
            </div>
          </div>
        ))}
        {ws && !ws.remarks_ready && ws.legacy_notes && (
          <div style={{ fontSize: 13, color: C.mid, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{ws.legacy_notes}</div>
        )}
      </div>
    </div>
  );
}

/* ── Book ───────────────────────────────────────────────────── */
function Book({ api, phone, ws, leadName, reload, onBooked }: {
  api: Api; phone: string; ws: Workspace | null; leadName?: string | null; reload: () => void; onBooked?: (s: string) => void;
}) {
  const [name, setName] = useState(leadName || "");
  const [service, setService] = useState("");
  const [date, setDate] = useState(istDate(1));
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<{ text: string; clash: boolean } | null>(null);
  const [done, setDone] = useState<{ text: string; wa: string } | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  useEffect(() => { if (leadName && !name) setName(leadName); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leadName]);

  const options = [...new Set([...(ws?.business?.appointment_types || []), ...(ws?.business?.services || [])])].slice(0, 30);
  const ready = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time);

  async function book(confirm: { warning?: boolean; clash?: boolean } = {}) {
    if (!ready || busy) return;
    setBusy(true); setDone(null);
    try {
      const body: any = { phone, name, service, slot_date: date, slot_time: time, notes, notify,
        confirm_warning: !!confirm.warning, confirm_clash: !!confirm.clash };
      const path = moving ? `/api/desk/appointment/${moving}` : "/api/desk/appointment";
      const j = await api(path, moving ? { ...body, action: "reschedule" } : body);
      const ref = j.appointment?.booking_ref ? ` · No. ${j.appointment.booking_ref}` : "";
      const summary = `${moving ? "Moved to" : "Booked"} ${niceDate(date)}, ${niceTime(time)}${ref}`;
      setDone({ text: summary, wa: j.whatsapp });
      setAsk(null); setMoving(null); setTime(""); setNotes("");
      onBooked?.(summary);
      reload();
    } catch (e: any) {
      const m = String(e.message || "");
      // A closed day or a taken slot is a question, not a failure.
      if (/closed on|outside working hours/.test(m)) setAsk({ text: m, clash: false });
      else if (/already booked at that time\.$/.test(m) && /^(?!This customer)/.test(m)) setAsk({ text: m, clash: true });
      else toast.err(m || "Couldn't save the booking.");
    }
    setBusy(false);
  }

  async function cancel(a: Appt) {
    if (!await confirmDialog({ title: "Cancel this booking?", body: `${niceDate(a.slot_date)}, ${niceTime(a.slot_time)}${a.service ? ` · ${a.service}` : ""}`,
      confirmLabel: "Cancel booking", cancelLabel: "Keep it", danger: true })) return;
    try { await api(`/api/desk/appointment/${a.id}`, { action: "cancel" }); toast.ok("Booking cancelled."); reload(); }
    catch (e: any) { toast.err(e.message); }
  }

  return (
    <div>
      {ws && ws.appointments.length > 0 && (
        <div style={{ marginBottom: 12, display: "grid", gap: 6 }}>
          <div style={label}>Upcoming for this customer</div>
          {ws.appointments.map(a => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap",
              background: moving === a.id ? C.gold + "14" : C.hi, border: `1px solid ${moving === a.id ? C.gold + "66" : C.bord}`, borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 13, color: C.txt, fontWeight: 600 }}>
                {niceDate(a.slot_date)}, {niceTime(a.slot_time)}
                <span style={{ color: C.mid, fontWeight: 500 }}>{a.service ? ` · ${a.service}` : ""}{a.booking_ref ? ` · No. ${a.booking_ref}` : ""}</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" style={chip(moving === a.id)} onClick={() => { setMoving(moving === a.id ? null : a.id); setDate(a.slot_date); setTime(""); setDone(null); }}>
                  {moving === a.id ? "Moving…" : "Move"}
                </button>
                <button type="button" style={chip()} onClick={() => cancel(a)}>Cancel</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {moving && <div style={{ fontSize: 13, color: C.txt, fontWeight: 700, marginBottom: 8 }}>Pick the new date and time</div>}
      {!moving && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 10 }}>
          <div>
            <label htmlFor="bk-name" style={label}>Name</label>
            <input id="bk-name" style={input} value={name} maxLength={80} placeholder="Customer's name" onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="bk-service" style={label}>For</label>
            <input id="bk-service" style={input} list="bk-services" value={service} maxLength={80} placeholder="Service or reason"
              onChange={e => setService(e.target.value)} />
            <datalist id="bk-services">{options.map(o => <option key={o} value={o} />)}</datalist>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <div>
          <label htmlFor="bk-date" style={label}>Date</label>
          <input id="bk-date" type="date" style={input} value={date} min={istDate(0)} onChange={e => setDate(e.target.value)} />
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            {[["Today", 0], ["Tomorrow", 1], ["Day after", 2]].map(([l, n]) => (
              <button key={l as string} type="button" style={chip(date === istDate(n as number))} onClick={() => setDate(istDate(n as number))}>{l}</button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="bk-time" style={label}>Time</label>
          <input id="bk-time" type="time" step={900} style={input} value={time} onChange={e => setTime(e.target.value)} />
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            {QUICK_TIMES.map(t => <button key={t} type="button" style={chip(time === t)} onClick={() => setTime(t)}>{niceTime(t)}</button>)}
          </div>
        </div>
      </div>
      {ws?.business && (
        <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>
          Open {ws.business.open_days.join(", ") || "every day"}, {niceTime(ws.business.open_time || "")}–{niceTime(ws.business.close_time || "")}
        </div>
      )}

      {!moving && (
        <div style={{ marginTop: 10 }}>
          <label htmlFor="bk-notes" style={label}>Note for whoever meets them (optional)</label>
          <input id="bk-notes" style={input} value={notes} maxLength={500} placeholder="Bring the old reports, prefers evenings…" onChange={e => setNotes(e.target.value)} />
        </div>
      )}

      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13, color: C.txt, cursor: "pointer" }}>
        <input type="checkbox" checked={notify && !ws?.whatsapp.opted_out} disabled={!!ws?.whatsapp.opted_out}
          onChange={e => setNotify(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.glow }} />
        Send the confirmation on WhatsApp
        {ws?.whatsapp.opted_out && <span style={{ color: C.dim }}>(this number asked not to be messaged)</span>}
      </label>

      {ask && (
        <div role="alert" style={{ background: C.gold + "12", border: `1px solid ${C.gold}66`, borderRadius: 8, padding: "10px 12px", marginTop: 10 }}>
          <div style={{ fontSize: 13, color: C.txt, fontWeight: 700, display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
            <TriangleAlert size={14} color={C.gold} /> {ask.text}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={btn(C.gold, !busy)} disabled={busy} onClick={() => book({ warning: true, clash: true })}>
              {busy ? "Saving…" : "Book anyway"}
            </button>
            <button type="button" style={btn(C.hi, true, C.txt)} onClick={() => setAsk(null)}>Pick another time</button>
          </div>
        </div>
      )}

      {!ask && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" style={btn(C.grn, ready && !busy)} disabled={!ready || busy} onClick={() => book()}>
            <CalendarPlus size={14} /> {busy ? "Saving…" : moving ? "Move booking" : "Book appointment"}
          </button>
          {moving && <button type="button" style={btn(C.hi, true, C.txt)} onClick={() => setMoving(null)}><X size={14} /> Don&apos;t move</button>}
        </div>
      )}

      {done && (
        <div role="status" style={{ marginTop: 10, fontSize: 13, color: C.txt, display: "flex", gap: 6, alignItems: "flex-start", lineHeight: 1.45 }}>
          <Check size={15} color={C.grn} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            <strong>{done.text}.</strong>{" "}
            {done.wa === "sent" ? "The confirmation is on its way to their WhatsApp."
              : done.wa === "failed" ? <span style={{ color: C.red }}>WhatsApp didn&apos;t take the confirmation — tell them the time now.</span>
              : "No WhatsApp sent — tell them the time now."}
          </span>
        </div>
      )}
    </div>
  );
}

/* ── WhatsApp ───────────────────────────────────────────────── */
function WhatsApp({ api, phone, ws }: { api: Api; phone: string; ws: Workspace | null }) {
  const [busy, setBusy] = useState("");
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [tplErr, setTplErr] = useState("");
  const [pick, setPick] = useState("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [text, setText] = useState("");

  useEffect(() => {
    let off = false;
    api("/api/whatsapp/templates")
      .then(j => { if (!off) setTemplates(j.templates || []); })
      .catch(e => { if (!off) { setTemplates([]); setTplErr(e.message || "Couldn't load templates."); } });
    return () => { off = true; };
  }, [api]);

  const tpl = templates?.find(t => t.name === pick) || null;
  const filled = !!tpl && tpl.variables.every((_, i) => (vars[String(i + 1)] || "").trim());
  const preview = tpl?.body_text ? tpl.body_text.replace(/\{\{(\d+)\}\}/g, (_m, n) => vars[n]?.trim() || `[${tpl.variables[+n - 1] || n}]`) : "";

  async function run(key: string, fn: () => Promise<any>, okText: string) {
    setBusy(key);
    try { await fn(); toast.ok(okText); }
    catch (e: any) { toast.err(e.message || "WhatsApp didn't accept it."); }
    setBusy("");
  }

  if (ws?.whatsapp.opted_out) {
    return (
      <div role="alert" style={{ fontSize: 13, color: C.red, fontWeight: 700, display: "flex", gap: 6, alignItems: "center" }}>
        <TriangleAlert size={14} /> This number asked not to be contacted. Nothing can be sent.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <div style={label}>Details they asked for</div>
        <button type="button" style={btn(C.grn, !busy)} disabled={!!busy}
          onClick={() => run("brochure", () => api("/api/desk/whatsapp", ws?.lead?.id ? { lead_id: ws.lead.id } : { phone }), "Brochure sent on WhatsApp.")}>
          <MessageCircle size={14} /> {busy === "brochure" ? "Sending…" : "Send the brochure"}
        </button>
      </div>

      <div>
        <label htmlFor="wa-tpl" style={label}>An approved message</label>
        {templates === null ? <div style={{ fontSize: 13, color: C.dim }}>Loading…</div>
          : templates.length === 0 ? <div style={{ fontSize: 13, color: C.dim }}>{tplErr || "No approved templates yet. Add them on the WhatsApp page."}</div>
          : (
            <>
              <select id="wa-tpl" style={input} value={pick} onChange={e => { setPick(e.target.value); setVars({}); }}>
                <option value="">Choose a message…</option>
                {templates.map(t => <option key={t.name} value={t.name}>{t.name.replace(/_/g, " ")}</option>)}
              </select>
              {tpl && (
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {tpl.variables.map((v, i) => (
                    <div key={i}>
                      <label htmlFor={`wa-v${i}`} style={label}>{v || `Value ${i + 1}`}</label>
                      <input id={`wa-v${i}`} style={input} maxLength={200} value={vars[String(i + 1)] || ""}
                        onChange={e => setVars(x => ({ ...x, [String(i + 1)]: e.target.value }))} />
                    </div>
                  ))}
                  {preview && (
                    <div style={{ background: C.grn + "10", border: `1px solid ${C.grn}33`, borderRadius: 8, padding: "9px 11px",
                      fontSize: 13, color: C.txt, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{preview}</div>
                  )}
                  <div>
                    <button type="button" style={btn(C.grn, filled && !busy)} disabled={!filled || !!busy}
                      onClick={() => run("tpl", () => api("/api/whatsapp/send-template", { to_number: phone, template_name: tpl.name, variables: vars }), "Sent on WhatsApp.")}>
                      <Send size={14} /> {busy === "tpl" ? "Sending…" : "Send this message"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
      </div>

      <div>
        <label htmlFor="wa-text" style={label}>Type a message</label>
        {ws && !ws.whatsapp.can_type ? (
          <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.5 }}>
            WhatsApp only delivers a typed message within 24 hours of the customer&apos;s own last message, and this
            customer hasn&apos;t written{ws.whatsapp.last_message_at ? " since " + when(ws.whatsapp.last_message_at) : ""}. Use an approved message above.
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea id="wa-text" rows={2} style={{ ...input, resize: "vertical", minHeight: 44 }} maxLength={1000}
              placeholder="They wrote to you in the last 24 hours, so you can reply freely" value={text} onChange={e => setText(e.target.value)} />
            <button type="button" style={btn(C.grn, !!text.trim() && !busy)} disabled={!text.trim() || !!busy}
              onClick={() => run("text", async () => { await api("/api/whatsapp/send-as-tenant", { to_number: phone, message: text.trim() }); setText(""); }, "Sent on WhatsApp.")}>
              <Send size={14} /> {busy === "text" ? "Sending…" : "Send"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
