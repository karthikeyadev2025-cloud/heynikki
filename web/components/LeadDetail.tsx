"use client";

/**
 * Lead detail drawer — the whole relationship on one screen.
 *
 * The previous drawer was a settings form (owner, value, tags, a Save
 * button) with an activity list that only ever held the changes made in
 * that same form. Everything the business actually wanted to know about a
 * caller — what they said on each call, whether the desk rang them, what
 * they wrote on WhatsApp, the appointment Nikki booked — lived on four other
 * pages. This drawer joins those tables by phone number into one timeline,
 * puts the two actions that matter (call, message) at the top, and makes the
 * stage a one-click change rather than a select-then-save.
 *
 * Reads and writes Supabase directly with the user's JWT; RLS (leads,
 * lead_activities, calls, appointments, click_to_call_log, wa_inbound,
 * wa_dispatch_log) scopes every query to the tenant in Postgres. The one
 * thing that goes through the API is sending a WhatsApp reply, because the
 * Meta token lives on the server.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "../lib/supabase";
import { NIKKI } from "../lib/brand";
import { toast } from "./Toast";
import {
  X, Plus, Loader2, Tag as TagIcon, IndianRupee, User, Phone, PhoneIncoming,
  PhoneOutgoing, PhoneMissed, Headset, MessageCircle, Calendar, StickyNote,
  ArrowRightLeft, ExternalLink, Pencil, Check,
} from "lucide-react";

const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border, bordHi: NIKKI.borderHi,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
  teal: NIKKI.teal, gbr: NIKKI.tealLight, grn: NIKKI.emerald, red: NIKKI.red,
  gold: NIKKI.gold, cyn: NIKKI.cyan, acc: NIKKI.terracotta,
};

export type Stage = { id: string; label: string; color: string };
type Seat = { user_id: string; display_name: string | null; role: string };

type Item = {
  id: string; at: string;
  kind: "call" | "desk" | "wa_in" | "wa_out" | "appt" | "note" | "change";
  title: string; body?: string | null; meta?: string | null; href?: string;
  tone: string;
};

const fmtDur = (s: number) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
const last10 = (n: unknown) => String(n || "").replace(/\D/g, "").slice(-10);
const when = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
};
const dayKey = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

function scoreColor(s: number): string {
  if (s >= 80) return C.grn;
  if (s >= 50) return C.gold;
  if (s >= 20) return C.gbr;
  return C.dim;
}

/** The last turn Nikki's transcript records the caller saying — the closest
 *  thing to "what this call was about" without a summary column. */
function gist(transcript: any): string | null {
  if (!Array.isArray(transcript)) return null;
  const user = transcript.filter((t: any) => t && (t.role === "user" || t.role === "caller") && t.content);
  const pick = user.length ? user[user.length - 1] : transcript[transcript.length - 1];
  const s = String(pick?.content || "").trim();
  return s ? (s.length > 140 ? s.slice(0, 137) + "…" : s) : null;
}

