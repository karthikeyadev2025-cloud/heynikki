"use client";

/**
 * Outbound telecalling campaigns.
 *
 * Reads (campaign list, recipient counts, the do-not-call list) go straight
 * to Supabase with the logged-in user's own JWT: the outbound_* tables carry
 * row-level security keyed to tenant membership, so Postgres enforces the
 * tenant boundary and nothing secret ships to the browser. Anything that
 * changes dialling state — start, pause, schedule, import — goes through
 * api-server (outbound.ts / campaign-import.ts), which owns the guards a
 * browser write would walk past: the consent declaration, "has any
 * recipients", calling-hours and opt-out checks.
 *
 * Dialling runs on our own Jio trunk: the pipeline serves the answered leg,
 * the dispatcher runs as a compose service, and FreeSWITCH originates the
 * call. What gates a campaign is operational rather than missing code — the
 * dispatcher container is started explicitly (--profile outbound) and a
 * campaign will not start without a consent declaration recorded against it.
 *
 * Recipient import lives in components/RecipientImport: it parses .xlsx and
 * .csv in the browser and posts clean rows to /api/campaigns/:id/import,
 * naming the exact rows that are malformed.
 */

import { useState, useEffect, useCallback } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import { NIKKI } from "../../lib/brand";
import { AlertTriangle, Megaphone } from "lucide-react";
import RecipientImport from "../../components/RecipientImport";

const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: NIKKI.gold,
  grn: NIKKI.emerald, red: NIKKI.red, cyn: NIKKI.cyan,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

type Campaign = {
  id: string;
  tenant_id: string;
  name: string;
  script: string;
  status: string;
  window_start: string;
  window_end: string;
  start_date: string | null;
  end_date: string | null;
  max_concurrent: number;
  created_at: string;
};

const API = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

/** IST calendar day as YYYY-MM-DD, matching the date columns. */
function istToday(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}
function fmtDay(d: string): string {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-IN",
    { day: "numeric", month: "short", timeZone: "UTC" });
}
/** "5 Sep – 10 Sep" / "from 5 Sep" / "until 10 Sep" / "every day". */
function fmtDays(c: { start_date: string | null; end_date: string | null }): string {
  if (c.start_date && c.end_date) {
    return c.start_date === c.end_date ? fmtDay(c.start_date) : `${fmtDay(c.start_date)} – ${fmtDay(c.end_date)}`;
  }
  if (c.start_date) return `from ${fmtDay(c.start_date)}`;
  if (c.end_date)   return `until ${fmtDay(c.end_date)}`;
  return "every day";
}

type Stats = {
  total: number; pending: number; queued: number; in_progress: number;
  completed: number; blocked_dnd: number; opted_out: number; failed: number;
};

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{
    background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12,
    padding: 20, ...style,
  }}>{children}</div>;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: C.mid, running: C.grn, scheduled: C.cyn,
    paused: C.gold, completed: C.cyn, cancelled: C.red,
  };
  const col = map[status] || C.mid;
  return <span style={{
    background: col + "22", color: col, border: `1px solid ${col}44`,
    fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
    textTransform: "uppercase", letterSpacing: 0.5,
  }}>{status}</span>;
}


// Who was actually dialled. The campaign card showed five counters and no
// way to see a single contact behind them — a business could not tell which
// number failed, which was blocked, or who had already been reached.
//
// Columns are the ones outbound_recipients actually has (006 + 019):
// first_name, status, attempts, outcome. There is no `name` or `last_error`
// — selecting either made PostgREST refuse the whole query, and the list
// read "no contacts imported" to a business with 500 rows in it.
type RecipientRow = {
  phone: string; first_name: string | null; status: string;
  attempts: number; outcome: string | null;
};

const RECIPIENT_STATUS: Record<string, { label: string; color: string }> = {
  pending:     { label: "waiting",                  color: C.mid },
  scrubbing:   { label: "checking",                 color: C.gold },
  queued:      { label: "queued",                   color: C.cyn },
  in_progress: { label: "on a call",                color: C.gbr },
  completed:   { label: "called",                   color: C.grn },
  failed:      { label: "failed",                   color: C.red },
  blocked_dnd: { label: "not dialled (no consent)", color: C.gold },
  opted_out:   { label: "opted out",                color: C.red },
};

