// components/WhatsAppChat.tsx
//
// WhatsApp the way people already know it: everyone on the left, the open
// conversation on the right, ticks on what was sent, a count on what has
// not been read. It replaces a list of replies with a box under each.
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bell, BellOff, Check, CheckCheck, CircleAlert, Clock, FileText, MessageCirclePlus, Phone, Search, Send, UserRound, Zap } from "lucide-react";
import { NIKKI } from "../lib/brand";
import { deskApi } from "../lib/desk-api";
import { createClient } from "../lib/supabase";
import { WA_EVENT, alertsState, enableAlerts } from "../lib/wa-notify";
import { toast } from "./Toast";

const API = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";
const C = { txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim, bord: "#E4E9F0", grn: "#16A34A", red: NIKKI.red,
  teal: NIKKI.teal, surf: NIKKI.surface, paper: "#F5F1EA", mine: "#DCF8C6", read: "#2F8FDD" };
const IST = "Asia/Kolkata";
const QUICK_KEY = "nk_wa_quick_replies";
const QUICK_DEFAULT = ["Thank you! We will call you shortly.", "Could you share a good time to call?", "Yes, that is available."];

type Chat = { number: string; lead_id: string | null; name: string | null; last: string; last_at: string;
  last_dir: "in" | "out"; last_status: string | null; unread: number; window_open: boolean;
  window_closes_at: string | null; waiting: boolean };
type Msg = { id: string; dir: "in" | "out"; body: string; at: string; type?: string; status?: string;
  label?: string | null; media?: { mime: string | null; name: string | null } | null; pending?: boolean };
type Thread = { number: string; name: string | null; lead_id: string | null; messages: Msg[];
  opted_out: boolean; window_open: boolean; window_closes_at: string | null };

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: IST });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: IST });
function dayLabel(iso: string) {
  const k = dayKey(iso), now = Date.now();
  if (k === dayKey(new Date(now).toISOString())) return "Today";
  if (k === dayKey(new Date(now - 86400000).toISOString())) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST });
}
/** List time: the clock today, the day otherwise — as the phone app shows it. */
const listTime = (iso: string) => dayLabel(iso) === "Today" ? clock(iso)
  : dayLabel(iso) === "Yesterday" ? "Yesterday"
  : new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
const spaced = (n: string) => n.replace(/^(\d{5})(\d{5})$/, "$1 $2");
// A manual template send is logged as "template:<name>".
const shown = (body: string) => /^template:/.test(body) ? "Template · " + body.slice(9).replace(/_/g, " ") : body;

function Ticks({ status }: { status?: string | null }) {
  if (status === "failed") return <CircleAlert size={13} color={C.red} aria-label="Not delivered" />;
  if (status === "read") return <CheckCheck size={14} color={C.read} aria-label="Read" />;
  if (status === "delivered") return <CheckCheck size={14} color="#8696A0" aria-label="Delivered" />;
  if (status === "pending") return <Clock size={12} color="#8696A0" aria-label="Sending" />;
  return <Check size={14} color="#8696A0" aria-label="Sent" />;
}

