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

import { useState, useEffect, useCallback } from "react";
import Shell from "../../components/Shell";
import { createClient } from "../../lib/supabase";
import { Upload, Check, X, Clock, FileText } from "lucide-react";

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
    // The table ships in migration 017; say so plainly rather than showing
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
      approved: ["#10B981", <Check key="c" size={11} />],
      rejected: ["#F87171", <X key="x" size={11} />],
      pending:  ["#F59E0B", <Clock key="p" size={11} />],
    };
    const [c, icon] = map[s] || map.pending;
    return <span style={{ color: c, background: `${c}18`, border: `1px solid ${c}44`,
                          borderRadius: 20, padding: "2px 8px", fontSize: 11,
                          display: "inline-flex", gap: 4, alignItems: "center" }}>{icon}{s}</span>;
  };

  return (
    <Shell title="Verification">
      <p style={{ color: "#94A3B8", fontSize: 13, maxWidth: "62ch", marginTop: 0 }}>
        We need to verify your business before we can hand over a phone number —
        this is a requirement from the telecom operator, not us. Upload any one of
        GST, PAN or business registration to get started.
      </p>

      {err && <Note tone="err">{err}</Note>}
      {ok  && <Note tone="ok">{ok}</Note>}

      <div style={{ background: "#0F172A", border: "1px solid #1E293B", borderRadius: 10,
                    padding: 16, marginBottom: 18, maxWidth: 560 }}>
        <label style={{ display: "block", fontSize: 11, color: "#94A3B8", marginBottom: 6 }}>
          Document type
        </label>
        <select value={type} onChange={e => setType(e.target.value)}
                style={{ background: "#0B1220", color: "#E2E8F0", border: "1px solid #1E293B",
                         borderRadius: 7, padding: "8px 10px", fontSize: 13, width: "100%",
                         marginBottom: 12 }}>
          {DOC_TYPES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>

        <label style={{ display: "inline-flex", gap: 8, alignItems: "center", cursor: busy ? "wait" : "pointer",
                        background: "#38BDF8", color: "#06121F", borderRadius: 7,
                        padding: "9px 16px", fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
          <Upload size={14} /> {busy ? "Uploading…" : "Choose file"}
          <input type="file" disabled={busy} style={{ display: "none" }}
                 accept={ALLOWED.join(",")}
                 onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ""; }} />
        </label>
        <span style={{ color: "#64748B", fontSize: 11, marginLeft: 10 }}>
          JPG, PNG, WEBP or PDF · up to 10 MB
        </span>
      </div>

      <div style={{ maxWidth: 720 }}>
        {!ready && <p style={{ color: "#64748B", fontSize: 12 }}>Loading…</p>}
        {ready && docs.length === 0 && (
          <p style={{ color: "#64748B", fontSize: 12 }}>Nothing uploaded yet.</p>
        )}
        {docs.map(d => (
          <div key={d.id} style={{ display: "flex", gap: 12, alignItems: "center",
                                   padding: "10px 12px", borderBottom: "1px solid #1E293B" }}>
            <FileText size={15} color="#64748B" />
            <span style={{ flex: 1, color: "#E2E8F0", fontSize: 13 }}>
              {d.file_name || d.doc_type}
              <span style={{ color: "#64748B", fontSize: 11, marginLeft: 8 }}>
                {DOC_TYPES.find(t => t.id === d.doc_type)?.label || d.doc_type}
              </span>
              {d.review_note && (
                <span style={{ display: "block", color: "#F87171", fontSize: 11, marginTop: 2 }}>
                  {d.review_note}
                </span>
              )}
            </span>
            {badge(d.status)}
          </div>
        ))}
      </div>
    </Shell>
  );
}

function Note({ tone, children }: { tone: "ok" | "err"; children: React.ReactNode }) {
  const c = tone === "ok" ? "#10B981" : "#F87171";
  return <div style={{ background: `${c}18`, border: `1px solid ${c}44`, color: c,
                       borderRadius: 8, padding: "8px 12px", fontSize: 12,
                       marginBottom: 12, maxWidth: 560 }}>{children}</div>;
}
