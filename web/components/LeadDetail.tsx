"use client";

/**
 * Lead detail drawer — owner, value, tags and the activity timeline.
 *
 * Migration 017 added leads.assigned_to, leads.deal_value_paise, leads.tags
 * and the lead_activities table, and no screen has ever shown any of them.
 * The leads page reads exactly one of the columns it paid for: stage. So a
 * business could not say who owns a lead, what it is worth, or what happened
 * to it last week — which is most of what a CRM is for.
 *
 * Reads and writes Supabase directly with the user's JWT. RLS
 * (leads_* in 011, lead_activities_* in 017) enforces tenant isolation in
 * Postgres, so no shared secret ships to the browser — the same pattern the
 * leads page already uses.
 *
 * Every change writes a lead_activities row. That table has sat empty since
 * it was created because nothing wrote to it; an audit trail nobody records
 * into is worse than none, because it implies a history that is not there.
 */

import { useState, useEffect, useCallback } from "react";
import { createClient } from "../lib/supabase";
import { NIKKI } from "../lib/brand";
import { X, Plus, Loader2, Tag as TagIcon, IndianRupee, User, Clock } from "lucide-react";

const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
  grn: NIKKI.emerald, red: NIKKI.red, gold: NIKKI.gold,
};

const STAGES = ["new", "contacted", "qualified", "won", "lost"];

type Seat = { user_id: string; display_name: string | null; role: string };
type Activity = {
  id: string; type: string; description: string;
  created_at: string; created_by: string | null;
};

