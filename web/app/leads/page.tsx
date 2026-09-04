"use client";

/**
 * Leads / CRM.
 *
 * Every inbound call produces a lead (see the FreeSWITCH call handler),
 * enriched by the same end-of-call Gemini pass that extracts appointments.
 * This page is where the business works that pipeline: see who called, what
 * they wanted, how promising they are, and move them through stages.
 *
 * Deliberately a simple five-stage funnel (new → contacted → qualified →
 * won/lost) rather than a configurable pipeline builder. An SMB clinic or
 * retail shop does not need pipeline configuration, and a half-built
 * "enterprise CRM" would be worse than a clear simple one.
 *
 * Reads/writes Supabase directly with the user's JWT — RLS policies
 * (leads_select/insert/update/delete in supabase/011_leads_crm.sql) enforce
 * tenant isolation in Postgres, so no shared secret ships to the browser.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import { NIKKI } from "../../lib/brand";
import { Check, X, Calendar, RefreshCw, PhoneOff, Users, Phone, ClipboardList } from "lucide-react";
import LeadDetail from "../../components/LeadDetail";

const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: NIKKI.gold,
  grn: NIKKI.emerald, red: NIKKI.red, cyn: NIKKI.cyan,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

type Lead = {
  id: string;
  phone: string;
  name: string | null;
  intent: string | null;
  interest: string | null;
  notes: string | null;
  stage: string;
  score: number;
  source: string;
  call_count: number;
  last_contacted_at: string;
  created_at: string;
  // Added by migration 017 and unused by any screen until now.
  tenant_id: string;
  assigned_to: string | null;
  deal_value_paise: number | null;
  tags: string[] | null;
};

// The fallback, and the platform defaults. crm_pipeline_stages holds the
// same five rows with tenant_id null, plus any a business defines for
// itself — and nothing has ever read it, so a tenant row would have had no
// effect anywhere. loadStages() below prefers the table.
const STAGES = [
  { id: "new",       label: "New",       color: C.cyn  },
  { id: "contacted", label: "Contacted", color: C.gbr  },
  { id: "qualified", label: "Qualified", color: C.gold },
  { id: "won",       label: "Won",       color: C.grn  },
  { id: "lost",      label: "Lost",      color: C.dim  },
];

const titleCase = (s: string) =>
  String(s).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

const INTENT_LABELS: Record<string, string> = {
  book_appointment:     "Wants to book",
  reschedule:           "Reschedule",
  cancel:               "Cancel",
  pricing_enquiry:      "Asked pricing",
  service_enquiry:      "Service question",
  location_hours:       "Location / hours",
  complaint:            "Complaint",
  follow_up:            "Follow-up",
  other:                "Other",
};

// What the seat can record after a dialled call. The hint says what the
// server's /api/calls/disposition does to the lead's stage — "busy" is
// accepted and logged but is not in its STAGE_MAP, so it moves nothing.
const DISPOSITIONS = [
  { label: "Interested",     value: "interested",     color: C.grn,  icon: Check,     hint: "Lead moves to Qualified" },
  { label: "Booked",         value: "booked",         color: C.gbr,  icon: Calendar,  hint: "Lead moves to Won" },
  { label: "Call Back",      value: "callback",       color: C.gold, icon: RefreshCw, hint: "Stays in Contacted" },
  { label: "Not Interested", value: "not_interested", color: C.dim,  icon: X,         hint: "Lead moves to Lost" },
  { label: "No Answer",      value: "no_answer",      color: C.mid,  icon: PhoneOff,  hint: "Back to New" },
  { label: "Busy",           value: "busy",           color: C.mid,  icon: PhoneOff,  hint: "Logged only — stage unchanged" },
];

const fmtDur = (s: number) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;

function scoreColor(s: number): string {
  if (s >= 80) return C.grn;
  if (s >= 50) return C.gold;
  if (s >= 20) return C.gbr;
  return C.dim;
}

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  if (isNaN(d)) return "—";
  const mins = Math.floor((Date.now() - d) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}


// Bulk import. Every lead in this product had to arrive through a phone
// call — a business switching from a spreadsheet, or with a list from an
// exhibition, had no way in at all.
//
// Parsed in the browser and inserted directly: the rows are a few hundred at
// most, and a server round trip per row would be slower and no safer, since
// RLS already scopes the insert to this tenant.
function ImportLeads({ tenantId, onDone }: { tenantId: string | null; onDone: (n: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState("");

  const parse = (text: string) => {
    const rows = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!rows.length) return [];
    // A header row is optional; detect it rather than demanding one.
    const first = rows[0].toLowerCase();
    const hasHeader = /name|phone|mobile|number/.test(first);
    const cols = hasHeader ? first.split(/[,;\t]/).map(c => c.trim()) : [];
    const idxOf = (...names: string[]) => cols.findIndex(c => names.some(n => c.includes(n)));
    const iPhone = hasHeader ? idxOf("phone", "mobile", "number") : -1;
    const iName  = hasHeader ? idxOf("name") : -1;
    const iNote  = hasHeader ? idxOf("interest", "note", "remark") : -1;

    const out: any[] = [];
    const seen = new Set<string>();
    for (const line of rows.slice(hasHeader ? 1 : 0)) {
      const parts = line.split(/[,;\t]/).map(c => c.trim().replace(/^"|"$/g, ""));
      // Without a header, find the field that looks like an Indian mobile.
      const phoneRaw = iPhone >= 0 ? parts[iPhone]
        : parts.find(c => /(?:\+?91|0)?[6-9]\d{9}/.test(c.replace(/\D/g, ""))) || "";
      const digits = String(phoneRaw).replace(/\D/g, "").slice(-10);
      if (!/^[6-9]\d{9}$/.test(digits) || seen.has(digits)) continue;
      seen.add(digits);
      out.push({
        tenant_id: tenantId,
        phone: digits,
        name: (iName >= 0 ? parts[iName] : parts.find(c => c && !/\d{6}/.test(c))) || null,
        interest: (iNote >= 0 ? parts[iNote] : null) || null,
        stage: "new",
        source: "import",
      });
    }
    return out;
  };

  const run = async (text: string) => {
    setErr("");
    if (!tenantId) { setErr("No business linked yet."); return; }
    const rows = parse(text);
    if (!rows.length) { setErr("No valid 10-digit Indian mobile numbers found."); return; }
    setBusy(true);
    const sb = createClient();
    // Skip numbers this tenant already has rather than creating a second
    // lead for someone the business is already talking to.
    const { data: existing } = await sb.from("leads")
      .select("phone").eq("tenant_id", tenantId);
    const have = new Set((existing || []).map((e: any) => String(e.phone).slice(-10)));
    const fresh = rows.filter(r => !have.has(r.phone));
    if (!fresh.length) { setBusy(false); setErr("Every number in that file is already a lead."); return; }
    const { error } = await sb.from("leads").insert(fresh);
    setBusy(false);
    if (error) setErr(error.message);
    else onDone(fresh.length);
  };

  return (
    <div style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <label style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid " + C.bord,
        color: C.txt, fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>
        {busy ? "Importing…" : "Import leads (CSV)"}
        <input type="file" accept=".csv,.txt" disabled={busy} style={{ display: "none" }}
          onChange={async e => {
            const f = e.target.files?.[0];
            if (f) await run(await f.text());
            e.target.value = "";
          }} />
      </label>
      <span style={{ color: C.dim, fontSize: 11.5 }}>
        Name, phone, interest — a header row is optional. Duplicates are skipped.
      </span>
      {err && <span style={{ color: C.gold, fontSize: 12 }}>{err}</span>}
    </div>
  );
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [stages, setStages] = useState(STAGES);
  const [openLead, setOpenLead] = useState<Lead | null>(null);
  const [error, setError] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  // Click-to-Call + Disposition state
  const [ctcActive, setCtcActive] = useState<{ lead: Lead; ctcLogId: string; startedAt: number; seconds: number } | null>(null);
  const [dispModal, setDispModal] = useState<{ lead: Lead; ctcLogId: string; seconds?: number } | null>(null);
  const [dispNotes, setDispNotes] = useState("");
  const [dispSaving, setDispSaving] = useState<string | null>(null);
  const [dispError, setDispError] = useState("");
  const [ctcLoading, setCtcLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const API = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => stopPolling(), []);

  // Same flow as the Human Desk (web/app/desk/page.tsx): the POST returns
  // once YOUR phone is answered and the customer leg is bridged. From there
  // GET /api/calls/click-to-call/:id says whether the channel is still up,
  // so the outcome prompt opens when the call actually ends — not on a
  // blind 30-second timer that fired mid-conversation, or while still
  // ringing, or long after a quick no-answer.
  const handleClickToCall = async (lead: Lead) => {
    setCtcLoading(lead.id);
    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    try {
      const resp = await fetch(`${API}/api/calls/click-to-call`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ customer_number: lead.phone, lead_id: lead.id }),
      });
      const data = await resp.json().catch(() => ({}));
      const ctcLogId: string | undefined = data.ctc_log_id || data.id;
      if (!resp.ok || !ctcLogId) {
        const m = String(data.error || data.detail || "Call failed");
        showToast(
          /NO_ANSWER|ORIGINATOR_CANCEL|timeout/i.test(m) ? "Your phone didn't pick up — try again when you're ready."
          : /USER_BUSY/i.test(m) ? "Your phone is busy on another call."
          : /no_outbound_cli/i.test(m) ? "No business number is assigned to this account yet."
          : m);
      } else {
        const started = Date.now();
        setCtcActive({ lead, ctcLogId, startedAt: started, seconds: 0 });
        showToast(`Connected to ${lead.name || lead.phone}`);
        stopPolling();
        pollRef.current = setInterval(async () => {
          const secsLocal = Math.round((Date.now() - started) / 1000);
          try {
            const { data: { session: s2 } } = await sb.auth.getSession();
            const r = await fetch(`${API}/api/calls/click-to-call/${ctcLogId}`, {
              headers: { Authorization: `Bearer ${s2?.access_token}` },
            });
            const st = r.ok ? await r.json() : null;
            if (st?.ended) {
              stopPolling();
              setCtcActive(null);
              setDispModal({ lead, ctcLogId, seconds: st.duration_seconds || secsLocal });
              return;
            }
            setCtcActive(cur => cur && cur.ctcLogId === ctcLogId
              ? { ...cur, seconds: st?.duration_seconds || secsLocal } : cur);
          } catch { /* keep polling */ }
          // Fallback: if the status route never reports an end (ESL down,
          // token expired), still ask after three minutes rather than never.
          if (secsLocal >= 180) {
            stopPolling();
            setCtcActive(null);
            setDispModal({ lead, ctcLogId, seconds: secsLocal });
          }
        }, 3000);
      }
    } catch (e: any) {
      showToast(`${e.message}`);
    }
    setCtcLoading(null);
  };

  const submitDisposition = async (disposition: string) => {
    if (!dispModal || dispSaving) return;
    setDispSaving(disposition);
    setDispError("");
    try {
      const sb = createClient();
      const { data: { session } } = await sb.auth.getSession();
      const resp = await fetch(`${API}/api/calls/disposition`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ctc_log_id: dispModal.ctcLogId, disposition, notes: dispNotes }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j.error || `Could not save the outcome (${resp.status})`);
      const d = DISPOSITIONS.find(x => x.value === disposition);
      showToast(`Outcome saved: ${d?.label || disposition}`);
      setDispModal(null);
      setDispNotes("");
      load();
    } catch (e: any) {
      setDispError(e.message || "Could not save the outcome");
    }
    setDispSaving(null);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) { window.location.href = "/login"; return; }

    // Reads are scoped by RLS so this page never needed the tenant id.
    // An INSERT does: the column is NOT NULL and the policy checks it.
    const { data: tu } = await sb.from("tenant_users")
      .select("tenant_id").eq("user_id", auth.user.id).maybeSingle();
    setTenantId(tu?.tenant_id ?? null);

    const { data: st } = await sb.from("crm_pipeline_stages")
      .select("name, color, tenant_id, sort_order").order("sort_order");
    if (st?.length) {
      // A tenant's own stage replaces the platform stage of the same name.
      const mine = st.filter((x: any) => x.tenant_id === tu?.tenant_id);
      const rows = (mine.length ? mine : st.filter((x: any) => !x.tenant_id));
      setStages(rows.map((x: any) => ({ id: x.name, label: titleCase(x.name), color: x.color || C.dim })));
    }

    const { data, error: e } = await sb.from("leads")
      .select("*")
      .order("last_contacted_at", { ascending: false })
      .limit(500);
    if (e) setError(e.message);
    else setLeads((data || []) as Lead[]);
    setLoading(false);
    // Deep links from the Human Desk and the live board: ?lead=<id> opens
    // that lead, ?phone=<10 digits> filters to it.
    try {
      const q = new URLSearchParams(window.location.search);
      const wantId = q.get("lead"), wantPhone = q.get("phone");
      if (wantId) { const hit = (data || []).find((l: any) => l.id === wantId); if (hit) setOpenLead(hit as Lead); }
      else if (wantPhone) setSearch(wantPhone.replace(/\D/g, "").slice(-10));
    } catch { /* no window */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function updateLead(id: string, patch: Partial<Lead>) {
    setError("");
    const sb = createClient();
    const { error: e } = await sb.from("leads").update(patch).eq("id", id);
    if (e) { setError(e.message); return; }
    // optimistic local update — avoids a full refetch on every stage click
    setLeads(ls => ls.map(l => (l.id === id ? { ...l, ...patch } as Lead : l)));
  }

  async function saveNote(id: string) {
    await updateLead(id, { notes: noteDraft });
    setEditing(null);
    setNoteDraft("");
  }

  const q = search.trim().toLowerCase();
  const shown = leads.filter(l => {
    if (stageFilter !== "all" && l.stage !== stageFilter) return false;
    if (!q) return true;
    return (l.name || "").toLowerCase().includes(q)
        || l.phone.includes(q)
        || (l.interest || "").toLowerCase().includes(q);
  });

  const counts = stages.reduce((acc, s) => {
    acc[s.id] = leads.filter(l => l.stage === s.id).length;
    return acc;
  }, {} as Record<string, number>);

  const inputStyle: React.CSSProperties = {
    background: C.hi, border: `1px solid ${C.bord}`, borderRadius: 8,
    padding: "9px 12px", color: C.txt, fontSize: 14, fontFamily: "inherit",
    boxSizing: "border-box",
  };

  return (
    <Shell>
      <ImportLeads tenantId={tenantId} onDone={(n: number) => { setToast(`${n} lead(s) imported`); load(); }} />

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999,
          background: C.surf, border: "1px solid " + C.bord, borderRadius: 10,
          padding: "12px 20px", color: C.txt, fontSize: 13, fontWeight: 700,
          boxShadow: "0 8px 32px #0008" }}>{toast}</div>
      )}

      {/* Disposition modal */}
      {dispModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 999,
          display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: C.surf, border: "1px solid " + C.bord,
            borderRadius: 12, padding: 28, width: 440, boxShadow: "0 20px 60px #0008" }}>
            <div style={{ color: C.txt, fontSize: 15, fontWeight: 900, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}><ClipboardList size={16} /> Call Disposition</div>
            <div style={{ color: C.mid, fontSize: 12, marginBottom: 20 }}>
              {dispModal.lead.name || dispModal.lead.phone}
              {dispModal.seconds != null && <> — call ended · {fmtDur(dispModal.seconds)}</>}
              . How did it go?
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              {DISPOSITIONS.map(d => (
                <button key={d.value} onClick={() => submitDisposition(d.value)}
                  disabled={!!dispSaving} title={d.hint} style={{
                  background: d.color + "22", color: d.color,
                  border: "1px solid " + d.color + "44",
                  borderRadius: 8, padding: "10px 10px", fontSize: 13,
                  fontWeight: 700, cursor: dispSaving ? "wait" : "pointer", textAlign: "center",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                  opacity: dispSaving && dispSaving !== d.value ? 0.5 : 1, fontFamily: "inherit",
                }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <d.icon size={14} /> {dispSaving === d.value ? "Saving…" : d.label}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: C.dim }}>{d.hint}</span>
                </button>
              ))}
            </div>
            <textarea value={dispNotes} onChange={e => setDispNotes(e.target.value)}
              placeholder="Add notes (optional)…" rows={3}
              style={{ background: C.hi, border: "1px solid " + C.bord, color: C.txt,
                borderRadius: 8, padding: "10px 12px", width: "100%", fontSize: 12,
                resize: "vertical", marginBottom: 12, boxSizing: "border-box", fontFamily: "inherit" }} />
            {dispError && (
              <div style={{ color: C.red, fontSize: 12, marginBottom: 12 }}>{dispError}</div>
            )}
            <button onClick={() => { setDispModal(null); setDispNotes(""); setDispError(""); }}
              disabled={!!dispSaving}
              style={{ background: "none", color: C.dim, border: "1px solid " + C.bord,
                borderRadius: 7, padding: "8px 16px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div style={{ padding: 24, maxWidth: 1060 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: C.txt, margin: "0 0 4px" }}>
          Leads
        </h1>
        <p style={{ color: C.mid, fontSize: 14, marginTop: 0, marginBottom: 20 }}>
          Everyone who called, what they wanted, and where they are in your pipeline.
          Captured automatically from every call.
        </p>

        {error && (
          <div style={{ background: C.red + "0D", border: `1px solid ${C.red}55`,
            borderRadius: 10, padding: 14, marginBottom: 16, color: C.red, fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* pipeline summary */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: 10, marginBottom: 20,
        }}>
          {stages.map(s => (
            <button key={s.id}
              onClick={() => setStageFilter(stageFilter === s.id ? "all" : s.id)}
              style={{
                background: stageFilter === s.id ? s.color + "22" : C.surf,
                border: `1px solid ${stageFilter === s.id ? s.color : C.bord}`,
                borderRadius: 12, padding: "14px 12px", cursor: "pointer",
                textAlign: "left", fontFamily: "inherit",
              }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>
                {counts[s.id] ?? 0}
              </div>
              <div style={{ fontSize: 11, color: C.mid, textTransform: "uppercase",
                letterSpacing: 0.5, fontWeight: 700 }}>{s.label}</div>
            </button>
          ))}
        </div>

        <input
          style={{ ...inputStyle, width: "100%", marginBottom: 16 }}
          placeholder="Search by name, phone, or interest…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {loading ? (
          <p style={{ color: C.mid }}>Loading…</p>
        ) : shown.length === 0 ? (
          <div style={{ background: C.surf, border: `1px solid ${C.bord}`,
            borderRadius: 12, padding: 40, textAlign: "center" }}>
            <div style={{ marginBottom: 10, display: "flex", justifyContent: "center" }}><Users size={28} /></div>
            <h3 style={{ color: C.txt, margin: "0 0 6px", fontSize: 17 }}>
              {leads.length === 0 ? "No leads yet" : "No leads match that filter"}
            </h3>
            <p style={{ color: C.mid, fontSize: 14, margin: 0, lineHeight: 1.5 }}>
              {leads.length === 0
                ? "Every call Hey Nikki answers becomes a lead here automatically."
                : "Try a different stage or clear the search."}
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {shown.map(l => (
              <div key={l.id}
                onClick={() => setOpenLead(l)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenLead(l); } }}
                style={{
                background: C.surf, border: `1px solid ${C.bord}`,
                borderRadius: 12, padding: 16, cursor: "pointer",
              }}>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
                  {/* score */}
                  <div style={{
                    background: scoreColor(l.score) + "1A",
                    border: `1px solid ${scoreColor(l.score)}44`,
                    borderRadius: 10, padding: "8px 12px", minWidth: 58, textAlign: "center",
                  }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: scoreColor(l.score) }}>
                      {l.score}
                    </div>
                    <div style={{ fontSize: 9, color: C.dim, textTransform: "uppercase",
                      letterSpacing: 0.5, fontWeight: 700 }}>score</div>
                  </div>

                  {/* identity + what they wanted */}
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: C.txt }}>
                        {l.name || "Unknown caller"}
                      </span>
                      {l.call_count > 1 && (
                        <span style={{
                          background: C.gbr + "22", color: C.gbr, fontSize: 10,
                          fontWeight: 700, padding: "2px 7px", borderRadius: 20,
                        }}>{l.call_count} calls</span>
                      )}
                    </div>
                    <a href={`tel:${l.phone}`} style={{
                      fontSize: 13, color: C.gbr, fontFamily: "monospace",
                      textDecoration: "none",
                    }}>{l.phone}</a>
                    <div style={{ fontSize: 13, color: C.mid, marginTop: 4 }}>
                      {l.intent ? ((INTENT_LABELS[l.intent] || titleCase(l.intent || "other")) || l.intent) : "—"}
                      {l.interest && <span style={{ color: C.txt }}> · {l.interest}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
                      Last contact {timeAgo(l.last_contacted_at)}
                    </div>

                    {editing === l.id ? (
                      <div style={{ marginTop: 10 }} onClick={e => e.stopPropagation()}>
                        <textarea
                          style={{ ...inputStyle, width: "100%", minHeight: 60, resize: "vertical" }}
                          value={noteDraft}
                          onChange={e => setNoteDraft(e.target.value)}
                          placeholder="Add a note…"
                        />
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button onClick={() => saveNote(l.id)} style={{
                            background: C.grn, color: "#fff", border: "none", borderRadius: 7,
                            padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                          }}>Save</button>
                          <button onClick={() => { setEditing(null); setNoteDraft(""); }} style={{
                            background: C.hi, color: C.mid, border: `1px solid ${C.bord}`,
                            borderRadius: 7, padding: "6px 14px", fontSize: 12, cursor: "pointer",
                          }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      /* The card itself opens the drawer; without this every
                         button inside it also opened a full-screen overlay on
                         top of what it just revealed. */
                      <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
                        {l.notes && (
                          <div style={{ fontSize: 12, color: C.mid, fontStyle: "italic",
                            marginBottom: 4, lineHeight: 1.5 }}>{l.notes}</div>
                        )}
                        <button
                          onClick={() => { setEditing(l.id); setNoteDraft(l.notes || ""); }}
                          style={{
                            background: "none", border: "none", color: C.dim, fontSize: 12,
                            cursor: "pointer", padding: 0, fontFamily: "inherit",
                          }}>{l.notes ? "Edit note" : "+ Add note"}</button>
                      </div>
                    )}
                  </div>

                  {/* stage control + click-to-call */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}
                    onClick={e => e.stopPropagation()}>
                    {/* Click-to-Call button */}
                    <button
                      onClick={() => handleClickToCall(l)}
                      disabled={ctcLoading === l.id || ctcActive?.lead.id === l.id}
                      style={{
                        background: C.grn + "22", color: C.grn,
                        border: "1px solid " + C.grn + "44",
                        borderRadius: 7, padding: "7px 14px", fontSize: 12,
                        fontWeight: 700, cursor: "pointer",
                        opacity: ctcLoading === l.id ? 0.7 : 1,
                        display: "flex", alignItems: "center", gap: 5,
                      }}>
                      {ctcLoading === l.id ? (<><RefreshCw size={12} /> Ringing you…</>) :
                       ctcActive?.lead.id === l.id ? (<><Phone size={12} /> On call · {fmtDur(ctcActive.seconds)}</>) : (<><Phone size={12} /> Call Lead</>)}
                    </button>
                    {/* Disposition trigger — the prompt opens by itself when
                        the call ends; this is for logging early. */}
                    {ctcActive?.lead.id === l.id && (
                      <button onClick={() => { stopPolling(); setDispModal({ lead: l, ctcLogId: ctcActive.ctcLogId, seconds: ctcActive.seconds }); setCtcActive(null); }}
                        style={{ background: C.gold + "22", color: C.gold, border: "1px solid " + C.gold + "44",
                          borderRadius: 7, padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer",
                          display: "flex", alignItems: "center", gap: 5 }}>
                        <ClipboardList size={11} /> Log Disposition
                      </button>
                    )}
                    {/* Stage buttons */}
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {stages.map(s => (
                        <button key={s.id}
                          onClick={() => updateLead(l.id, { stage: s.id })}
                          title={`Mark ${s.label}`}
                          style={{
                            background: l.stage === s.id ? s.color + "26" : "transparent",
                            color: l.stage === s.id ? s.color : C.dim,
                            border: `1px solid ${l.stage === s.id ? s.color + "66" : C.bord}`,
                            borderRadius: 7, padding: "5px 10px", fontSize: 11,
                            fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                          }}>{s.label}</button>
                      ))}
                    </div>
                    {/* Score progress bar */}
                    <div style={{ width: 160, marginTop: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ color: C.dim, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em" }}>Score</span>
                        <span style={{ color: scoreColor(l.score), fontSize: 9, fontWeight: 700 }}>{l.score}/100</span>
                      </div>
                      <div style={{ height: 4, background: C.bord, borderRadius: 2 }}>
                        <div style={{ width: l.score + "%", height: "100%", borderRadius: 2,
                          background: scoreColor(l.score), transition: "width 0.4s ease",
                          boxShadow: l.score >= 70 ? "0 0 8px " + C.grn + "88" : "none" }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {openLead && (
          <LeadDetail
            lead={openLead}
            onClose={() => setOpenLead(null)}
            // Reload so the row reflects the new stage/owner immediately —
            // the drawer writes straight to Postgres, not through this page's
            // state, so without this the list would show stale values until
            // the next manual refresh.
            onSaved={() => { setOpenLead(null); load(); }}
          />
        )}
      </div>
    </Shell>
  );
}
