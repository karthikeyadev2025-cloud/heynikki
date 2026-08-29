"use client";
// web/components/ScriptAndMenu.tsx
// ────────────────────────────────────────────────────────────────
// Two things a business owner asks for within a week of going live:
// "make her say it this way", and "ask them what they want first".
//
// Both were storable and neither was settable — greeting_script and
// must_ask had no UI, and ivr_menus had a working engine, routing and RLS
// with no way to put a row in it except a database insert.
// ────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import { createClient } from "../lib/supabase";
import { NIKKI } from "../lib/brand";

const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  glow: NIKKI.teal, grn: NIKKI.emerald, red: NIKKI.red,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

type Opt = { say: string; label: string; action: "ai" | "transfer"; target: string };

const inputStyle = {
  width: "100%", padding: "9px 11px", fontSize: 13.5, borderRadius: 8,
  background: C.hi, color: C.txt, border: `1px solid ${C.bord}`, outline: "none",
} as const;

export default function ScriptAndMenu({ tenantId, profileId }:
  { tenantId: string | null; profileId: string | null }) {
  const [greeting, setGreeting] = useState("");
  const [mustAsk, setMustAsk]   = useState<string[]>([]);
  const [menuOn, setMenuOn]     = useState(false);
  const [menuGreet, setMenuGreet] = useState("");
  const [opts, setOpts]         = useState<Opt[]>([]);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [err, setErr]           = useState("");

  const load = useCallback(async () => {
    if (!tenantId || !profileId) return;
    const sb = createClient();
    const [{ data: vp }, { data: menu }] = await Promise.all([
      sb.from("voice_profiles").select("greeting_script, must_ask").eq("id", profileId).maybeSingle(),
      sb.from("ivr_menus").select("enabled, greeting, options").eq("tenant_id", tenantId).maybeSingle(),
    ]);
    setGreeting(vp?.greeting_script || "");
    setMustAsk(Array.isArray(vp?.must_ask) ? vp!.must_ask as string[] : []);
    if (menu) {
      setMenuOn(!!menu.enabled);
      setMenuGreet(menu.greeting || "");
      setOpts(Array.isArray(menu.options) ? menu.options as Opt[] : []);
    }
  }, [tenantId, profileId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!tenantId || !profileId) return;
    setSaving(true); setErr(""); setSaved(false);
    const sb = createClient();
    const clean = mustAsk.map(q => q.trim()).filter(Boolean);
    const cleanOpts = opts
      .filter(o => o.say.trim())
      .map(o => ({ ...o, say: o.say.trim(), label: (o.label || o.say).trim(),
                   target: o.target.replace(/[^\d+]/g, "") }));

    const { error: e1 } = await sb.from("voice_profiles")
      .update({ greeting_script: greeting.trim() || null, must_ask: clean })
      .eq("id", profileId);

    // Upserting on tenant_id matches the unique index, so saving twice edits
    // the same menu rather than creating a second one the router would then
    // have to choose between.
    const { error: e2 } = await sb.from("ivr_menus").upsert({
      tenant_id: tenantId, did_number: null, enabled: menuOn,
      greeting: menuGreet.trim() || null, options: cleanOpts,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id" });

    if (e1 || e2) setErr((e1 || e2)!.message);
    else { setSaved(true); setTimeout(() => setSaved(false), 2500); }
    setSaving(false);
  };

  const Card = ({ children }: { children: React.ReactNode }) => (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`,
                  borderRadius: 14, padding: 18, marginBottom: 16 }}>{children}</div>
  );
  const Title = ({ t, s }: { t: string; s: string }) => (
    <>
      <div style={{ color: C.txt, fontSize: 15, fontWeight: 800 }}>{t}</div>
      <div style={{ color: C.mid, fontSize: 12.5, lineHeight: 1.55, margin: "4px 0 14px" }}>{s}</div>
    </>
  );

  return (
    <div>
      <Card>
        <Title t="What Nikki says first"
               s="Spoken word for word, right after the legally required AI disclosure. Leave it blank and she opens in her own words." />
        <textarea value={greeting} onChange={e => setGreeting(e.target.value)} rows={2}
          placeholder="నమస్కారం, శ్రీ రామ్య డెంటల్ క్లినిక్. నేను నిక్కి."
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />

        <div style={{ color: C.txt, fontSize: 13.5, fontWeight: 700, margin: "18px 0 4px" }}>
          Before the call ends, find out
        </div>
        <div style={{ color: C.mid, fontSize: 12.5, marginBottom: 10, lineHeight: 1.5 }}>
          She asks for whatever is still missing, when it fits. She will not ask
          for something the caller has already said.
        </div>
        {mustAsk.map((q, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 7 }}>
            <input value={q} placeholder="Caller's name"
              onChange={e => setMustAsk(m => m.map((x, j) => j === i ? e.target.value : x))}
              style={inputStyle} />
            <button onClick={() => setMustAsk(m => m.filter((_, j) => j !== i))}
              aria-label="Remove"
              style={{ padding: "0 12px", borderRadius: 8, background: "transparent",
                       border: `1px solid ${C.bord}`, color: C.dim, cursor: "pointer" }}>×</button>
          </div>
        ))}
        <button onClick={() => setMustAsk(m => [...m, ""])}
          style={{ padding: "7px 13px", borderRadius: 8, background: "transparent",
                   border: `1px solid ${C.bord}`, color: C.txt, fontSize: 13, cursor: "pointer" }}>
          + Add a question
        </button>
      </Card>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <Title t="Call menu"
                   s="Callers say what they want — they do not press keys. Nikki either handles it or puts them through to a person." />
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer",
                          color: C.mid, fontSize: 13, flex: "none" }}>
            <input type="checkbox" checked={menuOn} onChange={e => setMenuOn(e.target.checked)} />
            On
          </label>
        </div>

        {menuOn && (
          <>
            <input value={menuGreet} onChange={e => setMenuGreet(e.target.value)}
              placeholder="చెప్పండి, మీకు ఏం కావాలి?" style={{ ...inputStyle, marginBottom: 12 }} />
            {opts.map((o, i) => (
              <div key={i} style={{ border: `1px solid ${C.bord}`, borderRadius: 10,
                                    padding: 12, marginBottom: 9 }}>
                <div style={{ display: "grid", gap: 8,
                              gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
                  <input value={o.say} placeholder='They say… e.g. "appointment"'
                    onChange={e => setOpts(v => v.map((x, j) => j === i ? { ...x, say: e.target.value } : x))}
                    style={inputStyle} />
                  <select value={o.action}
                    onChange={e => setOpts(v => v.map((x, j) => j === i
                      ? { ...x, action: e.target.value as Opt["action"] } : x))}
                    style={inputStyle}>
                    <option value="ai">Nikki handles it</option>
                    <option value="transfer">Put them through</option>
                  </select>
                  {o.action === "transfer" && (
                    <input value={o.target} placeholder="Ring this number"
                      inputMode="numeric"
                      onChange={e => setOpts(v => v.map((x, j) => j === i ? { ...x, target: e.target.value } : x))}
                      style={inputStyle} />
                  )}
                </div>
                <button onClick={() => setOpts(v => v.filter((_, j) => j !== i))}
                  style={{ marginTop: 8, padding: "5px 11px", borderRadius: 7, background: "transparent",
                           border: `1px solid ${C.bord}`, color: C.dim, fontSize: 12, cursor: "pointer" }}>
                  Remove
                </button>
              </div>
            ))}
            <button onClick={() => setOpts(v => [...v, { say: "", label: "", action: "ai", target: "" }])}
              style={{ padding: "7px 13px", borderRadius: 8, background: "transparent",
                       border: `1px solid ${C.bord}`, color: C.txt, fontSize: 13, cursor: "pointer" }}>
              + Add an option
            </button>
            {!opts.length && (
              <div style={{ color: C.dim, fontSize: 12, marginTop: 9 }}>
                A menu with no options is ignored — Nikki answers normally.
              </div>
            )}
          </>
        )}
      </Card>

      {err && <div style={{ color: C.red, fontSize: 13, marginBottom: 10 }}>{err}</div>}
      <button onClick={save} disabled={saving || !profileId}
        style={{ padding: "11px 22px", borderRadius: 10, border: "none",
                 background: saved ? C.grn : C.glow, color: "#fff",
                 fontSize: 14.5, fontWeight: 750,
                 cursor: saving || !profileId ? "not-allowed" : "pointer" }}>
        {saving ? "Saving…" : saved ? "Saved" : "Save script and menu"}
      </button>
    </div>
  );
}
