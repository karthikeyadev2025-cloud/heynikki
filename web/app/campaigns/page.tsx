"use client";

/**
 * Outbound telecalling campaigns.
 *
 * The API layer for this (api-server/src/outbound.ts) has existed for a
 * while with solid TRAI-compliance logic -- DND scrubbing, calling-hours
 * enforcement, opt-out tracking -- but nothing in the app ever called it.
 * There was no way for a user to create a campaign or upload numbers.
 * This page is that missing interface.
 *
 * SECURITY NOTE -- why this talks to Supabase directly instead of the API:
 * the existing dashboard pages authenticate to api-server by sending
 * NEXT_PUBLIC_INTERNAL_SECRET from the browser. Anything prefixed
 * NEXT_PUBLIC_ is compiled into the client bundle, so that "secret" is
 * readable by anyone who views source -- meaning those endpoints are
 * effectively open. The outbound_* tables already have proper row-level
 * security keyed to tenant membership, so this page uses the logged-in
 * user's own JWT instead. Tenant isolation is enforced by Postgres, and
 * no shared secret ships to the browser.
 *
 * Phone normalization and opt-out filtering are reimplemented client-side
 * here to match api-server/src/outbound.ts exactly (E.164 +91). If that
 * server-side logic changes, this must change with it.
 *
 * IMPORTANT -- campaigns created here cannot place calls yet. Three
 * pieces are still missing downstream: the /dispatch endpoint in the
 * voice pipeline, the outbound-dispatcher worker (written but never
 * deployed), and outbound calling enabled on the Exotel account. The
 * banner at the top of this page states that plainly rather than letting
 * someone upload 5,000 numbers and wonder why nothing dials.
 */

import { useState, useEffect, useCallback } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import { NIKKI } from "../../lib/brand";
import { AlertTriangle, Megaphone } from "lucide-react";

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
  max_concurrent: number;
  created_at: string;
};

type Stats = {
  total: number; pending: number; queued: number; in_progress: number;
  completed: number; blocked_dnd: number; opted_out: number; failed: number;
};

/** Mirrors normalize() in api-server/src/outbound.ts -- keep in sync. */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 13 && digits.startsWith("91")) return `+${digits}`;
  return null;
}

/**
 * Accepts pasted CSV or a plain list. Tolerates "phone,name" or just
 * phones, one per line, with or without a header row -- people paste
 * whatever their spreadsheet gives them.
 */
