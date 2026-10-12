// components/TeamLists.tsx
//
// A list of numbers in, shared out to the team, and a view of who is
// holding what. The owner's side of the calling floor: telecallers work
// what lands in their Desk queue.
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Shuffle, Upload, Users, X } from "lucide-react";
import { NIKKI } from "../lib/brand";
import { deskApi } from "../lib/desk-api";
import { toast } from "./Toast";

const C = { txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim, bord: NIKKI.border, surf: NIKKI.surface,
  hi: NIKKI.vault, teal: NIKKI.teal, red: NIKKI.red, grn: NIKKI.emerald, gold: NIKKI.gold };

export type Member = { user_id: string; name: string; role: string; is_you: boolean;
  open: number; untouched: number; callbacks_due: number; calls_today: number; no_outcome: number };
type Pool = { open: number; untouched: number; callbacks_due: number };
export type TeamLoad = { members: Member[]; pool: Pool };

/** The team and what each person holds. `null` for anyone but the owner. */
export function useTeamLoad() {
  const [load, setLoad] = useState<TeamLoad | null>(null);
  const reload = useCallback(async () => {
    try {
      const [l, t] = await Promise.all([deskApi("/api/leads/team-load"), deskApi("/api/team").catch(() => ({ members: [] }))]);
      // A seat with no display name is known by its email.
      const email = new Map<string, string>((t.members || []).map((m: any) => [m.user_id, String(m.email || "").split("@")[0]]));
      setLoad({ pool: l.pool, members: (l.members || []).map((m: Member) => ({ ...m, name: m.name || email.get(m.user_id) || "Team member" })) });
    } catch { setLoad(null); }      // 403 for a telecaller: they do not see this
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { load, reload };
}

const label = (m: Member) => m.is_you ? `${m.name} (you)` : m.name;
const n = (v: number) => v.toLocaleString("en-IN");
const btn = (primary = false): React.CSSProperties => ({
  padding: "9px 14px", borderRadius: 9, fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6,
  border: primary ? 0 : `1px solid ${C.bord}`, background: primary ? C.teal : C.surf, color: primary ? "#fff" : C.txt });

/** Tick who gets a share. Nobody ticked means "leave unassigned". */
function PickPeople({ members, picked, onChange, exclude }: {
  members: Member[]; picked: string[]; onChange: (ids: string[]) => void; exclude?: string }) {
  const list = members.filter(m => m.user_id !== exclude);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {list.map(m => {
        const on = picked.includes(m.user_id);
        return (
          <label key={m.user_id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 9,
            border: `1px solid ${on ? C.teal + "88" : C.bord}`, background: on ? C.teal + "0A" : C.surf, fontSize: 14, color: C.txt, cursor: "pointer" }}>
            <input type="checkbox" checked={on} onChange={() => onChange(on ? picked.filter(i => i !== m.user_id) : [...picked, m.user_id])} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{label(m)}</span>
            <span style={{ fontSize: 12, color: C.mid }}>holding {n(m.open)}</span>
          </label>
        );
      })}
      {list.length > 1 && (
        <button type="button" onClick={() => onChange(picked.length === list.length ? [] : list.map(m => m.user_id))}
          style={{ justifySelf: "start", background: "none", border: 0, color: C.teal, fontSize: 13, fontWeight: 600, padding: "2px 0" }}>
          {picked.length === list.length ? "Untick everyone" : "Tick everyone"}
        </button>
      )}
    </div>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 80,
      background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.surf, borderRadius: 14, width: "100%", maxWidth: 520,
        maxHeight: "90vh", overflowY: "auto", padding: 20, boxShadow: "0 20px 50px rgba(15,23,42,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0, flex: 1, fontSize: 18, fontWeight: 700, color: C.txt }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: 0, color: C.mid, padding: 4, lineHeight: 0 }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const MOBILE = /^[6-9]\d{9}$/;
function tenDigits(v: unknown): string {
  let s = String(v ?? "").trim();
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) s = Number(s).toFixed(0);
  let d = s.replace(/\.0+$/, "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}

/**
 * Rows of a sheet → {phone, name, note}. A file of nothing but numbers is
 * the common case, so no heading is required: the phone column is whichever
 * one holds the most mobile numbers.
 */
export function readSheet(grid: any[][]): { rows: { phone: string; name?: string; note?: string }[]; skipped: number } {
  const rows = grid.filter(r => Array.isArray(r) && r.some(c => String(c ?? "").trim()));
  if (!rows.length) return { rows: [], skipped: 0 };
  const width = Math.max(...rows.slice(0, 50).map(r => r.length));
  const hits = Array.from({ length: width }, (_, c) => rows.slice(0, 200).filter(r => MOBILE.test(tenDigits(r[c]))).length);
  const iPhone = hits.indexOf(Math.max(...hits));
  const head = rows[0].map(c => String(c ?? "").toLowerCase());
  const hasHead = !MOBILE.test(tenDigits(rows[0][iPhone])) && head.some(h => /name|phone|mobile|number|contact/.test(h));
  const find = (re: RegExp) => hasHead ? head.findIndex((h, i) => i !== iPhone && re.test(h)) : -1;
  const iName = find(/name/), iNote = find(/interest|note|remark|product|requirement|city|area/);
  const out: { phone: string; name?: string; note?: string }[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const r of rows.slice(hasHead ? 1 : 0)) {
    const phone = tenDigits(r[iPhone]);
    if (!MOBILE.test(phone) || seen.has(phone)) { skipped += 1; continue; }
    seen.add(phone);
    out.push({ phone, name: iName >= 0 ? String(r[iName] ?? "").trim() : undefined, note: iNote >= 0 ? String(r[iNote] ?? "").trim() : undefined });
  }
  return { rows: out, skipped };
}

/** "Upload list": Excel, CSV or pasted numbers, shared between chosen people. */
export function UploadList({ load, onDone }: { load: TeamLoad; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<{ rows: any[]; skipped: number; file: string } | null>(null);
  const [paste, setPaste] = useState("");
  const [listName, setListName] = useState("");
  const [to, setTo] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);

  const reset = () => { setParsed(null); setPaste(""); setListName(""); setDone(null); setTo([]); };
  const close = () => { setOpen(false); reset(); };

  const readFile = async (f: File) => {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const r = readSheet(XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: true }) as any[][]);
      if (!r.rows.length) { toast.err("No 10-digit Indian mobile numbers found in that file."); return; }
      setParsed({ ...r, file: f.name });
      if (!listName) setListName(f.name.replace(/\.[^.]+$/, "").replace(/[^\w .&()-]/g, " ").trim().slice(0, 40));
    } catch { toast.err("Could not read that file. Save it as .xlsx or .csv and try again."); }
  };
  const readPaste = () => {
    const r = readSheet(paste.split(/[\n,;]+/).map(v => [v]));
    if (!r.rows.length) { toast.err("No 10-digit Indian mobile numbers found."); return; }
    setParsed({ ...r, file: "pasted numbers" });
  };

  const each = to.length && parsed ? Math.floor(parsed.rows.length / to.length) : 0;
  const run = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      setDone(await deskApi("/api/leads/import", { rows: parsed.rows, assign_to: to, list_name: listName }));
      onDone();
    } catch (e: any) { toast.err(e.message); }
    setBusy(false);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={btn()}><Upload size={14} /> Upload list</button>
      {open && (
        <Dialog title={done ? "List added" : "Upload a list of numbers"} onClose={close}>
          {done ? (
            <>
              <div style={{ fontSize: 15, color: C.txt, lineHeight: 1.6 }}>
                <strong>{n(done.added)}</strong> new number{done.added === 1 ? "" : "s"} added{done.list_name ? <> under the tag <strong>{done.list_name}</strong></> : null}.
              </div>
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: C.mid, fontSize: 13.5, lineHeight: 1.7 }}>
                {done.shared.map((s: any) => <li key={s.user_id}><strong style={{ color: C.txt }}>{s.name}</strong> got {n(s.count)}</li>)}
                {!done.shared.length && done.added > 0 && <li>Left unassigned — anyone on the team can pick them up from the Desk.</li>}
                {done.existing > 0 && <li>{n(done.existing)} were already in your leads, so they were left as they are.</li>}
                {done.opted_out > 0 && <li>{n(done.opted_out)} had asked not to be contacted and were left out.</li>}
                {done.invalid + done.repeated > 0 && <li>{n(done.invalid + done.repeated)} were not valid mobiles or were repeated.</li>}
              </ul>
              <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                <button type="button" onClick={close} style={btn(true)}>Done</button>
                <button type="button" onClick={reset} style={btn()}>Upload another</button>
              </div>
            </>
          ) : !parsed ? (
            <>
              <label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "26px 16px", borderRadius: 12,
                border: `2px dashed ${C.bord}`, background: C.hi, cursor: "pointer", textAlign: "center" }}
                onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) readFile(f); }}>
                <FileSpreadsheet size={26} color={C.teal} />
                <span style={{ fontSize: 15, fontWeight: 700, color: C.txt }}>Choose an Excel or CSV file</span>
                <span style={{ fontSize: 13, color: C.mid, lineHeight: 1.5 }}>A single column of mobile numbers is enough. Names and notes are picked up if the file has them. Up to 5,000 numbers at a time.</span>
                <input type="file" accept=".xlsx,.xls,.csv,.txt,text/csv" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />
              </label>
              <div style={{ fontSize: 13, color: C.mid, fontWeight: 600, margin: "14px 0 6px" }}>Or paste numbers</div>
              <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={4} placeholder={"9876543210\n9123456780"} aria-label="Paste numbers"
                style={{ width: "100%", border: `1px solid ${C.bord}`, borderRadius: 9, padding: 10, fontSize: 14, fontFamily: "var(--font-mono), monospace", resize: "vertical" }} />
              <button type="button" onClick={readPaste} disabled={!paste.trim()} style={{ ...btn(), marginTop: 8, opacity: paste.trim() ? 1 : 0.5 }}>Use these numbers</button>
            </>
          ) : (
            <>
              <div style={{ background: C.hi, border: `1px solid ${C.bord}`, borderRadius: 10, padding: "10px 12px", fontSize: 14, color: C.txt, lineHeight: 1.55 }}>
                <strong>{n(parsed.rows.length)}</strong> mobile number{parsed.rows.length === 1 ? "" : "s"} in {parsed.file}
                {parsed.skipped > 0 && <span style={{ color: C.mid }}> · {n(parsed.skipped)} row{parsed.skipped === 1 ? "" : "s"} skipped (not a mobile, or repeated)</span>}
                {parsed.rows.length > 5000 && <div style={{ color: C.red, fontWeight: 600 }}>That is more than 5,000. Split the file and upload it in parts.</div>}
              </div>
              <div style={{ fontSize: 13, color: C.mid, fontWeight: 600, margin: "14px 0 6px" }}>Name this list (it becomes a tag you can filter by)</div>
              <input value={listName} onChange={e => setListName(e.target.value.slice(0, 40))} placeholder="e.g. Expo October"
                aria-label="List name" style={{ width: "100%", border: `1px solid ${C.bord}`, borderRadius: 9, padding: "9px 11px", fontSize: 14 }} />
              <div style={{ fontSize: 13, color: C.mid, fontWeight: 600, margin: "14px 0 6px" }}>Share between</div>
              <PickPeople members={load.members} picked={to} onChange={setTo} />
              <div style={{ fontSize: 13, color: C.mid, margin: "10px 0 0", lineHeight: 1.5 }}>
                {to.length === 0 ? "Nobody ticked: the numbers stay unassigned and anyone on the team can pick them up."
                  : to.length === 1 ? "All of them go to this person's calling queue."
                  : `About ${n(each)} each. Whoever is holding fewer leads gets the first ones.`}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                <button type="button" onClick={run} disabled={busy || parsed.rows.length > 5000} style={{ ...btn(true), opacity: busy ? 0.6 : 1 }}>
                  {busy ? "Adding…" : `Add ${n(parsed.rows.length)} number${parsed.rows.length === 1 ? "" : "s"}`}
                </button>
                <button type="button" onClick={() => setParsed(null)} disabled={busy} style={btn()}>Choose another file</button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </>
  );
}

