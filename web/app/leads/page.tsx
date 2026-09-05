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
import { Check, X, Calendar, RefreshCw, PhoneOff, Users, Phone, ClipboardList, Plus, Upload, Search, MessageCircle, Flame } from "lucide-react";
import LeadDetail, { type Stage } from "../../components/LeadDetail";
import { toast } from "../../components/Toast";

const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, teal: NIKKI.teal, acc: NIKKI.terracotta, gbr: NIKKI.tealLight, gold: NIKKI.gold,
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
const STAGES: Stage[] = [
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

  useEffect(() => { if (err) toast.err(err); }, [err]);
  return (
    <label title="CSV with name, phone, interest — a header row is optional. Duplicates are skipped."
      style={{ padding: "9px 14px", borderRadius: 9, border: "1px solid " + C.bord, background: C.surf,
        color: C.txt, fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer",
        display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Upload size={14} /> {busy ? "Importing…" : "Import CSV"}
      <input type="file" accept=".csv,.txt" disabled={busy} style={{ display: "none" }}
        onChange={async e => {
          const f = e.target.files?.[0];
          if (f) await run(await f.text());
          e.target.value = "";
        }} />
    </label>
  );
}

// Manual entry — a walk-in, a referral, a number scribbled on a slip. Until
// now the only door was a phone call or a CSV.
function AddLead({ tenantId, onDone, onCancel }: { tenantId: string | null; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [interest, setInterest] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const digits = phone.replace(/\D/g, "").slice(-10);
    if (!/^[6-9]\d{9}$/.test(digits)) { toast.err("Enter a 10-digit Indian mobile number."); return; }
    if (!tenantId) { toast.err("No business linked yet."); return; }
    setBusy(true);
    const sb = createClient();
    const { data: dup } = await sb.from("leads").select("id").eq("tenant_id", tenantId).eq("phone", digits).maybeSingle();
    if (dup) { setBusy(false); toast.err("That number is already a lead."); return; }
    const { error } = await sb.from("leads").insert({
      tenant_id: tenantId, phone: digits, name: name.trim() || null, interest: interest.trim() || null,
      stage: "new", source: "manual",
    });
    setBusy(false);
    if (error) { toast.err(error.message); return; }
    toast.ok("Lead added");
    onDone();
  };
  const f: React.CSSProperties = { background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 8, padding: "9px 12px", color: C.txt, fontSize: 14, minWidth: 0 };
  return (
    <div style={{ background: C.hi, border: `1px solid ${C.bord}`, borderRadius: 12, padding: 14, marginBottom: 14,
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, alignItems: "end" }}>
      <div><div style={{ fontSize: 11, color: C.mid, fontWeight: 700, marginBottom: 4 }}>NAME</div>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Optional" style={{ ...f, width: "100%" }} /></div>
      <div><div style={{ fontSize: 11, color: C.mid, fontWeight: 700, marginBottom: 4 }}>MOBILE</div>
        <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="98765 43210" style={{ ...f, width: "100%", fontFamily: "var(--font-mono), monospace" }}
          onKeyDown={e => { if (e.key === "Enter") submit(); }} /></div>
      <div><div style={{ fontSize: 11, color: C.mid, fontWeight: 700, marginBottom: 4 }}>WANTS</div>
        <input value={interest} onChange={e => setInterest(e.target.value)} placeholder="e.g. root canal, Saturday" style={{ ...f, width: "100%" }}
          onKeyDown={e => { if (e.key === "Enter") submit(); }} /></div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={submit} disabled={busy} style={{ background: C.teal, color: "#fff", border: 0, borderRadius: 8, padding: "10px 16px", fontSize: 13, fontWeight: 700 }}>
          {busy ? "Adding…" : "Add lead"}</button>
        <button onClick={onCancel} style={{ background: "none", color: C.mid, border: `1px solid ${C.bord}`, borderRadius: 8, padding: "10px 12px", fontSize: 13 }}>Cancel</button>
      </div>
    </div>
  );
}

type SortKey = "recent" | "score" | "calls" | "newest";
const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: "recent", label: "Last contact" }, { id: "score", label: "Highest score" },
  { id: "calls", label: "Most calls" }, { id: "newest", label: "Newest" },
];

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [stages, setStages] = useState<Stage[]>(STAGES);
  const [openLead, setOpenLead] = useState<Lead | null>(null);
  const [error, setError] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [hotOnly, setHotOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("recent");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Click-to-Call + Disposition state
  const [ctcActive, setCtcActive] = useState<{ lead: Lead; ctcLogId: string; startedAt: number; seconds: number } | null>(null);
  const [dispModal, setDispModal] = useState<{ lead: Lead; ctcLogId: string; seconds?: number } | null>(null);
  const [dispNotes, setDispNotes] = useState("");
  const [dispSaving, setDispSaving] = useState<string | null>(null);
  const [dispError, setDispError] = useState("");
  const [ctcLoading, setCtcLoading] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const API = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => stopPolling(), []);

  // Same flow as the Human Desk (web/app/desk/page.tsx): the POST returns
  // once YOUR phone is answered and the customer leg is bridged. From there
  // GET /api/calls/click-to-call/:id says whether the channel is still up,
  // so the outcome prompt opens when the call actually ends — not on a
  // blind 30-second timer that fired mid-conversation, or while still
  // ringing, or long after a quick no-answer.
  const handleClickToCall = async (lead: Lead) => {
    if (ctcActive) { toast.err(`You're already on a call with ${ctcActive.lead.name || ctcActive.lead.phone}.`); return; }
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
        toast.err(
          /NO_ANSWER|ORIGINATOR_CANCEL|timeout/i.test(m) ? "Your phone didn't pick up — try again when you're ready."
          : /USER_BUSY/i.test(m) ? "Your phone is busy on another call."
          : /no_outbound_cli/i.test(m) ? "No business number is assigned to this account yet."
          : /no_credits/i.test(m) ? "No calling minutes left — top up on Billing."
          : m);
      } else {
        const started = Date.now();
        setCtcActive({ lead, ctcLogId, startedAt: started, seconds: 0 });
        toast.ok(`Connected to ${lead.name || lead.phone}`);
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
      toast.err(`${e.message}`);
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
      toast.ok(`Outcome saved: ${d?.label || disposition}`);
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

  // The drawer shows the row it was opened with; keep it in step with the
  // list so a stage click in the drawer is reflected in the header at once.
  const patchLocal = (id: string, patch: Partial<Lead>) => {
    setLeads(ls => ls.map(l => (l.id === id ? { ...l, ...patch } as Lead : l)));
    setOpenLead(cur => cur && cur.id === id ? { ...cur, ...patch } as Lead : cur);
  };

  async function updateLead(id: string, patch: Partial<Lead>) {
    setError("");
    const sb = createClient();
    const { error: e } = await sb.from("leads").update(patch).eq("id", id);
    if (e) { toast.err(e.message); return; }
    patchLocal(id, patch);
    if (patch.stage) {
      const from = leads.find(l => l.id === id)?.stage;
      if (from && from !== patch.stage) {
        const { data: { user } } = await sb.auth.getUser();
        await sb.from("lead_activities").insert({ lead_id: id, type: "stage_change", description: `Stage: ${from} → ${patch.stage}`, created_by: user?.id ?? null });
      }
    }
  }

  const bulkStage = async (stage: string) => {
    if (!selected.size || !stage) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const sb = createClient();
    const { error: e } = await sb.from("leads").update({ stage }).in("id", ids);
    setBulkBusy(false);
    if (e) { toast.err(e.message); return; }
    setLeads(ls => ls.map(l => selected.has(l.id) ? { ...l, stage } : l));
    toast.ok(`${ids.length} lead${ids.length === 1 ? "" : "s"} moved to ${stages.find(s => s.id === stage)?.label || stage}`);
    setSelected(new Set());
  };

  const q = search.trim().toLowerCase();
  const shown = leads.filter(l => {
    if (stageFilter !== "all" && l.stage !== stageFilter) return false;
    if (hotOnly && l.score < 70) return false;
    if (!q) return true;
    return (l.name || "").toLowerCase().includes(q)
        || l.phone.includes(q)
        || (l.interest || "").toLowerCase().includes(q)
        || (l.tags || []).some(t => t.toLowerCase().includes(q));
  }).sort((a, b) => {
    if (sort === "score") return b.score - a.score;
    if (sort === "calls") return (b.call_count || 0) - (a.call_count || 0);
    if (sort === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return new Date(b.last_contacted_at || b.created_at).getTime() - new Date(a.last_contacted_at || a.created_at).getTime();
  });

  const counts = stages.reduce((acc, s) => {
    acc[s.id] = leads.filter(l => l.stage === s.id).length;
    return acc;
  }, {} as Record<string, number>);
  const hotCount = leads.filter(l => l.score >= 70 && !["won", "lost"].includes(l.stage)).length;
  const allShownSelected = shown.length > 0 && shown.every(l => selected.has(l.id));

  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const inputStyle: React.CSSProperties = {
    background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 9,
    padding: "9px 12px", color: C.txt, fontSize: 14, fontFamily: "inherit",
    boxSizing: "border-box",
  };
  const chip = (on: boolean, color: string): React.CSSProperties => ({
    background: on ? color + "1F" : C.surf, color: on ? color : C.mid,
    border: `1px solid ${on ? color + "88" : C.bord}`, borderRadius: 20,
    padding: "6px 12px", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap",
    display: "inline-flex", alignItems: "center", gap: 6,
  });

  return (
    <Shell title="Leads">
      {/* Disposition modal */}
      {dispModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 10001,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: C.surf, border: "1px solid " + C.bord,
            borderRadius: 12, padding: 24, width: "min(440px, 100%)", boxShadow: "0 20px 60px #0008" }}>
            <div style={{ color: C.txt, fontSize: 15, fontWeight: 900, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}><ClipboardList size={16} /> How did the call go?</div>
            <div style={{ color: C.mid, fontSize: 12, marginBottom: 18 }}>
              {dispModal.lead.name || dispModal.lead.phone}
              {dispModal.seconds != null && <> · {fmtDur(dispModal.seconds)}</>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              {DISPOSITIONS.map(d => (
                <button key={d.value} onClick={() => submitDisposition(d.value)}
                  disabled={!!dispSaving} title={d.hint} style={{
                  background: d.color + "16", color: d.color,
                  border: "1px solid " + d.color + "44",
                  borderRadius: 8, padding: "10px 10px", fontSize: 13,
                  fontWeight: 700, textAlign: "center",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                  opacity: dispSaving && dispSaving !== d.value ? 0.5 : 1,
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
                resize: "vertical", marginBottom: 12, boxSizing: "border-box" }} />
            {dispError && (
              <div style={{ color: C.red, fontSize: 12, marginBottom: 12 }}>{dispError}</div>
            )}
            <button onClick={() => { setDispModal(null); setDispNotes(""); setDispError(""); }}
              disabled={!!dispSaving}
              style={{ background: "none", color: C.dim, border: "1px solid " + C.bord,
                borderRadius: 7, padding: "8px 16px", fontSize: 12 }}>
              Skip for now
            </button>
          </div>
        </div>
      )}

      {/* Live call strip — visible wherever you are on the page. */}
      {ctcActive && (
        <div style={{ position: "sticky", top: 56, zIndex: 20, background: C.grn, color: "#fff", borderRadius: 10,
          padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff", animation: "pulse 2s infinite" }} />
          <span style={{ fontWeight: 800, fontSize: 13 }}>On call with {ctcActive.lead.name || ctcActive.lead.phone}</span>
          <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{fmtDur(ctcActive.seconds)}</span>
          <button onClick={() => { stopPolling(); setDispModal({ lead: ctcActive.lead, ctcLogId: ctcActive.ctcLogId, seconds: ctcActive.seconds }); setCtcActive(null); }}
            style={{ marginLeft: "auto", background: "#fff", color: C.grn, border: 0, borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 800 }}>
            Log outcome
          </button>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: C.txt, margin: "0 0 4px" }}>Leads</h1>
          <p style={{ color: C.mid, fontSize: 14, margin: 0 }}>
            Everyone who called, what they wanted, and where they are in your pipeline.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ImportLeads tenantId={tenantId} onDone={(n: number) => { toast.ok(`${n} lead${n === 1 ? "" : "s"} imported`); load(); }} />
          <button onClick={() => setAdding(v => !v)} style={{
            background: C.teal, color: "#fff", border: 0, borderRadius: 9, padding: "9px 14px",
            fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Plus size={14} /> Add lead
          </button>
        </div>
      </div>

      {adding && <AddLead tenantId={tenantId} onDone={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}

      {error && (
        <div style={{ background: C.red + "0D", border: `1px solid ${C.red}55`,
          borderRadius: 10, padding: 14, marginBottom: 16, color: C.red, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Stage filter — the pipeline at a glance, click to narrow. */}
      <div className="nk-scroll" style={{ display: "flex", gap: 6, marginBottom: 12, paddingBottom: 2 }}>
        <button onClick={() => setStageFilter("all")} style={chip(stageFilter === "all", C.teal)}>
          All <span style={{ opacity: 0.7 }}>{leads.length}</span>
        </button>
        {stages.map(s => (
          <button key={s.id} onClick={() => setStageFilter(stageFilter === s.id ? "all" : s.id)} style={chip(stageFilter === s.id, s.color)}>
            {s.label} <span style={{ opacity: 0.7 }}>{counts[s.id] ?? 0}</span>
          </button>
        ))}
        <button onClick={() => setHotOnly(v => !v)} style={{ ...chip(hotOnly, C.acc), marginLeft: "auto" }} title="Score 70 and above">
          <Flame size={13} /> Hot <span style={{ opacity: 0.7 }}>{hotCount}</span>
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 240px" }}>
          <Search size={14} style={{ position: "absolute", left: 11, top: 12, color: C.dim }} />
          <input
            style={{ ...inputStyle, width: "100%", paddingLeft: 32 }}
            placeholder="Search name, phone, interest or tag…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select value={sort} onChange={e => setSort(e.target.value as SortKey)} style={{ ...inputStyle, flex: "0 0 auto" }} aria-label="Sort">
          {SORTS.map(s => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
        </select>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: C.txt, color: "#fff",
          borderRadius: 10, padding: "8px 12px", marginBottom: 10, fontSize: 13 }}>
          <strong>{selected.size} selected</strong>
          <span style={{ opacity: 0.7 }}>Move to</span>
          {stages.map(s => (
            <button key={s.id} onClick={() => bulkStage(s.id)} disabled={bulkBusy} style={{
              background: s.color + "33", color: "#fff", border: `1px solid ${s.color}88`, borderRadius: 20,
              padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>{s.label}</button>
          ))}
          <button onClick={() => setSelected(new Set())} style={{ marginLeft: "auto", background: "none", border: 0, color: "#fff", opacity: 0.8, fontSize: 12 }}>Clear</button>
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[0, 1, 2, 3].map(i => <div key={i} style={{ height: 64, borderRadius: 12, background: C.hi, border: `1px solid ${C.bord}` }} />)}
        </div>
      ) : shown.length === 0 ? (
        <div style={{ background: C.surf, border: `1px solid ${C.bord}`,
          borderRadius: 12, padding: 40, textAlign: "center" }}>
          <div style={{ marginBottom: 10, display: "flex", justifyContent: "center", color: C.dim }}><Users size={28} /></div>
          <h3 style={{ color: C.txt, margin: "0 0 6px", fontSize: 17 }}>
            {leads.length === 0 ? "No leads yet" : "No leads match"}
          </h3>
          <p style={{ color: C.mid, fontSize: 14, margin: 0, lineHeight: 1.5 }}>
            {leads.length === 0
              ? "Every call Nikki answers becomes a lead here automatically — or add one above."
              : "Try another stage, clear the search, or turn off Hot."}
          </p>
        </div>
      ) : (
        <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12, overflow: "hidden" }}>
          {/* Header row (desktop only) */}
          <div className="nk-leadrow nk-leadhead">
            <input type="checkbox" aria-label="Select all" checked={allShownSelected}
              onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map(l => l.id)))} />
            <span>Lead</span><span>Wants</span><span>Stage</span><span>Last contact</span><span></span>
          </div>
          {shown.map(l => {
            const sc = scoreColor(l.score);
            const st = stages.find(s => s.id === l.stage);
            const onCall = ctcActive?.lead.id === l.id;
            return (
              <div key={l.id} className="nk-leadrow" role="button" tabIndex={0}
                onClick={() => setOpenLead(l)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenLead(l); } }}
                style={{ background: selected.has(l.id) ? C.teal + "0A" : undefined }}>
                <input type="checkbox" aria-label={`Select ${l.name || l.phone}`} checked={selected.has(l.id)}
                  onClick={e => e.stopPropagation()} onChange={() => toggle(l.id)} />

                {/* identity */}
                <div style={{ minWidth: 0, display: "flex", gap: 10, alignItems: "center" }}>
                  <div title={`Score ${l.score}/100`} style={{
                    width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                    background: sc + "1A", color: sc, border: `1px solid ${sc}44`,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800,
                  }}>{l.score}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 700, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {l.name || "Unknown caller"}
                      </span>
                      {l.call_count > 1 && (
                        <span style={{ background: C.hi, color: C.mid, fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 20, flexShrink: 0 }}>
                          {l.call_count} calls</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: C.mid, fontFamily: "var(--font-mono), monospace" }}>{l.phone}</div>
                    {(l.tags?.length || 0) > 0 && (
                      <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
                        {l.tags!.slice(0, 3).map(t => <span key={t} style={{ fontSize: 10, color: C.teal, background: C.teal + "12", borderRadius: 4, padding: "1px 5px" }}>{t}</span>)}
                      </div>
                    )}
                  </div>
                </div>

                {/* wants */}
                <div className="nk-lead-wants" style={{ fontSize: 13, color: C.txt, minWidth: 0 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any }}>
                    {l.interest || (l.intent ? (INTENT_LABELS[l.intent] || titleCase(l.intent)) : <span style={{ color: C.dim }}>—</span>)}
                  </div>
                  {l.notes && <div style={{ fontSize: 11.5, color: C.dim, fontStyle: "italic", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.notes}</div>}
                </div>

                {/* stage — inline, saves on change */}
                <div onClick={e => e.stopPropagation()}>
                  <select value={l.stage} onChange={e => updateLead(l.id, { stage: e.target.value })} aria-label="Stage" style={{
                    background: (st?.color || C.dim) + "1A", color: st?.color || C.mid,
                    border: `1px solid ${(st?.color || C.dim)}55`, borderRadius: 20, padding: "5px 10px",
                    fontSize: 12, fontWeight: 700, appearance: "auto",
                  }}>
                    {stages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>

                {/* last contact */}
                <div className="nk-lead-when" style={{ fontSize: 12, color: C.dim, whiteSpace: "nowrap" }}>{timeAgo(l.last_contacted_at || l.created_at)}</div>

                {/* actions */}
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => handleClickToCall(l)} disabled={ctcLoading === l.id || onCall} title="Call from your phone via Nikki's number" style={{
                    background: onCall ? C.grn : C.grn + "1A", color: onCall ? "#fff" : C.grn, border: `1px solid ${C.grn}44`,
                    borderRadius: 8, padding: "7px 10px", fontSize: 12, fontWeight: 700,
                    display: "inline-flex", alignItems: "center", gap: 5, opacity: ctcLoading === l.id ? 0.7 : 1 }}>
                    {ctcLoading === l.id ? <RefreshCw size={13} /> : <Phone size={13} />}
                    <span className="nk-hide-mobile">{ctcLoading === l.id ? "Ringing…" : onCall ? fmtDur(ctcActive!.seconds) : "Call"}</span>
                  </button>
                  <button onClick={() => setOpenLead(l)} title="Message on WhatsApp" aria-label="Message on WhatsApp" style={{
                    background: C.teal + "12", color: C.teal, border: `1px solid ${C.teal}33`,
                    borderRadius: 8, padding: "7px 10px", display: "inline-flex", alignItems: "center" }}>
                    <MessageCircle size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openLead && (
        <LeadDetail
          lead={openLead}
          stages={stages}
          onClose={() => setOpenLead(null)}
          onChanged={patch => patchLocal(openLead.id, patch)}
          onCall={l => handleClickToCall(l)}
          calling={ctcLoading === openLead.id}
        />
      )}
    </Shell>
  );
}
