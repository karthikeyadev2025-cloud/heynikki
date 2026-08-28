"use client";

/**
 * Recipient import for an outbound campaign.
 *
 * The file is parsed IN THE BROWSER and only clean rows are sent. Three
 * reasons that is the right split rather than posting the raw file:
 *
 *  - the person uploading sees exactly which rows are wrong, with the row
 *    number Excel shows them, before anything is committed. Fixing a sheet is
 *    the normal workflow, not the exception.
 *  - a spreadsheet is a hostile input format. Parsing it in a sandboxed tab
 *    rather than on the server that holds every tenant's data is the smaller
 *    blast radius.
 *  - the server keeps one code path — a rows array — whether the source was
 *    .xlsx, .csv, or a paste.
 *
 * SheetJS is imported dynamically so the ~400KB parser is only fetched when
 * someone actually picks a spreadsheet. A .csv never loads it: that path is
 * a plain FileReader, and the server re-parses CSV itself anyway.
 */

import { useState, useCallback } from "react";
import { createClient } from "../lib/supabase";
import { NIKKI } from "../lib/brand";
import { Upload, AlertTriangle, CheckCircle2, Loader2, FileSpreadsheet } from "lucide-react";

const C = {
  surf: NIKKI.surface, bord: NIKKI.border, txt: NIKKI.text,
  mid: NIKKI.textMid, dim: NIKKI.textDim, red: NIKKI.red,
  grn: NIKKI.emerald, hi: NIKKI.vault,
};

type Parsed = { phone: string; name: string; row: number };
type Bad    = { row: number; value: string; why: string };

const PHONE_KEYS = ["phone", "mobile", "number", "phone number", "mobile number",
                    "contact", "contact number", "phone_no", "mob", "cell", "whatsapp"];
const NAME_KEYS  = ["name", "first name", "first_name", "customer name",
                    "full name", "fullname", "contact name", "client name"];

const norm = (h: string) => String(h ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

function pickColumn(header: string[], keys: string[]): number {
  const h = header.map(norm);
  for (const k of keys) { const i = h.indexOf(k); if (i !== -1) return i; }
  for (let i = 0; i < h.length; i++) if (keys.some(k => h[i].includes(k))) return i;
  return -1;
}

/** Mirrors the server's rule exactly — a row accepted here must not be rejected there. */
function normalizePhone(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  let ten: string;
  if (digits.length === 10)                                 ten = digits;
  else if (digits.length === 11 && digits.startsWith("0"))   ten = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith("91"))  ten = digits.slice(2);
  else if (digits.length === 13 && digits.startsWith("091")) ten = digits.slice(3);
  else return null;
  return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null;
}

