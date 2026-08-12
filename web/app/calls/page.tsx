// app/calls/page.tsx — Call History, Recordings & Transcripts
"use client";
import { useState, useEffect, useCallback } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import type { CallRecord } from "../../lib/supabase";
import { Check, X, Bot, User, Phone } from "lucide-react";
import { NIKKI } from "../../lib/brand";

const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: NIKKI.gold,
  grn: NIKKI.emerald, red: NIKKI.red, cyn: NIKKI.cyan,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

function IntentBadge({ intent }: { intent: string }) {
  const map: Record<string, string> = {
    appointment: C.grn, enquiry: C.cyn, callback: C.gold,
    transfer: C.gbr, emergency: C.red, unknown: C.dim,
  };
  const col = map[intent] || C.dim;
  return (
    <span style={{ background: col + "22", color: col, border: "1px solid " + col + "44",
      borderRadius: 4, padding: "2px 7px", fontSize: 10, fontWeight: 700,
      textTransform: "uppercase", letterSpacing: "0.07em" }}>
      {intent || "unknown"}
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

function CallDetail({ call, onClose }: { call: CallRecord; onClose: () => void }) {
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
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
                `Intent: ${call.intent || "Unknown"}`,
                call.appointment_created ? "Appointment Booked" : null,
                call.wa_sent ? "WhatsApp Sent" : null,
                "Call Ended",
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

          {/* Recording */}
          {call.recording_url && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: C.mid, fontSize: 11, fontWeight: 800,
                textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                Recording
              </div>
              <audio controls src={call.recording_url} style={{ width: "100%" }} />
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

// CSV export — generates a UTF-8 CSV with BOM so Excel opens it cleanly
// without "Save in CSV format?" prompts and without mangling Telugu /
// any other non-ASCII text.
function exportCsv(rows: CallRecord[]) {
  if (rows.length === 0) return;

  const cols: { key: keyof CallRecord; label: string; map?: (v: any, row: CallRecord) => string }[] = [
    { key: "created_at",       label: "Date",         map: v => new Date(v).toLocaleString("en-IN") },
    { key: "caller_number",    label: "Caller" },
    { key: "direction",        label: "Direction" },
    { key: "status",           label: "Status" },
    { key: "intent",           label: "Intent" },
    { key: "duration_seconds", label: "Duration (s)" },
    { key: "transcript",       label: "Transcript",   map: v => (v || "").toString().replace(/\s+/g, " ").slice(0, 8000) },
  ];

  const escape = (val: any) => {
    if (val === null || val === undefined) return "";
    const s = String(val);
    // RFC 4180: quote if contains comma, quote, or newline; escape quotes by doubling
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = cols.map(c => escape(c.label)).join(",");
  const body   = rows.map(r =>
    cols.map(c => escape(c.map ? c.map((r as any)[c.key], r) : (r as any)[c.key])).join(",")
  ).join("\n");

  // UTF-8 BOM so Excel auto-detects encoding
  const csv  = "\uFEFF" + header + "\n" + body;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href     = url;
  a.download = `nikki-calls-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function CallsPage() {
  const [calls, setCalls]         = useState<CallRecord[]>([]);
  const [selected, setSelected]   = useState<CallRecord | null>(null);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState("all");
  const [search, setSearch]       = useState("");
  const [tenantId, setTenantId]   = useState<string | null>(null);

  const fetchCalls = useCallback(async (tid: string) => {
    const sb = createClient();
    let q = sb.from("calls").select("*").eq("tenant_id", tid)
      .order("created_at", { ascending: false }).limit(100);
    if (filter !== "all") q = q.eq("intent", filter);
    const { data } = await q;
    setCalls(data || []);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { window.location.href = "/login"; return; }
      const { data: tu } = await sb.from("tenant_users")
        .select("tenant_id").eq("user_id", data.user.id).single();
      if (tu) { setTenantId(tu.tenant_id); fetchCalls(tu.tenant_id); }
    });
  }, []);

  useEffect(() => {
    if (tenantId) fetchCalls(tenantId);
  }, [filter, tenantId, fetchCalls]);

  const filtered = calls.filter(c =>
    !search || c.caller_number?.includes(search) ||
    c.intent?.includes(search.toLowerCase())
  );

  return (
    <Shell title="Call History">
      {selected && <CallDetail call={selected} onClose={() => setSelected(null)} />}

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by number or intent..."
          style={{ maxWidth: 240 }} />
        <div style={{ display: "flex", gap: 6 }}>
          {["all","appointment","enquiry","callback","transfer"].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: "7px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700,
              background: filter === f ? C.glow + "66" : C.hi,
              color: filter === f ? C.gbr : C.mid,
              border: "1px solid " + (filter === f ? C.glow : C.bord),
            }}>{f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}</button>
          ))}
        </div>
        <span style={{ color: C.dim, fontSize: 12, marginLeft: "auto" }}>
          {filtered.length} calls
        </span>
        <button
          onClick={() => exportCsv(filtered)}
          disabled={filtered.length === 0}
          title="Download as CSV (Excel / Sheets compatible)"
          style={{
            padding: "7px 14px", borderRadius: 7, fontSize: 12, fontWeight: 700,
            background: filtered.length === 0 ? C.hi : C.grn + "22",
            color: filtered.length === 0 ? C.dim : C.grn,
            border: "1px solid " + (filtered.length === 0 ? C.bord : C.grn + "66"),
            cursor: filtered.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          ↓ Export CSV
        </button>
      </div>

      <div style={{ background: C.surf, border: "1px solid " + C.bord, borderRadius: 10, overflow: "hidden" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 48, color: C.mid }}>Loading calls...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: C.dim }}>
            <div style={{ marginBottom: 10, display: "flex", justifyContent: "center" }}><Phone size={28} /></div>
            <div>No calls yet. Set up your voice profile to start receiving calls.</div>
            <a href="/setup" style={{ color: C.glow, fontSize: 13, display: "block", marginTop: 8 }}>
              Set up now →
            </a>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.hi }}>
                {["Caller","Direction","Duration","Intent","WA Sent","Appt","Time",""].map(h => (
                  <th key={h} style={{ color: C.dim, fontSize: 10, fontWeight: 700,
                    textTransform: "uppercase", letterSpacing: "0.08em",
                    padding: "10px 12px", textAlign: "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(call => (
                <tr key={call.id}
                  style={{ borderBottom: "1px solid " + C.bord + "44", cursor: "pointer" }}
                  onClick={() => setSelected(call)}
                  onMouseEnter={e => (e.currentTarget.style.background = C.hi)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <td style={{ padding: "10px 12px", color: C.txt, fontSize: 13, fontWeight: 600 }}>
                    {call.caller_number || "Unknown"}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ color: call.direction === "inbound" ? C.grn : C.gold,
                      fontSize: 11, fontWeight: 600 }}>
                      {call.direction === "inbound" ? "↙ Inbound" : "↗ Outbound"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px", color: C.mid, fontSize: 12 }}>
                    {formatDur(call.duration_seconds)}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <IntentBadge intent={call.intent || "unknown"} />
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
                    <span style={{ color: C.glow, fontSize: 12 }}>View →</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
