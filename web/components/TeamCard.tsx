"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "../lib/supabase";
import { NIKKI } from "../lib/brand";

const API = process.env.NEXT_PUBLIC_API_URL;
const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  grn: NIKKI.emerald, gold: NIKKI.gold, red: NIKKI.red,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

/**
 * The people who can use this account.
 *
 * Roles have meant something since the price floor moved onto the profile —
 * only an owner changes what the business says and what it spends. Until now
 * there was no way to add the person that rule was written about, so every
 * account was one operator and the seats line had to come off the pricing
 * page.
 *
 * The invite link is shown rather than only emailed. Email delivery is not
 * configured, and more to the point a colleague in a shop is reached on
 * WhatsApp, not in an inbox.
 */
export default function TeamCard() {
  const [d, setD]       = useState<any>(null);
  const [email, setEmail] = useState("");
  const [role, setRole]   = useState("member");
  const [link, setLink]   = useState("");
  const [msg, setMsg]     = useState("");
  const [busy, setBusy]   = useState(false);

  const load = useCallback(async () => {
    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${API}/api/team`, { headers: { Authorization: `Bearer ${session?.access_token}` } });
    if (r.ok) setD(await r.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!d) return null;
  const full = d.seats_used >= d.seats_total;

  const invite = async () => {
    setBusy(true); setMsg(""); setLink("");
    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${API}/api/team/invite`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const j = await r.json();
    if (!r.ok) setMsg(j.error || "Could not send the invite");
    else { setLink(j.link); setEmail(""); setMsg("Invite ready — send them this link."); load(); }
    setBusy(false);
  };

  // Remove a member / cancel an invite. A refused request (last owner,
  // wrong tenant, plan gate) used to re-render the list unchanged with no
  // word about why.
  const act = async (path: string, what: string) => {
    setMsg(""); setLink("");
    try {
      const sb = createClient();
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(`${API}${path}`, { method: "POST", headers: { Authorization: `Bearer ${session?.access_token}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || `Could not ${what} (${r.status})`);
    } catch (e: any) {
      setMsg(e.message || `Could not ${what}`);
    }
    load();
  };

  const prettyPhone = (n: string) => { const d = String(n).replace(/\D/g, "").slice(-10); return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : n; };
  const showsPhones = (d.members || []).some((m: any) => m.phone);

  const label = { fontSize: 11.5, color: C.dim, marginBottom: 4 } as const;
  const input = { padding: "8px 11px", borderRadius: 8, fontSize: 13.5,
    background: C.hi, color: C.txt, border: `1px solid ${C.bord}` } as const;

  return (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12,
      padding: 18, marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div style={{ color: C.txt, fontSize: 15.5, fontWeight: 800 }}>Your team</div>
        <div style={{ color: full ? C.gold : C.dim, fontSize: 12.5 }}>
          {d.seats_used} of {d.seats_total} {d.seats_total === 1 ? "seat" : "seats"} used · {d.plan}
        </div>
      </div>
      <div style={{ color: C.mid, fontSize: 12.5, margin: "6px 0 14px", lineHeight: 1.55 }}>
        Everyone can work leads, calls and appointments. Only you can change what Nikki
        says, what she charges, and what she spends.
      </div>

      {(d.members || []).map((m: any) => (
        <div key={m.id} style={{ display: "flex", gap: 10, alignItems: "center",
          padding: "8px 0", borderBottom: `1px solid ${C.bord}55`, fontSize: 13.5 }}>
          <span style={{ color: C.txt, fontWeight: 600 }}>{m.email}</span>
          <span style={{ color: ["owner","super_admin"].includes(m.role) ? C.grn : C.dim, fontSize: 12 }}>
            {m.role === "super_admin" ? "owner" : m.role}
          </span>
          {m.is_you && <span style={{ color: C.dim, fontSize: 11.5 }}>you</span>}
          {m.phone && (
            <span style={{ color: C.dim, fontSize: 12, fontVariantNumeric: "tabular-nums" }} title="Rings on calls passed to the team">
              {prettyPhone(m.phone)}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {d.you_are_owner && !m.is_you && !["owner","super_admin"].includes(m.role) && (
            <button type="button" onClick={() => act(`/api/team/${m.id}/remove`, `remove ${m.email}`)}
              style={{ background: "none", border: "none", color: C.dim, fontSize: 12, cursor: "pointer" }}>
              remove
            </button>
          )}
        </div>
      ))}

      {(d.invites || []).map((i: any) => (
        <div key={i.id} style={{ display: "flex", gap: 10, alignItems: "center",
          padding: "8px 0", borderBottom: `1px solid ${C.bord}55`, fontSize: 13.5 }}>
          <span style={{ color: C.mid }}>{i.email}</span>
          <span style={{ color: C.gold, fontSize: 12 }}>invited · not joined yet</span>
          <span style={{ flex: 1 }} />
          {d.you_are_owner && (
            <button type="button" onClick={() => act(`/api/team/invite/${i.id}/revoke`, "cancel the invite")}
              style={{ background: "none", border: "none", color: C.dim, fontSize: 12, cursor: "pointer" }}>
              cancel
            </button>
          )}
        </div>
      ))}

      {showsPhones && (
        <div style={{ color: C.dim, fontSize: 12, marginTop: 8 }}>
          Numbers shown ring when a call is passed to the team.{" "}
          <a href="/desk" style={{ color: C.grn, fontWeight: 600, textDecoration: "none" }}>Manage who answers calls →</a>
        </div>
      )}

      {!d.you_are_owner && msg && <div style={{ color: C.mid, fontSize: 12.5, marginTop: 8 }}>{msg}</div>}

      {d.you_are_owner && (
        <div style={{ marginTop: 14 }}>
          <div style={label}>Add someone</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={email} onChange={e => setEmail(e.target.value)}
              placeholder="their email" style={{ ...input, flex: 1, minWidth: 190 }} />
            <select value={role} onChange={e => setRole(e.target.value)} style={input}>
              <option value="member">Staff</option>
              <option value="support">Support</option>
            </select>
            <button type="button" onClick={invite} disabled={busy || !email.trim() || full}
              style={{ padding: "8px 16px", borderRadius: 8, border: "none", fontSize: 13.5,
                fontWeight: 800, background: C.grn, color: "#04120a",
                cursor: busy || full ? "default" : "pointer", opacity: full ? .5 : 1 }}>
              {busy ? "…" : "Invite"}
            </button>
          </div>
          {full && (
            <div style={{ color: C.gold, fontSize: 12, marginTop: 7 }}>
              All {d.seats_total} {d.seats_total === 1 ? "seat is" : "seats are"} used on {d.plan}.
              Upgrade to add more people.
            </div>
          )}
          {msg && <div style={{ color: C.mid, fontSize: 12.5, marginTop: 8 }}>{msg}</div>}
          {link && (
            <div style={{ marginTop: 8, display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
              <input readOnly value={link} onFocus={e => e.currentTarget.select()}
                style={{ ...input, flex: 1, minWidth: 220, fontSize: 12 }} />
              <button type="button"
                onClick={() => { navigator.clipboard?.writeText(link); setMsg("Link copied — send it on WhatsApp."); }}
                style={{ padding: "8px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 700,
                  background: "transparent", color: C.txt, border: `1px solid ${C.bord}`, cursor: "pointer" }}>
                Copy
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
