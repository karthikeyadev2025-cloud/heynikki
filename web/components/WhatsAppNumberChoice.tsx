"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "../lib/supabase";
import { NIKKI } from "../lib/brand";
import { MessageCircle, ArrowRight } from "lucide-react";
import { waStatus } from "./WhatsAppSender";

// The same local alias every other component in this app uses — the palette
// exports surface/vault/text, not surf/hi/txt.
const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  grn: NIKKI.emerald, gold: NIKKI.gold, gbr: NIKKI.tealLight,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

const API = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

type SenderSummary = {
  kyc_approved: boolean;
  heynikki_number: string | null;
  chosen: string | null;
  display_name: string | null;
  status: string | null;
  on_waba: boolean;
  sending_as: string;
  sending_as_own: boolean;
};

/**
 * Which number this business sends WhatsApp from — shown on the
 * Verification page because KYC is what unlocks it.
 *
 * Read-only on purpose. This card used to run its own "pick a number" form
 * against /api/whatsapp/number-choice, while the WhatsApp page ran the real
 * three-step Meta registration against /api/whatsapp/sender/*. Both wrote
 * the same tenant_whatsapp row with different meanings, so a choice made
 * here could contradict what the WhatsApp page said. There is one flow now:
 * this card reflects it and links to it.
 */
export default function WhatsAppNumberChoice() {
  const [s, setS] = useState<SenderSummary | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const sb = createClient();
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return;
      try {
        const r = await fetch(`${API}/api/whatsapp/sender`,
          { headers: { Authorization: `Bearer ${session.access_token}` } });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { setErr(j.error || "Could not load your WhatsApp number"); return; }
        setS(j);
      } catch (e: any) { setErr(e.message || "Could not reach the server"); }
    })();
  }, []);

  if (!s && !err) return null;

  const st   = waStatus(s?.status);
  const live = s?.status === "active";

  return (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12,
      padding: 18, marginTop: 18, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ color: C.txt, fontSize: 15.5, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
          <MessageCircle size={16} /> Your WhatsApp number
        </div>
        {s && (
          <span style={{ background: st.color + "22", color: st.color, border: `1px solid ${st.color}44`,
            borderRadius: 4, padding: "2px 8px", fontSize: 10.5, fontWeight: 700 }}>{st.label}</span>
        )}
      </div>

      {err ? (
        <div style={{ color: NIKKI.red, fontSize: 12.5, marginTop: 8 }}>{err}</div>
      ) : s && (
        <>
          <div style={{ color: C.mid, fontSize: 12.5, marginTop: 6, lineHeight: 1.55 }}>
            Customers get confirmations, brochures and follow-ups from{" "}
            <strong style={{ color: live ? C.grn : C.gold }}>{s.sending_as}</strong>
            {live
              ? ` as “${s.display_name || "your business"}”.`
              : " — the shared HeyNikki number, until your own is live."}
          </div>

          {!live && (
            <div style={{ color: C.mid, fontSize: 12.5, marginTop: 8, lineHeight: 1.55 }}>
              {!s.kyc_approved
                ? "Once your KYC is approved you can move WhatsApp to your own number from the WhatsApp page."
                : s.on_waba
                  ? `${s.chosen} is added and waiting for its verification code — finish on the WhatsApp page.`
                  : "Your KYC is approved, so you can put WhatsApp on your own number now."}
            </div>
          )}

          <Link href="/whatsapp" style={{ display: "inline-flex", alignItems: "center", gap: 6,
            marginTop: 12, color: C.gbr, fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
            {live ? "Manage on the WhatsApp page" : s.kyc_approved ? "Set up on the WhatsApp page" : "Open the WhatsApp page"}
            <ArrowRight size={14} />
          </Link>
        </>
      )}
    </div>
  );
}
