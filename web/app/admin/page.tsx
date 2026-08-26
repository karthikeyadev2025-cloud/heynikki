"use client";

// ─────────────────────────────────────────────────────────────────────────
// Super-admin console.
//
// The admin API existed with 14 routes and no UI, so onboarding a client
// meant running curl against production. This is the click-through for the
// step that actually gates a new client: handing them a number.
//
// Guarded twice on purpose. The page hides itself for non-admins, but that
// is cosmetic — every endpoint behind it is verifySuperAdmin on the server,
// which is what actually enforces it. Never rely on the client check.
// ─────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import { Phone, Users, RefreshCw, Check, X, AlertTriangle } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

type Did = {
  number: string; status: string; provider: string | null;
  tenant_id: string | null; routing_mode: string | null;
  tenant: { id: string; name: string; status: string } | null;
};
type Tenant = { id: string; name: string; status: string; plan: string };

export default function AdminPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [dids, setDids]       = useState<Did[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [busy, setBusy]       = useState("");
  const [err, setErr]         = useState("");
  const [ok, setOk]           = useState("");
  const [pick, setPick]       = useState<Record<string, string>>({});

  const authed = useCallback(async (path: string, init?: RequestInit) => {
    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.href = "/login"; throw new Error("no session"); }
    return fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json",
                 Authorization: `Bearer ${session.access_token}`,
                 ...(init?.headers || {}) },
    });
  }, []);

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await authed("/api/admin/dids");
      if (r.status === 403) { setAllowed(false); return; }
      if (!r.ok) throw new Error(`DID list failed (${r.status})`);
      const d = await r.json();
      setDids(d.dids || []);
      setAllowed(true);

      const t = await authed("/api/admin/tenants");
      if (t.ok) {
        const td = await t.json();
        setTenants(Array.isArray(td) ? td : (td.tenants || []));
      }
    } catch (e: any) {
      if (e?.message !== "no session") setErr(e?.message || "Could not load");
    }
  }, [authed]);

  useEffect(() => { load(); }, [load]);

  const assign = async (number: string) => {
    const tenant_id = pick[number];
    if (!tenant_id) { setErr(`Choose a tenant for ${number} first`); return; }
    setBusy(number); setErr(""); setOk("");
    try {
      const r = await authed(`/api/admin/dids/${number}/assign`, {
        method: "POST", body: JSON.stringify({ tenant_id }),
      });
      const d = await r.json().catch(() => ({}));
      // 409 = already held by another tenant. Surfaced, never swallowed:
      // silently reassigning would send their callers to someone else.
      if (!r.ok) throw new Error(d.error || `Assign failed (${r.status})`);
      setOk(`${number} assigned to ${d.tenant}`);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(""); }
  };

  const release = async (number: string) => {
    if (!confirm(`Release ${number}? Calls to it will stop reaching that tenant.`)) return;
    setBusy(number); setErr(""); setOk("");
    try {
      const r = await authed(`/api/admin/dids/${number}/release`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Release failed (${r.status})`);
      setOk(`${number} released`);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(""); }
  };

  if (allowed === false) {
    return (
      <Shell title="Admin">
        <div style={{ padding: 32, color: "#94A3B8", display: "flex", gap: 10, alignItems: "center" }}>
          <AlertTriangle size={18} /> Super admin only.
        </div>
      </Shell>
    );
  }

  const assigned  = dids.filter(d => d.status === "assigned").length;
  const available = dids.length - assigned;

  return (
    <Shell title="Admin — Numbers">
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <Stat icon={<Phone size={14} />} label="DIDs total" value={dids.length} />
        <Stat icon={<Check size={14} />} label="Assigned"  value={assigned} />
        <Stat icon={<Users size={14} />} label="Available" value={available} />
        <button onClick={load} style={btnGhost}><RefreshCw size={13} /> Refresh</button>
      </div>

      {err && <Banner tone="err"><X size={13} /> {err}</Banner>}
      {ok  && <Banner tone="ok"><Check size={13} /> {ok}</Banner>}

      <div style={card}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "#94A3B8", fontSize: 11, textTransform: "uppercase" }}>
              <Th>Number</Th><Th>Status</Th><Th>Tenant</Th><Th>Mode</Th><Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {dids.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 18, color: "#94A3B8" }}>
                No DIDs in inventory yet.
              </td></tr>
            )}
            {dids.map(d => (
              <tr key={d.number} style={{ borderTop: "1px solid #1E293B" }}>
                <Td><span style={{ fontFamily: "monospace" }}>{d.number}</span></Td>
                <Td>
                  <span style={{
                    fontSize: 11, padding: "2px 8px", borderRadius: 20,
                    background: d.status === "assigned" ? "#10B98122" : "#94A3B822",
                    color:      d.status === "assigned" ? "#10B981"   : "#94A3B8",
                  }}>{d.status}</span>
                </Td>
                <Td>{d.tenant?.name || <span style={{ color: "#64748B" }}>—</span>}</Td>
                <Td style={{ color: "#94A3B8" }}>{d.routing_mode || "—"}</Td>
                <Td>
                  {d.status === "assigned" ? (
                    <button onClick={() => release(d.number)} disabled={busy === d.number} style={btnGhost}>
                      {busy === d.number ? "…" : "Release"}
                    </button>
                  ) : (
                    <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <select
                        value={pick[d.number] || ""}
                        onChange={e => setPick(p => ({ ...p, [d.number]: e.target.value }))}
                        style={sel}
                      >
                        <option value="">Choose tenant…</option>
                        {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      <button onClick={() => assign(d.number)} disabled={busy === d.number} style={btnPrimary}>
                        {busy === d.number ? "…" : "Assign"}
                      </button>
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ color: "#64748B", fontSize: 11, marginTop: 12, maxWidth: "70ch" }}>
        Assigning sets the DID to <code>assigned</code> and links it to that tenant&apos;s
        voice profile. Routing only matches numbers in that state, so a number left in
        any other status never reaches a caller.
      </p>
    </Shell>
  );
}

const card = { background: "#0F172A", border: "1px solid #1E293B", borderRadius: 10, padding: 4, overflowX: "auto" as const };
const sel  = { background: "#0B1220", color: "#E2E8F0", border: "1px solid #1E293B", borderRadius: 7, padding: "6px 8px", fontSize: 12 };
const btnPrimary = { background: "#38BDF8", color: "#06121F", border: 0, borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" };
const btnGhost   = { background: "transparent", color: "#94A3B8", border: "1px solid #1E293B", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center" };

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600 }}>{children}</th>;
}
function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: "10px 12px", color: "#E2E8F0", ...style }}>{children}</td>;
}
function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div style={{ ...card, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", minWidth: 130 }}>
      <span style={{ color: "#38BDF8" }}>{icon}</span>
      <span>
        <span style={{ display: "block", fontSize: 18, fontWeight: 800, color: "#F1F5F9" }}>{value}</span>
        <span style={{ fontSize: 11, color: "#94A3B8" }}>{label}</span>
      </span>
    </div>
  );
}
function Banner({ tone, children }: { tone: "ok" | "err"; children: React.ReactNode }) {
  const c = tone === "ok" ? "#10B981" : "#F87171";
  return (
    <div style={{ background: `${c}18`, border: `1px solid ${c}44`, color: c,
                  borderRadius: 8, padding: "8px 12px", fontSize: 12,
                  marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
      {children}
    </div>
  );
}
