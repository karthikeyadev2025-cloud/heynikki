"use client";

/**
 * Knowledge base — "tell Nikki about your business".
 *
 * The RAG engine (voice-pipeline/app/knowledge.py) has worked for a
 * while: every call turn embeds the caller's question, searches
 * knowledge_base, and grounds the reply in whatever it finds. But there was
 * no way for a customer to PUT anything in that table — so the whole feature
 * was unreachable and Nikki could only ever answer from the generic SKU
 * prompt. This page is that missing half.
 *
 * How the flow works:
 *  1. Business types/pastes facts here → saved with embedding = NULL.
 *  2. The scheduler worker (api-server/src/jobs/scheduler.ts) picks up rows
 *     with no embedding, generates one via Gemini, and writes it back.
 *  3. From then on, calls retrieve it automatically.
 *
 * Embedding is deliberately NOT done in the browser: it needs the Gemini API
 * key, which must never ship to a client. Saving text first and embedding
 * server-side keeps the key server-only and makes the UI instant.
 *
 * RLS (kb_select/kb_insert/kb_delete) scopes everything to the tenant, so
 * this talks to Supabase directly with the user's own JWT.
 */

import { useState, useEffect, useCallback } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import { NIKKI } from "../../lib/brand";
import { Check, Loader2 } from "lucide-react";

const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: NIKKI.gold,
  grn: NIKKI.emerald, red: NIKKI.red, cyn: NIKKI.cyan,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

type Entry = {
  id: string;
  content: string;
  source_type: string;
  source_name: string | null;
  embedding: unknown | null;
  created_at: string;
};

/* Starter prompts. An empty textarea labelled "knowledge base" gets nothing
   useful out of a shop owner; concrete examples of what Nikki gets asked on
   real calls get good answers immediately. */
const SUGGESTIONS = [
  { q: "What are your charges?",        hint: "Consultation ₹500. Follow-up within 15 days free." },
  { q: "Where exactly are you?",        hint: "Opposite Big Bazaar, 2nd floor. Parking behind the building." },
  { q: "Which doctor sits when?",       hint: "Dr. Rao: Mon-Wed mornings. Dr. Sharma: Thu-Sat evenings." },
  { q: "Do you take insurance?",        hint: "We accept Star Health and HDFC Ergo. Cashless available." },
];

