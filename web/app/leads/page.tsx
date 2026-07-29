"use client";

/**
 * Leads / CRM.
 *
 * Every inbound call produces a lead (see voice-pipeline/app/exotel/leads.py),
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

import { useState, useEffect, useCallback } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";

const C = {
  bg:"#07070D", surf:"#0F0F1A", hi:"#161625", bord:"#1E1E35",
  glow:"#8B5CF6", gbr:"#A78BFA", gold:"#F59E0B",
  grn:"#10B981", red:"#EF4444", cyn:"#06B6D4",
  txt:"#EEEEFF", mid:"#8888AA", dim:"#44445A",
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
};

const STAGES = [
  { id: "new",       label: "New",       color: C.cyn  },
  { id: "contacted", label: "Contacted", color: C.gbr  },
  { id: "qualified", label: "Qualified", color: C.gold },
  { id: "won",       label: "Won",       color: C.grn  },
  { id: "lost",      label: "Lost",      color: C.dim  },
];

const INTENT_LABELS: Record<string, string> = {
  book_appointment:     "Wants to book",
  reschedule:           "Reschedule",
  cancel:               "Cancel",
  pricing_enquiry:      "Asked pricing",
  service_enquiry:      "Service question",
  location_hours:       "Location / hours",
  complaint:            "Complaint",
  follow_up:            "Follow-up",
  spam_or_wrong_number: "Spam / wrong number",
  other:                "Other",
};

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

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) { window.location.href = "/login"; return; }

    const { data, error: e } = await sb.from("leads")
      .select("*")
      .order("last_contacted_at", { ascending: false })
      .limit(500);
    if (e) setError(e.message);
    else setLeads((data || []) as Lead[]);
    setLoading(false);
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

  const counts = STAGES.reduce((acc, s) => {
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
          {STAGES.map(s => (
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
            <div style={{ fontSize: 32, marginBottom: 10 }}>👥</div>
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
              <div key={l.id} style={{
                background: C.surf, border: `1px solid ${C.bord}`,
                borderRadius: 12, padding: 16,
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
                      {l.intent ? (INTENT_LABELS[l.intent] || l.intent) : "—"}
                      {l.interest && <span style={{ color: C.txt }}> · {l.interest}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
                      Last contact {timeAgo(l.last_contacted_at)}
                    </div>

                    {editing === l.id ? (
                      <div style={{ marginTop: 10 }}>
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
                      <div style={{ marginTop: 8 }}>
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

                  {/* stage control */}
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "flex-start" }}>
                    {STAGES.map(s => (
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