export default function RecipientImport({
  campaignId, onDone,
}: { campaignId: string; onDone?: (n: number) => void }) {
  const [rows, setRows]       = useState<Parsed[]>([]);
  const [bad, setBad]         = useState<Bad[]>([]);
  const [fileName, setFile]   = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState("");
  const [result, setResult]   = useState<any>(null);

  const ingest = useCallback((table: any[][]) => {
    setError(""); setResult(null);
    if (table.length < 2) { setError("Need a header row and at least one data row."); return; }

    const header = (table[0] || []).map((c: any) => String(c ?? ""));
    const pCol = pickColumn(header, PHONE_KEYS);
    const nCol = pickColumn(header, NAME_KEYS);
    if (pCol === -1) {
      setError(`No phone column found. Rename one to "phone". Columns seen: ${header.join(", ")}`);
      return;
    }

    const good: Parsed[] = [];
    const bads: Bad[] = [];
    const seen = new Set<string>();

    table.slice(1).forEach((r, i) => {
      const rowNo = i + 2;                       // header is row 1, Excel is 1-based
      const raw   = r?.[pCol];
      if (raw === undefined || String(raw).trim() === "") return;   // genuinely blank
      const phone = normalizePhone(raw);
      if (!phone)          { bads.push({ row: rowNo, value: String(raw), why: "not a valid Indian mobile" }); return; }
      if (seen.has(phone)) { bads.push({ row: rowNo, value: phone,       why: "duplicate in this file" });    return; }
      seen.add(phone);
      good.push({ phone, name: nCol !== -1 ? String(r?.[nCol] ?? "").trim() : "", row: rowNo });
    });

    setRows(good); setBad(bads);
  }, []);

  const onFile = useCallback(async (f: File) => {
    setFile(f.name); setRows([]); setBad([]); setResult(null); setError("");
    try {
      if (/\.(xlsx|xls)$/i.test(f.name)) {
        const XLSX = await import("xlsx");
        const wb   = XLSX.read(await f.arrayBuffer(), { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        // header:1 gives an array-of-arrays, so a sheet with duplicate or
        // missing header names still parses positionally.
        ingest(XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: false }) as any[][]);
      } else {
        // CSV: hand to the server's parser by keeping the text intact. Parsed
        // here too, only to show the preview.
        const text = await f.text();
        const { parseCsvClient } = await import("../lib/csv");
        ingest(parseCsvClient(text));
      }
    } catch (e: any) {
      setError(`Could not read that file: ${e.message}`);
    }
  }, [ingest]);

  const submit = async () => {
    setBusy(true); setError(""); setResult(null);
    try {
      const sb = createClient();
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { setError("Session expired — sign in again."); setBusy(false); return; }

      const api = process.env.NEXT_PUBLIC_API_URL || "";
      const r = await fetch(`${api}/api/campaigns/${campaignId}/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          rows: rows.map(x => ({ phone: x.phone, name: x.name })),
          consent_declared: consent,
        }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j.error || `Import failed (${r.status})`); setBusy(false); return; }
      setResult(j);
      onDone?.(j.inserted);
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  };

  const box: React.CSSProperties = {
    background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12, padding: 20,
  };

  return (
    <div style={box}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <FileSpreadsheet size={16} color={C.grn} />
        <strong style={{ color: C.txt, fontSize: 15 }}>Import recipients</strong>
      </div>
      <div style={{ color: C.mid, fontSize: 13, marginBottom: 14 }}>
        Excel (.xlsx) or CSV. Needs a column named <code>phone</code> — <code>mobile</code>,{" "}
        <code>contact number</code> and similar are recognised too. A <code>name</code> column is optional.
      </div>

      <label style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        border: `1px dashed ${C.bord}`, borderRadius: 10, padding: "18px 12px",
        cursor: "pointer", color: C.mid, fontSize: 14, background: C.hi,
      }}>
        <Upload size={16} />
        {fileName || "Choose a file"}
        <input
          type="file" accept=".xlsx,.xls,.csv,text/csv"
          style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }}
        />
      </label>

      {error && (
        <div role="alert" style={{
          marginTop: 12, background: "#FEF2F2", border: "1px solid #FECACA",
          color: C.red, padding: "10px 12px", borderRadius: 8, fontSize: 13,
        }}>{error}</div>
      )}

      {(rows.length > 0 || bad.length > 0) && !result && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", gap: 16, fontSize: 13, marginBottom: 10 }}>
            <span style={{ color: C.grn, fontWeight: 700 }}>{rows.length} ready</span>
            {bad.length > 0 && <span style={{ color: C.red, fontWeight: 700 }}>{bad.length} skipped</span>}
          </div>

          {bad.length > 0 && (
            <div style={{
              maxHeight: 132, overflowY: "auto", border: `1px solid ${C.bord}`,
              borderRadius: 8, padding: 10, fontSize: 12, color: C.mid, marginBottom: 12,
            }}>
              {bad.slice(0, 50).map((b, i) => (
                <div key={i}>Row {b.row}: <code>{b.value || "(empty)"}</code> — {b.why}</div>
              ))}
              {bad.length > 50 && <div style={{ color: C.dim }}>…and {bad.length - 50} more</div>}
            </div>
          )}

          {/* Consent is the gate. With no DND scrub feed configured, this
              declaration is what permits dialling at all, and the server
              records who made it. */}
          <label style={{
            display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13,
            color: C.txt, background: C.hi, border: `1px solid ${C.bord}`,
            borderRadius: 8, padding: 12, marginBottom: 12, cursor: "pointer",
          }}>
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}
                   style={{ marginTop: 2 }} />
            <span>
              I confirm every number on this list gave us permission to call them —
              they are existing customers, enquiries or opt-ins.
              <span style={{ display: "block", color: C.mid, marginTop: 4, fontSize: 12 }}>
                Calling numbers on India&apos;s DND registry without consent can get the
                trunk suspended. This declaration is recorded against your account.
              </span>
            </span>
          </label>

          <button
            onClick={submit}
            disabled={busy || rows.length === 0 || !consent}
            style={{
              width: "100%", padding: 12, borderRadius: 10, border: "none",
              fontSize: 14, fontWeight: 700, color: "#fff",
              background: (busy || !consent || rows.length === 0) ? C.dim : C.grn,
              cursor: (busy || !consent || rows.length === 0) ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
            {busy ? <><Loader2 size={15} /> Importing…</> : <>Import {rows.length} recipients</>}
          </button>
        </div>
      )}

      {result && (
        <div style={{
          marginTop: 14, background: "#ECFDF5", border: "1px solid #A7F3D0",
          borderRadius: 8, padding: 12, fontSize: 13, color: "#065F46",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
            <CheckCircle2 size={15} /> Imported {result.inserted}
          </div>
          <div style={{ marginTop: 6, color: C.mid }}>
            Skipped — invalid {result.skipped?.invalid ?? 0}, duplicates {result.skipped?.duplicates ?? 0},
            opted out {result.skipped?.opted_out ?? 0}, already on this campaign {result.skipped?.already_present ?? 0}.
          </div>
          {(result.skipped?.opted_out ?? 0) > 0 && (
            <div style={{ marginTop: 6, display: "flex", gap: 6, color: "#92400E" }}>
              <AlertTriangle size={14} />
              Opted-out numbers are never dialled, regardless of the file.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
