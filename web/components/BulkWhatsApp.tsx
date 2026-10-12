// components/BulkWhatsApp.tsx
//
// One approved message to a whole list — a tagged upload, a stage, or one
// person's leads. Owner only. It says how many people that is before
// anything goes, and sends in small pages from this tab, so closing the tab
// stops it.
"use client";
import { useEffect, useRef, useState } from "react";
import { Megaphone } from "lucide-react";
import { NIKKI } from "../lib/brand";
import { deskApi } from "../lib/desk-api";
import { createClient } from "../lib/supabase";
import { confirmDialog } from "./Confirm";
import { toast } from "./Toast";

const C = { txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim, bord: NIKKI.border, surf: NIKKI.surface,
  hi: NIKKI.vault, teal: NIKKI.teal, red: NIKKI.red, grn: NIKKI.emerald };
const STAGES = [["new", "New"], ["contacted", "Contacted"], ["qualified", "Qualified"], ["won", "Won"], ["lost", "Lost"]];

export default function BulkWhatsApp({ templates, business }: { templates: any[]; business: string }) {
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tag, setTag] = useState("");
  const [stage, setStage] = useState("");
  const [tplId, setTplId] = useState("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [aud, setAud] = useState<{ count: number; opted_out: number; over_limit: boolean; limit: number } | null>(null);
  const [run, setRun] = useState<{ sent: number; failed: number; total: number; done: boolean; error?: string | null } | null>(null);
  const stop = useRef(false);
  const tpl = templates.find(t => t.id === tplId);

  useEffect(() => {
    (async () => {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data: me } = await sb.from("tenant_users").select("role").eq("user_id", user.id).maybeSingle();
      setOwner(["owner", "super_admin"].includes(me?.role));
    })();
    return () => { stop.current = true; };
  }, []);

  // The tags in use, from the leads themselves, so a list uploaded a minute
  // ago is here without anyone typing its name.
  useEffect(() => {
    if (!open || tags.length) return;
    (async () => {
      const { data } = await createClient().from("leads").select("tags").not("tags", "eq", "{}").limit(1000);
      setTags([...new Set((data || []).flatMap((l: any) => l.tags || []))].sort() as string[]);
    })();
  }, [open, tags.length]);

  const filter = { tag, stage };
  useEffect(() => {
    setAud(null); setRun(null);
    if (!tag && !stage) return;
    let off = false;
    deskApi("/api/whatsapp/bulk/audience", filter).then(j => { if (!off) setAud(j); }).catch(e => { if (!off) toast.err(e.message); });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, stage]);

  const ready = !!aud?.count && !!tpl && (tpl.variables || []).every((_: string, i: number) => (vars[String(i + 1)] || "").trim());
  const send = async () => {
    if (!ready || !aud || !tpl) return;
    const ok = await confirmDialog({
      title: `Send to ${aud.count.toLocaleString("en-IN")} people?`,
      body: "This cannot be undone once it starts. Keep this tab open until it finishes; closing it stops the rest. WhatsApp charges for each message.",
      confirmLabel: "Send",
    });
    if (!ok) return;
    stop.current = false;
    let offset = 0, sent = 0, failed = 0;
    setRun({ sent, failed, total: aud.count, done: false });
    try {
      while (!stop.current) {
        const j = await deskApi("/api/whatsapp/bulk/send", { filter, template_name: tpl.name, variables: vars, offset });
        sent += j.sent; failed += j.failed; offset = j.next;
        setRun({ sent, failed, total: j.total, done: j.done, error: j.error });
        if (j.done) break;
      }
      if (!stop.current) toast.ok(`Sent to ${sent.toLocaleString("en-IN")}${failed ? `, ${failed} not delivered` : ""}.`);
    } catch (e: any) {
      toast.err(e.message);
      setRun(r => r && { ...r, done: true, error: e.message });
    }
  };

  if (!owner) return null;
  const input: React.CSSProperties = { border: `1px solid ${C.bord}`, borderRadius: 8, padding: "9px 10px", fontSize: 14, background: C.surf, color: C.txt, width: "100%" };
  const lab: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: C.mid, marginBottom: 5 };
  const sending = !!run && !run.done;

  return (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12, marginBottom: 24 }}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%",
        background: "none", border: 0, padding: "14px 16px", textAlign: "left" }}>
        <Megaphone size={16} color={C.teal} />
        <span style={{ flex: 1 }}>
          <strong style={{ fontSize: 15, color: C.txt, display: "block" }}>Message a whole list</strong>
          <span style={{ fontSize: 13, color: C.mid }}>Send one ready-made message to everyone in an uploaded list or a stage.</span>
        </span>
        <span style={{ fontSize: 13, color: C.teal, fontWeight: 600 }}>{open ? "Close" : "Open"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 16px 16px", display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
            <div>
              <div style={lab}>List (tag)</div>
              <select value={tag} onChange={e => setTag(e.target.value)} disabled={sending} style={input} aria-label="List">
                <option value="">Any</option>
                {tags.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div style={lab}>Stage</div>
              <select value={stage} onChange={e => setStage(e.target.value)} disabled={sending} style={input} aria-label="Stage">
                <option value="">Any</option>
                {STAGES.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
              </select>
            </div>
            <div>
              <div style={lab}>Ready-made message</div>
              <select value={tplId} onChange={e => { setTplId(e.target.value); setVars(business && business !== "your business" ? { "1": business } : {}); }}
                disabled={sending} style={input} aria-label="Ready-made message">
                <option value="">Choose…</option>
                {templates.map(t => <option key={t.id} value={t.id}>{String(t.name).replace(/_/g, " ")}</option>)}
              </select>
            </div>
          </div>

          {tpl && (
            <div style={{ display: "grid", gap: 10 }}>
              {(tpl.variables || []).map((label: string, i: number) => (
                <div key={i}>
                  <div style={lab}>{label}</div>
                  <input value={vars[String(i + 1)] || ""} onChange={e => setVars(v => ({ ...v, [String(i + 1)]: e.target.value }))} disabled={sending} style={input} aria-label={label} />
                </div>
              ))}
              <div style={{ background: "#DCF8C6", borderRadius: 10, padding: "9px 12px", fontSize: 14, lineHeight: 1.5, color: C.txt, whiteSpace: "pre-wrap", maxWidth: 420 }}>
                {String(tpl.body_text || "").replace(/\{\{(\d+)\}\}/g, (_: string, n: string) => vars[n] || `[${(tpl.variables || [])[Number(n) - 1] || "…"}]`)}
              </div>
            </div>
          )}

          <div style={{ fontSize: 14, color: C.txt, lineHeight: 1.6 }}>
            {!tag && !stage ? <span style={{ color: C.mid }}>Choose a list or a stage to see how many people it reaches.</span>
              : !aud ? <span style={{ color: C.mid }}>Counting…</span>
              : <>
                  This reaches <strong>{aud.count.toLocaleString("en-IN")}</strong> {aud.count === 1 ? "person" : "people"}.
                  {aud.opted_out > 0 && <span style={{ color: C.mid }}> {aud.opted_out} who asked not to be contacted are left out.</span>}
                  {aud.over_limit && <span style={{ color: C.red }}> Only the first {aud.limit.toLocaleString("en-IN")} are sent at one time — narrow it with a tag.</span>}
                </>}
          </div>

          {run && (
            <div>
              <div style={{ height: 8, borderRadius: 4, background: C.hi, overflow: "hidden" }}>
                <div style={{ width: `${run.total ? Math.round(((run.sent + run.failed) / run.total) * 100) : 0}%`, height: "100%", background: C.grn, transition: "width 300ms" }} />
              </div>
              <div style={{ fontSize: 13, color: C.mid, marginTop: 6 }}>
                {run.done ? "Finished: " : "Sending… "}{run.sent} sent{run.failed ? `, ${run.failed} not accepted` : ""} of {run.total}.
                {run.error && <span style={{ color: C.red }}> {run.error}</span>}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={send} disabled={!ready || sending} style={{ background: C.grn, color: "#fff", border: 0, borderRadius: 9,
              padding: "10px 16px", fontSize: 14, fontWeight: 700, opacity: !ready || sending ? 0.5 : 1 }}>
              {sending ? "Sending…" : aud?.count ? `Send to ${aud.count.toLocaleString("en-IN")}` : "Send"}
            </button>
            {sending && <button type="button" onClick={() => { stop.current = true; setRun(r => r && { ...r, done: true }); }}
              style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 9, padding: "10px 16px", fontSize: 14, fontWeight: 700, color: C.txt }}>Stop</button>}
          </div>
        </div>
      )}
    </div>
  );
}