/** Who is holding what, with a way to move a whole list between people. */
export function TeamLoadPanel({ load, onChanged }: { load: TeamLoad; onChanged: () => void }) {
  const [move, setMove] = useState<{ from: string; name: string; open: number; untouched: number } | null>(null);
  const [to, setTo] = useState<string[]>([]);
  const [untouched, setUntouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => [...load.members].sort((a, b) => b.open - a.open), [load]);
  const start = (from: string, name: string, open: number, fresh: number) => { setTo([]); setUntouched(false); setMove({ from, name, open, untouched: fresh }); };

  const run = async () => {
    if (!move) return;
    setBusy(true);
    try {
      const r = await deskApi("/api/leads/assign", { from: move.from, to, untouched_only: untouched });
      toast.ok(`${n(r.moved)} lead${r.moved === 1 ? "" : "s"} moved: ${r.shared.map((s: any) => `${s.name} ${n(s.count)}`).join(", ")}`);
      setMove(null); onChanged();
    } catch (e: any) { toast.err(e.message); }
    setBusy(false);
  };

  const th: React.CSSProperties = { textAlign: "right", padding: "8px 10px", fontSize: 12, fontWeight: 700, color: C.mid, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { textAlign: "right", padding: "9px 10px", fontSize: 14, color: C.txt, fontVariantNumeric: "tabular-nums", borderTop: `1px solid ${C.bord}` };
  const moveBtn = (onClick: () => void, text: string, off: boolean) => (
    <button type="button" onClick={onClick} disabled={off} style={{ background: "none", border: `1px solid ${C.bord}`, borderRadius: 7,
      padding: "4px 9px", fontSize: 12.5, fontWeight: 600, color: off ? C.dim : C.teal, display: "inline-flex", alignItems: "center", gap: 5 }}>
      <Shuffle size={12} /> {text}
    </button>
  );

  return (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12, marginBottom: 14, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px" }}>
        <Users size={15} color={C.teal} />
        <strong style={{ fontSize: 14.5, color: C.txt, flex: 1 }}>Team lists</strong>
        <span style={{ fontSize: 12.5, color: C.mid }}>Open leads each person is holding right now</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
          <thead>
            <tr style={{ background: C.hi }}>
              <th style={{ ...th, textAlign: "left" }}>Telecaller</th><th style={th}>Holding</th><th style={th}>Not called yet</th>
              <th style={th}>Callbacks late</th><th style={th}>Calls today</th><th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.user_id}>
                <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{label(m)}
                  {["owner", "super_admin"].includes(m.role) && <span style={{ color: C.dim, fontWeight: 400, fontSize: 12 }}> · owner</span>}</td>
                <td style={td}>{n(m.open)}</td>
                <td style={td}>{n(m.untouched)}</td>
                <td style={{ ...td, color: m.callbacks_due ? C.red : C.txt, fontWeight: m.callbacks_due ? 700 : 400 }}>{n(m.callbacks_due)}</td>
                <td style={td}>{n(m.calls_today)}{m.no_outcome > 0 && <span title="Calls with no outcome saved" style={{ color: C.gold, fontSize: 12 }}> · {m.no_outcome} unsaved</span>}</td>
                <td style={td}>{moveBtn(() => start(m.user_id, m.name, m.open, m.untouched), "Move", !m.open)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...td, textAlign: "left", color: C.mid }}>Unassigned</td>
              <td style={td}>{n(load.pool.open)}</td><td style={td}>{n(load.pool.untouched)}</td>
              <td style={{ ...td, color: load.pool.callbacks_due ? C.red : C.txt }}>{n(load.pool.callbacks_due)}</td><td style={td}>—</td>
              <td style={td}>{moveBtn(() => start("pool", "Unassigned", load.pool.open, load.pool.untouched), "Share out", !load.pool.open)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {move && (
        <Dialog title={move.from === "pool" ? "Share out unassigned leads" : `Move ${move.name}'s leads`} onClose={() => setMove(null)}>
          <div style={{ fontSize: 14, color: C.txt, lineHeight: 1.55, marginBottom: 12 }}>
            {move.from === "pool" ? `${n(move.open)} open leads belong to nobody yet.` : `${move.name} is holding ${n(move.open)} open leads.`} Won and lost leads stay where they are.
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, color: C.txt, marginBottom: 14 }}>
            <input type="checkbox" checked={untouched} onChange={e => setUntouched(e.target.checked)} />
            Only the {n(move.untouched)} not called yet
          </label>
          <div style={{ fontSize: 13, color: C.mid, fontWeight: 600, marginBottom: 6 }}>Give them to</div>
          <PickPeople members={load.members} picked={to} onChange={setTo} exclude={move.from} />
          {move.from !== "pool" && <div style={{ fontSize: 13, color: C.mid, marginTop: 10 }}>Nobody ticked: they go back to unassigned.</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button type="button" onClick={run} disabled={busy || (move.from === "pool" && !to.length) || (untouched && !move.untouched)}
              style={{ ...btn(true), opacity: busy || (move.from === "pool" && !to.length) ? 0.6 : 1 }}>
              {busy ? "Moving…" : `Move ${n(untouched ? move.untouched : move.open)} lead${(untouched ? move.untouched : move.open) === 1 ? "" : "s"}`}
            </button>
            <button type="button" onClick={() => setMove(null)} style={btn()}>Cancel</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