/** The dispatcher writes `answered`, `dialled`, `no_conversation_<CAUSE>` or
 *  a raw trunk reason. Say it in words where the shape is known. */
function fmtOutcome(o: string | null): string {
  if (!o) return "";
  if (o === "answered") return "answered";
  if (o === "dialled")  return "dialling";
  if (o.startsWith("no_conversation_")) {
    const cause = o.slice("no_conversation_".length).replace(/_/g, " ").toLowerCase();
    return cause === "stale" || cause === "unknown" ? "no conversation" : `no answer (${cause})`;
  }
  return o.replace(/_/g, " ").toLowerCase();
}

function RecipientList({ campaignId }: { campaignId: string }) {
  const [rows, setRows] = useState<RecipientRow[] | null>(null);
  const [err, setErr]   = useState("");
  const [open, setOpen] = useState(false);

  const load = async () => {
    setErr("");
    const sb = createClient();
    const { data, error } = await sb.from("outbound_recipients")
      .select("phone, first_name, status, attempts, outcome")
      .eq("campaign_id", campaignId)
      .order("status").limit(200);
    if (error) { setErr(error.message); setRows([]); return; }
    setRows((data || []) as RecipientRow[]);
  };

  return (
    <div style={{ marginTop: 8 }}>
      <button type="button"
        onClick={() => { setOpen(o => !o); if (!rows) load(); }}
        style={{ background: "none", border: "none", color: C.gbr, fontSize: 12,
          fontWeight: 700, cursor: "pointer", padding: 0 }}>
        {open ? "Hide contacts" : "See contacts"}
      </button>
      {open && (
        <div style={{ marginTop: 8, maxHeight: 260, overflowY: "auto",
          border: `1px solid ${C.bord}`, borderRadius: 8 }}>
          {rows === null ? (
            <div style={{ padding: 10, color: C.dim, fontSize: 12 }}>Loading…</div>
          ) : err ? (
            <div style={{ padding: 10, color: C.red, fontSize: 12, display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ flex: 1 }}>Couldn&apos;t load the contacts: {err}</span>
              <button type="button" onClick={load}
                style={{ background: "none", border: `1px solid ${C.bord}`, color: C.txt,
                  borderRadius: 6, padding: "3px 9px", fontSize: 11.5, cursor: "pointer" }}>
                Retry
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 10, color: C.dim, fontSize: 12 }}>
              No contacts on this campaign yet — use Upload numbers to add a list.
            </div>
          ) : rows.map((r, i) => {
            const st = RECIPIENT_STATUS[r.status] || { label: r.status, color: C.dim };
            const outcome = fmtOutcome(r.outcome);
            return (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "center",
                padding: "7px 10px", borderBottom: `1px solid ${C.bord}44`, fontSize: 12.5 }}>
                <span style={{ color: C.txt, fontWeight: 700, minWidth: 96 }}>{r.phone}</span>
                <span style={{ color: C.mid, flex: 1 }}>{r.first_name || "—"}</span>
                <span style={{ color: st.color }}>{st.label}</span>
                {outcome && <span style={{ color: C.dim, fontSize: 11.5 }}>{outcome}</span>}
                {r.attempts > 1 && <span style={{ color: C.dim, fontSize: 11.5 }}>{r.attempts} tries</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Do-not-call, owned by the business.
//
// The dispatcher has always cross-referenced this table before every dial,
// and the import screen has always promised opt-outs are filtered — but a
// customer had no way to see the list or add to it, so the promise rested on
// rows only we could write. A person who says "stop calling me" is a legal
// obligation under TRAI, not a preference, and the business needs to be able
// to honour it the moment they hear it.
function OptOutList({ tenantId }: { tenantId: string | null }) {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (!tenantId) return;
    const sb = createClient();
    const { data } = await sb.from("outbound_opt_outs")
      .select("id, phone, reason, created_at")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(300);
    setRows(data || []);
  }, [tenantId]);
  useEffect(() => { if (open) load(); }, [open, load]);

  const add = async () => {
    const digits = phone.replace(/\D/g, "").slice(-10);
    if (!/^[6-9]\d{9}$/.test(digits)) { setMsg("Enter a 10-digit Indian mobile number."); return; }
    const sb = createClient();
    // Stored as ten digits, the same shape the dispatcher compares against —
    // a number saved as +91… would silently never match and the person would
    // keep being called.
    const { error } = await sb.from("outbound_opt_outs")
      .insert({ tenant_id: tenantId, phone: digits, reason: reason.trim() || "asked not to be called" });
    setMsg(error ? (/duplicate/i.test(error.message) ? "Already on the list." : error.message) : "Added — we won't call this number.");
    if (!error) { setPhone(""); setReason(""); load(); }
    setTimeout(() => setMsg(""), 3000);
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ background: "none", border: `1px solid ${C.bord}`, color: C.txt,
          borderRadius: 8, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
        Do-not-call list{rows.length ? ` (${rows.length})` : ""}
      </button>
      {open && (
        <div style={{ marginTop: 10, border: `1px solid ${C.bord}`, borderRadius: 10, padding: 14 }}>
          <div style={{ color: C.mid, fontSize: 12.5, marginBottom: 10, lineHeight: 1.55 }}>
            Numbers here are skipped by every campaign. Add anyone who asks not to be
            called — under TRAI that request has to be honoured.
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" as const, marginBottom: 10 }}>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="98765 43210"
              style={{ width: 150, padding: "7px 10px", borderRadius: 7, fontSize: 12.5,
                background: C.hi, color: C.txt, border: `1px solid ${C.bord}` }} />
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="reason (optional)"
              style={{ flex: 1, minWidth: 160, padding: "7px 10px", borderRadius: 7, fontSize: 12.5,
                background: C.hi, color: C.txt, border: `1px solid ${C.bord}` }} />
            <button type="button" onClick={add}
              style={{ padding: "7px 14px", borderRadius: 7, border: "none", fontSize: 12.5,
                fontWeight: 800, background: C.grn, color: "#04120a", cursor: "pointer" }}>
              Add
            </button>
          </div>
          {msg && <div style={{ color: C.mid, fontSize: 12, marginBottom: 8 }}>{msg}</div>}
          {rows.length === 0 ? (
            <div style={{ color: C.dim, fontSize: 12.5 }}>Nobody on the list yet.</div>
          ) : (
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              {rows.map(r => (
                <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center",
                  padding: "6px 0", borderBottom: `1px solid ${C.bord}44`, fontSize: 12.5 }}>
                  <span style={{ color: C.txt, fontWeight: 700, minWidth: 96 }}>{r.phone}</span>
                  <span style={{ color: C.mid, flex: 1 }}>{r.reason || "—"}</span>
                  <button type="button"
                    onClick={async () => {
                      const sb = createClient();
                      await sb.from("outbound_opt_outs").delete().eq("id", r.id);
                      load();
                    }}
                    style={{ background: "none", border: "none", color: C.dim, fontSize: 12,
                      cursor: "pointer" }}>
                    remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ScheduleEditor({ campaign: c, inputStyle, onSave }: {
  campaign: Campaign; inputStyle: React.CSSProperties;
  onSave: (patch: Record<string, unknown>) => Promise<boolean>;
}) {
  const [f, setF] = useState({
    start_date: c.start_date || "", end_date: c.end_date || "",
    window_start: c.window_start.slice(0, 5), window_end: c.window_end.slice(0, 5),
    max_concurrent: c.max_concurrent,
  });
  const [saving, setSaving] = useState(false);
  const field = (label: React.ReactNode, el: React.ReactNode) => (
    <div style={{ flex: "1 1 140px" }}>
      <label style={{ display:"block", fontSize:12, color:C.mid, marginBottom:6 }}>{label}</label>
      {el}
    </div>
  );
  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.bord}` }}>
      <div style={{ display:"flex", gap: 12, flexWrap:"wrap", marginBottom: 12 }}>
        {field("First calling day",
          <input type="date" style={inputStyle} value={f.start_date}
            onChange={e => setF(v => ({ ...v, start_date: e.target.value }))} />)}
        {field(<>Last calling day <span style={{ color: C.dim }}>(optional)</span></>,
          <input type="date" style={inputStyle} value={f.end_date} min={f.start_date || istToday()}
            onChange={e => setF(v => ({ ...v, end_date: e.target.value }))} />)}
        {field("Call from",
          <input type="time" style={inputStyle} value={f.window_start}
            onChange={e => setF(v => ({ ...v, window_start: e.target.value }))} />)}
        {field("Call until",
          <input type="time" style={inputStyle} value={f.window_end}
            onChange={e => setF(v => ({ ...v, window_end: e.target.value }))} />)}
        {field("Simultaneous calls",
          <input type="number" min={1} max={25} style={inputStyle} value={f.max_concurrent}
            onChange={e => setF(v => ({ ...v, max_concurrent: parseInt(e.target.value) || 1 }))} />)}
      </div>
      <div style={{ display:"flex", gap: 10, alignItems:"center", flexWrap:"wrap" }}>
        <button disabled={saving} onClick={async () => {
          setSaving(true);
          await onSave({
            start_date: f.start_date || null, end_date: f.end_date || null,
            window_start: f.window_start, window_end: f.window_end,
            max_concurrent: Math.min(Math.max(f.max_concurrent || 1, 1), 25),
          });
          setSaving(false);
        }} style={{
          background: C.grn, color: "#fff", border: "none", borderRadius: 8,
          padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: saving ? 0.7 : 1,
        }}>{saving ? "Saving…" : "Save schedule"}</button>
        <span style={{ fontSize: 12, color: C.dim }}>
          Times are IST. Changes apply from the dispatcher&apos;s next check, within a minute.
        </span>
      </div>
    </div>
  );
}

export default function CampaignsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    name: "", script: "", start_date: "", end_date: "",
    window_start: "10:00", window_end: "19:00", max_concurrent: 3,
  });
  const [editing, setEditing] = useState<string | null>(null);

  const [uploadFor, setUploadFor] = useState<string | null>(null);

  const loadStats = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const sb = createClient();
    const { data } = await sb.from("outbound_recipients")
      .select("campaign_id,status").in("campaign_id", ids);
    const acc: Record<string, Stats> = {};
    for (const id of ids) {
      acc[id] = { total:0, pending:0, queued:0, in_progress:0, completed:0,
                  blocked_dnd:0, opted_out:0, failed:0 };
    }
    for (const r of (data || []) as { campaign_id: string; status: string }[]) {
      const s = acc[r.campaign_id];
      if (!s) continue;
      s.total += 1;
      if (r.status in s) (s as unknown as Record<string, number>)[r.status] += 1;
    }
    setStats(acc);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) { window.location.href = "/login"; return; }
    const { data: tu } = await sb.from("tenant_users")
      .select("tenant_id").eq("user_id", auth.user.id).single();
    if (!tu) { setError("No tenant found for this account."); setLoading(false); return; }
    setTenantId(tu.tenant_id);

    const { data, error: e } = await sb.from("outbound_campaigns")
      .select("*").eq("tenant_id", tu.tenant_id).order("created_at", { ascending: false });
    if (e) setError(e.message);
    else {
      setCampaigns((data || []) as Campaign[]);
      await loadStats((data || []).map((c: Campaign) => c.id));
    }
    setLoading(false);
  }, [loadStats]);

  useEffect(() => { load(); }, [load]);

  async function createCampaign() {
    setError(""); setNotice("");
    if (!form.name.trim() || !form.script.trim()) {
      setError("Name and script are both required."); return;
    }
    if (!tenantId) return;
    if (form.window_end <= form.window_start) { setError("Call-until must be after call-from."); return; }
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      setError("Last calling day must be on or after the first."); return;
    }
    if (form.end_date && form.end_date < istToday()) { setError("Last calling day is already in the past."); return; }
    const sb = createClient();
    const { error: e } = await sb.from("outbound_campaigns").insert({
      tenant_id: tenantId,
      name: form.name.trim(),
      script: form.script.trim(),
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      window_start: form.window_start,
      window_end: form.window_end,
      max_concurrent: Math.min(form.max_concurrent || 3, 25),
    });
    if (e) {
      setError(/start_date|end_date/.test(e.message)
        ? "Calling days can't be saved on this account yet — leave both days blank for now, or contact support."
        : e.message);
      return;
    }
    setShowNew(false);
    setForm({ name:"", script:"", start_date:"", end_date:"", window_start:"10:00", window_end:"19:00", max_concurrent:3 });
    setNotice("Campaign created.");
    load();
  }

  // Start and Pause used to write outbound_campaigns.status straight from
  // the browser, walking past every guard the real endpoints enforce: a
  // consent declaration, and having any recipients at all. A campaign with
  // zero contacts could be set "running" and would sit there dialling
  // nobody with no explanation. These endpoints exist and were never called.
  async function setStatus(id: string, status: string) {
    setError(""); setNotice("");
    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    const action = status === "running" ? "start" : "pause";
    const r = await fetch(`${API}/api/campaigns/${id}/${action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setError(j.error || `Could not ${action} the campaign`);
    else {
      setNotice(j.scheduled_for
        ? `Campaign scheduled — ${j.recipients} to dial from ${fmtDay(j.scheduled_for)}.`
        : j.recipients ? `Campaign started — ${j.recipients} to dial.` : `Campaign ${action}d.`);
      load();
    }
  }

  // Dates and hours are editable after creation — the old page had no way
  // to change a window short of making a new campaign and re-uploading.
  async function saveSchedule(id: string, patch: Record<string, unknown>) {
    setError(""); setNotice("");
    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${API}/api/campaigns/${id}/schedule`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error || "Could not save the schedule"); return false; }
    setNotice("Schedule saved."); setEditing(null); load();
    return true;
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", background: C.hi, border: `1px solid ${C.bord}`,
    borderRadius: 8, padding: "10px 12px", color: C.txt, fontSize: 14,
    fontFamily: "inherit", boxSizing: "border-box",
  };

  return (
    <Shell title="Campaigns">
      <div style={{ padding: 24, maxWidth: 1000 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: 8 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: C.txt, margin: 0 }}>
            Outbound Campaigns
          </h1>
          <button onClick={() => setShowNew(v => !v)} style={{
            background: C.glow, color: "#fff", border: "none", borderRadius: 8,
            padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer",
          }}>{showNew ? "Cancel" : "+ New campaign"}</button>
        </div>
        <p style={{ color: C.mid, fontSize: 14, marginTop: 0, marginBottom: 20 }}>
          Upload a list of numbers and Hey Nikki calls them with your script.
        </p>

        {/* Dialling now runs on our own trunk. What is left is operational,
            not missing code, so the banner says which switch is off rather
            than repeating the old "three things outstanding" list. */}
        <Card style={{ borderColor: C.gold + "55", background: C.gold + "0D", marginBottom: 20 }}>
          <div style={{ display:"flex", gap: 10, alignItems:"flex-start" }}>
            <AlertTriangle size={16} />
            <div style={{ fontSize: 13, color: C.txt, lineHeight: 1.6 }}>
              <strong>Only consented lists.</strong> Campaigns dial on your own
              number, and unanswered calls get a WhatsApp follow-up
              automatically. Upload only numbers that gave you permission to
              call them — existing customers, enquiries or opt-ins. Calling
              India&apos;s DND registry without consent risks your number being
              suspended, and you confirm the list at import.
            </div>
          </div>
        </Card>

        <OptOutList tenantId={tenantId} />


        {error && (
          <Card style={{ borderColor: C.red + "55", background: C.red + "0D", marginBottom: 16 }}>
            <span style={{ color: C.red, fontSize: 13 }}>{error}</span>
          </Card>
        )}
        {notice && (
          <Card style={{ borderColor: C.grn + "55", background: C.grn + "0D", marginBottom: 16 }}>
            <span style={{ color: C.grn, fontSize: 13 }}>{notice}</span>
          </Card>
        )}

        {showNew && (
          <Card style={{ marginBottom: 20 }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, color: C.txt }}>New campaign</h3>
            <label style={{ display:"block", fontSize:12, color:C.mid, marginBottom:6 }}>
              Campaign name
            </label>
            <input style={{ ...inputStyle, marginBottom: 14 }} value={form.name}
              placeholder="e.g. Diwali offer — existing customers"
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />

            <label style={{ display:"block", fontSize:12, color:C.mid, marginBottom:6 }}>
              What should Hey Nikki say?
            </label>
            <textarea style={{ ...inputStyle, minHeight: 90, marginBottom: 14, resize: "vertical" }}
              value={form.script}
              placeholder="Introduce yourself, mention the Diwali offer of 20% off, and ask if they'd like to book an appointment this week."
              onChange={e => setForm(f => ({ ...f, script: e.target.value }))} />

            <div style={{ display:"flex", gap: 12, flexWrap:"wrap", marginBottom: 12 }}>
              <div style={{ flex:"1 1 160px" }}>
                <label style={{ display:"block", fontSize:12, color:C.mid, marginBottom:6 }}>
                  First calling day
                </label>
                <input type="date" style={inputStyle} value={form.start_date} min={istToday()}
                  onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div style={{ flex:"1 1 160px" }}>
                <label style={{ display:"block", fontSize:12, color:C.mid, marginBottom:6 }}>
                  Last calling day <span style={{ color: C.dim }}>(optional)</span>
                </label>
                <input type="date" style={inputStyle} value={form.end_date} min={form.start_date || istToday()}
                  onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>
            <div style={{ display:"flex", gap: 12, flexWrap:"wrap", marginBottom: 16 }}>
              <div style={{ flex:"1 1 130px" }}>
                <label style={{ display:"block", fontSize:12, color:C.mid, marginBottom:6 }}>
                  Call from
                </label>
                <input type="time" style={inputStyle} value={form.window_start}
                  onChange={e => setForm(f => ({ ...f, window_start: e.target.value }))} />
              </div>
              <div style={{ flex:"1 1 130px" }}>
                <label style={{ display:"block", fontSize:12, color:C.mid, marginBottom:6 }}>
                  Call until
                </label>
                <input type="time" style={inputStyle} value={form.window_end}
                  onChange={e => setForm(f => ({ ...f, window_end: e.target.value }))} />
              </div>
              <div style={{ flex:"1 1 130px" }}>
                <label style={{ display:"block", fontSize:12, color:C.mid, marginBottom:6 }}>
                  Simultaneous calls
                </label>
                <input type="number" min={1} max={25} style={inputStyle} value={form.max_concurrent}
                  onChange={e => setForm(f => ({ ...f, max_concurrent: parseInt(e.target.value) || 1 }))} />
              </div>
            </div>
            <p style={{ fontSize: 12, color: C.dim, marginTop: 0, marginBottom: 16 }}>
              Leave the days blank to dial from the moment you press Start until the
              list is done. TRAI rules restrict telemarketing hours: 10:00–19:00 is the
              safe default, and calls outside your window are refused automatically.
            </p>
            <button onClick={createCampaign} style={{
              background: C.grn, color: "#fff", border: "none", borderRadius: 8,
              padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}>Create campaign</button>
          </Card>
        )}

        {loading ? (
          <p style={{ color: C.mid }}>Loading…</p>
        ) : campaigns.length === 0 ? (
          <Card style={{ textAlign: "center", padding: 40 }}>
            <div style={{ marginBottom: 10, display: "flex", justifyContent: "center" }}><Megaphone size={28} /></div>
            <h3 style={{ color: C.txt, margin: "0 0 6px", fontSize: 17 }}>No campaigns yet</h3>
            <p style={{ color: C.mid, fontSize: 14, margin: 0 }}>
              Create one to start building your calling list.
            </p>
          </Card>
        ) : campaigns.map(c => {
          const s = stats[c.id];
          return (
            <Card key={c.id} style={{ marginBottom: 16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap: 12, flexWrap:"wrap" }}>
                <div style={{ flex: "1 1 260px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap: 10, marginBottom: 6 }}>
                    <h3 style={{ margin: 0, fontSize: 17, color: C.txt }}>{c.name}</h3>
                    <StatusPill status={c.status === "running" && c.start_date && c.start_date > istToday() ? "scheduled" : c.status} />
                  </div>
                  <p style={{ color: C.mid, fontSize: 13, margin: "0 0 8px", lineHeight: 1.5 }}>
                    {c.script.length > 150 ? c.script.slice(0, 150) + "…" : c.script}
                  </p>
                  <div style={{ fontSize: 12, color: C.dim, fontFamily: "monospace", display:"flex", gap: 10, alignItems:"center", flexWrap:"wrap" }}>
                    <span>{fmtDays(c)} · {c.window_start.slice(0,5)}–{c.window_end.slice(0,5)} IST · up to {c.max_concurrent} at once</span>
                    {c.status !== "completed" && c.status !== "cancelled" && (
                      <button onClick={() => setEditing(editing === c.id ? null : c.id)} style={{
                        background: "none", border: "none", color: C.cyn, cursor: "pointer",
                        fontSize: 12, padding: 0, fontFamily: "inherit", textDecoration: "underline",
                      }}>{editing === c.id ? "close" : "change"}</button>
                    )}
                  </div>
                  {c.status === "running" && c.start_date && c.start_date > istToday() && (
                    <div style={{ fontSize: 12, color: C.gold, marginTop: 6 }}>
                      Scheduled — dialling begins {fmtDay(c.start_date)} at {c.window_start.slice(0,5)} IST.
                    </div>
                  )}
                  {c.status === "paused" && c.end_date && c.end_date < istToday() && (
                    <div style={{ fontSize: 12, color: C.gold, marginTop: 6 }}>
                      Last calling day has passed — move the end date to continue.
                    </div>
                  )}
                </div>
                <div style={{ display:"flex", gap: 8, flexWrap:"wrap" }}>
                  <button onClick={() => setUploadFor(uploadFor === c.id ? null : c.id)}
                    style={{
                      background: C.hi, color: C.txt, border: `1px solid ${C.bord}`,
                      borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    }}>
                    {uploadFor === c.id ? "Close" : "Upload numbers"}
                  </button>
                  {c.status === "running" ? (
                    <button onClick={() => setStatus(c.id, "paused")} style={{
                      background: C.gold + "22", color: C.gold, border: `1px solid ${C.gold}44`,
                      borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    }}>Pause</button>
                  ) : (c.status === "draft" || c.status === "paused") ? (
                    <button onClick={() => setStatus(c.id, "running")} style={{
                      background: C.grn + "22", color: C.grn, border: `1px solid ${C.grn}44`,
                      borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    }}>{c.start_date && c.start_date > istToday() ? "Schedule" : "Start"}</button>
                  ) : null}
                </div>
              </div>

              {editing === c.id && (
                <ScheduleEditor campaign={c} inputStyle={inputStyle}
                  onSave={patch => saveSchedule(c.id, patch)} />
              )}

              {s && s.total > 0 && (
                <>
                  <div style={{
                    display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(88px, 1fr))",
                    gap: 10, marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.bord}`,
                  }}>
                    {[
                      { l:"Total",       v:s.total,       c:C.txt },
                      { l:"Pending",     v:s.pending,     c:C.mid },
                      { l:"Queued",      v:s.queued,      c:C.cyn },
                      { l:"On a call",   v:s.in_progress, c:C.gbr },
                      { l:"Called",      v:s.completed,   c:C.grn },
                      { l:"Failed",      v:s.failed,      c:C.red },
                      { l:"Blocked",     v:s.blocked_dnd, c:C.gold },
                      { l:"Opted out",   v:s.opted_out,   c:C.red },
                    ].map(x => (
                      <div key={x.l}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: x.c }}>{x.v}</div>
                        <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 0.4 }}>{x.l}</div>
                      </div>
                    ))}
                  </div>

                  {/* Blocked is not a failure — with no DND scrubbing provider
                      configured the dispatcher refuses every number that did not
                      submit its own enquiry, which is the safe reading of TRAI and
                      was never explained on this page. */}
                  {s.blocked_dnd > 0 && (
                    <div style={{ color: C.dim, fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}>
                      Blocked numbers did not submit their own enquiry, and DND scrubbing
                      isn&apos;t switched on — so we don&apos;t dial them. Contacts who filled in
                      your form or asked for a callback are dialled normally.
                    </div>
                  )}

                </>
              )}
              {/* Always offered: with zero recipients the list says so itself,
                  and a stats query failure no longer hides the contacts. */}
              <RecipientList campaignId={c.id} />

              {uploadFor === c.id && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.bord}` }}>
                  {/* Replaces a paste-a-list textarea. That box had no way to
                      show which line was wrong, so a 500-number paste with
                      eight bad rows failed as one opaque error. This parses
                      the file in the browser, names the bad rows by their
                      Excel row number, and takes the consent declaration the
                      dispatcher requires before it will dial anything. */}
                  <RecipientImport campaignId={c.id} onDone={() => load()} />
                  <div style={{ fontSize:12, color:C.dim, marginTop: 10 }}>
                    Indian mobiles only. Opted-out numbers are removed automatically,
                    and re-importing a corrected sheet skips anyone already added.
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </Shell>
  );
}
