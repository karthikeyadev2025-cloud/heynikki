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
  const [webhook, setWebhook]   = useState("");
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
      sb.from("voice_profiles").select("greeting_script, must_ask, automation_webhook_url").eq("id", profileId).maybeSingle(),
      sb.from("ivr_menus").select("enabled, greeting, options").eq("tenant_id", tenantId).maybeSingle(),
    ]);
    setGreeting(vp?.greeting_script || "");
    setWebhook((vp as any)?.automation_webhook_url || "");
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

    const wh = webhook.trim();
    const { error: e1 } = await sb.from("voice_profiles")
      .update({
        greeting_script: greeting.trim() || null,
        must_ask: clean,
        // http(s) or nothing — a typo'd scheme would fail silently per event.
        automation_webhook_url: /^https?:\/\//.test(wh) ? wh : null,
      })
      .eq("id", profileId);

    // Upserting on tenant_id matches the unique index, so saving twice edits
    // the same menu rather than creating a second one the router would then
    // have to choose between.
    // The table's only unique index is an EXPRESSION index,
    // (tenant_id, coalesce(did_number,'')), and Postgres cannot infer an
    // arbiter from "tenant_id" alone — so this upsert failed every single
    // time with "no unique or exclusion constraint matching the ON CONFLICT
    // specification", and no tenant has ever saved a call menu. Read then
    // write: it needs no arbiter at all, and the tenant-wide row is exactly
    // one row by definition.
    const row = {
      tenant_id: tenantId, did_number: null, enabled: menuOn,
      greeting: menuGreet.trim() || null, options: cleanOpts,
      updated_at: new Date().toISOString(),
    };
    const { data: existing } = await sb.from("ivr_menus")
      .select("id").eq("tenant_id", tenantId).is("did_number", null).maybeSingle();
    const { error: e2 } = existing
      ? await sb.from("ivr_menus").update(row).eq("id", existing.id)
      : await sb.from("ivr_menus").insert(row);

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

  // Everything here writes against a voice profile. With none, the card was
  // fully editable and then refused to save with no explanation — the
  // customer types a greeting, presses Save, and nothing says why nothing
  // happened.
  if (!profileId) {
    return (
      <div style={{ color: C.mid, fontSize: 13.5, lineHeight: 1.6 }}>
        Save your business details above first — the greeting and call menu
        attach to that profile.
      </div>
    );
  }

  return (
    <div>
      <Card>
        <Title t="What Nikki says first"
               s="The first thing your caller hears, spoken word for word. Leave it blank and she opens in her own words." />
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
        <div style={{ color: C.txt, fontSize: 13.5, fontWeight: 700, margin: "18px 0 4px" }}>
          Webhook for your own automations <span style={{ color: C.dim, fontWeight: 400 }}>(optional)</span>
        </div>
        <div style={{ color: C.mid, fontSize: 12.5, marginBottom: 8, lineHeight: 1.5 }}>
          When Nikki books an appointment we POST the details to
          <code style={{ color: C.txt }}> your-url/appointment-confirmed</code> —
          plug it into Zapier, n8n, or your own CRM.
        </div>
        <input value={webhook} onChange={e => setWebhook(e.target.value)}
          placeholder="https://hooks.example.com/nikki" style={inputStyle} />

        <div style={{ height: 14 }} />
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
