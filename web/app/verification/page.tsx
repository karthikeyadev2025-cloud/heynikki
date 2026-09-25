"use client";

// ─────────────────────────────────────────────────────────────────────────
// KYC upload — the tenant side of getting a number.
//
// The carrier requires customer verification before a DID is handed over,
// so this is the step that gates onboarding. Files go straight from the
// browser to a PRIVATE Supabase bucket; nothing is proxied through the API
// server, and no public URL is ever produced. Admin review happens through
// short-lived signed URLs on the admin side.
// ─────────────────────────────────────────────────────────────────────────

import WhatsAppNumberChoice from "../../components/WhatsAppNumberChoice";
import { useState, useEffect, useCallback } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import { NIKKI } from "../../lib/brand";
import { Upload, Check, X, Clock, FileText } from "lucide-react";

const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border, teal: NIKKI.teal,
  grn: NIKKI.emerald, red: NIKKI.red, gold: NIKKI.gold,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

const DOC_TYPES = [
  { id: "gst",           label: "GST certificate" },
  { id: "pan",           label: "PAN (business or proprietor)" },
  { id: "business_reg",  label: "Business registration" },
  { id: "address_proof", label: "Address proof" },
  { id: "aadhaar",       label: "Aadhaar" },
  { id: "other",         label: "Other" },
];
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

type Doc = { id: string; doc_type: string; file_name: string | null;
             status: string; review_note: string | null; created_at: string };