/** A photo, voice note or file a customer sent. Fetched with the login. */
function Media({ id, mime, name }: { id: string; mime: string | null; name: string | null }) {
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const kind = (mime || "").split("/")[0];
  const load = useCallback(async () => {
    setBusy(true); setErr("");
    try {
      const { data: { session } } = await createClient().auth.getSession();
      const r = await fetch(`${API}/api/whatsapp/media/${id}`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not open the file");
      setUrl(URL.createObjectURL(await r.blob()));
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }, [id]);
  // Pictures open by themselves, as they do on a phone.
  useEffect(() => { if (kind === "image") load(); }, [kind, load]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  if (err) return <div style={{ color: C.red, fontSize: 12 }}>{err}</div>;
  if (url && kind === "image") return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={name || "Photo"} style={{ maxWidth: 260, maxHeight: 260, borderRadius: 8, display: "block" }} /></a>;
  if (url && kind === "audio") return <audio controls src={url} style={{ maxWidth: 260 }} />;
  if (url && kind === "video") return <video controls src={url} style={{ maxWidth: 260, borderRadius: 8 }} />;
  if (url) return <a href={url} download={name || "file"} style={{ color: C.teal, fontWeight: 600, fontSize: 13 }}>Save {name || "file"}</a>;
  return (
    <button type="button" onClick={load} disabled={busy} style={{ display: "inline-flex", alignItems: "center", gap: 6,
      background: "#fff", border: `1px solid ${C.bord}`, borderRadius: 8, padding: "6px 10px", fontSize: 13, color: C.txt }}>
      <FileText size={14} /> {busy ? "Opening…" : kind === "audio" ? "Play voice note" : `Open ${name || kind || "file"}`}
    </button>
  );
}

export default function WhatsAppChat({ templates, refreshKey, onTemplate }: {
  templates: any[];
  /** Bumped by the page after it sends a template, so the chat shows it. */
  refreshKey: number;
  onTemplate: (number: string, template?: any) => void;
}) {
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [open, setOpen] = useState("");
  const [thread, setThread] = useState<Thread | null>(null);
  const [filter, setFilter] = useState<"all" | "unread" | "waiting">("all");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [alerts, setAlerts] = useState<ReturnType<typeof alertsState>>("unsupported");
  const [quick, setQuick] = useState<string[]>(QUICK_DEFAULT);
  const [showQuick, setShowQuick] = useState(false);
  const [newChat, setNewChat] = useState(false);
  const [newNumber, setNewNumber] = useState("");
  const [tpl, setTpl] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open); openRef.current = open;

  const loadChats = useCallback(async () => {
    try { setChats((await deskApi("/api/whatsapp/chats")).chats || []); }
    catch (e: any) { setChats(c => c || []); if (!/Signed out/.test(e.message)) toast.err(e.message); }
  }, []);
  const loadThread = useCallback(async (number: string, quiet = false) => {
    try {
      const t: Thread = await deskApi(`/api/whatsapp/chat?number=${number}`);
      if (openRef.current !== number) return;
      setThread(prev => {
        const grew = !prev || prev.number !== t.number || prev.messages.length !== t.messages.length;
        if (grew) setTimeout(() => endRef.current?.scrollIntoView({ block: "end" }), 30);
        return t;
      });
      setChats(cs => cs && cs.map(c => c.number === number ? { ...c, unread: 0 } : c));
    } catch (e: any) { if (!quiet) toast.err(e.message); }
  }, []);

  useEffect(() => {
    setAlerts(alertsState());
    try { const s = JSON.parse(localStorage.getItem(QUICK_KEY) || "null"); if (Array.isArray(s) && s.length) setQuick(s); } catch { /* defaults */ }
    // /whatsapp?chat=<number> — from an alert, a lead, or the Desk.
    try {
      const n = (new URLSearchParams(window.location.search).get("chat") || "").replace(/\D/g, "").slice(-10);
      if (/^[6-9]\d{9}$/.test(n)) setOpen(n);
    } catch { /* no window */ }
  }, []);
  useEffect(() => { loadChats(); const t = setInterval(loadChats, 20_000); return () => clearInterval(t); }, [loadChats, refreshKey]);
  useEffect(() => {
    if (!open) { setThread(null); return; }
    setDraft(""); setShowQuick(false);
    loadThread(open);
    const t = setInterval(() => loadThread(open, true), 8_000);
    return () => clearInterval(t);
  }, [open, loadThread, refreshKey]);
  // The sidebar's half-minute check noticed something new: do not wait.
  useEffect(() => {
    const on = () => { loadChats(); if (openRef.current) loadThread(openRef.current, true); };
    window.addEventListener(WA_EVENT, on);
    return () => window.removeEventListener(WA_EVENT, on);
  }, [loadChats, loadThread]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase(), digits = needle.replace(/\D/g, "");
    return (chats || []).filter(c =>
      (filter === "all" || (filter === "unread" ? c.unread > 0 : c.waiting)) &&
      (!needle || (c.name || "").toLowerCase().includes(needle) || (digits && c.number.includes(digits)) || c.last.toLowerCase().includes(needle)));
  }, [chats, filter, q]);
  const counts = useMemo(() => ({
    unread: (chats || []).filter(c => c.unread > 0).length,
    waiting: (chats || []).filter(c => c.waiting).length,
  }), [chats]);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || !thread || sending) return;
    setSending(true);
    const temp: Msg = { id: "tmp-" + Date.now(), dir: "out", body, at: new Date().toISOString(), status: "pending", pending: true };
    setThread(t => t && { ...t, messages: [...t.messages, temp] });
    setDraft("");
    setTimeout(() => endRef.current?.scrollIntoView({ block: "end" }), 30);
    try {
      await deskApi("/api/whatsapp/send-as-tenant", { to_number: thread.number, message: body });
      await loadThread(thread.number, true);
      loadChats();
    } catch (e: any) {
      // Put the words back: nobody should have to type a reply twice.
      setThread(t => t && { ...t, messages: t.messages.filter(m => m.id !== temp.id) });
      setDraft(body);
      toast.err(e.message);
    }
    setSending(false);
  };

  const saveQuick = (next: string[]) => {
    setQuick(next);
    try { localStorage.setItem(QUICK_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };

  const startNew = () => {
    const n = newNumber.replace(/\D/g, "").slice(-10);
    if (!/^[6-9]\d{9}$/.test(n)) { toast.err("Enter a valid 10-digit mobile number"); return; }
    setNewChat(false); setNewNumber(""); setOpen(n);
  };

  const active = (chats || []).find(c => c.number === open);
  const title = thread?.name || active?.name || (open ? spaced(open) : "");
  const hoursLeft = thread?.window_closes_at ? Math.max(0, (Date.parse(thread.window_closes_at) - Date.now()) / 3600000) : 0;
  const chip = (id: typeof filter, label: string, n?: number) => (
    <button type="button" onClick={() => setFilter(id)} aria-pressed={filter === id} style={{
      border: `1px solid ${filter === id ? C.grn : C.bord}`, background: filter === id ? "#E8F7EE" : "#fff",
      color: filter === id ? "#0F6B34" : C.mid, borderRadius: 999, padding: "4px 11px", fontSize: 12.5, fontWeight: 600 }}>
      {label}{n ? ` ${n}` : ""}
    </button>
  );

  return (
    <div className={"nk-wa" + (open ? " has-open" : "")} style={{ border: `1px solid ${C.bord}`, borderRadius: 14, overflow: "hidden",
      background: C.surf, display: "grid", gridTemplateColumns: "minmax(260px, 340px) 1fr", height: "min(72vh, 680px)", minHeight: 440,
      boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
      <style>{`
        @media (max-width: 760px) {
          .nk-wa { grid-template-columns: 1fr !important; }
          .nk-wa.has-open .nk-wa-list { display: none !important; }
          .nk-wa:not(.has-open) .nk-wa-pane { display: none !important; }
        }
        @media (min-width: 761px) { .nk-wa-back { display: none !important; } }
        .nk-wa-row:hover { background: #F5F7FA; }
      `}</style>

      {/* ── everyone ── */}
      <div className="nk-wa-list" style={{ borderRight: `1px solid ${C.bord}`, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: "12px 12px 8px", borderBottom: `1px solid ${C.bord}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
            <strong style={{ fontSize: 16, color: C.txt, flex: 1 }}>Chats</strong>
            {alerts !== "unsupported" && (
              <button type="button" title={alerts === "on" ? "Alerts are on for this browser"
                  : alerts === "blocked" ? "Alerts are blocked in this browser's site settings" : "Get an alert when a customer writes"}
                onClick={async () => { if (alerts === "off") { const ok = await enableAlerts(); setAlerts(alertsState()); if (ok) toast.ok("Alerts are on. You will be told when a customer writes."); } }}
                aria-label="WhatsApp alerts" style={{ background: "none", border: 0, padding: 5, color: alerts === "on" ? C.grn : C.mid, lineHeight: 0 }}>
                {alerts === "on" ? <Bell size={17} /> : <BellOff size={17} />}
              </button>
            )}
            <button type="button" onClick={() => setNewChat(v => !v)} aria-label="New chat" title="Message a new number"
              style={{ background: "none", border: 0, padding: 5, color: C.mid, lineHeight: 0 }}><MessageCirclePlus size={18} /></button>
          </div>
          {newChat && (
            <form onSubmit={e => { e.preventDefault(); startNew(); }} style={{ display: "flex", gap: 6, marginBottom: 9 }}>
              <input autoFocus inputMode="numeric" value={newNumber} onChange={e => setNewNumber(e.target.value)} placeholder="10-digit mobile number"
                aria-label="Number to message" style={{ flex: 1, minWidth: 0, border: `1px solid ${C.bord}`, borderRadius: 8, padding: "8px 10px", fontSize: 14 }} />
              <button type="submit" style={{ background: C.grn, color: "#fff", border: 0, borderRadius: 8, padding: "0 12px", fontSize: 13, fontWeight: 600 }}>Open</button>
            </form>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 7, background: "#F1F4F8", borderRadius: 9, padding: "7px 10px", marginBottom: 9 }}>
            <Search size={14} color={C.dim} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, number or message" aria-label="Search chats"
              style={{ border: 0, background: "none", outline: "none", flex: 1, minWidth: 0, fontSize: 13.5, color: C.txt }} />
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {chip("all", "All")}{chip("unread", "Unread", counts.unread)}{chip("waiting", "Needs a reply", counts.waiting)}
          </div>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {chats === null ? <div style={{ padding: 24, color: C.mid, fontSize: 13.5 }}>Loading chats…</div>
          : list.length === 0 ? (
            <div style={{ padding: "28px 18px", color: C.mid, fontSize: 13.5, lineHeight: 1.6, textAlign: "center" }}>
              {chats.length === 0 ? "No conversations yet. When a customer writes, or Nikki sends a confirmation, it appears here."
                : filter === "waiting" ? "Nobody is waiting for a reply." : filter === "unread" ? "Everything has been read." : "No chat matches that search."}
            </div>
          ) : list.map(c => (
            <button type="button" key={c.number} className="nk-wa-row" onClick={() => setOpen(c.number)} style={{
              display: "flex", gap: 10, alignItems: "center", width: "100%", textAlign: "left", border: 0, borderBottom: `1px solid #F1F4F8`,
              background: c.number === open ? "#EEF4FA" : "transparent", padding: "10px 12px" }}>
              <span aria-hidden style={{ width: 40, height: 40, borderRadius: "50%", flex: "none", background: "#DFE7EF", color: "#56677A",
                display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15 }}>
                {c.name ? c.name.trim()[0]?.toUpperCase() : <UserRound size={18} />}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    color: C.txt, fontSize: 14.5, fontWeight: c.unread ? 700 : 600 }}>{c.name || spaced(c.number)}</span>
                  <span style={{ flex: "none", fontSize: 12, color: c.unread ? C.grn : C.dim, fontWeight: c.unread ? 700 : 400 }}>{listTime(c.last_at)}</span>
                </span>
                <span style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 2 }}>
                  {c.last_dir === "out" && <span style={{ flex: "none", lineHeight: 0 }}><Ticks status={c.last_status} /></span>}
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    color: c.unread ? C.txt : C.mid, fontSize: 13 }}>{shown(c.last) || "—"}</span>
                  {c.unread > 0 && <span style={{ flex: "none", background: C.grn, color: "#fff", borderRadius: 999, minWidth: 20,
                    padding: "1px 6px", fontSize: 12, fontWeight: 700, textAlign: "center" }}>{c.unread}</span>}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── the open conversation ── */}
      <div className="nk-wa-pane" style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: C.paper }}>
        {!open ? (
          <div style={{ margin: "auto", textAlign: "center", color: C.mid, padding: 24, maxWidth: 340, lineHeight: 1.6, fontSize: 14 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.txt, marginBottom: 6 }}>Pick a chat</div>
            Choose someone on the left to read and reply. The bell turns on an alert for new messages.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: C.surf, borderBottom: `1px solid ${C.bord}` }}>
              <button type="button" className="nk-wa-back" onClick={() => setOpen("")} aria-label="Back to chats"
                style={{ background: "none", border: 0, padding: 4, color: C.mid, lineHeight: 0 }}><ArrowLeft size={19} /></button>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
                <div style={{ fontSize: 12, color: thread?.window_open ? "#0F6B34" : C.mid }}>
                  {!thread ? "Opening…" : thread.opted_out ? "Asked not to be contacted"
                    : thread.window_open ? `${spaced(open)} · you can reply freely for ${hoursLeft < 1 ? "under an hour" : Math.round(hoursLeft) + " h"}`
                    : `${spaced(open)} · only a ready-made message reaches them now`}
                </div>
              </div>
              <a href={`/desk?call=${open}${thread?.lead_id ? `&lead=${thread.lead_id}` : ""}`} title="Call from the Desk" style={{ display: "inline-flex",
                alignItems: "center", gap: 6, border: `1px solid ${C.bord}`, background: "#fff", color: C.txt, borderRadius: 8, padding: "6px 10px",
                fontSize: 13, fontWeight: 600, textDecoration: "none" }}><Phone size={14} /> Call</a>
              <a href={`/leads?phone=${open}`} title="Open the lead" style={{ display: "inline-flex", alignItems: "center", gap: 6,
                border: `1px solid ${C.bord}`, background: "#fff", color: C.txt, borderRadius: 8, padding: "6px 10px", fontSize: 13,
                fontWeight: 600, textDecoration: "none" }}><UserRound size={14} /> Lead</a>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
              {thread && thread.messages.length === 0 && (
                <div style={{ margin: "auto", color: C.mid, fontSize: 13.5, textAlign: "center", maxWidth: 320, lineHeight: 1.6 }}>
                  Nothing has been sent to {spaced(open)} yet. WhatsApp only lets a business start with a ready-made message — pick one below.
                </div>
              )}
              {thread?.messages.map((m, i) => {
                const first = i === 0 || dayKey(thread.messages[i - 1].at) !== dayKey(m.at);
                const mine = m.dir === "out";
                return (
                  <div key={m.id} style={{ display: "contents" }}>
                    {first && <div style={{ alignSelf: "center", background: "#fff", color: C.mid, fontSize: 12, fontWeight: 600,
                      padding: "3px 10px", borderRadius: 8, margin: "8px 0 4px", boxShadow: "0 1px 1px rgba(15,23,42,0.06)" }}>{dayLabel(m.at)}</div>}
                    <div style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "78%", background: mine ? C.mine : "#fff",
                      borderRadius: 10, borderTopRightRadius: mine ? 3 : 10, borderTopLeftRadius: mine ? 10 : 3, padding: "6px 9px 4px",
                      boxShadow: "0 1px 1px rgba(15,23,42,0.08)", opacity: m.pending ? 0.7 : 1 }}>
                      {m.label && <div style={{ fontSize: 12, fontWeight: 700, color: "#0F6B34", marginBottom: 2 }}>Nikki · {m.label}</div>}
                      {m.media && <div style={{ marginBottom: m.body && !/^\[.+\]$/.test(m.body) ? 5 : 0 }}><Media id={m.id} mime={m.media.mime} name={m.media.name} /></div>}
                      {!(m.media && /^\[.+\]$/.test(m.body)) && (
                        <div style={{ fontSize: 14, lineHeight: 1.45, color: C.txt, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{shown(m.body)}</div>
                      )}
                      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, fontSize: 12, color: "#667781", marginTop: 1 }}>
                        {m.status === "failed" && <span style={{ color: C.red, fontWeight: 600 }}>Not delivered</span>}
                        {clock(m.at)}{mine && <Ticks status={m.status} />}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            {/* ── writing ── */}
            {thread && (thread.opted_out ? (
              <div style={{ padding: "12px 14px", background: C.surf, borderTop: `1px solid ${C.bord}`, color: C.mid, fontSize: 13.5 }}>
                This person asked not to be contacted, so nothing can be sent to them.
              </div>
            ) : thread.window_open ? (
              <div style={{ background: C.surf, borderTop: `1px solid ${C.bord}`, padding: "8px 10px" }}>
                {showQuick && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {quick.map((t, i) => (
                      <span key={i} style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${C.bord}`, borderRadius: 999, background: "#fff" }}>
                        <button type="button" onClick={() => { setDraft(t); setShowQuick(false); }}
                          style={{ border: 0, background: "none", padding: "5px 4px 5px 11px", fontSize: 13, color: C.txt, maxWidth: 260,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t}</button>
                        <button type="button" aria-label={`Remove "${t}"`} onClick={() => saveQuick(quick.filter((_, j) => j !== i))}
                          style={{ border: 0, background: "none", padding: "5px 9px 5px 2px", color: C.dim, fontSize: 14 }}>×</button>
                      </span>
                    ))}
                    {draft.trim() && !quick.includes(draft.trim()) && (
                      <button type="button" onClick={() => saveQuick([...quick, draft.trim()].slice(-12))}
                        style={{ border: `1px dashed ${C.bord}`, background: "none", borderRadius: 999, padding: "5px 11px", fontSize: 13, color: C.teal, fontWeight: 600 }}>
                        + Save what I typed
                      </button>
                    )}
                  </div>
                )}
                <form onSubmit={e => { e.preventDefault(); send(draft); }} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <button type="button" onClick={() => setShowQuick(v => !v)} aria-label="Quick replies" aria-pressed={showQuick} title="Quick replies"
                    style={{ border: 0, background: showQuick ? "#E8F7EE" : "none", borderRadius: 8, padding: 9, color: showQuick ? C.grn : C.mid, lineHeight: 0 }}><Zap size={18} /></button>
                  <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={1} placeholder="Type a message" aria-label="Message"
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft); } }}
                    style={{ flex: 1, minWidth: 0, resize: "none", border: `1px solid ${C.bord}`, borderRadius: 18, padding: "9px 14px",
                      fontSize: 14, lineHeight: 1.4, maxHeight: 120, fontFamily: "inherit", color: C.txt, background: "#fff" }} />
                  <button type="submit" disabled={!draft.trim() || sending} aria-label="Send" style={{ border: 0, borderRadius: "50%", width: 40, height: 40,
                    background: C.grn, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center",
                    opacity: !draft.trim() || sending ? 0.5 : 1, flex: "none" }}><Send size={17} /></button>
                </form>
              </div>
            ) : (
              <div style={{ background: C.surf, borderTop: `1px solid ${C.bord}`, padding: "10px 12px" }}>
                <div style={{ fontSize: 12.5, color: C.mid, marginBottom: 7, lineHeight: 1.5 }}>
                  WhatsApp lets a business type freely only for 24 hours after the customer last wrote. Send a ready-made message; once they answer, you can chat.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <select value={tpl} onChange={e => setTpl(e.target.value)} aria-label="Ready-made message"
                    style={{ flex: 1, minWidth: 0, border: `1px solid ${C.bord}`, borderRadius: 8, padding: "9px 10px", fontSize: 14, background: "#fff", color: C.txt }}>
                    <option value="">{templates.length ? "Choose a ready-made message…" : "No ready-made messages approved yet"}</option>
                    {templates.map(t => <option key={t.id} value={t.id}>{String(t.name).replace(/_/g, " ").replace(/^./, (ch: string) => ch.toUpperCase())}</option>)}
                  </select>
                  <button type="button" disabled={!tpl} onClick={() => onTemplate(open, templates.find(t => t.id === tpl))}
                    style={{ background: C.grn, color: "#fff", border: 0, borderRadius: 8, padding: "0 16px", fontSize: 14, fontWeight: 600, opacity: tpl ? 1 : 0.5 }}>
                    Next
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
