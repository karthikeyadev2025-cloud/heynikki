"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "../lib/supabase";
import { NIKKI } from "../lib/brand";

// The same local alias every other component in this app uses — the palette
// exports surface/vault/text, not surf/hi/txt.
const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  grn: NIKKI.emerald, gold: NIKKI.gold,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

const API = process.env.NEXT_PUBLIC_API_URL;

/**
 * Which number this business sends WhatsApp from.
 *
 * The HeyNikki number is the default because it costs the business nothing:
 * one identity for calls and messages, nothing to arrange, live the same
 * day. Their own number is offered too — but the trade-off is stated BEFORE
 * they choose, not discovered afterwards: putting a number on the WhatsApp
 * Cloud API ends its WhatsApp Business app account, and the chats already on
 * it do not come across. For a shop that has messaged its customers from
 * that number for years, that is a real loss.
 */
export default function WhatsAppNumberChoice() {
  const [state, setState] = useState<any>(null);
  const [mode, setMode]   = useState<"did" | "own">("did");
  const [own, setOwn]     = useState("");
  const [name, setName]   = useState("");
  const [ack, setAck]     = useState(false);
  const [msg, setMsg]     = useState("");
  const [busy, setBusy]   = useState(false);

  const load = useCallback(async () => {
    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${API}/api/whatsapp/number-choice`,
      { headers: { Authorization: `Bearer ${session?.access_token}` } });
    if (r.ok) {
      const j = await r.json();
      setState(j);
      if (j.display_name) setName(j.display_name);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!state) return null;

  const save = async () => {
    setBusy(true); setMsg("");
    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${API}/api/whatsapp/number-choice`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mode, display_name: name, phone: own }),
    });
    const j = await r.json();
    setMsg(j.error || j.message || "Saved");
    setBusy(false);
    load();
  };

  const label = { fontSize: 13.5, color: C.txt, display: "flex", gap: 9,
    alignItems: "flex-start", cursor: "pointer", padding: "9px 0" } as const;

  return (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12,
      padding: 18, marginTop: 18 }}>
      <div style={{ color: C.txt, fontSize: 15.5, fontWeight: 800, marginBottom: 3 }}>
        Your WhatsApp number
      </div>
      <div style={{ color: C.mid, fontSize: 12.5, marginBottom: 12, lineHeight: 1.55 }}>
        This is the number your customers see when Nikki sends them a confirmation,
        a brochure or a follow-up.
      </div>

      {state.status === "active" ? (
        <div style={{ color: C.grn, fontSize: 13.5, fontWeight: 700 }}>
          Live on {state.chosen} — your customers see “{state.display_name}”.
        </div>
      ) : !state.kyc_approved ? (
        <div style={{ color: C.mid, fontSize: 13 }}>
          We&apos;ll enable this as soon as your KYC is approved.
        </div>
      ) : (
        <>
          <label style={label}>
            <input type="radio" checked={mode === "did"} onChange={() => setMode("did")} />
            <span>
              <strong>Use my HeyNikki number{state.heynikki_number ? ` (${state.heynikki_number})` : ""}</strong>
              <div style={{ color: C.mid, fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>
                Recommended. One number for calls and WhatsApp, nothing for you to set up,
                and your personal WhatsApp keeps working exactly as it does today.
              </div>
            </span>
          </label>

          <label style={label}>
            <input type="radio" checked={mode === "own"} onChange={() => setMode("own")} />
            <span>
              <strong>Use my own number</strong>
              <div style={{ color: C.mid, fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>
                Keeps the number your customers already know.
              </div>
            </span>
          </label>

          {mode === "own" && (
            <div style={{ marginLeft: 26, marginBottom: 6 }}>
              <input value={own} onChange={e => setOwn(e.target.value)}
                placeholder="98765 43210"
                style={{ padding: "8px 11px", borderRadius: 8, fontSize: 13.5, width: 190,
                  background: C.hi, color: C.txt, border: `1px solid ${C.bord}` }} />
              <div style={{ background: `${C.gold}14`, border: `1px solid ${C.gold}44`,
                borderRadius: 8, padding: "10px 12px", marginTop: 10 }}>
                <div style={{ color: C.gold, fontSize: 12.5, fontWeight: 800, marginBottom: 4 }}>
                  Read this before choosing your own number
                </div>
                <div style={{ color: C.mid, fontSize: 12.5, lineHeight: 1.6 }}>
                  Once this number is connected, the <strong>WhatsApp Business app on it stops
                  working</strong> and the chats already in it will not move across. You&apos;ll
                  message customers from your HeyNikki dashboard instead. If you want to keep
                  using WhatsApp on your phone as you do now, pick the HeyNikki number above.
                </div>
                <label style={{ display: "flex", gap: 7, alignItems: "center",
                  marginTop: 9, fontSize: 12.5, color: C.txt, cursor: "pointer" }}>
                  <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
                  I understand and want to use my own number
                </label>
              </div>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <div style={{ color: C.dim, fontSize: 11.5, marginBottom: 4 }}>
              Name your customers will see on WhatsApp
            </div>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Aduri Group"
              style={{ padding: "8px 11px", borderRadius: 8, fontSize: 13.5, width: 240,
                background: C.hi, color: C.txt, border: `1px solid ${C.bord}` }} />
          </div>

          <button type="button" disabled={busy || name.trim().length < 3 || (mode === "own" && (!ack || own.replace(/\D/g, "").length < 10))}
            onClick={save}
            style={{ marginTop: 12, padding: "9px 18px", borderRadius: 8, border: "none",
              fontSize: 13.5, fontWeight: 800, background: C.grn, color: "#04120a",
              cursor: busy ? "wait" : "pointer",
              opacity: (name.trim().length < 3 || (mode === "own" && (!ack || own.replace(/\D/g, "").length < 10))) ? 0.5 : 1 }}>
            {busy ? "Saving…" : state.chosen ? "Update my choice" : "Confirm"}
          </button>

          {state.status === "requested" && (
            <div style={{ color: C.gold, fontSize: 12, marginTop: 8 }}>
              Requested {state.chosen} — we&apos;re verifying it with WhatsApp now.
            </div>
          )}
          {msg && <div style={{ color: C.mid, fontSize: 12.5, marginTop: 8 }}>{msg}</div>}
        </>
      )}
    </div>
  );
}
