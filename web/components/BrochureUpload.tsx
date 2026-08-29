"use client";
// web/components/BrochureUpload.tsx
// ────────────────────────────────────────────────────────────────
// The half of onboarding that does not involve typing.
//
// A clinic already has a brochure. A restaurant has a menu. All of it says
// what they do, when they open and what they charge — which is exactly
// what the form below this asks them to retype, and exactly why the form
// sits half-finished.
//
// Upload it, Nikki reads it, and what she found comes back as a card the
// owner accepts or rejects. Never applied silently: a brochure is evidence,
// not instruction, and a stale PDF should not be able to change when a
// business answers its phone.
// ────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "../lib/supabase";
import { NIKKI } from "../lib/brand";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, gbr: NIKKI.tealLight, gold: NIKKI.gold,
  grn: NIKKI.emerald, red: NIKKI.red,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";
const MAX_MB = 8;

/** Human labels for the fields a document may propose. The API whitelist is
 *  the real guard; this only decides what the card is able to describe. */
const LABELS: Record<string, string> = {
  business_name:     "Business name",
  services:          "Services",
  appointment_types: "Appointment types",
  open_time:         "Opens",
  close_time:        "Closes",
  open_days:         "Open days",
  fallback_message:  "Fallback message",
};

type Draft = { id: string; proposed: Record<string, any>; created_at: string };

