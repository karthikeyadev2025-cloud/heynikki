// app/calls/page.tsx — Call History, Recordings & Transcripts
"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import type { CallRecord } from "../../lib/supabase";
import { Check, X, Bot, User, Phone, Search } from "lucide-react";
import { NIKKI } from "../../lib/brand";
import ExportButton from "../../components/ExportButton";

const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: NIKKI.gold,
  grn: NIKKI.emerald, red: NIKKI.red, cyn: NIKKI.cyan,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

// Intents are enquiry/appointment/order/callback/transfer/emergency/unknown, but
// legacy rows also carry `wa_otp_<code>` (a WhatsApp verification call
// surfaced through the pipeline). That is an internal marker, not a
// caller intent, so it is shown as a readable label and never raw.
function intentLabel(intent: string | null | undefined): string {
  if (!intent) return "unknown";
  if (intent.startsWith("wa_otp")) return "WhatsApp OTP";
  return intent;
}

function IntentBadge({ intent }: { intent: string | null | undefined }) {
  const map: Record<string, string> = {
    appointment: C.grn, enquiry: C.cyn, callback: C.gold,
    transfer: C.gbr, emergency: C.red, unknown: C.dim, order: C.gold,
    "WhatsApp OTP": C.cyn,
  };
  const label = intentLabel(intent);
  const col = map[label] || C.dim;
  return (
    <span style={{ background: col + "22", color: col, border: "1px solid " + col + "44",
      borderRadius: 4, padding: "2px 7px", fontSize: 10, fontWeight: 700,
      textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

// calls.status was selected and exported to CSV but never drawn, so a
// missed, failed or human-answered call looked identical to a completed
// one. "transferred" is the API's word for a call a team member picked up.
const STATUS_META: Record<string, { label: string; color: string }> = {
  active:      { label: "Live",             color: C.grn  },
  completed:   { label: "Completed",        color: C.mid  },
  missed:      { label: "Missed",           color: C.gold },
  transferred: { label: "Answered by team", color: C.gbr  },
  failed:      { label: "Failed",           color: C.red  },
};

function StatusPill({ status }: { status: string | null | undefined }) {
  const meta = STATUS_META[status || ""] || { label: status || "—", color: C.dim };
  return (
    <span style={{ background: meta.color + "22", color: meta.color,
      border: "1px solid " + meta.color + "44", borderRadius: 20,
      padding: "2px 8px", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
      display: "inline-flex", alignItems: "center", gap: 5 }}>
      {status === "active" && (
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color,
          boxShadow: "0 0 6px " + meta.color, animation: "pulse 2s infinite" }} />
      )}
      {meta.label}
    </span>
  );
}

function formatDur(s: number) {
  if (!s) return "—";
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function CallDetail({ call, onClose, onRecordingDeleted }: {
  call: CallRecord; onClose: () => void; onRecordingDeleted: (id: string) => void;
}) {
  const transcript: Array<{ role: string; content: string; ts: string }> =
    Array.isArray(call.transcript) ? call.transcript : [];

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: C.surf, border: "1px solid " + C.bord, borderRadius: 14,
        width: "100%", maxWidth: 560, maxHeight: "85vh", overflow: "hidden",
        display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid " + C.bord,
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: C.txt, fontSize: 15, fontWeight: 800 }}>{call.caller_number}</div>
            <div style={{ color: C.dim, fontSize: 11, marginTop: 2 }}>
              {formatTime(call.created_at)} · {formatDur(call.duration_seconds)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <StatusPill status={call.status} />
            <IntentBadge intent={call.intent} />
            {call.wa_sent && (
              <span style={{ color: C.cyn, fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }}>WA <Check size={11} /></span>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none",
              color: C.dim, cursor: "pointer", padding: "0 4px", display: "flex" }}><X size={18} /></button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {/* Call Journey Audit Trail */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: C.gold, fontSize: 11, fontWeight: 800,
              textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              Call Journey
            </div>
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
              {[
                "Call Received",
                `Intent: ${intentLabel(call.intent)}`,
                call.status === "transferred" ? "Answered by team" : null,
                call.appointment_created ? "Appointment Booked" : null,
                call.wa_sent ? "WhatsApp Sent" : null,
                call.status === "active" ? "In Progress"
                  : call.status === "missed" ? "Missed"
                  : call.status === "failed" ? "Failed"
                  : "Call Ended",
              ].filter(Boolean).map((step, i, arr) => (
                <span key={step as string} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ background: C.glow + "22", color: C.gbr, border: "1px solid " + C.glow + "44",
                    borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>
                    {step}
                  </span>
                  {i < arr.length - 1 && <span style={{ color: C.dim, fontSize: 10 }}>→</span>}
                </span>
              ))}
            </div>
          </div>

          {/* Recording. The old condition was `call.recording_url`, a column
              nothing has ever written — every recording lives in
              r2_object_key — so no customer could play a single call. */}
          {/* recording_size_bytes survives the purge, so a call that HAD audio
              can say what happened to it instead of looking like it never
              had any. Retention is by plan — seven days on trial. */}
          {(!call.r2_object_key && !call.recording_url && (call as any).recording_size_bytes) ? (
            <div style={{ marginBottom: 16, color: C.dim, fontSize: 12.5 }}>
              Recording deleted — removed from this page, or past the time your plan keeps call audio.
            </div>
          ) : null}
          {(call.r2_object_key || call.recording_url) && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: C.mid, fontSize: 11, fontWeight: 800,
                textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                Recording
              </div>
              <RecordingPlayer callId={call.id} publicUrl={call.recording_url} />
              <DeleteRecording callId={call.id} onDeleted={() => onRecordingDeleted(call.id)} />
            </div>
          )}

          {/* Transcript */}
          <div>
            <div style={{ color: C.mid, fontSize: 11, fontWeight: 800,
              textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              Transcript
            </div>
            {transcript.length === 0 ? (
              <div style={{ color: C.dim, fontSize: 12 }}>No transcript available</div>
            ) : transcript.map((turn, i) => (
              <div key={i} style={{
                display: "flex", gap: 10, marginBottom: 10,
                justifyContent: turn.role === "assistant" ? "flex-start" : "flex-end",
              }}>
                {turn.role === "assistant" && (
                  <div style={{ width: 26, height: 26, borderRadius: "50%",
                    background: C.glow + "33", border: "1px solid " + C.glow,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0 }}><Bot size={13} /></div>
                )}
                <div style={{
                  background: turn.role === "assistant" ? C.hi : C.glow + "22",
                  border: "1px solid " + (turn.role === "assistant" ? C.bord : C.glow + "44"),
                  borderRadius: 8, padding: "8px 12px", maxWidth: "75%",
                }}>
                  <div style={{ color: C.txt, fontSize: 12, lineHeight: 1.5 }}>{turn.content}</div>
                  {turn.ts && (
                    <div style={{ color: C.dim, fontSize: 9, marginTop: 2 }}>
                      {new Date(turn.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </div>
                  )}
                </div>
                {turn.role === "user" && (
                  <div style={{ width: 26, height: 26, borderRadius: "50%",
                    background: C.gold + "22", border: "1px solid " + C.gold + "44",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0 }}><User size={13} /></div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A list row. /calls no longer selects * — a page of 100 calls used to drag
 * 100 full transcripts into the browser to draw a table that shows none of
 * them, and the transcript search below returns this same narrow shape from
 * the API. The full record is fetched only when a call is opened.
 */
type CallRow = {
  id: string;
  caller_number: string | null;
  direction: string | null;
  status: string;
  duration_seconds: number;
  intent: string | null;
  wa_sent: boolean;
  appointment_created: boolean;
  created_at: string;
  /** The transcript line that matched a search, when the row came from one. */
  snippet?: string | null;
};

const LIST_COLUMNS =
  "id,caller_number,direction,status,duration_seconds,intent,wa_sent,appointment_created,created_at";

// Every customer is in India. A date filter that means "since 05:30 this
// morning" because the browser or the server is on UTC is the kind of wrong
// a shop owner notices and cannot explain. Same +05:30 arithmetic the API
// and the pipeline use.
const IST_MS = 330 * 60_000;
const istDay = (offsetDays = 0) =>
  new Date(Date.now() + IST_MS + offsetDays * 86_400_000).toISOString().slice(0, 10);

const PAGE = 100;

function RecordingPlayer({ callId, publicUrl }: { callId: string; publicUrl?: string | null }) {
  const [src, setSrc] = useState<string | null>(publicUrl || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState("");

  // Blob URLs are revoked on unmount; leaving them attached leaks the audio
  // of every call the user opened for as long as the tab lives.
  useEffect(() => () => { if (src && src.startsWith("blob:")) URL.revokeObjectURL(src); }, [src]);

  if (src) return <audio controls src={src} style={{ width: "100%" }} />;

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true); setErr("");
          try {
            const sb = createClient();
            const { data: { session } } = await sb.auth.getSession();
            const r = await fetch(
              `${process.env.NEXT_PUBLIC_API_URL}/api/calls/${callId}/recording`,
              { headers: { Authorization: `Bearer ${session?.access_token}` } });
            if (!r.ok) {
              const j = await r.json().catch(() => ({}));
              setErr(j.error || "Could not load the recording");
            } else {
              setSrc(URL.createObjectURL(await r.blob()));
            }
          } catch {
            setErr("Could not load the recording");
          } finally { setBusy(false); }
        }}
        style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.bord}`,
          background: "transparent", color: C.txt, fontSize: 13, fontWeight: 700,
          cursor: busy ? "wait" : "pointer" }}>
        {busy ? "Loading…" : "▶  Play recording"}
      </button>
      {err && <div style={{ color: C.dim, fontSize: 12, marginTop: 6 }}>{err}</div>}
    </div>
  );
}

// Self-serve erasure of one call's audio. DELETE goes through the API (the
// browser never sees R2), and the parent drops the recording columns from
// its copy of the row so the panel re-renders as "deleted" without a refetch.
// The transcript is untouched — only the audio goes.
function DeleteRecording({ callId, onDeleted }: { callId: string; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState("");

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!confirm("Delete this recording? The audio is removed permanently. The transcript is kept.")) return;
          setBusy(true); setErr("");
          try {
            const sb = createClient();
            const { data: { session } } = await sb.auth.getSession();
            const r = await fetch(
              `${process.env.NEXT_PUBLIC_API_URL}/api/calls/${callId}/recording`,
              { method: "DELETE", headers: { Authorization: `Bearer ${session?.access_token}` } });
            if (!r.ok) {
              const j = await r.json().catch(() => ({}));
              setErr(j.error || "Could not delete the recording");
            } else {
              onDeleted();
            }
          } catch {
            setErr("Could not delete the recording");
          } finally { setBusy(false); }
        }}
        style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.red}55`,
          background: "transparent", color: C.red, fontSize: 11.5, fontWeight: 700,
          cursor: busy ? "wait" : "pointer" }}>
        {busy ? "Deleting…" : "Delete recording"}
      </button>
      {err && <div style={{ color: C.dim, fontSize: 12, marginTop: 6 }}>{err}</div>}
    </div>
  );
}

const INTENTS  = ["all", "appointment", "enquiry", "callback", "transfer", "emergency", "order"];
const STATUSES = ["all", "completed", "missed", "transferred", "failed", "active"];

// Quick ranges, in IST days. "All time" leaves both ends open rather than
// guessing a start date the business never gave.
const RANGES: Array<{ id: string; label: string; from: () => string; to: () => string }> = [
  { id: "today", label: "Today",    from: () => istDay(0),   to: () => istDay(0) },
  { id: "7d",    label: "7 days",   from: () => istDay(-6),  to: () => istDay(0) },
  { id: "30d",   label: "30 days",  from: () => istDay(-29), to: () => istDay(0) },
  { id: "all",   label: "All time", from: () => "",          to: () => "" },
];

export default function CallsPage() {
  const [rows, setRows]         = useState<CallRow[]>([]);
  const [selected, setSelected] = useState<CallRecord | null>(null);
  const [opening, setOpening]   = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [more, setMore]         = useState(false);      // another page exists
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError]       = useState("");
  const [tenantId, setTenantId] = useState<string | null>(null);

  const [intent, setIntent] = useState("all");
  const [status, setStatus] = useState("all");
  const [from,   setFrom]   = useState("");
  const [to,     setTo]     = useState("");
  const [typed,  setTyped]  = useState("");             // what is in the box
  const [query,  setQuery]  = useState("");             // what has been searched
  // Set when the server stopped short of reading every call. The count must
  // then be read as "in the most recent N", never as "that is all there is".
  const [capped, setCapped] = useState<{ scanned: number } | null>(null);

  const API = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

  // Searching on every keystroke would fire a transcript scan per letter.
  // A third of a second is below the pause between words.
  useEffect(() => {
    const t = setTimeout(() => setQuery(typed.trim()), 350);
    return () => clearTimeout(t);
  }, [typed]);

  /**
   * One page of results.
   *
   * Without a search this is Supabase directly, as every other list screen
   * does it — RLS scopes the rows and the page keeps working even if the API
   * is down. With a search it has to be the API: the words are inside
   * calls.transcript, which is jsonb, and PostgREST cannot filter a cast of
   * it (see api-server/src/search-export.ts).
   */
  const fetchPage = useCallback(async (tid: string, offset: number):
    Promise<{ rows: CallRow[]; more: boolean; capped: { scanned: number } | null }> => {

    const sb = createClient();

    if (query.length >= 2) {
      const { data: { session } } = await sb.auth.getSession();
      const qs = new URLSearchParams({ q: query, limit: String(PAGE), offset: String(offset) });
      if (intent !== "all") qs.set("intent", intent);
      if (status !== "all") qs.set("status", status);
      if (from) qs.set("from", from);
      if (to)   qs.set("to", to);
      const r = await fetch(`${API}/api/search/calls?${qs}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(j.error || "Could not search your calls just now.");
      return {
        rows: (j.rows || []) as CallRow[],
        more: !!j.has_more,
        capped: j.capped ? { scanned: Number(j.scanned) || 0 } : null,
      };
    }

    let q = sb.from("calls").select(LIST_COLUMNS).eq("tenant_id", tid);
    if (intent !== "all") q = q.eq("intent", intent);
    if (status !== "all") q = q.eq("status", status);
    // The bounds are IST days; +05:30 keeps a 9pm call on the day it happened.
    if (from) q = q.gte("created_at", `${from}T00:00:00+05:30`);
    if (to)   q = q.lte("created_at", `${to}T23:59:59.999+05:30`);
    const { data, error: e } = await q
      // created_at alone is not a stable sort — two calls in the same second
      // can swap between pages, so one appears twice and the other never.
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (e) throw new Error(e.message);
    const batch = (data || []) as unknown as CallRow[];
    return { rows: batch, more: batch.length === PAGE, capped: null };
  }, [API, intent, status, from, to, query]);

  // A slow search that the user has already typed past must not overwrite a
  // newer one when it finally lands.
  const runId = useRef(0);

  const load = useCallback(async (tid: string) => {
    const mine = ++runId.current;
    setLoading(true); setError("");
    try {
      const out = await fetchPage(tid, 0);
      if (mine !== runId.current) return;
      setRows(out.rows); setMore(out.more); setCapped(out.capped);
    } catch (e: any) {
      if (mine !== runId.current) return;
      setRows([]); setMore(false); setCapped(null);
      setError(e?.message || "Could not load your calls.");
    } finally {
      if (mine === runId.current) setLoading(false);
    }
  }, [fetchPage]);

  const loadMore = async () => {
    if (!tenantId || loadingMore) return;
    setLoadingMore(true);
    try {
      const out = await fetchPage(tenantId, rows.length);
      setRows(prev => [...prev, ...out.rows]);
      setMore(out.more);
      setCapped(out.capped);
    } catch (e: any) {
      setError(e?.message || "Could not load more calls.");
    } finally {
      setLoadingMore(false);
    }
  };

  /**
   * Open one call. The list rows deliberately carry no transcript and no
   * recording key, so the full record is read here — the same read the
   * ?call=<id> deep link has always done.
   */
  const openCall = useCallback(async (id: string) => {
    if (!tenantId) return;
    setOpening(id);
    const sb = createClient();
    const { data, error: e } = await sb.from("calls").select("*")
      .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    setOpening(null);
    if (e || !data) { setError("Could not open that call."); return; }
    setSelected(data as CallRecord);
  }, [tenantId]);

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = "/login"; return; }
      const { data: tu } = await sb.from("tenant_users")
        .select("tenant_id").eq("user_id", data.user.id).maybeSingle();
      if (!tu) { setLoading(false); setError("No business is linked to this login yet."); return; }
      setTenantId(tu.tenant_id);
      // Deep links from a lead's timeline: /calls?call=<id> opens that call,
      // which may be far older than the first page of the list.
      try {
        const want = new URLSearchParams(window.location.search).get("call");
        if (want) {
          const { data: hit } = await sb.from("calls").select("*")
            .eq("id", want).eq("tenant_id", tu.tenant_id).maybeSingle();
          if (hit) setSelected(hit as CallRecord);
          window.history.replaceState({}, "", "/calls");
        }
      } catch { /* no window */ }
    });
  }, []);

  useEffect(() => { if (tenantId) load(tenantId); }, [tenantId, load]);

  const activeRange = RANGES.find(r => r.from() === from && r.to() === to)?.id
    || (from || to ? "custom" : "all");
  const filtersOn = intent !== "all" || status !== "all" || !!from || !!to || !!query;

  const clearAll = () => {
    setIntent("all"); setStatus("all"); setFrom(""); setTo(""); setTyped(""); setQuery("");
  };

  const chip = (on: boolean, color: string): React.CSSProperties => ({
    padding: "7px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700,
    background: on ? color + "33" : C.hi, color: on ? color : C.mid,
    border: "1px solid " + (on ? color : C.bord), cursor: "pointer", whiteSpace: "nowrap",
  });
  const dateInput: React.CSSProperties = {
    padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.bord}`,
    background: C.hi, color: C.txt, fontSize: 12.5, fontFamily: "inherit",
  };

  return (
    <Shell title="Call History">
      {selected && (
        <CallDetail call={selected} onClose={() => setSelected(null)}
          onRecordingDeleted={(id) => {
            // Mirror what the API did to the row: key and URL gone,
            // recording_size_bytes kept so the panel says "deleted".
            setSelected(prev => (prev && prev.id === id
              ? { ...prev, r2_object_key: null, recording_url: null } : prev));
          }} />
      )}

      {/* Search + filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 260px", maxWidth: 380 }}>
          <Search size={14} style={{ position: "absolute", left: 11, top: 12, color: C.dim }} />
          <input value={typed} onChange={e => setTyped(e.target.value)}
            placeholder="Search what was said, or a phone number…"
            aria-label="Search calls and transcripts"
            style={{ width: "100%", padding: "9px 12px 9px 32px", borderRadius: 8, boxSizing: "border-box",
                     border: `1px solid ${C.bord}`, background: C.hi, color: C.txt, fontSize: 13 }} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {RANGES.map(r => (
            <button key={r.id} onClick={() => { setFrom(r.from()); setTo(r.to()); }}
              style={chip(activeRange === r.id, C.gbr)}>{r.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)}
            aria-label="From date" style={dateInput} />
          <span style={{ color: C.dim, fontSize: 12 }}>to</span>
          <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)}
            aria-label="To date" style={dateInput} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div className="nk-scroll" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {INTENTS.map(f => (
            <button key={f} onClick={() => setIntent(f)}
              style={chip(intent === f, f === "emergency" ? C.red : C.glow)}>
              {f === "all" ? "All intents" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status"
          style={{ ...dateInput, fontWeight: 700 }}>
          {STATUSES.map(s => (
            <option key={s} value={s}>{s === "all" ? "Any outcome" : STATUS_META[s]?.label || s}</option>
          ))}
        </select>

        <span style={{ color: C.dim, fontSize: 12, marginLeft: "auto" }}>
          {loading ? "…" : `${rows.length}${more ? "+" : ""} call${rows.length === 1 ? "" : "s"}`}
        </span>
        {filtersOn && (
          <button onClick={clearAll} style={{ background: "none", border: "none", color: C.glow,
            fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>Clear filters</button>
        )}
        <ExportButton path="/api/export/calls.csv"
          params={{ q: query, intent, status, from, to }}
          label="Export CSV"
          title="Download every call matching these filters — not just the ones on screen" />
      </div>

      {capped && (
        <div style={{ background: C.gold + "0D", border: `1px solid ${C.gold}55`, borderRadius: 8,
          padding: "9px 12px", marginBottom: 12, color: C.gold, fontSize: 12.5 }}>
          Searched your most recent {capped.scanned.toLocaleString("en-IN")} calls. Narrow the dates to search further back.
        </div>
      )}

      {error && (
        <div style={{ background: C.red + "0D", border: `1px solid ${C.red}55`, borderRadius: 8,
          padding: "9px 12px", marginBottom: 12, color: C.red, fontSize: 12.5 }}>{error}</div>
      )}

      <div style={{ background: C.surf, border: "1px solid " + C.bord, borderRadius: 10, overflow: "hidden" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 48, color: C.mid }}>
            {query ? "Searching calls and transcripts…" : "Loading calls…"}
          </div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: C.dim }}>
            <div style={{ marginBottom: 10, display: "flex", justifyContent: "center" }}><Phone size={28} /></div>
            {filtersOn ? (
              // A filter with no matches is not an empty account — the
              // "set up your voice profile" onboarding line showed here to a
              // clinic with 32 calls whenever a category was empty.
              <div>
                {query
                  ? <>Nothing said on a call matches “{query}”.</>
                  : <>No calls match these filters.</>}
                <button onClick={clearAll} style={{
                  background: "none", border: "none", color: C.glow, fontSize: 13, cursor: "pointer",
                  display: "block", margin: "8px auto 0", fontFamily: "inherit",
                }}>Show all calls →</button>
              </div>
            ) : (
              <>
                <div>No calls yet. Set up your voice profile to start receiving calls.</div>
                <a href="/setup" style={{ color: C.glow, fontSize: 13, display: "block", marginTop: 8 }}>
                  Set up now →
                </a>
              </>
            )}
          </div>
        ) : (
          <div className="nk-scroll">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.hi }}>
                {["Caller","Direction","Status","Duration","Intent","WA Sent","Appt","Time",""].map(h => (
                  <th key={h} style={{ color: C.dim, fontSize: 10, fontWeight: 700,
                    textTransform: "uppercase", letterSpacing: "0.08em",
                    padding: "10px 12px", textAlign: "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(call => (
                <tr key={call.id}
                  style={{ borderBottom: "1px solid " + C.bord + "44", cursor: "pointer",
                           opacity: opening === call.id ? 0.6 : 1 }}
                  onClick={() => openCall(call.id)}
                  onMouseEnter={e => (e.currentTarget.style.background = C.hi)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <td style={{ padding: "10px 12px", color: C.txt, fontSize: 13, fontWeight: 600 }}>
                    {call.caller_number || "Unknown"}
                    {/* Why this call came back from a search, without opening it. */}
                    {call.snippet && (
                      <div style={{ color: C.mid, fontSize: 11.5, fontWeight: 400, marginTop: 3,
                        maxWidth: 320, whiteSpace: "normal", lineHeight: 1.45 }}>
                        “{call.snippet}”
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ color: call.direction === "inbound" ? C.grn : C.gold,
                      fontSize: 11, fontWeight: 600 }}>
                      {call.direction === "inbound" ? "↙ Inbound" : "↗ Outbound"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <StatusPill status={call.status} />
                  </td>
                  <td style={{ padding: "10px 12px", color: C.mid, fontSize: 12 }}>
                    {formatDur(call.duration_seconds)}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <IntentBadge intent={call.intent} />
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 13,
                    color: call.wa_sent ? C.grn : C.dim }}>
                    {call.wa_sent ? <Check size={14} color={C.grn} /> : "—"}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 13,
                    color: call.appointment_created ? C.grn : C.dim }}>
                    {call.appointment_created ? <Check size={14} color={C.grn} /> : "—"}
                  </td>
                  <td style={{ padding: "10px 12px", color: C.dim, fontSize: 11, whiteSpace: "nowrap" }}>
                    {formatTime(call.created_at)}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ color: C.glow, fontSize: 12 }}>
                      {opening === call.id ? "Opening…" : "View →"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* The old page stopped dead at 100 rows with nothing to say so. */}
      {more && !loading && (
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <button onClick={loadMore} disabled={loadingMore} style={{
            padding: "9px 18px", borderRadius: 8, border: `1px solid ${C.bord}`,
            background: C.hi, color: C.txt, fontSize: 13, fontWeight: 700,
            cursor: loadingMore ? "wait" : "pointer" }}>
            {loadingMore ? "Loading…" : "Load more calls"}
          </button>
        </div>
      )}
    </Shell>
  );
}
