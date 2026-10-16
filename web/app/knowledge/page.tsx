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
 * The phone path does not wait for step 2: every call reads the business's
 * facts straight from knowledge_base at pickup, so a fact saved here is used
 * on the very next call. The embedding only serves search elsewhere.
 *
 * Above the composer: questions callers asked that Nikki could not answer
 * (knowledge_gaps, 077), filed after every call. Answering one is the
 * fastest way she learns — it is a question a customer actually asked.
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
import { Check } from "lucide-react";

const C = {
  bg: NIKKI.bg, surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: NIKKI.gold,
  grn: NIKKI.emerald, red: NIKKI.red, cyn: NIKKI.cyan,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

type Gap = {
  id: string;
  question: string;
  caller_said: string | null;
  times_asked: number;
  last_asked_at: string;
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
  const [gaps, setGaps]         = useState<Gap[]>([]);
  const [gapDraft, setGapDraft] = useState<Record<string, string>>({});
  const [gapBusy, setGapBusy]   = useState<string | null>(null);
  const [editing, setEditing]   = useState<string | null>(null);
  const [editText, setEditText] = useState("");

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

    // Before 077 the table is missing; the section simply does not show.
    const { data: g } = await sb.from("knowledge_gaps")
      .select("id, question, caller_said, times_asked, last_asked_at")
      .eq("status", "open").order("times_asked", { ascending: false })
      .order("last_asked_at", { ascending: false }).limit(30);
    setGaps((g || []) as Gap[]);

    const { data, error: e } = await sb.from("knowledge_base")
      .select("id, content, source_type, source_name, embedding, created_at")
      .order("created_at", { ascending: false });
    if (e) setError(e.message);
    else {
      // Facts pulled out of an upload are tagged "asset:<uuid>" — show the
      // file they came from, not the id.
      const ids = Array.from(new Set((data || []).map((r: any) => String(r.source_name || ""))
        .filter(n => n.startsWith("asset:")).map(n => n.slice(6))));
      const names = new Map<string, string>();
      if (ids.length) {
        const { data: assets } = await sb.from("tenant_assets").select("id, file_name, kind, created_at").in("id", ids);
        for (const a of assets || []) {
          // "brochure · 3 Sep" reads better than a phone camera's file name.
          const when = a.created_at ? new Date(a.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";
          const kind = String(a.kind || "upload").replace(/_/g, " ");
          names.set(a.id, when ? `${kind} · ${when}` : kind);
        }
      }
      setEntries((data || []).map((r: any) => {
        const n = String(r.source_name || "");
        return n.startsWith("asset:") ? { ...r, source_name: "From your " + (names.get(n.slice(6)) || "upload") } : r;
      }) as Entry[]);
    }
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
    setNotice("Saved. Nikki will use this from her very next call.");
    load();
  }

  async function answerGap(gap: Gap) {
    setError(""); setNotice("");
    const answer = (gapDraft[gap.id] || "").trim();
    if (!answer) { setError("Type the answer Nikki should give first."); return; }
    if (!profileId) { setError("Finish your setup first — Nikki needs a voice profile."); return; }
    setGapBusy(gap.id);
    const sb = createClient();
    const { error: e } = await sb.from("knowledge_base").insert({
      tenant_id: tenantId, voice_profile_id: profileId,
      content: `If a caller asks "${gap.question}": ${answer}`,
      source_type: "faq", source_name: "Caller question",
    });
    if (!e) {
      await sb.from("knowledge_gaps").update({
        status: "answered", answer, answered_at: new Date().toISOString(),
      }).eq("id", gap.id);
    }
    setGapBusy(null);
    if (e) { setError(e.message); return; }
    setGaps(gs => gs.filter(x => x.id !== gap.id));
    setNotice("Taught. Nikki will answer this from her very next call.");
    load();
  }

  async function dismissGap(gap: Gap) {
    const sb = createClient();
    const { error: e } = await sb.from("knowledge_gaps").update({ status: "dismissed" }).eq("id", gap.id);
    if (e) setError(e.message);
    else setGaps(gs => gs.filter(x => x.id !== gap.id));
  }

  async function saveEdit(id: string) {
    const text = editText.trim();
    if (!text) { setError("A fact cannot be empty — use Remove instead."); return; }
    const sb = createClient();
    // A changed fact needs a new embedding; the scheduler fills it in.
    const { data, error: e } = await sb.from("knowledge_base")
      .update({ content: text, embedding: null }).eq("id", id).select("id");
    if (e || !data?.length) {
      setError(e?.message || "Could not save the change — editing needs database update 077.");
      return;
    }
    setEditing(null);
    setEntries(es => es.map(x => x.id === id ? { ...x, content: text } : x));
    setNotice("Updated. Nikki will say it this way from her next call.");
  }

  async function removeEntry(id: string) {
    const sb = createClient();
    const { error: e } = await sb.from("knowledge_base").delete().eq("id", id);
    if (e) setError(e.message);
    else { setEntries(es => es.filter(x => x.id !== id)); }
  }

  const ago = (iso: string) => {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 60) return `${Math.max(1, m)} min ago`;
    if (m < 1440) return `${Math.round(m / 60)} h ago`;
    return `${Math.round(m / 1440)} d ago`;
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", background: C.surf, border: "1px solid #D8DFE8",
    borderRadius: 8, padding: "10px 12px", color: C.txt, fontSize: 14,
    fontFamily: "inherit", boxSizing: "border-box",
  };

  return (
    <Shell title="Teach Nikki">
      <div style={{ maxWidth: 900 }}>
        <h1 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", color: C.txt, margin: "0 0 4px" }}>
          Teach Nikki
        </h1>
        <p style={{ color: C.mid, fontSize: 14, marginTop: 0, marginBottom: 20, lineHeight: 1.6, maxWidth: "68ch" }}>
          Tell Nikki about your business the way you&apos;d brief a new receptionist on
          their first day. Anything you add here, she can answer on calls — in Telugu,
          in your words.
        </p>

        {error && (
          <div style={{ background: C.red + "0A", border: `1px solid ${C.red}44`, borderLeft: `3px solid ${C.red}`,
            borderRadius: 10, padding: "12px 14px", marginBottom: 16, color: C.red, fontSize: 13.5 }}>
            {error}
          </div>
        )}
        {notice && (
          <div style={{ background: C.grn + "0A", border: `1px solid ${C.grn}44`, borderLeft: `3px solid ${C.grn}`,
            borderRadius: 10, padding: "12px 14px", marginBottom: 16, color: C.txt, fontSize: 13.5 }}>
            {notice}
          </div>
        )}

        {/* questions callers asked that she could not answer */}
        {gaps.length > 0 && (
          <div style={{ background: C.surf, border: `1px solid ${C.gold}55`, borderLeft: `3px solid ${C.gold}`, borderRadius: 12,
            boxShadow: "0 1px 2px rgba(15,23,42,0.04)", padding: 22, marginBottom: 20 }}>
            <div style={{ color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 17, fontWeight: 700,
              letterSpacing: "-0.01em", marginBottom: 4 }}>
              Callers asked — Nikki didn&apos;t know <span style={{ color: C.dim, fontSize: 13.5, fontWeight: 500 }}>· {gaps.length}</span>
            </div>
            <div style={{ color: C.mid, fontSize: 13, marginBottom: 14, lineHeight: 1.55 }}>
              Real questions from your calls. Type the answer once and she gives it on every call from now on.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {gaps.map(g => (
                <div key={g.id} style={{ background: "#F8FAFC", border: "1px solid #E4E9F0", borderRadius: 10, padding: 14 }}>
                  <div style={{ color: C.txt, fontSize: 14.5, fontWeight: 600, marginBottom: 3 }}>&ldquo;{g.question}&rdquo;</div>
                  <div style={{ color: C.dim, fontSize: 12.5, marginBottom: 10 }}>
                    {g.times_asked > 1 ? `Asked ${g.times_asked} times` : "Asked once"} · {ago(g.last_asked_at)}
                    {g.caller_said ? <> · caller said: <span style={{ color: C.mid }}>{g.caller_said}</span></> : null}
                  </div>
                  <textarea
                    style={{ ...inputStyle, minHeight: 60, resize: "vertical", marginBottom: 10 }}
                    value={gapDraft[g.id] || ""}
                    onChange={e => setGapDraft(d => ({ ...d, [g.id]: e.target.value }))}
                    placeholder="What should Nikki say? e.g. 100 visiting cards are ₹350, ready in 2 days."
                  />
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button onClick={() => answerGap(g)} disabled={gapBusy === g.id} style={{
                      background: gapBusy === g.id ? "#CBD5E1" : C.glow, color: "#fff", border: "none", borderRadius: 8,
                      padding: "8px 16px", fontSize: 13.5, fontWeight: 600, cursor: gapBusy === g.id ? "not-allowed" : "pointer",
                    }}>{gapBusy === g.id ? "Saving…" : "Teach Nikki"}</button>
                    <button onClick={() => dismissGap(g)} style={{
                      background: C.surf, border: "1px solid #D8DFE8", borderRadius: 8, color: C.mid,
                      padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    }}>Not relevant</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* composer */}
        <div style={{ background: C.surf, border: "1px solid #E4E9F0", borderRadius: 12, boxShadow: "0 1px 2px rgba(15,23,42,0.04)", padding: 22, marginBottom: 20 }}>
          <label style={{ display: "block", color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 17, fontWeight: 700,
            letterSpacing: "-0.01em", marginBottom: 10 }}>
            What should Nikki know?
          </label>
          {/* Say it before the click, not after: the composer used to look
              entirely usable and only explained itself once saving failed. */}
          {!profileId && (
            <div style={{ color: C.mid, fontSize: 13, marginBottom: 10, lineHeight: 1.55 }}>
              Finish <a href="/setup" style={{ color: C.glow, fontWeight: 600 }}>your setup</a> first — Nikki
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
              background: saving ? "#CBD5E1" : C.glow, color: "#fff", border: "none",
              borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
            }}>{saving ? "Saving…" : "Teach Nikki"}</button>
            <span style={{ fontSize: 13, color: C.dim }}>
              Live from her next call. Price lists and long notes are fine.
            </span>
          </div>
        </div>

        {/* suggestions — only while the base is empty */}
        {entries.length === 0 && !loading && (
          <div style={{ background: C.surf, border: "1px solid #E4E9F0", borderRadius: 12, boxShadow: "0 1px 2px rgba(15,23,42,0.04)", padding: 22, marginBottom: 20 }}>
            <div style={{ color: C.txt, fontSize: 15, fontWeight: 700, marginBottom: 3 }}>
              Callers usually ask these
            </div>
            <div style={{ color: C.mid, fontSize: 13, marginBottom: 14 }}>
              Tap one to start — then replace the example with your real details.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
              {SUGGESTIONS.map(s => (
                <button key={s.q} onClick={() => setDraft(s.hint)} style={{
                  background: "#F8FAFC", border: "1px solid #E4E9F0", borderRadius: 10,
                  padding: 14, cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                }}>
                  <div style={{ color: C.txt, fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                    &ldquo;{s.q}&rdquo;
                  </div>
                  <div style={{ color: C.mid, fontSize: 12.5, lineHeight: 1.5 }}>{s.hint}</div>
                </button>
              ))}
            </div>
          </div>
        )}


        {loading ? (
          <p style={{ color: C.mid, textAlign: "center", padding: 24 }}>Loading…</p>
        ) : entries.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", margin: "4px 0 2px" }}>
              What Nikki knows <span style={{ color: C.dim, fontFamily: "var(--font-body), sans-serif", fontSize: 13.5, fontWeight: 500 }}>· {entries.length}</span>
            </div>
            {entries.map(e => (
              <div key={e.id} style={{
                background: C.surf, border: "1px solid #E4E9F0", borderRadius: 12, boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                padding: "16px 18px", display: "flex", gap: 12, alignItems: "flex-start",
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {e.source_name && (
                    <div style={{ display: "inline-block", background: C.glow + "14", color: C.glow, fontSize: 12, fontWeight: 600,
                      borderRadius: 999, padding: "2px 10px", marginBottom: 8 }}>
                      {e.source_name}
                    </div>
                  )}
                  {editing === e.id ? (
                    <>
                      <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical", marginBottom: 8 }}
                        value={editText} onChange={ev => setEditText(ev.target.value)} />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => saveEdit(e.id)} style={{ background: C.glow, color: "#fff", border: "none",
                          borderRadius: 8, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Save</button>
                        <button onClick={() => setEditing(null)} style={{ background: C.surf, border: "1px solid #D8DFE8",
                          borderRadius: 8, color: C.mid, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <div style={{ color: C.txt, fontSize: 14, lineHeight: 1.6,
                      whiteSpace: "pre-wrap" }}>{e.content}</div>
                  )}
                  {/* Calls read the text directly, so a saved fact is live
                      at once — "Learning this…" was waiting on an embedding
                      the phone never uses. */}
                  <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 600, color: C.grn }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Check size={12} /> Nikki uses this on calls</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {editing !== e.id && (
                    <button onClick={() => { setEditing(e.id); setEditText(e.content); }} title="Edit" aria-label="Edit" style={{
                      background: C.surf, border: "1px solid #D8DFE8", borderRadius: 8, color: C.glow,
                      cursor: "pointer", padding: "5px 11px", fontSize: 12.5, fontWeight: 600,
                    }}>Edit</button>
                  )}
                  <button onClick={() => removeEntry(e.id)} title="Remove" aria-label="Remove" style={{
                    background: C.surf, border: "1px solid #D8DFE8", borderRadius: 8, color: C.red,
                    cursor: "pointer", padding: "5px 11px", fontSize: 12.5, fontWeight: 600,
                  }}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