export default function BrochureUpload({ onApplied }: { onApplied?: () => void }) {
  const [drafts, setDrafts]   = useState<Draft[]>([]);
  const [busy, setBusy]       = useState(false);
  const [status, setStatus]   = useState("");
  const [error, setError]     = useState("");
  const [dragging, setDrag]   = useState(false);
  const inputRef              = useRef<HTMLInputElement>(null);
  const pollRef               = useRef<ReturnType<typeof setInterval> | null>(null);

  const authed = useCallback(async (path: string, init?: RequestInit) => {
    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error("Please sign in again.");
    return fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
    });
  }, []);

  const loadDrafts = useCallback(async () => {
    try {
      const r = await authed("/api/profile-drafts");
      const j = await r.json();
      setDrafts(j.drafts || []);
      return (j.drafts || []).length as number;
    } catch { return 0; }
  }, [authed]);

  useEffect(() => { loadDrafts(); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, [loadDrafts]);

  const upload = async (file: File) => {
    setError(""); setStatus("");
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`That file is ${(file.size / 1e6).toFixed(1)}MB. The limit is ${MAX_MB}MB.`);
      return;
    }
    setBusy(true);
    setStatus("Nikki is reading it…");
    try {
      // Strip the data: prefix — the API wants raw base64.
      const b64: string = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload  = () => resolve(String(fr.result).split(",")[1] || "");
        fr.onerror = () => reject(new Error("Could not read that file"));
        fr.readAsDataURL(file);
      });

      const r = await authed("/api/assets", {
        method: "POST",
        body: JSON.stringify({
          file_name: file.name, mime_type: file.type || "application/pdf",
          data_base64: b64,
          kind: /logo/i.test(file.name) ? "logo" : "brochure",
        }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j.error || `Upload failed (${r.status})`); setBusy(false); setStatus(""); return; }

      // Extraction runs server-side within a few seconds. Poll briefly rather
      // than leave the page looking like nothing happened, and stop either
      // way — a document with nothing readable in it produces no draft, and
      // that is a real outcome, not a failure to report as one.
      let tries = 0;
      pollRef.current = setInterval(async () => {
        tries += 1;
        const n = await loadDrafts();
        if (n > 0 || tries >= 12) {
          if (pollRef.current) clearInterval(pollRef.current);
          setBusy(false);
          setStatus(n > 0
            ? ""
            : "Nikki could not find business details in that file. A brochure or price list works better than a logo.");
        }
      }, 2500);
    } catch (e: any) {
      setError(e.message); setBusy(false); setStatus("");
    }
  };

  const decide = async (id: string, action: "apply" | "dismiss") => {
    setBusy(true); setError("");
    try {
      const r = await authed(`/api/profile-drafts/${id}/${action}`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) setError(j.error || "Could not save that");
      else {
        setDrafts(d => d.filter(x => x.id !== id));
        if (action === "apply") { setStatus("Applied to your setup below."); onApplied?.(); }
      }
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const show = (v: any) => Array.isArray(v) ? v.join(", ") : String(v);

  return (
    <div style={{
      background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 14,
      padding: 18, marginBottom: 20,
    }}>
      <div style={{ color: C.txt, fontSize: 15, fontWeight: 800, marginBottom: 4 }}>
        Already have a brochure?
      </div>
      <div style={{ color: C.mid, fontSize: 13, lineHeight: 1.55, marginBottom: 14 }}>
        Upload your brochure, menu, price list or a photo of your board.
        Nikki reads it and fills the form below — you check it before anything changes.
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => {
          e.preventDefault(); setDrag(false);
          const f = e.dataTransfer.files?.[0]; if (f && !busy) upload(f);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && !busy) inputRef.current?.click(); }}
        style={{
          border: `1.5px dashed ${dragging ? C.glow : C.bord}`,
          background: dragging ? C.glow + "0F" : C.hi,
          borderRadius: 12, padding: "22px 16px", textAlign: "center",
          cursor: busy ? "wait" : "pointer", transition: "border-color .15s, background .15s",
        }}>
        <div style={{ color: busy ? C.gbr : C.txt, fontSize: 13.5, fontWeight: 700 }}>
          {busy ? (status || "Working…") : "Drop a file here, or click to choose"}
        </div>
        <div style={{ color: C.dim, fontSize: 11.5, marginTop: 5 }}>
          PDF or photo · up to {MAX_MB}MB
        </div>
      </div>
      <input ref={inputRef} type="file" accept={ACCEPT} hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />

      {error && (
        <div style={{ color: C.red, fontSize: 12.5, marginTop: 10 }}>{error}</div>
      )}
      {!busy && status && !drafts.length && (
        <div style={{ color: C.mid, fontSize: 12.5, marginTop: 10 }}>{status}</div>
      )}

      {drafts.map(d => {
        const fields = Object.entries(d.proposed || {})
          .filter(([k, v]) => LABELS[k] && v != null && !(Array.isArray(v) && !v.length));
        if (!fields.length) return null;
        return (
          <div key={d.id} style={{
            marginTop: 14, border: `1px solid ${C.grn}55`, borderRadius: 12,
            background: C.grn + "0D", padding: 14,
          }}>
            <div style={{ color: C.txt, fontSize: 13.5, fontWeight: 800, marginBottom: 2 }}>
              Nikki read this from your file
            </div>
            <div style={{ color: C.mid, fontSize: 12, marginBottom: 10 }}>
              Nothing changes until you apply it.
            </div>

            <div style={{ display: "grid", gap: 7, marginBottom: 12 }}>
              {fields.map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 10, fontSize: 12.5, lineHeight: 1.5 }}>
                  <div style={{ color: C.dim, minWidth: 128, flex: "none" }}>{LABELS[k]}</div>
                  <div style={{ color: C.txt }}>{show(v)}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => decide(d.id, "apply")} disabled={busy}
                style={{
                  padding: "8px 16px", borderRadius: 8, border: "none",
                  background: C.grn, color: "#04120a", fontSize: 13, fontWeight: 800,
                  cursor: busy ? "not-allowed" : "pointer",
                }}>Apply to my setup</button>
              <button type="button" onClick={() => decide(d.id, "dismiss")} disabled={busy}
                style={{
                  padding: "8px 14px", borderRadius: 8, background: "transparent",
                  border: `1px solid ${C.bord}`, color: C.mid, fontSize: 13,
                  cursor: busy ? "not-allowed" : "pointer",
                }}>Discard</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