export default function LeadDetail({
  lead, stages, onClose, onChanged, onCall, calling,
}: {
  lead: any;
  stages: Stage[];
  onClose: () => void;
  /** Called with the patch already written to Postgres so the list updates without a refetch. */
  onChanged: (patch: Record<string, any>) => void;
  onCall?: (lead: any) => void;
  calling?: boolean;
}) {
  const [seats, setSeats]       = useState<Seat[]>([]);
  const [items, setItems]       = useState<Item[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<"timeline" | "details">("timeline");
  const [uid, setUid]           = useState<string | null>(null);

  // Details form
  const [name, setName]         = useState<string>(lead.name || "");
  const [editName, setEditName] = useState(false);
  const [assigned, setAssigned] = useState<string>(lead.assigned_to || "");
  const [value, setValue]       = useState<string>(lead.deal_value_paise ? String(Math.round(lead.deal_value_paise / 100)) : "");
  const [tags, setTags]         = useState<string[]>(lead.tags || []);
  const [tagDraft, setTagDraft] = useState("");
  const [busy, setBusy]         = useState(false);

  // Composer
  const [note, setNote]         = useState("");
  const [wa, setWa]             = useState("");
  const [waOpen, setWaOpen]     = useState(false);
  const [sending, setSending]   = useState(false);
  const [waWindow, setWaWindow] = useState<boolean | null>(null);

  const API = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";
  const phone = last10(lead.phone);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    setUid(user?.id ?? null);
    const like = `%${phone}`;
    const [seatRes, acts, calls, desk, waIn, waOut, appts] = await Promise.all([
      sb.from("tenant_users").select("user_id, display_name, role").eq("tenant_id", lead.tenant_id),
      sb.from("lead_activities").select("id, type, description, created_at, created_by")
        .eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(100),
      sb.from("calls").select("id, direction, status, duration_seconds, intent, transcript, created_at, wa_sent, appointment_created, r2_object_key, recording_url")
        .eq("tenant_id", lead.tenant_id).like("caller_number", like).order("created_at", { ascending: false }).limit(50),
      sb.from("click_to_call_log").select("id, agent_user_id, disposition, notes, duration_seconds, created_at")
        .eq("tenant_id", lead.tenant_id).like("callee_number", like).order("created_at", { ascending: false }).limit(50),
      sb.from("wa_inbound").select("id, body, msg_type, received_at")
        .eq("tenant_id", lead.tenant_id).like("from_number", like).order("received_at", { ascending: false }).limit(50),
      sb.from("wa_dispatch_log").select("id, message_type, message_body, status, sent_at")
        .eq("tenant_id", lead.tenant_id).like("to_number", like).order("sent_at", { ascending: false }).limit(50),
      sb.from("appointments").select("id, service, slot_date, slot_time, status, created_at")
        .eq("tenant_id", lead.tenant_id).like("caller_number", like).order("created_at", { ascending: false }).limit(20),
    ]);

    const seatRows = seatRes.error
      ? ((await sb.from("tenant_users").select("user_id, role").eq("tenant_id", lead.tenant_id)).data || []).map((b: any) => ({ ...b, display_name: null }))
      : (seatRes.data || []);
    setSeats(seatRows as Seat[]);
    const seatName = (id: string | null) => {
      const s = (seatRows as Seat[]).find(x => x.user_id === id);
      return s?.display_name || (s ? s.role : null);
    };

    const out: Item[] = [];
    for (const c of (calls.data || []) as any[]) {
      const inbound = c.direction !== "outbound";
      const missed = c.status === "missed";
      const team = c.status === "transferred";
      out.push({
        id: `call-${c.id}`, at: c.created_at, kind: "call",
        tone: missed ? C.gold : team ? C.gbr : inbound ? C.grn : C.acc,
        title: missed ? "Missed call — nobody picked up"
             : team ? (inbound ? "Called in · answered by your team" : "Your team called")
             : inbound ? "Called in · Nikki answered" : "Nikki called them",
        body: missed ? (c.wa_sent ? "Nikki sent them a WhatsApp so they know you'll call back." : null) : gist(c.transcript),
        meta: [c.intent && !String(c.intent).startsWith("wa_otp") ? String(c.intent) : null,
               c.duration_seconds ? fmtDur(c.duration_seconds) : null,
               c.appointment_created ? "booked an appointment" : null,
               (c.r2_object_key || c.recording_url) ? "recording" : null].filter(Boolean).join(" · "),
        href: `/calls?call=${c.id}`,
      });
    }
    for (const d of (desk.data || []) as any[]) {
      const disp = d.disposition ? String(d.disposition).replace(/_/g, " ") : null;
      out.push({
        id: `desk-${d.id}`, at: d.created_at, kind: "desk", tone: C.teal,
        title: `Dialled from the desk${seatName(d.agent_user_id) ? ` by ${seatName(d.agent_user_id)}` : ""}`,
        body: d.notes || null,
        meta: [disp ? `outcome: ${disp}` : (d.duration_seconds ? null : "no outcome logged"),
               d.duration_seconds ? fmtDur(d.duration_seconds) : null].filter(Boolean).join(" · "),
      });
    }
    for (const m of (waIn.data || []) as any[]) {
      out.push({ id: `wain-${m.id}`, at: m.received_at, kind: "wa_in", tone: C.grn,
        title: "They wrote on WhatsApp", body: m.body || (m.msg_type ? `(${m.msg_type})` : null) });
    }
    for (const m of (waOut.data || []) as any[]) {
      const body = String(m.message_body || "");
      out.push({ id: `waout-${m.id}`, at: m.sent_at, kind: "wa_out", tone: m.status === "failed" ? C.red : C.mid,
        title: m.message_type === "manual_reply" ? "You replied on WhatsApp"
             : body.startsWith("template:") ? `WhatsApp template sent · ${body.slice(9)}`
             : "Nikki sent a WhatsApp",
        body: body.startsWith("template:") ? null : body,
        meta: m.status && m.status !== "sent" ? String(m.status) : null });
    }
    for (const a of (appts.data || []) as any[]) {
      out.push({ id: `appt-${a.id}`, at: a.created_at, kind: "appt", tone: a.status === "cancelled" ? C.dim : C.cyn,
        title: `Appointment ${a.status === "pending" ? "needs confirmation" : a.status}`,
        body: [a.service, a.slot_date, a.slot_time].filter(Boolean).join(" · ") || null,
        href: "/appointments" });
    }
    for (const a of (acts.data || []) as any[]) {
      const by = seatName(a.created_by);
      out.push({ id: `act-${a.id}`, at: a.created_at, kind: a.type === "note" ? "note" : "change",
        tone: a.type === "note" ? C.gold : C.dim,
        title: a.type === "note" ? `Note${by ? ` · ${by}` : ""}` : a.description,
        body: a.type === "note" ? a.description : null,
        meta: a.type !== "note" && by ? by : null });
    }
    out.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
    setItems(out);

    // Free-text WhatsApp only lands inside Meta's 24-hour window after their
    // last message; say so before they type.
    const lastIn = (waIn.data || [])[0]?.received_at;
    setWaWindow(!!lastIn && Date.now() - new Date(lastIn).getTime() < 24 * 3600e3);
    setLoading(false);
  }, [lead.id, lead.tenant_id, phone]);

  useEffect(() => { load(); }, [load]);

  const seatName = (id: string | null) => {
    if (!id) return "Unassigned";
    const s = seats.find(x => x.user_id === id);
    return s?.display_name || s?.role || `${id.slice(0, 8)}…`;
  };

  const logActivity = async (type: string, description: string) => {
    const sb = createClient();
    const { error } = await sb.from("lead_activities").insert({ lead_id: lead.id, type, description, created_by: uid });
    if (error) console.error("[lead] activity log failed:", error.message);
  };

  const setStage = async (id: string) => {
    if (id === lead.stage) return;
    const sb = createClient();
    const { error } = await sb.from("leads").update({ stage: id }).eq("id", lead.id);
    if (error) { toast.err(error.message); return; }
    await logActivity("stage_change", `Stage: ${lead.stage} → ${id}`);
    onChanged({ stage: id });
    toast.ok(`Moved to ${stages.find(s => s.id === id)?.label || id}`);
    load();
  };

  const addNote = async () => {
    const t = note.trim();
    if (!t) return;
    setBusy(true);
    await logActivity("note", t);
    setNote("");
    setBusy(false);
    load();
  };

  const sendWa = async () => {
    const text = wa.trim();
    if (!text) return;
    setSending(true);
    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${API}/api/whatsapp/send-as-tenant`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to_number: phone, message: text }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setSending(false);
    if (r?.ok) { toast.ok("Sent on WhatsApp"); setWa(""); setWaOpen(false); load(); }
    else toast.err(j.error || "Could not send the message");
  };

  const saveDetails = async () => {
    setBusy(true);
    const sb = createClient();
    const paise = Math.max(0, Math.round((parseFloat(value) || 0) * 100));
    const patch: Record<string, any> = {
      name: name.trim() || null, assigned_to: assigned || null, deal_value_paise: paise, tags,
    };
    const { error } = await sb.from("leads").update(patch).eq("id", lead.id);
    if (error) { toast.err(error.message); setBusy(false); return; }
    if ((assigned || null) !== (lead.assigned_to || null)) await logActivity("assignment", `Assigned to ${seatName(assigned || null)}`);
    if (paise !== (lead.deal_value_paise || 0)) await logActivity("value_change",
      `Deal value: ₹${((lead.deal_value_paise || 0) / 100).toLocaleString("en-IN")} → ₹${(paise / 100).toLocaleString("en-IN")}`);
    if (JSON.stringify(tags) !== JSON.stringify(lead.tags || [])) await logActivity("tag_change", `Tags: ${tags.join(", ") || "none"}`);
    onChanged(patch);
    setBusy(false);
    setEditName(false);
    toast.ok("Saved");
    load();
  };

  const addTag = () => {
    const t = tagDraft.trim().toLowerCase();
    if (!t || tags.includes(t)) { setTagDraft(""); return; }
    setTags([...tags, t]); setTagDraft("");
  };

  // Esc closes; nothing else on the page listens for it.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const grouped = useMemo(() => {
    const g: Array<{ day: string; items: Item[] }> = [];
    for (const it of items) {
      const d = dayKey(it.at);
      const last = g[g.length - 1];
      if (last && last.day === d) last.items.push(it); else g.push({ day: d, items: [it] });
    }
    return g;
  }, [items]);

  const counts = useMemo(() => ({
    calls: items.filter(i => i.kind === "call" || i.kind === "desk").length,
    wa:    items.filter(i => i.kind === "wa_in" || i.kind === "wa_out").length,
    appts: items.filter(i => i.kind === "appt").length,
  }), [items]);

  const label: React.CSSProperties = {
    display: "block", fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
    color: C.mid, marginBottom: 6, textTransform: "uppercase",
  };
  const field: React.CSSProperties = {
    width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 8,
    border: `1px solid ${C.bord}`, background: C.surf, color: C.txt, outline: "none",
  };
  const iconFor = (k: Item["kind"]) => ({
    call: PhoneIncoming, desk: Headset, wa_in: MessageCircle, wa_out: MessageCircle,
    appt: Calendar, note: StickyNote, change: ArrowRightLeft,
  }[k]);
  const stageMeta = stages.find(s => s.id === lead.stage);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
      display: "flex", justifyContent: "flex-end", zIndex: 10000,
    }}>
      <div role="dialog" aria-label={`Lead ${lead.name || phone}`} onClick={e => e.stopPropagation()} style={{
        width: "min(520px, 100%)", height: "100%", background: C.hi,
        borderLeft: `1px solid ${C.bord}`, display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{ padding: "18px 20px 14px", background: C.surf, borderBottom: `1px solid ${C.bord}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              {editName ? (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input autoFocus value={name} onChange={e => setName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") saveDetails(); }}
                    placeholder="Name" style={{ ...field, padding: "6px 10px", fontSize: 16, fontWeight: 700 }} />
                  <button onClick={saveDetails} aria-label="Save name" style={{ background: C.grn, color: "#fff", border: 0, borderRadius: 8, padding: 7 }}><Check size={14} /></button>
                </div>
              ) : (
                <h2 style={{ margin: 0, fontSize: 20, color: C.txt, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.name || "Unknown caller"}</span>
                  <button onClick={() => setEditName(true)} aria-label="Edit name"
                    style={{ background: "none", border: 0, color: C.dim, padding: 2, display: "inline-flex" }}><Pencil size={13} /></button>
                </h2>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                <span style={{ color: C.mid, fontSize: 13, fontFamily: "var(--font-mono), monospace" }}>{phone}</span>
                <span style={{ background: scoreColor(lead.score) + "1A", color: scoreColor(lead.score), border: `1px solid ${scoreColor(lead.score)}44`,
                  borderRadius: 20, padding: "1px 8px", fontSize: 11, fontWeight: 800 }}>score {lead.score}</span>
                {lead.call_count > 0 && <span style={{ color: C.dim, fontSize: 12 }}>{lead.call_count} call{lead.call_count === 1 ? "" : "s"}</span>}
                {lead.assigned_to && <span style={{ color: C.dim, fontSize: 12 }}>· {seatName(lead.assigned_to)}</span>}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close"
              style={{ background: "none", border: "none", color: C.mid, padding: 4, flexShrink: 0 }}>
              <X size={20} />
            </button>
          </div>

          {(lead.interest || lead.intent) && (
            <div style={{ marginTop: 10, fontSize: 13, color: C.txt, lineHeight: 1.45 }}>
              <span style={{ color: C.dim }}>Wants: </span>
              {lead.interest || String(lead.intent).replace(/_/g, " ")}
            </div>
          )}

          {/* Stage — one click, saved immediately. */}
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 12 }}>
            {stages.map(s => {
              const on = lead.stage === s.id;
              return (
                <button key={s.id} onClick={() => setStage(s.id)} aria-pressed={on} style={{
                  background: on ? s.color + "26" : "transparent",
                  color: on ? s.color : C.mid,
                  border: `1px solid ${on ? s.color + "88" : C.bord}`,
                  borderRadius: 20, padding: "5px 12px", fontSize: 12, fontWeight: 700,
                }}>{s.label}</button>
              );
            })}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {onCall && (
              <button onClick={() => onCall(lead)} disabled={!!calling} style={{
                flex: "1 1 120px", background: C.grn, color: "#fff", border: 0, borderRadius: 9,
                padding: "10px 14px", fontSize: 13, fontWeight: 800,
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
                opacity: calling ? 0.7 : 1,
              }}>
                <Phone size={14} /> {calling ? "Ringing you…" : "Call"}
              </button>
            )}
            <button onClick={() => setWaOpen(v => !v)} style={{
              flex: "1 1 120px", background: waOpen ? C.teal : C.teal + "14", color: waOpen ? "#fff" : C.teal,
              border: `1px solid ${C.teal}33`, borderRadius: 9, padding: "10px 14px", fontSize: 13, fontWeight: 800,
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
            }}>
              <MessageCircle size={14} /> WhatsApp
            </button>
            <a href={`https://wa.me/91${phone}`} target="_blank" rel="noreferrer" title="Open in your own WhatsApp"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, color: C.dim, fontSize: 12, padding: "10px 4px" }}>
              <ExternalLink size={13} /> wa.me
            </a>
          </div>

          {waOpen && (
            <div style={{ marginTop: 10 }}>
              {waWindow === false && (
                <div style={{ fontSize: 12, color: C.gold, marginBottom: 6, lineHeight: 1.4 }}>
                  They haven&apos;t messaged in the last 24 hours, so WhatsApp only allows a template.{" "}
                  <a href={`/whatsapp?to=${phone}`} style={{ color: C.teal, fontWeight: 700 }}>Send a template →</a>
                </div>
              )}
              <textarea value={wa} onChange={e => setWa(e.target.value)} rows={2}
                placeholder={`Message ${lead.name || phone} from your business WhatsApp…`}
                style={{ ...field, resize: "vertical" }} />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
                <button onClick={() => { setWaOpen(false); setWa(""); }} style={{ background: "none", border: `1px solid ${C.bord}`, color: C.mid, borderRadius: 8, padding: "7px 12px", fontSize: 12 }}>Cancel</button>
                <button onClick={sendWa} disabled={sending || !wa.trim() || waWindow === false} style={{
                  background: C.teal, color: "#fff", border: 0, borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700,
                  opacity: sending || !wa.trim() || waWindow === false ? 0.6 : 1,
                }}>{sending ? "Sending…" : "Send"}</button>
              </div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${C.bord}`, background: C.surf, padding: "0 20px" }}>
          {([["timeline", `Timeline`], ["details", "Details"]] as const).map(([id, l]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              background: "none", border: 0, borderBottom: `2px solid ${tab === id ? C.teal : "transparent"}`,
              color: tab === id ? C.teal : C.mid, padding: "10px 12px", fontSize: 13, fontWeight: 700, marginBottom: -1,
            }}>{l}</button>
          ))}
          <div style={{ marginLeft: "auto", alignSelf: "center", color: C.dim, fontSize: 11 }}>
            {counts.calls} calls · {counts.wa} messages{counts.appts ? ` · ${counts.appts} bookings` : ""}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {tab === "timeline" ? (
            <>
              {/* Note composer */}
              <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                <input value={note} onChange={e => setNote(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addNote(); } }}
                  placeholder="Add a note — what happened, what to do next…" style={field} />
                <button onClick={addNote} disabled={busy || !note.trim()} style={{
                  background: C.txt, color: "#fff", border: 0, borderRadius: 8, padding: "0 14px", fontSize: 13, fontWeight: 700,
                  opacity: !note.trim() ? 0.5 : 1, flexShrink: 0,
                }}>{busy ? <Loader2 size={14} /> : "Add"}</button>
              </div>

              {loading ? (
                <div style={{ color: C.dim, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}><Loader2 size={14} /> Loading history…</div>
              ) : items.length === 0 ? (
                <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.5 }}>
                  Nothing yet. Calls, WhatsApp messages, bookings and your notes for {phone} will show up here.
                </div>
              ) : grouped.map(g => (
                <div key={g.day} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>{g.day}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {g.items.map(it => {
                      const Icon = it.kind === "call" && /Nikki called|team called/.test(it.title) ? PhoneOutgoing
                                 : it.kind === "call" && /Missed/.test(it.title) ? PhoneMissed : iconFor(it.kind);
                      const isWa = it.kind === "wa_in" || it.kind === "wa_out";
                      return (
                        <div key={it.id} style={{
                          display: "grid", gridTemplateColumns: "28px 1fr", gap: 10,
                          background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 10, padding: "10px 12px",
                          borderLeft: `3px solid ${it.tone}`,
                        }}>
                          <div style={{ width: 28, height: 28, borderRadius: 8, background: it.tone + "1A", color: it.tone,
                            display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={14} /></div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>{it.title}</span>
                              <span style={{ fontSize: 11, color: C.dim, whiteSpace: "nowrap" }}>{when(it.at)}</span>
                            </div>
                            {it.body && (
                              <div style={{
                                fontSize: 13, color: C.txt, marginTop: 4, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word",
                                ...(isWa ? { background: it.kind === "wa_in" ? C.grn + "12" : C.hi, borderRadius: 8, padding: "6px 10px" } : {}),
                                ...(it.kind === "call" ? { fontStyle: "italic", color: C.mid } : {}),
                              }}>{it.body}</div>
                            )}
                            {(it.meta || it.href) && (
                              <div style={{ fontSize: 11, color: C.dim, marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {it.meta && <span>{it.meta}</span>}
                                {it.href && <a href={it.href} style={{ color: C.teal, fontWeight: 700 }}>
                                  {it.kind === "call" ? "Open call →" : "Open →"}
                                </a>}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <div style={{ marginBottom: 16 }}>
                <label style={label}>Name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Unknown caller" style={field} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={label}><User size={11} style={{ verticalAlign: -1 }} /> Owner</label>
                <select value={assigned} onChange={e => setAssigned(e.target.value)} style={field}>
                  <option value="">Unassigned</option>
                  {seats.map(s => (
                    <option key={s.user_id} value={s.user_id}>{s.display_name || `${s.role} · ${s.user_id.slice(0, 8)}…`}</option>
                  ))}
                </select>
                {seats.length <= 1 && (
                  <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>
                    Invite teammates from <a href="/setup" style={{ color: C.teal }}>Setup</a> to hand leads to them.
                  </div>
                )}
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={label}><IndianRupee size={11} style={{ verticalAlign: -1 }} /> Deal value (₹)</label>
                <input value={value} onChange={e => setValue(e.target.value)} inputMode="decimal" placeholder="0" style={field} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={label}><TagIcon size={11} style={{ verticalAlign: -1 }} /> Tags</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {tags.map(t => (
                    <span key={t} style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 20,
                      padding: "4px 10px", fontSize: 12, color: C.txt, display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {t}
                      <button onClick={() => setTags(tags.filter(x => x !== t))} aria-label={`Remove ${t}`}
                        style={{ background: "none", border: "none", color: C.dim, padding: 0, lineHeight: 1 }}><X size={12} /></button>
                    </span>
                  ))}
                  {tags.length === 0 && <span style={{ fontSize: 12, color: C.dim }}>No tags</span>}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={tagDraft} onChange={e => setTagDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                    placeholder="add a tag" style={{ ...field, flex: 1 }} />
                  <button onClick={addTag} aria-label="Add tag" style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 8, padding: "0 12px", color: C.txt }}><Plus size={15} /></button>
                </div>
              </div>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 16, lineHeight: 1.5 }}>
                Source: {String(lead.source || "call").replace(/_/g, " ")} · first seen {when(lead.created_at)}
                {stageMeta && <> · stage <span style={{ color: stageMeta.color, fontWeight: 700 }}>{stageMeta.label}</span></>}
              </div>
              <button onClick={saveDetails} disabled={busy} style={{
                width: "100%", padding: 12, borderRadius: 10, border: "none",
                background: busy ? C.dim : C.teal, color: "#fff", fontWeight: 700, fontSize: 14,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                {busy ? <><Loader2 size={15} /> Saving…</> : "Save details"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
