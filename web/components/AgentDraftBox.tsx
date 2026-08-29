"use client";

/**
 * Agent builder — describe the business, get the setup form filled in.
 *
 * Configuring an agent means a business name, a service list, opening hours,
 * appointment types, and a fallback line written in Telugu. That is where a
 * shop owner stops, and an unconfigured agent answers every call as a generic
 * receptionist that knows nothing about the business.
 *
 * This fills the form the page already has rather than replacing it. The
 * draft lands in the same fields, editable, and nothing is saved until the
 * owner presses the page's own Save. An agent answers a real phone number
 * that real customers ring, so a model must never be the last thing between
 * a sentence and production — it proposes, the owner decides.
 */

import { useState } from "react";
import { createClient } from "../lib/supabase";
import { NIKKI } from "../lib/brand";
import { Sparkles, Loader2 } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
  grn: NIKKI.emerald, red: NIKKI.red,
};

export type AgentDraft = {
  business_name: string;
  display_name: string;
  profile_sku: string;
  services: string[];
  appointment_types: string[];
  open_time: string;
  close_time: string;
  open_days: string[];
  fallback_message: string;
};

const EXAMPLE =
  "We are Sri Lakshmi Dental Care in Kukatpally, Hyderabad. Two dentists. " +
  "We do cleaning, root canal, braces and implants. Open Monday to Saturday, " +
  "10am to 8pm, closed Sunday. People call to book check-ups.";

export default function AgentDraftBox({ onDraft }: { onDraft: (d: AgentDraft) => void }) {
  const [text, setText]   = useState("");
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState("");
  const [done, setDone]   = useState(false);

  const generate = async () => {
    setBusy(true); setError(""); setDone(false);
    try {
      const sb = createClient();
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { setError("Session expired — sign in again."); setBusy(false); return; }

      const r = await fetch(`${API_URL}/api/agents/draft`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ description: text.trim() }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j.error || `Could not draft the agent (${r.status})`); setBusy(false); return; }
      onDraft(j.draft as AgentDraft);
      setDone(true);
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <div style={{
      background: C.hi, border: `1px solid ${C.bord}`, borderRadius: 12,
      padding: 18, marginBottom: 20,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Sparkles size={16} color={C.grn} />
        <strong style={{ color: C.txt, fontSize: 15 }}>Describe your business</strong>
      </div>
      <div style={{ color: C.mid, fontSize: 13, marginBottom: 12 }}>
        Say what you do in a sentence or two and the form below fills itself in.
        You can change anything afterwards — nothing is saved until you press Save.
      </div>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={4}
        placeholder={EXAMPLE}
        maxLength={2000}
        style={{
          width: "100%", padding: "12px 14px", fontSize: 14, borderRadius: 10,
          border: `1px solid ${C.bord}`, background: C.surf, color: C.txt,
          outline: "none", resize: "vertical", lineHeight: 1.5,
        }}
      />

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <button type="button"
          onClick={generate}
          disabled={busy || text.trim().length < 10}
          style={{
            padding: "10px 18px", borderRadius: 10, border: "none", fontSize: 14,
            fontWeight: 700, color: "#fff",
            background: (busy || text.trim().length < 10) ? C.dim : C.grn,
            cursor: (busy || text.trim().length < 10) ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 8,
          }}>
          {busy ? <><Loader2 size={15} /> Drafting…</> : <><Sparkles size={15} /> Fill in the form</>}
        </button>

        {/* The blank path stays one click away. Someone who already knows
            exactly what they want should not have to describe it to a model
            first. */}
        <button type="button"
          onClick={() => { setText(""); setError(""); setDone(false); }}
          style={{
            padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
            background: C.surf, color: C.mid, border: `1px solid ${C.bord}`, cursor: "pointer",
          }}>
          Start from scratch
        </button>

        {text.trim().length > 0 && text.trim().length < 10 && (
          <span style={{ fontSize: 12, color: C.dim }}>A little more detail…</span>
        )}
        {done && !error && (
          <span style={{ fontSize: 13, color: C.grn, fontWeight: 600 }}>
            Filled in below — check it before saving.
          </span>
        )}
      </div>

      {error && (
        <div role="alert" style={{
          marginTop: 10, background: "#FEF2F2", border: "1px solid #FECACA",
          color: C.red, padding: "9px 12px", borderRadius: 8, fontSize: 13,
        }}>{error}</div>
      )}
    </div>
  );
}
