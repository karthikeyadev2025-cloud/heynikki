"use client";

import { useEffect, useState } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import { NIKKI } from "../../lib/brand";
import { Check, ClipboardCopy, Key, BarChart3, Clock, BookOpen, Lock } from "lucide-react";

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
  { id: "calls.read",         label: "Read calls",            hint: "GET /api/v1/calls, /api/v1/calls/:id, /api/v1/calls/outbound", recommended: true },
  { id: "appointments.read",  label: "Read appointments",     hint: "GET /api/v1/appointments",             recommended: true },
  { id: "orders.read",        label: "Read orders",           hint: "GET /api/v1/orders — orders Nikki took on the phone", recommended: true },
  // The two write scopes. Kept off by default on purpose: one of them
  // spends credits and rings a real person's phone.
  { id: "calls.write",        label: "Place outbound calls",  hint: "POST /api/v1/calls/outbound — Nikki rings a customer and delivers your message. Uses call credits." },
  { id: "orders.write",       label: "Update orders",         hint: "PATCH /api/v1/orders/:id — move an order to preparing, ready, delivered" },
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

  // Whether this account's plan includes API access at all. null = not
  // known yet (or the check failed), which must not lock a paying customer
  // out of a form they are entitled to — the API is the real gate either way.
  const [apiAllowed, setApiAllowed] = useState<boolean | null>(null);
  const [planName, setPlanName]     = useState("");

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

      // API access is a plan feature (plans.api_access) and POST /api/keys/mine
      // refuses with "API access is on the Scale plan." — but only AFTER the
      // owner had named the key, picked permissions, chosen an expiry and
      // pressed the button. Ask the same question before they type a word.
      //
      // The feature flags come from /api/platform/pricing, not the plans
      // table: /campaigns learned the hard way that plans has RLS on with no
      // policy for a browser, so reading it directly returns [] and every
      // account looks ungated.
      try {
        const { data: t } = await sb.from("tenants").select("plan").eq("id", tu.tenant_id).maybeSingle();
        const plan = String(t?.plan || "trial");
        const pr   = await fetch(`${API_URL}/api/platform/pricing`).then(r => r.json());
        const tier = (pr?.tiers || []).find((x: any) => x.id === plan);
        setPlanName(tier?.name || (plan === "trial" ? "the free trial" : plan));
        // Trial has no tier row, and a trial does not include API access.
        setApiAllowed(!!tier?.api_access);
      } catch {
        // A failed lookup leaves the form open rather than blocking a Scale
        // customer; the server still enforces the real gate.
        setApiAllowed(null);
      }
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

  // One date format on this page, and the same one the rest of the dashboard
  // uses ("19 Sep 2026"). The key list printed a browser-locale timestamp
  // beside this, so two dates in the same row read in two different orders.
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", {
      day: "numeric", month: "short", year: "numeric",
      hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata",
    });

  return (
    <Shell title="API keys">
      <div style={{ maxWidth: 900 }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", color: J.chandra, margin: "0 0 4px" }}>
              API keys
            </h1>
            <p style={{ color: J.textMid, fontSize: 14, margin: 0 }}>
              For integrating Nikki with your CRM, Zapier, or custom backend.
            </p>
          </div>
          {!showIssueForm && !newKey && apiAllowed !== false && (
            <button
              onClick={() => setShowIssueForm(true)}
              style={{
                padding: "10px 18px", background: J.mercury, color: "#fff",
                border: "none", borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: "pointer",
              }}>
              + Issue new key
            </button>
          )}
        </div>

        {/* Said BEFORE the form, not after it is submitted. The old page let
            an owner name a key, tick permissions and choose an expiry, then
            answered the press with "API access is on the Scale plan." */}
        {apiAllowed === false && (
          <div style={{
            background: J.surface, border: "1px solid #E4E9F0", borderLeft: `3px solid ${J.surya}`,
            borderRadius: 12, padding: 20, marginBottom: 24, boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
            display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap",
          }}>
            <Lock size={18} color={J.surya} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: "1 1 240px", minWidth: 0 }}>
              <div style={{ color: J.chandra, fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
                API keys come with the Scale plan
              </div>
              <p style={{ color: J.textMid, fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
                You are on {planName || "a plan"}, which does not include them. Move up to
                Scale and you can issue a key here straight away — everything else on your
                account stays exactly as it is.
              </p>
            </div>
            <a href="/billing" style={{
              padding: "10px 18px", background: J.mercury, color: "#fff", textDecoration: "none",
              borderRadius: 8, fontWeight: 600, fontSize: 14, whiteSpace: "nowrap",
            }}>See plans</a>
          </div>
        )}

        {/* New-key one-time reveal */}
        {newKey && (
          <div style={{
            background: J.surface, border: `1px solid ${J.mercury}`,
            boxShadow: "0 0 0 3px " + J.mercury + "1F",
            borderRadius: 12, padding: 24, marginBottom: 24,
          }}>
            <div style={{ color: J.chandra, fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Check size={12} /> Key created — copy it now</span>
            </div>
            <p style={{ color: J.textMid, fontSize: 13.5, lineHeight: 1.6, marginBottom: 16 }}>
              <strong style={{ color: J.chandra }}>{newKey.name}</strong>
              {newKey.expires_at ? ` — expires ${fmtDate(newKey.expires_at)}` : " — never expires"}.
              This key is shown only once and cannot be recovered. Copy it to a password
              manager or your integration's environment file now.
            </p>
            <div style={{
              background: "#F1F4F8", border: "1px solid #E4E9F0",
              padding: 14, borderRadius: 8, fontFamily: "var(--font-mono), monospace",
              fontSize: 13.5, color: J.chandra, wordBreak: "break-all", marginBottom: 16,
            }}>{newKey.key}</div>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => { navigator.clipboard.writeText(newKey.key); }}
                style={{
                  padding: "10px 18px", background: J.surface,
                  border: "1px solid #D8DFE8", color: J.chandra,
                  borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ClipboardCopy size={13} /> Copy</span></button>
              <button
                onClick={() => setNewKey(null)}
                style={{
                  padding: "10px 18px", background: J.mercury, color: "#fff",
                  border: "none", borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}>I've saved it — done</button>
            </div>
          </div>
        )}

        {/* Issue form */}
        {showIssueForm && apiAllowed !== false && (
          <form onSubmit={issueKey} style={{
            background: J.surface, border: "1px solid #E4E9F0", boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
            borderRadius: 12, padding: 24, marginBottom: 24,
          }}>
            <h2 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 19, fontWeight: 700, letterSpacing: "-0.01em", color: J.chandra, margin: "0 0 18px" }}>
              Issue new API key
            </h2>

            <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: J.textMid, marginBottom: 6 }}>
              Name (so you can identify it later)
            </label>
            <input
              type="text" required value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Zapier production, CRM sync, mobile app"
              style={{
                width: "100%", padding: "10px 12px", fontSize: 14,
                background: J.surface, border: "1px solid #D8DFE8",
                borderRadius: 8, color: J.chandra, marginBottom: 20, outline: "none",
              }} />

            <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: J.textMid, marginBottom: 8 }}>
              Permissions
            </label>
            <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
              {AVAILABLE_SCOPES.map(s => (
                <label key={s.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                  background: chosenScopes.includes(s.id) ? J.mercury + "0D" : J.surface,
                  border: `1px solid ${chosenScopes.includes(s.id) ? J.mercury : "#E4E9F0"}`,
                  borderRadius: 10, cursor: "pointer", fontSize: 13.5, flexWrap: "wrap",
                }}>
                  <input
                    type="checkbox" checked={chosenScopes.includes(s.id)}
                    onChange={() => setChosenScopes(cur =>
                      cur.includes(s.id) ? cur.filter(x => x !== s.id) : [...cur, s.id]
                    )} />
                  <span style={{ color: J.chandra, fontWeight: 600 }}>{s.label}</span>
                  {s.recommended && <span style={{ background: J.mercury + "14", color: J.mercury, fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: "1px 8px" }}>Recommended</span>}
                  <code style={{ color: J.textDim, fontSize: 12, marginLeft: "auto", fontFamily: "var(--font-mono), monospace" }}>{s.id}</code>
                  <span style={{ color: J.textMid, fontSize: 12.5, flexBasis: "100%", paddingLeft: 24 }}>{s.hint}</span>
                </label>
              ))}
            </div>

            <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: J.textMid, marginBottom: 6 }}>
              Expires
            </label>
            <select value={expiresIn} onChange={e => setExpiresIn(e.target.value)}
              style={{
                width: "100%", padding: "10px 12px", fontSize: 14,
                background: J.surface, border: "1px solid #D8DFE8",
                borderRadius: 8, color: J.chandra, marginBottom: 20, outline: "none",
              }}>
              <option value="never">Never</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </select>

            {error && <div style={{
              color: J.red, fontSize: 13.5, padding: "10px 14px",
              background: J.red + "0A", border: `1px solid ${J.red}44`, borderLeft: `3px solid ${J.red}`,
              borderRadius: 10, marginBottom: 16,
            }}>{error}</div>}

            <div style={{ display: "flex", gap: 12 }}>
              <button type="submit" disabled={issuing}
                style={{
                  padding: "10px 22px", background: J.mercury, color: "#fff",
                  border: "none", borderRadius: 8, fontWeight: 600, fontSize: 14,
                  cursor: issuing ? "wait" : "pointer", opacity: issuing ? 0.6 : 1,
                }}>{issuing ? "Issuing…" : "Issue key"}</button>
              <button type="button" onClick={() => setShowIssueForm(false)}
                style={{
                  padding: "10px 22px", background: J.surface,
                  border: "1px solid #D8DFE8", color: J.chandra,
                  borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}>Cancel</button>
            </div>
          </form>
        )}

        {revokeError && <div style={{
          color: J.red, fontSize: 13.5, padding: "10px 14px",
          background: J.red + "0A", border: `1px solid ${J.red}44`, borderLeft: `3px solid ${J.red}`,
          borderRadius: 10, marginBottom: 16,
        }}>{revokeError}</div>}

        {/* Key list */}
        {loading ? (
          <div style={{ color: J.textMid, padding: 40, textAlign: "center" }}>Loading…</div>
        ) : keys.length === 0 ? (
          <div style={{
            background: J.surface, border: "1px solid #E4E9F0", boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
            borderRadius: 12, padding: 40, textAlign: "center", color: J.textMid, fontSize: 14,
          }}>
            <div style={{ marginBottom: 10, display: "flex", justifyContent: "center", color: J.textDim }}><Key size={28} /></div>
            {apiAllowed === false
              ? "No API keys on this account."
              : "No API keys yet. Issue one above to start integrating."}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {keys.map(k => {
              const expired = !!(k.expires_at && new Date(k.expires_at) < new Date());
              const dead    = !!k.revoked_at || expired;
              return (
                <div key={k.id} style={{
                  background: J.surface, border: "1px solid #E4E9F0", boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                  borderRadius: 12, padding: "16px 18px",
                  opacity: dead ? 0.6 : 1,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <div style={{ color: J.chandra, fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {k.name}
                      {k.revoked_at && <span style={{ background: J.red + "14", color: J.red, fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: "2px 9px" }}>Revoked</span>}
                      {expired && !k.revoked_at && <span style={{ background: J.surya + "14", color: J.surya, fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: "2px 9px" }}>Expired</span>}
                      {!dead && <span style={{ background: "#10B98114", color: "#059669", fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: "2px 9px" }}>Active</span>}
                    </div>
                    {!dead && (
                      <button onClick={() => revokeKey(k.id, k.name)} disabled={revoking === k.id}
                        style={{
                          padding: "6px 12px", background: J.surface,
                          border: "1px solid #D8DFE8", color: J.red, fontWeight: 600,
                          borderRadius: 8, fontSize: 13, cursor: revoking === k.id ? "wait" : "pointer",
                          opacity: revoking === k.id ? 0.6 : 1,
                        }}>{revoking === k.id ? "Revoking…" : "Revoke"}</button>
                    )}
                  </div>
                  <div style={{ display: "inline-block", fontFamily: "var(--font-mono), monospace", background: "#F1F4F8", borderRadius: 6,
                    padding: "3px 8px", color: J.chandra, fontSize: 13, marginBottom: 10 }}>
                    {k.prefix}<span style={{ color: J.textDim }}>••••••••</span>
                  </div>
                  <div style={{ display: "flex", gap: "6px 18px", fontSize: 13, color: J.textMid, flexWrap: "wrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><BarChart3 size={12} /> {k.request_count?.toLocaleString() || 0} requests</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={12} /> {k.last_used_at ? `last used ${fmtDateTime(k.last_used_at)}` : "never used"}</span>
                    <span>{k.expires_at ? `${expired ? "expired" : "expires"} ${fmtDate(k.expires_at)}` : "never expires"}</span>
                    <span style={{ color: J.textDim, fontFamily: "var(--font-mono), monospace", fontSize: 12 }}>{(k.scopes || []).join(" · ") || "no scopes"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Docs link */}
        {/* Every route the API serves under /api/v1 (api-server/src/index.ts).
            This list used to stop at four and left out orders and outbound
            calls, both of which have scopes on the form above. */}
        <div style={{ marginTop: 28, padding: "18px 20px", background: J.surface, borderRadius: 12,
                      border: "1px solid #E4E9F0", fontSize: 13.5, color: J.textMid }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: J.chandra, fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
            <BookOpen size={16} color={J.mercury} /> Endpoints
          </div>
          <div style={{ marginBottom: 12 }}>
            Full reference at <a href="/developers" style={{ color: J.mercury, fontWeight: 600 }}>heynikki.in/developers</a>.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["GET /api/v1/calls", "GET /api/v1/calls/:id", "POST /api/v1/calls/outbound", "GET /api/v1/calls/outbound",
              "GET /api/v1/appointments", "GET /api/v1/orders", "PATCH /api/v1/orders/:id", "GET /api/v1/usage"].map(e => (
              <code key={e} style={{ background: "#F1F4F8", color: J.chandra, borderRadius: 6, padding: "3px 8px",
                fontFamily: "var(--font-mono), monospace", fontSize: 12.5 }}>{e}</code>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}