export default function KnowledgePage() {
  const [entries, setEntries]   = useState<Entry[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [tenantId, setTenantId]   = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const [notice, setNotice]     = useState("");
  const [draft, setDraft]       = useState("");
  const [name, setName]         = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) { window.location.href = "/login"; return; }

    const { data: tu } = await sb.from("tenant_users")
      .select("tenant_id").eq("user_id", auth.user.id).single();
    if (!tu) { setError("No tenant found."); setLoading(false); return; }
    setTenantId(tu.tenant_id);

    const { data: vp } = await sb.from("voice_profiles")
      .select("id").eq("tenant_id", tu.tenant_id).limit(1).maybeSingle();
    setProfileId(vp?.id ?? null);

    const { data, error: e } = await sb.from("knowledge_base")
      .select("id, content, source_type, source_name, embedding, created_at")
      .order("created_at", { ascending: false });
    if (e) setError(e.message);
    else setEntries((data || []) as Entry[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addEntry() {
    setError(""); setNotice("");
    const text = draft.trim();
    if (!text) { setError("Type something for Nikki to learn first."); return; }
    if (!profileId) {
      setError("Set up your voice profile first — Nikki needs one before she can learn about your business.");
      return;
    }
    setSaving(true);
    const sb = createClient();
    const { error: e } = await sb.from("knowledge_base").insert({
      tenant_id: tenantId,
      voice_profile_id: profileId,
      content: text,
      source_type: "manual",
      source_name: name.trim() || null,
      // embedding intentionally omitted — the scheduler worker fills it in.
    });
    setSaving(false);
    if (e) { setError(e.message); return; }
    setDraft(""); setName("");
    setNotice("Saved. Nikki will start using this within a few minutes.");
    load();
  }

  async function removeEntry(id: string) {
    const sb = createClient();
    const { error: e } = await sb.from("knowledge_base").delete().eq("id", id);
    if (e) setError(e.message);
    else { setEntries(es => es.filter(x => x.id !== id)); }
  }

  const pending = entries.filter(e => !e.embedding).length;

  const inputStyle: React.CSSProperties = {
    width: "100%", background: C.hi, border: `1px solid ${C.bord}`,
    borderRadius: 8, padding: "10px 12px", color: C.txt, fontSize: 14,
    fontFamily: "inherit", boxSizing: "border-box",
  };

  return (
    <Shell title="Teach Nikki">
      <div style={{ padding: 24, maxWidth: 900 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: C.txt, margin: "0 0 4px" }}>
          Teach Nikki
        </h1>
        <p style={{ color: C.mid, fontSize: 14, marginTop: 0, marginBottom: 20, lineHeight: 1.6 }}>
          Tell Nikki about your business the way you&apos;d brief a new receptionist on
          their first day. Anything you add here, she can answer on calls — in Telugu,
          in your words.
        </p>

        {error && (
          <div style={{ background: C.red + "0D", border: `1px solid ${C.red}55`,
            borderRadius: 10, padding: 14, marginBottom: 16, color: C.red, fontSize: 13 }}>
            {error}
          </div>
        )}
        {notice && (
          <div style={{ background: C.grn + "0D", border: `1px solid ${C.grn}55`,
            borderRadius: 10, padding: 14, marginBottom: 16, color: C.grn, fontSize: 13 }}>
            {notice}
          </div>
        )}

        {/* composer */}
        <div style={{ background: C.surf, border: `1px solid ${C.bord}`,
          borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 12, color: C.mid, marginBottom: 6 }}>
            What should Nikki know?
          </label>
          {/* Say it before the click, not after: the composer used to look
              entirely usable and only explained itself once saving failed. */}
          {!profileId && (
            <div style={{ color: C.mid, fontSize: 13, marginBottom: 10, lineHeight: 1.55 }}>
              Finish <a href="/setup" style={{ color: C.grn }}>your setup</a> first — Nikki
              needs a voice profile before she can learn about your business.
            </div>
          )}

          <textarea
            style={{ ...inputStyle, minHeight: 100, resize: "vertical", marginBottom: 12 }}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={"e.g. Consultation fee is ₹500. Follow-up within 15 days is free.\nWe're closed on second Saturdays.\nParking is available behind the building."}
          />
          <input
            style={{ ...inputStyle, marginBottom: 12 }}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Label (optional) — e.g. Pricing, Location, Doctors"
          />
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={addEntry} disabled={saving} style={{
              background: saving ? C.dim : C.glow, color: "#fff", border: "none",
              borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer",
            }}>{saving ? "Saving…" : "Teach Nikki"}</button>
            <span style={{ fontSize: 12, color: C.dim }}>
              One fact or a short paragraph works best.
            </span>
          </div>
        </div>

        {/* suggestions — only while the base is empty */}
        {entries.length === 0 && !loading && (
          <div style={{ background: C.surf, border: `1px solid ${C.bord}`,
            borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ color: C.txt, fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
              Callers usually ask these
            </div>
            <div style={{ color: C.mid, fontSize: 12, marginBottom: 14 }}>
              Tap one to start — then replace the example with your real details.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
              {SUGGESTIONS.map(s => (
                <button key={s.q} onClick={() => setDraft(s.hint)} style={{
                  background: C.hi, border: `1px solid ${C.bord}`, borderRadius: 10,
                  padding: 14, cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                }}>
                  <div style={{ color: C.gbr, fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                    &ldquo;{s.q}&rdquo;
                  </div>
                  <div style={{ color: C.dim, fontSize: 11, lineHeight: 1.5 }}>{s.hint}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {pending > 0 && (
          <div style={{ background: C.gold + "0D", border: `1px solid ${C.gold}44`,
            borderRadius: 10, padding: 12, marginBottom: 16, color: C.gold, fontSize: 13 }}>
            {pending} {pending === 1 ? "entry is" : "entries are"} still being processed —
            Nikki will start using {pending === 1 ? "it" : "them"} within a few minutes.
          </div>
        )}

        {loading ? (
          <p style={{ color: C.mid }}>Loading…</p>
        ) : entries.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {entries.map(e => (
              <div key={e.id} style={{
                background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12,
                padding: 16, display: "flex", gap: 12, alignItems: "flex-start",
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {e.source_name && (
                    <div style={{ color: C.gbr, fontSize: 11, fontWeight: 700,
                      textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>
                      {e.source_name}
                    </div>
                  )}
                  <div style={{ color: C.txt, fontSize: 14, lineHeight: 1.6,
                    whiteSpace: "pre-wrap" }}>{e.content}</div>
                  <div style={{ marginTop: 6, fontSize: 11,
                    color: e.embedding ? C.grn : C.gold }}>
                    {e.embedding ? (<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Check size={12} /> Nikki knows this</span>) : (<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Loader2 size={12} /> processing…</span>)}
                  </div>
                </div>
                <button onClick={() => removeEntry(e.id)} title="Remove" style={{
                  background: "none", border: "none", color: C.dim, fontSize: 18,
                  cursor: "pointer", lineHeight: 1, padding: 4,
                }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