export default function LeadDetail({
  lead, onClose, onSaved,
}: { lead: any; onClose: () => void; onSaved: () => void }) {
  const [seats, setSeats]         = useState<Seat[]>([]);
  const [acts, setActs]           = useState<Activity[]>([]);
  const [assigned, setAssigned]   = useState<string>(lead.assigned_to || "");
  const [stage, setStage]         = useState<string>(lead.stage || "new");
  const [value, setValue]         = useState<string>(
    lead.deal_value_paise ? String(Math.round(lead.deal_value_paise / 100)) : "");
  const [tags, setTags]           = useState<string[]>(lead.tags || []);
  const [tagDraft, setTagDraft]   = useState("");
  const [note, setNote]           = useState("");
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState("");

  const load = useCallback(async () => {
    const sb = createClient();
    const [seatRes, { data: a }] = await Promise.all([
      sb.from("tenant_users").select("user_id, display_name, role").eq("tenant_id", lead.tenant_id),
      sb.from("lead_activities").select("*").eq("lead_id", lead.id)
        .order("created_at", { ascending: false }).limit(50),
    ]);

    // display_name arrives with migration 020. Until that is applied
    // PostgREST rejects the whole select with 42703 and the owner dropdown
    // would come back empty — looking like "this account has no teammates"
    // rather than "a column is missing". Retry without it so assignment
    // works either way; names simply appear as role + id stub until then.
    if (seatRes.error) {
      const { data: basic } = await sb.from("tenant_users")
        .select("user_id, role").eq("tenant_id", lead.tenant_id);
      setSeats(((basic || []) as any[]).map(b => ({ ...b, display_name: null })) as Seat[]);
    } else {
      setSeats((seatRes.data || []) as Seat[]);
    }
    setActs((a || []) as Activity[]);
  }, [lead.id, lead.tenant_id]);

  useEffect(() => { load(); }, [load]);

  const seatName = (id: string | null) => {
    if (!id) return "Unassigned";
    const s = seats.find(x => x.user_id === id);
    // Falls back to a short id rather than the full uuid: unreadable either
    // way, but a 8-char stub does not blow the layout out.
    return s?.display_name || s?.role || `${id.slice(0, 8)}…`;
  };

  /** One activity row per change, with the human-readable before/after. */
  const logActivity = async (sb: any, type: string, description: string, userId: string | null) => {
    const { error } = await sb.from("lead_activities")
      .insert({ lead_id: lead.id, type, description, created_by: userId });
    if (error) console.error("[lead] activity log failed:", error.message);
  };

  const save = async () => {
    setBusy(true); setErr("");
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    const uid = user?.id ?? null;

    // Rupees in the box, paise in the column. Anything non-numeric becomes 0
    // rather than NaN, which Postgres rejects for an integer column.
    const paise = Math.max(0, Math.round((parseFloat(value) || 0) * 100));
    const patch: Record<string, any> = {
      stage,
      assigned_to: assigned || null,
      deal_value_paise: paise,
      tags,
    };

    const { error } = await sb.from("leads").update(patch).eq("id", lead.id);
    if (error) { setErr(error.message); setBusy(false); return; }

    // Log only what actually changed — a timeline of no-ops is noise.
    if (stage !== lead.stage) {
      await logActivity(sb, "stage_change", `Stage: ${lead.stage} → ${stage}`, uid);
    }
    if ((assigned || null) !== (lead.assigned_to || null)) {
      await logActivity(sb, "assignment",
        `Assigned to ${seatName(assigned || null)}`, uid);
    }
    if (paise !== (lead.deal_value_paise || 0)) {
      await logActivity(sb, "value_change",
        `Deal value: ₹${((lead.deal_value_paise || 0) / 100).toLocaleString("en-IN")} → ₹${(paise / 100).toLocaleString("en-IN")}`, uid);
    }
    if (JSON.stringify(tags) !== JSON.stringify(lead.tags || [])) {
      await logActivity(sb, "tag_change", `Tags: ${tags.join(", ") || "none"}`, uid);
    }
    if (note.trim()) {
      await logActivity(sb, "note", note.trim(), uid);
      setNote("");
    }

    setBusy(false);
    await load();
    onSaved();
  };

  const addTag = () => {
    const t = tagDraft.trim().toLowerCase();
    if (!t || tags.includes(t)) { setTagDraft(""); return; }
    setTags([...tags, t]); setTagDraft("");
  };

  const label: React.CSSProperties = {
    display: "block", fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
    color: C.mid, marginBottom: 6, textTransform: "uppercase",
  };
  const field: React.CSSProperties = {
    width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 8,
    border: `1px solid ${C.bord}`, background: C.surf, color: C.txt, outline: "none",
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
        display: "flex", justifyContent: "flex-end", zIndex: 50,
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(460px, 100%)", height: "100%", background: C.hi,
          borderLeft: `1px solid ${C.bord}`, overflowY: "auto", padding: 24,
        }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 19, color: C.txt }}>{lead.name || "Unknown caller"}</h2>
            <div style={{ color: C.mid, fontSize: 13, fontFamily: "monospace", marginTop: 2 }}>{lead.phone}</div>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ background: "none", border: "none", cursor: "pointer", color: C.mid, padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {lead.interest && (
          <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 8,
                        padding: 12, fontSize: 13, color: C.mid, marginBottom: 18 }}>
            {lead.interest}
          </div>
        )}

        {err && (
          <div role="alert" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: C.red,
                                     padding: "10px 12px", borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{err}</div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={label}><User size={11} style={{ verticalAlign: -1 }} /> Owner</label>
          <select value={assigned} onChange={e => setAssigned(e.target.value)} style={field}>
            <option value="">Unassigned</option>
            {seats.map(s => (
              <option key={s.user_id} value={s.user_id}>
                {s.display_name || `${s.role} · ${s.user_id.slice(0, 8)}…`}
              </option>
            ))}
          </select>
          {seats.length === 0 && (
            <div style={{ fontSize: 12, color: C.gold, marginTop: 6 }}>
              No seats on this account yet — add teammates to assign leads.
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Stage</label>
            <select value={stage} onChange={e => setStage(e.target.value)} style={field}>
              {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}><IndianRupee size={11} style={{ verticalAlign: -1 }} /> Deal value</label>
            <input value={value} onChange={e => setValue(e.target.value)}
              inputMode="decimal" placeholder="0" style={field} />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={label}><TagIcon size={11} style={{ verticalAlign: -1 }} /> Tags</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {tags.map(t => (
              <span key={t} style={{
                background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 20,
                padding: "4px 10px", fontSize: 12, color: C.txt,
                display: "inline-flex", alignItems: "center", gap: 6,
              }}>
                {t}
                <button onClick={() => setTags(tags.filter(x => x !== t))} aria-label={`Remove ${t}`}
                  style={{ background: "none", border: "none", cursor: "pointer", color: C.dim, padding: 0, lineHeight: 1 }}>
                  <X size={12} />
                </button>
              </span>
            ))}
            {tags.length === 0 && <span style={{ fontSize: 12, color: C.dim }}>No tags</span>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={tagDraft} onChange={e => setTagDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
              placeholder="add a tag" style={{ ...field, flex: 1 }} />
            <button onClick={addTag} style={{
              background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 8,
              padding: "0 12px", cursor: "pointer", color: C.txt,
            }}><Plus size={15} /></button>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={label}>Add a note</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
            placeholder="What happened on this lead?"
            style={{ ...field, resize: "vertical" }} />
        </div>

        <button onClick={save} disabled={busy} style={{
          width: "100%", padding: 12, borderRadius: 10, border: "none",
          background: busy ? C.dim : C.grn, color: "#fff", fontWeight: 700,
          fontSize: 14, cursor: busy ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          marginBottom: 22,
        }}>
          {busy ? <><Loader2 size={15} /> Saving…</> : "Save changes"}
        </button>

        <div>
          <label style={label}><Clock size={11} style={{ verticalAlign: -1 }} /> Activity</label>
          {acts.length === 0 ? (
            <div style={{ fontSize: 13, color: C.dim }}>
              Nothing recorded yet. Changes you make here appear as a timeline.
            </div>
          ) : (
            <div style={{ borderLeft: `2px solid ${C.bord}`, paddingLeft: 12 }}>
              {acts.map(a => (
                <div key={a.id} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: C.txt }}>{a.description}</div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                    {a.type.replace(/_/g, " ")} · {new Date(a.created_at).toLocaleString("en-IN")}
                    {a.created_by ? ` · ${seatName(a.created_by)}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