function parseRecipients(text: string): { phone: string; first_name: string | null; raw: string }[] {
  const out: { phone: string; first_name: string | null; raw: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/[,\t;]/).map(p => p.trim());
    // skip an obvious header row
    if (/^(phone|mobile|number|contact)$/i.test(parts[0])) continue;
    const phone = normalizePhone(parts[0]);
    out.push({
      phone: phone || "",
      first_name: parts[1] || null,
      raw: parts[0],
    });
  }
  return out;
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{
    background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12,
    padding: 20, ...style,
  }}>{children}</div>;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: C.mid, scrubbing: C.gold, running: C.grn,
    paused: C.gold, completed: C.cyn, cancelled: C.red,
  };
  const col = map[status] || C.mid;
  return <span style={{
    background: col + "22", color: col, border: `1px solid ${col}44`,
    fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
    textTransform: "uppercase", letterSpacing: 0.5,
  }}>{status}</span>;
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
    name: "", script: "", window_start: "10:00", window_end: "19:00", max_concurrent: 3,
  });

  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const [uploadText, setUploadText] = useState("");
  const [uploading, setUploading] = useState(false);

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
    const sb = createClient();
    const { error: e } = await sb.from("outbound_campaigns").insert({
      tenant_id: tenantId,
      name: form.name.trim(),
      script: form.script.trim(),
      window_start: form.window_start,
      window_end: form.window_end,
      max_concurrent: Math.min(form.max_concurrent || 3, 25),
    });
    if (e) { setError(e.message); return; }
    setShowNew(false);
    setForm({ name:"", script:"", window_start:"10:00", window_end:"19:00", max_concurrent:3 });
    setNotice("Campaign created.");
    load();
  }

  async function uploadRecipients(campaignId: string) {
    setError(""); setNotice(""); setUploading(true);
    const sb = createClient();
    try {
      const parsed = parseRecipients(uploadText);
      if (!parsed.length) { setError("Nothing to upload — paste numbers first."); return; }
      if (parsed.length > 10000) { setError("Max 10,000 numbers per upload."); return; }

      const invalid = parsed.filter(p => !p.phone);
      const valid   = parsed.filter(p => p.phone);
      if (!valid.length) { setError("No valid Indian mobile numbers found."); return; }

      // Filter against this tenant's opt-out list (RLS scopes this to us).
      const { data: outs } = await sb.from("outbound_opt_outs")
        .select("phone").eq("tenant_id", tenantId).in("phone", valid.map(v => v.phone));
      const blocked = new Set((outs || []).map((o: { phone: string }) => o.phone));

      const rows = valid.filter(v => !blocked.has(v.phone)).map(v => ({
        campaign_id: campaignId,
        tenant_id:   tenantId,
        phone:       v.phone,
        first_name:  v.first_name,
        metadata:    {},
        status:      "pending",
      }));

      if (!rows.length) { setError("Every number was already opted out."); return; }

      const { error: e } = await sb.from("outbound_recipients").insert(rows);
      if (e) { setError(e.message); return; }

      setNotice(
        `Uploaded ${rows.length}. ` +
        (invalid.length ? `${invalid.length} invalid (skipped). ` : "") +
        (blocked.size ? `${blocked.size} opted out (skipped).` : "")
      );
      setUploadText(""); setUploadFor(null);
      load();
    } finally {
      setUploading(false);
    }
  }

  async function setStatus(id: string, status: string) {
    setError(""); setNotice("");
    const sb = createClient();
    const { error: e } = await sb.from("outbound_campaigns")
      .update({ status }).eq("id", id);
    if (e) setError(e.message);
    else { setNotice(`Campaign ${status}.`); load(); }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", background: C.hi, border: `1px solid ${C.bord}`,
    borderRadius: 8, padding: "10px 12px", color: C.txt, fontSize: 14,
    fontFamily: "inherit", boxSizing: "border-box",
  };

  return (
    <Shell>
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

        {/* Honest status banner -- dispatch genuinely isn't wired yet. */}
        <Card style={{ borderColor: C.gold + "55", background: C.gold + "0D", marginBottom: 20 }}>
          <div style={{ display:"flex", gap: 10, alignItems:"flex-start" }}>
            <AlertTriangle size={16} />
            <div style={{ fontSize: 13, color: C.txt, lineHeight: 1.6 }}>
              <strong>Calls don&apos;t dial yet.</strong> You can build campaigns and
              upload numbers now — they&apos;re stored safely and opt-outs are
              respected — but three things are still outstanding before anything
              actually rings: the dispatch endpoint in the voice pipeline, the
              dispatcher worker, and outbound calling being enabled on the Exotel
              account (Exotel must switch that on; it&apos;s off by default).
            </div>
          </div>
        </Card>

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
              TRAI rules restrict telemarketing hours. 10:00–19:00 is the safe
              default; calls outside your window are refused automatically.
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
                    <StatusPill status={c.status} />
                  </div>
                  <p style={{ color: C.mid, fontSize: 13, margin: "0 0 8px", lineHeight: 1.5 }}>
                    {c.script.length > 150 ? c.script.slice(0, 150) + "…" : c.script}
                  </p>
                  <div style={{ fontSize: 12, color: C.dim, fontFamily: "monospace" }}>
                    {c.window_start}–{c.window_end} IST · up to {c.max_concurrent} at once
                  </div>
                </div>
                <div style={{ display:"flex", gap: 8, flexWrap:"wrap" }}>
                  <button onClick={() => { setUploadFor(uploadFor === c.id ? null : c.id); setUploadText(""); }}
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
                    }}>Start</button>
                  ) : null}
                </div>
              </div>

              {s && s.total > 0 && (
                <div style={{
                  display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(88px, 1fr))",
                  gap: 10, marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.bord}`,
                }}>
                  {[
                    { l:"Total",     v:s.total,       c:C.txt },
                    { l:"Pending",   v:s.pending,     c:C.mid },
                    { l:"Queued",    v:s.queued,      c:C.cyn },
                    { l:"Called",    v:s.completed,   c:C.grn },
                    { l:"DND",       v:s.blocked_dnd, c:C.gold },
                    { l:"Opted out", v:s.opted_out,   c:C.red },
                  ].map(x => (
                    <div key={x.l}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: x.c }}>{x.v}</div>
                      <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 0.4 }}>{x.l}</div>
                    </div>
                  ))}
                </div>
              )}

              {uploadFor === c.id && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.bord}` }}>
                  <label style={{ display:"block", fontSize:12, color:C.mid, marginBottom:6 }}>
                    Paste numbers — one per line. Optionally add a name after a comma.
                  </label>
                  <textarea style={{ ...inputStyle, minHeight: 130, resize:"vertical", fontFamily:"monospace", fontSize:13 }}
                    value={uploadText}
                    onChange={e => setUploadText(e.target.value)}
                    placeholder={"9876543210, Ramesh\n8885490495, Lakshmi\n+919123456789"} />
                  <div style={{ display:"flex", gap:10, alignItems:"center", marginTop: 12, flexWrap:"wrap" }}>
                    <button onClick={() => uploadRecipients(c.id)} disabled={uploading} style={{
                      background: uploading ? C.dim : C.glow, color:"#fff", border:"none",
                      borderRadius: 8, padding:"9px 18px", fontSize:13, fontWeight:700,
                      cursor: uploading ? "not-allowed" : "pointer",
                    }}>{uploading ? "Uploading…" : "Upload"}</button>
                    <span style={{ fontSize:12, color:C.dim }}>
                      Indian mobiles only. Opted-out numbers are removed automatically.
                    </span>
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