export default function VerificationPage() {
  const [tenantId, setTenantId] = useState("");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [type, setType] = useState("gst");
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState("");
  const [ok, setOk]     = useState("");
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const sb = createClient();
    const { data: u } = await sb.auth.getUser();
    if (!u.user) { window.location.href = "/login"; return; }
    const { data: tu } = await sb.from("tenant_users")
      .select("tenant_id").eq("user_id", u.user.id).single();
    if (!tu) { setErr("No business linked to this account yet."); setReady(true); return; }
    setTenantId(tu.tenant_id);

    const { data, error } = await sb.from("kyc_documents")
      .select("id, doc_type, file_name, status, review_note, created_at")
      .eq("tenant_id", tu.tenant_id).order("created_at", { ascending: false });
    // The table ships in migration 017b; say so plainly rather than showing
    // an empty list that looks like nothing was ever uploaded.
    if (error) setErr(error.message.includes("does not exist")
      ? "Verification isn't switched on yet — please contact support."
      : error.message);
    else setDocs(data || []);
    setReady(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  const upload = async (file: File) => {
    setErr(""); setOk("");
    if (!ALLOWED.includes(file.type)) { setErr("JPG, PNG, WEBP or PDF only."); return; }
    if (file.size > MAX_BYTES)        { setErr("File must be under 10 MB."); return; }
    if (!tenantId)                    { setErr("No business linked yet."); return; }

    setBusy(true);
    try {
      const sb = createClient();
      const { data: u } = await sb.auth.getUser();
      const ext  = (file.name.split(".").pop() || "bin").toLowerCase();
      // Path is namespaced by tenant so one tenant can never overwrite
      // another's document, and randomised so filenames are not guessable.
      const path = `${tenantId}/${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error: upErr } = await sb.storage.from("kyc-documents")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error(upErr.message);

      const { error: rowErr } = await sb.from("kyc_documents").insert({
        tenant_id: tenantId, uploaded_by: u.user?.id, doc_type: type,
        storage_path: path, file_name: file.name,
        mime_type: file.type, size_bytes: file.size,
      });
      // Don't leave an orphan object in the bucket if the row fails.
      if (rowErr) {
        await sb.storage.from("kyc-documents").remove([path]).catch(() => {});
        throw new Error(rowErr.message);
      }
      setOk(`${file.name} uploaded — our team will review it.`);
      await load();
    } catch (e: any) { setErr(e.message || "Upload failed"); }
    finally { setBusy(false); }
  };

  const badge = (s: string) => {
    const map: Record<string, [string, React.ReactNode]> = {
      approved: [C.grn,  <Check key="c" size={11} />],
      rejected: [C.red,  <X key="x" size={11} />],
      pending:  [C.gold, <Clock key="p" size={11} />],
    };
    const [c, icon] = map[s] || map.pending;
    return <span style={{ color: c, background: `${c}14`, borderRadius: 999, padding: "3px 9px",
                          fontSize: 11.5, fontWeight: 600,
                          display: "inline-flex", gap: 4, alignItems: "center" }}>{icon}{s === "pending" ? "In review" : s.charAt(0).toUpperCase() + s.slice(1)}</span>;
  };

  return (
    <Shell title="Verification">
      <h1 style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", color: C.txt, margin: "0 0 4px" }}>Verification</h1>
      <p style={{ color: C.mid, fontSize: 14, maxWidth: "68ch", margin: "0 0 20px", lineHeight: 1.6 }}>
        We need to verify your business before we can hand over a phone number —
        this is a requirement from the telecom operator, not us. Upload any one of
        GST, PAN or business registration to get started.
      </p>

      {/* Where they are in the three steps that end with a number. The
          steps are a real sequence, so they are numbered. */}
      {ready && (() => {
        const uploaded = docs.length > 0;
        const approved = docs.some(d => d.status === "approved");
        const steps = [
          { t: "Upload a document", done: uploaded, now: !uploaded },
          { t: "We review it",      done: approved, now: uploaded && !approved, sub: "Usually within one working day" },
          { t: "Your number is assigned", done: false, now: approved, sub: "We WhatsApp you when it's live" },
        ];
        return (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10,
            marginBottom: 20, maxWidth: 720 }}>
            {steps.map((st, i) => {
              const col = st.done ? C.grn : st.now ? C.teal : "#CBD5E1";
              return (
                <div key={st.t} style={{ background: C.surf, border: "1px solid #E4E9F0", borderRadius: 12, boxShadow: "0 1px 2px rgba(15,23,42,0.04)", padding: "12px 14px",
                  display: "flex", gap: 10, alignItems: "flex-start", opacity: st.done || st.now ? 1 : 0.7 }}>
                  <span style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, display: "inline-flex",
                    alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700,
                    background: st.done ? C.grn : st.now ? C.teal + "14" : "#F1F4F8",
                    color: st.done ? "#fff" : col, border: st.now ? `1px solid ${C.teal}55` : "none" }}>
                    {st.done ? <Check size={13} /> : i + 1}
                  </span>
                  <div>
                    <div style={{ color: C.txt, fontSize: 13.5, fontWeight: 600 }}>{st.t}</div>
                    {st.sub && <div style={{ color: C.mid, fontSize: 12, marginTop: 2 }}>{st.sub}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {err && <Note tone="err">{err}</Note>}
      {ok  && <Note tone="ok">{ok}</Note>}
      {/* Say where they stand before asking for another file. */}
      {ready && docs.some(d => d.status === "approved") && (
        <Note tone="ok">Your business is verified — nothing more to upload unless we ask.</Note>
      )}
      {ready && !docs.some(d => d.status === "approved") && docs.some(d => d.status === "pending") && (
        <Note tone="ok">Your document is with us for review — usually within one working day.</Note>
      )}

      <div style={{ background: C.surf, border: "1px solid #E4E9F0", borderRadius: 12, boxShadow: "0 1px 2px rgba(15,23,42,0.04)", padding: 22, marginBottom: 18, maxWidth: 720 }}>
        <div style={{ color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 14 }}>
          Upload a document
        </div>
        <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: C.mid, marginBottom: 6 }}>
          Document type
        </label>
        <select value={type} onChange={e => setType(e.target.value)}
                style={{ background: C.surf, color: C.txt, border: "1px solid #D8DFE8",
                         borderRadius: 8, padding: "9px 12px", fontSize: 14, width: "100%",
                         marginBottom: 14 }}>
          {DOC_TYPES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>

        <label style={{ display: "inline-flex", gap: 8, alignItems: "center", cursor: busy ? "wait" : "pointer",
                        background: C.teal, color: "#fff", borderRadius: 8,
                        padding: "10px 18px", fontSize: 14, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>
          <Upload size={14} /> {busy ? "Uploading…" : "Choose file"}
          <input type="file" disabled={busy} style={{ display: "none" }}
                 accept={ALLOWED.join(",")}
                 onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ""; }} />
        </label>
        <span style={{ color: C.dim, fontSize: 12.5, marginLeft: 12 }}>
          JPG, PNG, WEBP or PDF · up to 10 MB
        </span>
      </div>

      <div style={{ maxWidth: 720, background: C.surf, border: "1px solid #E4E9F0", borderRadius: 12, boxShadow: "0 1px 2px rgba(15,23,42,0.04)", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #EEF2F6", color: C.txt, fontSize: 15, fontWeight: 700 }}>
          Your documents
        </div>
        {!ready && <p style={{ color: C.mid, fontSize: 13, padding: "0 18px" }}>Loading…</p>}
        {ready && docs.length === 0 && !err && (
          <p style={{ color: C.mid, fontSize: 13.5, padding: "4px 18px 8px" }}>Nothing uploaded yet.</p>
        )}
        {docs.map((d, i) => (
          <div key={d.id} style={{ display: "flex", gap: 12, alignItems: "center",
                                   padding: "12px 18px", borderTop: i === 0 ? "none" : "1px solid #EEF2F6" }}>
            <span style={{ width: 32, height: 32, borderRadius: 8, background: "#F1F4F8", color: C.mid, flexShrink: 0,
              display: "inline-flex", alignItems: "center", justifyContent: "center" }}><FileText size={15} /></span>
            <span style={{ flex: 1, minWidth: 0, color: C.txt, fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" }}>
              {d.file_name || d.doc_type}
              <span style={{ display: "block", color: C.dim, fontSize: 12.5, fontWeight: 400, marginTop: 1 }}>
                {DOC_TYPES.find(t => t.id === d.doc_type)?.label || d.doc_type}
              </span>
              {d.review_note && (
                <span style={{ display: "block", color: C.red, fontSize: 12.5, fontWeight: 500, marginTop: 3 }}>
                  {d.review_note}
                </span>
              )}
            </span>
            {badge(d.status)}
          </div>
        ))}
      </div>
      <WhatsAppNumberChoice />

    </Shell>
  );
}

function Note({ tone, children }: { tone: "ok" | "err"; children: React.ReactNode }) {
  const c = tone === "ok" ? C.grn : C.red;
  return <div style={{ background: `${c}0A`, border: `1px solid ${c}44`, borderLeft: `3px solid ${c}`,
                       color: tone === "ok" ? C.txt : c,
                       borderRadius: 10, padding: "10px 14px", fontSize: 13.5,
                       marginBottom: 12, maxWidth: 720 }}>{children}</div>;
}
