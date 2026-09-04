"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase";
import { NIKKI } from "../../lib/brand";
import { Check, ClipboardCopy, Key, BarChart3, Clock, BookOpen } from "lucide-react";

const J = {
  bg: NIKKI.bg, vault: NIKKI.vault, surface: NIKKI.surface,
  border: NIKKI.border, borderHi: NIKKI.borderHi,
  mercury: NIKKI.teal, surya: NIKKI.terracotta, chandra: NIKKI.text,
  textMid: NIKKI.textMid, textDim: NIKKI.textDim, red: NIKKI.red,
  grad: NIKKI.gradient,
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

interface ApiKey {
  id:         string;
  name:       string;
  prefix:     string;
  scopes:     string[];
  mode:       string;
  last_used_at: string | null;
  request_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

// Only what the API actually checks (requireScope in api-server). The
// former "appointments.write" and "webhook.subscribe" entries gated nothing:
// every /api/v1 route is a GET and no webhook subscription endpoint exists,
// so granting them was a promise the key could not keep.
const AVAILABLE_SCOPES = [
  { id: "calls.read",         label: "Read calls",            hint: "GET /api/v1/calls, /api/v1/calls/:id", recommended: true },
  { id: "appointments.read",  label: "Read appointments",     hint: "GET /api/v1/appointments",             recommended: true },
];

export default function ApiKeysPage() {
  const [keys, setKeys]               = useState<ApiKey[]>([]);
  const [tenantId, setTenantId]       = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [issuing, setIssuing]         = useState(false);
  const [newKey, setNewKey]           = useState<{ key: string; name: string; expires_at: string | null } | null>(null);
  const [error, setError]             = useState("");
  const [revokeError, setRevokeError] = useState("");
  const [revoking, setRevoking]       = useState<string | null>(null);

  // Issue form
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [name, setName]                   = useState("");
  const [chosenScopes, setChosenScopes]   = useState<string[]>(["calls.read", "appointments.read"]);
  const [expiresIn, setExpiresIn]         = useState("never");

  useEffect(() => {
    (async () => {
      const sb = createClient();
      const { data: user } = await sb.auth.getUser();
      if (!user.user) { window.location.href = "/login"; return; }

      const { data: tu } = await sb.from("tenant_users")
        .select("tenant_id").eq("user_id", user.user.id).single();
      if (!tu) return;
      setTenantId(tu.tenant_id);

      const { data: ks } = await sb.from("api_keys")
        .select("id, name, prefix, scopes, mode, last_used_at, request_count, expires_at, revoked_at, created_at")
        .eq("tenant_id", tu.tenant_id)
        .order("created_at", { ascending: false });
      setKeys(ks || []);
      setLoading(false);
    })();
  }, []);

  async function issueKey(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId || !name.trim()) return;
    setIssuing(true);
    setError("");

    const sb = createClient();

    let expires_at: string | null = null;
    if (expiresIn !== "never") {
      const days = parseInt(expiresIn, 10);
      expires_at = new Date(Date.now() + days * 86400000).toISOString();
    }

    try {
      // Session auth, not a shared secret. The old header shipped
      // NEXT_PUBLIC_INTERNAL_SECRET — a server-to-server secret compiled into
      // browser JavaScript — and was empty, so this never worked at all.
      // The tenant and creator come from the session server-side; only
      // name, scopes and expires_at are the caller's to choose.
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(`${API_URL}/api/keys/mine`, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          Authorization:   `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          name:   name.trim(),
          scopes: chosenScopes,
          expires_at,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.key) throw new Error(j.error || "Failed to issue key");

      setNewKey({ key: j.key, name: j.name || name.trim(), expires_at: j.expires_at ?? expires_at });
      setShowIssueForm(false);
      setName("");
      setExpiresIn("never");
      // Refresh list
      const { data: ks } = await sb.from("api_keys")
        .select("id, name, prefix, scopes, mode, last_used_at, request_count, expires_at, revoked_at, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      setKeys(ks || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIssuing(false);
    }
  }

  async function revokeKey(id: string, label: string) {
    if (!confirm(`Revoke "${label}"? Any integration using it will immediately stop working.`)) return;
    setRevokeError("");
    setRevoking(id);
    try {
      const sb = createClient();
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(`${API_URL}/api/keys/mine/${id}/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:  `Bearer ${session?.access_token}`,
        },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || `Could not revoke "${label}" (${r.status})`);
      setKeys(ks => ks.map(k => k.id === id ? { ...k, revoked_at: new Date().toISOString() } : k));
    } catch (e: any) {
      setRevokeError(e.message || `Could not revoke "${label}"`);
    } finally {
      setRevoking(null);
    }
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div style={{ minHeight: "100vh", background: J.bg, color: J.chandra, padding: 24 }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
          <div>
            <Link href="/dashboard" style={{ color: J.textMid, fontSize: 13, textDecoration: "none" }}>
              ← Dashboard
            </Link>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: J.chandra, marginTop: 8 }}>
              API Keys
            </h1>
            <p style={{ color: J.textMid, fontSize: 14, marginTop: 4 }}>
              For integrating Nikki with your CRM, Zapier, or custom backend.
            </p>
          </div>
          {!showIssueForm && !newKey && (
            <button
              onClick={() => setShowIssueForm(true)}
              style={{
                padding: "10px 18px", background: J.grad, color: J.bg,
                border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer",
              }}>
              + Issue new key
            </button>
          )}
        </div>

        {/* New-key one-time reveal */}
        {newKey && (
          <div style={{
            background: J.vault, border: `1px solid ${J.mercury}`,
            borderRadius: 16, padding: 24, marginBottom: 24,
          }}>
            <div style={{ color: J.mercury, fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Check size={12} /> Key created — copy it now</span>
            </div>
            <p style={{ color: J.textMid, fontSize: 13, marginBottom: 16 }}>
              <strong style={{ color: J.chandra }}>{newKey.name}</strong>
              {newKey.expires_at ? ` — expires ${fmtDate(newKey.expires_at)}` : " — never expires"}.
              This key is shown only once and cannot be recovered. Copy it to a password
              manager or your integration's environment file now.
            </p>
            <div style={{
              background: J.bg, border: `1px solid ${J.border}`,
              padding: 14, borderRadius: 8, fontFamily: "monospace",
              fontSize: 13, color: J.chandra, wordBreak: "break-all", marginBottom: 16,
            }}>{newKey.key}</div>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => { navigator.clipboard.writeText(newKey.key); }}
                style={{
                  padding: "10px 18px", background: J.surface,
                  border: `1px solid ${J.borderHi}`, color: J.chandra,
                  borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: "pointer",
                }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ClipboardCopy size={13} /> Copy</span></button>
              <button
                onClick={() => setNewKey(null)}
                style={{
                  padding: "10px 18px", background: J.grad, color: J.bg,
                  border: "none", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: "pointer",
                }}>I've saved it — done</button>
            </div>
          </div>
        )}

        {/* Issue form */}
        {showIssueForm && (
          <form onSubmit={issueKey} style={{
            background: J.vault, border: `1px solid ${J.border}`,
            borderRadius: 16, padding: 24, marginBottom: 24,
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: J.chandra, marginBottom: 16 }}>
              Issue new API key
            </h2>

            <label style={{ display: "block", fontSize: 11, color: J.textMid, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
              Name (so you can identify it later)
            </label>
            <input
              type="text" required value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Zapier production, CRM sync, mobile app"
              style={{
                width: "100%", padding: "12px 14px", fontSize: 14,
                background: J.surface, border: `1px solid ${J.borderHi}`,
                borderRadius: 10, color: J.chandra, marginBottom: 20, outline: "none",
              }} />

            <label style={{ display: "block", fontSize: 11, color: J.textMid, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
              Permissions
            </label>
            <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
              {AVAILABLE_SCOPES.map(s => (
                <label key={s.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                  background: chosenScopes.includes(s.id) ? J.mercury + "11" : J.surface,
                  border: `1px solid ${chosenScopes.includes(s.id) ? J.mercury + "55" : J.borderHi}`,
                  borderRadius: 8, cursor: "pointer", fontSize: 13,
                }}>
                  <input
                    type="checkbox" checked={chosenScopes.includes(s.id)}
                    onChange={() => setChosenScopes(cur =>
                      cur.includes(s.id) ? cur.filter(x => x !== s.id) : [...cur, s.id]
                    )} />
                  <span style={{ color: J.chandra, fontWeight: 600 }}>{s.label}</span>
                  {s.recommended && <span style={{ color: J.mercury, fontSize: 11 }}>recommended</span>}
                  <span style={{ color: J.textDim, fontSize: 11 }}>{s.hint}</span>
                  <code style={{ color: J.textDim, fontSize: 11, marginLeft: "auto" }}>{s.id}</code>
                </label>
              ))}
            </div>

            <label style={{ display: "block", fontSize: 11, color: J.textMid, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
              Expires
            </label>
            <select value={expiresIn} onChange={e => setExpiresIn(e.target.value)}
              style={{
                width: "100%", padding: "12px 14px", fontSize: 14,
                background: J.surface, border: `1px solid ${J.borderHi}`,
                borderRadius: 10, color: J.chandra, marginBottom: 20, outline: "none",
              }}>
              <option value="never">Never</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </select>

            {error && <div style={{
              color: J.red, fontSize: 13, padding: 10,
              background: J.red + "22", border: `1px solid ${J.red}`,
              borderRadius: 8, marginBottom: 16,
            }}>{error}</div>}

            <div style={{ display: "flex", gap: 12 }}>
              <button type="submit" disabled={issuing}
                style={{
                  padding: "12px 24px", background: J.grad, color: J.bg,
                  border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14,
                  cursor: issuing ? "wait" : "pointer", opacity: issuing ? 0.6 : 1,
                }}>{issuing ? "Issuing…" : "Issue key"}</button>
              <button type="button" onClick={() => setShowIssueForm(false)}
                style={{
                  padding: "12px 24px", background: "transparent",
                  border: `1px solid ${J.borderHi}`, color: J.textMid,
                  borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer",
                }}>Cancel</button>
            </div>
          </form>
        )}

        {revokeError && <div style={{
          color: J.red, fontSize: 13, padding: 10,
          background: J.red + "22", border: `1px solid ${J.red}`,
          borderRadius: 8, marginBottom: 16,
        }}>{revokeError}</div>}

        {/* Key list */}
        {loading ? (
          <div style={{ color: J.textMid, padding: 40, textAlign: "center" }}>Loading…</div>
        ) : keys.length === 0 ? (
          <div style={{
            background: J.vault, border: `1px solid ${J.border}`,
            borderRadius: 16, padding: 40, textAlign: "center", color: J.textMid,
          }}>
            <div style={{ marginBottom: 8, display: "flex", justifyContent: "center" }}><Key size={28} /></div>
            No API keys yet. Issue one above to start integrating.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {keys.map(k => {
              const expired = !!(k.expires_at && new Date(k.expires_at) < new Date());
              const dead    = !!k.revoked_at || expired;
              return (
                <div key={k.id} style={{
                  background: J.vault, border: `1px solid ${J.border}`,
                  borderRadius: 12, padding: 16,
                  opacity: dead ? 0.5 : 1,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ color: J.chandra, fontWeight: 700, fontSize: 15 }}>
                      {k.name}
                      {k.revoked_at && <span style={{ color: J.red, fontSize: 11, marginLeft: 10 }}>REVOKED</span>}
                      {expired && !k.revoked_at && <span style={{ color: J.surya, fontSize: 11, marginLeft: 10 }}>EXPIRED</span>}
                    </div>
                    {!dead && (
                      <button onClick={() => revokeKey(k.id, k.name)} disabled={revoking === k.id}
                        style={{
                          padding: "6px 12px", background: "transparent",
                          border: `1px solid ${J.red}55`, color: J.red,
                          borderRadius: 6, fontSize: 12, cursor: revoking === k.id ? "wait" : "pointer",
                          opacity: revoking === k.id ? 0.6 : 1,
                        }}>{revoking === k.id ? "Revoking…" : "Revoke"}</button>
                    )}
                  </div>
                  <div style={{ fontFamily: "monospace", color: J.textMid, fontSize: 13, marginBottom: 8 }}>
                    {k.prefix}<span style={{ color: J.textDim }}>{"…(hidden)"}</span>
                  </div>
                  <div style={{ display: "flex", gap: 16, fontSize: 12, color: J.textMid, flexWrap: "wrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><BarChart3 size={12} /> {k.request_count?.toLocaleString() || 0} requests</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={12} /> {k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleString()}` : "never used"}</span>
                    <span>{k.expires_at ? `${expired ? "expired" : "expires"} ${fmtDate(k.expires_at)}` : "never expires"}</span>
                    <span style={{ color: J.textDim }}>{(k.scopes || []).join(" · ") || "no scopes"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Docs link */}
        <div style={{ marginTop: 32, padding: 16, background: J.vault, borderRadius: 10,
                      border: `1px solid ${J.border}`, fontSize: 13, color: J.textMid }}>
          <BookOpen size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} /> API documentation: <a href="https://docs.heynikki.in/api" style={{ color: J.mercury }}>docs.heynikki.in/api</a>
          {" · "}Endpoints: <code style={{ color: J.chandra }}>GET /api/v1/calls</code>,
          {" "}<code style={{ color: J.chandra }}>GET /api/v1/calls/:id</code>,
          {" "}<code style={{ color: J.chandra }}>GET /api/v1/appointments</code>,
          {" "}<code style={{ color: J.chandra }}>GET /api/v1/usage</code>
        </div>
      </div>
    </div>
  );
}
