"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase";
import { NIKKI } from "../lib/brand";
import { Phone, PhoneCall, ShieldCheck, Check, AlertTriangle } from "lucide-react";

const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border,
  grn: NIKKI.emerald, gold: NIKKI.gold, red: NIKKI.red, cyn: NIKKI.cyan,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

const API = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";

// Every value the API writes to tenant_whatsapp.status (index.ts + 024):
// pending_kyc / awaiting_signup at provisioning, requested from the old
// number-choice form, pending_verification once the number is on the WABA,
// active after verify+register, failed / submitted from the Meta review path.
export const WA_STATUS: Record<string, { label: string; color: string }> = {
  pending_kyc:          { label: "Waiting for KYC",       color: NIKKI.gold },
  awaiting_signup:      { label: "Not set up yet",        color: NIKKI.textDim },
  requested:            { label: "Requested",             color: NIKKI.gold },
  pending_verification: { label: "Awaiting code",         color: NIKKI.gold },
  submitted:            { label: "With WhatsApp",         color: NIKKI.cyan },
  active:               { label: "Live",                  color: NIKKI.emerald },
  failed:               { label: "Rejected by WhatsApp",  color: NIKKI.red },
};
export const waStatus = (status: string | null | undefined) =>
  (status && WA_STATUS[status]) || { label: "Using the shared number", color: NIKKI.textDim };

type Sender = {
  kyc_approved: boolean;
  heynikki_number: string | null;
  chosen: string | null;
  display_name: string | null;
  status: string | null;
  review_note: string | null;
  on_waba: boolean;
  own: boolean;
  sending_as: string;
  sending_as_own: boolean;
  otp: { code: string; heard_at: string } | null;
  meta: { number: string; name: string; verification: string; status: string;
          quality: string; name_status: string } | null;
};

/**
 * Which number this business's customers get WhatsApp from, and the
 * self-serve path to make it their own HeyNikki number.
 *
 * Three steps against Meta: add the number to the WhatsApp account, have
 * Meta ring it with a code, submit the code. The number is a SIP line nobody
 * can pick up, so Nikki answers Meta's call herself; the pipeline reads the
 * six digits out of what it heard and this page polls for them and fills
 * the box. The client clicks three buttons and never touches a phone.
 */
export default function WhatsAppSender() {
  const [s, setS]       = useState<Sender | null>(null);
  const [name, setName] = useState("");
  const [useOwn, setUseOwn] = useState(false);
  const [ownNum, setOwnNum] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg]   = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    let r: Response;
    try {
      r = await fetch(`${API}/api/whatsapp/sender`,
        { headers: { Authorization: `Bearer ${session.access_token}` } });
    } catch (e: any) { setLoadErr(e.message || "Could not reach the server"); return; }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setLoadErr(j.error || `Could not load your WhatsApp number (${r.status})`);
      return;
    }
    setLoadErr("");
    const j: Sender = await r.json();
    setS(j);
    setName(n => n || j.display_name || "");
    // A number that isn't the leased line was typed by the client earlier —
    // keep the form on that path so a reload doesn't flip them back to the
    // DID Meta already refused.
    if (j.chosen && j.chosen !== j.heynikki_number) { setUseOwn(true); setOwnNum(o => o || j.chosen!); }
    if (j.otp?.code) setCode(c => c || j.otp!.code);
  }, []);
  useEffect(() => { load(); }, [load]);

  // While Meta's call is in flight, look for the code every 5 s. Stops on
  // its own once a code shows up or after four minutes.
  useEffect(() => {
    if (!calling) return;
    const started = Date.now();
    pollRef.current = setInterval(async () => {
      await load();
      if (Date.now() - started > 240_000) setCalling(false);
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [calling, load]);
  useEffect(() => { if (s?.otp?.code) setCalling(false); }, [s?.otp?.code]);

  const post = async (path: string, body: any, label: string) => {
    setBusy(label); setMsg(null);
    try {
      const sb = createClient();
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(`${API}/api/whatsapp/sender/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      setMsg({ text: j.error || j.message || "Done", bad: !r.ok });
      if (r.ok && path === "request-code" && !j.own) setCalling(true);
      await load();
      return r.ok;
    } catch (e: any) {
      setMsg({ text: e.message, bad: true });
      return false;
    } finally { setBusy(null); }
  };

  if (!s) {
    if (!loadErr) return null;
    return (
      <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12,
        padding: 18, marginBottom: 26 }}>
        <div style={{ color: C.txt, fontSize: 15.5, fontWeight: 800 }}>Your WhatsApp number</div>
        <div style={{ marginTop: 8, color: C.red, fontSize: 12.5, display: "flex", gap: 6, alignItems: "flex-start" }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{loadErr}</span>
        </div>
      </div>
    );
  }

  const live = s.status === "active";
  const step = live ? 4 : !s.on_waba ? 1 : !s.otp?.code && !code ? 2 : 3;
  // Own-number mode: chosen at step 1, or the number already on the WABA
  // isn't the leased line. Without a leased line it's the only option.
  const ownMode = s.on_waba ? s.own : (useOwn || !s.heynikki_number);
  const ownOk   = /^[6-9]\d{9}$/.test(ownNum);
  const canAdd  = step === 1 && name.trim().length >= 3 && (!ownMode || ownOk);
  const target  = ownMode ? (s.chosen || ownNum) : s.heynikki_number;
  const input = { padding: "8px 11px", borderRadius: 8, fontSize: 13.5,
    background: C.hi, color: C.txt, border: `1px solid ${C.bord}` } as const;
  const btn = (on: boolean, color: string = C.grn) => ({
    padding: "9px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 800,
    background: on ? color : C.hi, color: on ? "#fff" : C.dim,
    cursor: on ? "pointer" : "default", opacity: busy ? 0.7 : 1 } as const);

  return (
    <div style={{ background: C.surf, border: `1px solid ${C.bord}`, borderRadius: 12,
      padding: 18, marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ color: C.txt, fontSize: 15.5, fontWeight: 800 }}>Your WhatsApp number</div>
          <div style={{ color: C.mid, fontSize: 12.5, marginTop: 3, lineHeight: 1.55 }}>
            Customers are getting messages from{" "}
            <strong style={{ color: live ? C.grn : C.gold }}>{s.sending_as}</strong>
            {live ? ` as “${s.meta?.name || s.display_name}”.` : " — the shared HeyNikki number, until yours is live."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Tag label={waStatus(s.status).label} color={waStatus(s.status).color} />
          {s.meta && (<>
            <Tag label={`Meta: ${s.meta.status || "?"}`} color={s.meta.status === "CONNECTED" ? C.grn : C.gold} />
            <Tag label={`Code: ${s.meta.verification || "?"}`} color={s.meta.verification === "VERIFIED" ? C.grn : C.gold} />
            <Tag label={`Name: ${s.meta.name_status || "?"}`} color={s.meta.name_status === "APPROVED" ? C.grn : C.gold} />
            {s.meta.quality && <Tag label={`Quality: ${s.meta.quality}`} color={s.meta.quality === "GREEN" ? C.grn : C.red} />}
          </>)}
        </div>
      </div>

      {live ? (
        <div style={{ marginTop: 12, color: C.grn, fontSize: 13.5, fontWeight: 700,
          display: "flex", alignItems: "center", gap: 8 }}>
          <Check size={16} /> Live on {s.chosen}. Nothing else to do.
        </div>
      ) : !s.kyc_approved ? (
        <div style={{ marginTop: 12, color: C.mid, fontSize: 13 }}>
          We&apos;ll enable your own number as soon as your KYC is approved.
        </div>
      ) : (
        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          {/* Step 1 */}
          <Step n={1} done={step > 1} active={step === 1} icon={<Phone size={14} />}
            title={ownMode ? `Make ${target || ownNum || "your mobile"} your WhatsApp number`
                           : `Make ${s.heynikki_number} your WhatsApp number`}>
            <div style={{ color: C.mid, fontSize: 12.5, marginBottom: 8, lineHeight: 1.5 }}>
              {ownMode
                ? "Calls keep coming to your HeyNikki number; WhatsApp goes out from this mobile. It must not already be on WhatsApp — a fresh SIM is easiest. WhatsApp allows only a few code requests a day, so ask once and wait for it."
                : "Same number for calls and WhatsApp. Your personal WhatsApp is untouched."}
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {s.heynikki_number && (
                <label style={{ color: C.mid, fontSize: 12.5, display: "flex", gap: 7, alignItems: "center",
                  cursor: step === 1 ? "pointer" : "default" }}>
                  <input type="checkbox" checked={useOwn} disabled={step !== 1}
                    onChange={e => setUseOwn(e.target.checked)} />
                  Use my own mobile number instead
                </label>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {ownMode && (
                  <input value={ownNum} inputMode="numeric" disabled={step !== 1}
                    onChange={e => setOwnNum(e.target.value.replace(/\D/g, "").slice(-10))}
                    placeholder="10-digit mobile, e.g. 9876543210" style={{ ...input, width: 220 }} />
                )}
                <input value={name} onChange={e => setName(e.target.value)} disabled={step !== 1}
                  placeholder="Name customers see, e.g. Bismillah Clinic" style={{ ...input, width: 260 }} />
                <button type="button" disabled={!canAdd || !!busy}
                  onClick={() => post("add", { display_name: name.trim(), own_number: ownMode ? ownNum : null }, "add")}
                  style={btn(canAdd)}>
                  {busy === "add" ? "Adding…" : "Add to WhatsApp"}
                </button>
              </div>
            </div>
          </Step>

          {/* Step 2 */}
          <Step n={2} done={step > 2} active={step === 2} icon={<PhoneCall size={14} />}
            title={ownMode ? "Get a code from WhatsApp" : "Let WhatsApp call the number with a code"}>
            <div style={{ color: C.mid, fontSize: 12.5, marginBottom: 8, lineHeight: 1.5 }}>
              {ownMode ? (
                <>WhatsApp sends a 6-digit code to {target} by SMS (or reads it out on a call).
                  Type it in at step 3.</>
              ) : (
                <>WhatsApp rings {target} and reads a 6-digit code out. You can&apos;t
                  pick that call up — <strong>Nikki answers it</strong>, hears the code, and it
                  appears here on its own. It also shows on your Calls list as <code>wa_otp_…</code>.</>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ownMode && (
                <button type="button" disabled={step < 2 || !!busy || step === 4}
                  onClick={() => post("request-code", { method: "SMS" }, "sms")} style={btn(step >= 2)}>
                  {busy === "sms" ? "Asking WhatsApp…" : "Text me the code"}
                </button>
              )}
              <button type="button" disabled={step < 2 || !!busy || step === 4}
                onClick={() => post("request-code", { method: "VOICE" }, "call")}
                style={btn(step >= 2, ownMode ? C.cyn : C.grn)}>
                {busy === "call" ? "Asking WhatsApp…" : calling && !ownMode ? "Calling… listening for the code" : s.otp ? "Call again" : "Call me with the code"}
              </button>
            </div>
            {calling && !ownMode && (
              <div style={{ color: C.gold, fontSize: 12, marginTop: 6 }}>
                Waiting for the call to finish — checking every 5 seconds.
              </div>
            )}
          </Step>

          {/* Step 3 */}
          <Step n={3} done={false} active={step === 3} icon={<ShieldCheck size={14} />}
            title="Confirm the code">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                disabled={step < 2} placeholder="6-digit code" inputMode="numeric"
                style={{ ...input, width: 130, letterSpacing: 3, fontWeight: 800 }} />
              <button type="button" disabled={step < 2 || !!busy || code.length !== 6}
                onClick={() => post("verify", { code }, "verify")} style={btn(step >= 2 && code.length === 6)}>
                {busy === "verify" ? "Confirming…" : "Go live"}
              </button>
              {s.otp && (
                <span style={{ color: C.cyn, fontSize: 12 }}>
                  Nikki heard <strong>{s.otp.code}</strong> at {new Date(s.otp.heard_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
          </Step>
        </div>
      )}

      {s.review_note && !live && (
        <div style={{ marginTop: 10, color: C.red, fontSize: 12.5, display: "flex", gap: 6, alignItems: "flex-start" }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>Last attempt: {s.review_note}</span>
        </div>
      )}
      {msg && (
        <div style={{ marginTop: 10, color: msg.bad ? C.red : C.mid, fontSize: 12.5, lineHeight: 1.5 }}>{msg.text}</div>
      )}
    </div>
  );
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ background: color + "22", color, border: `1px solid ${color}44`,
      borderRadius: 4, padding: "2px 8px", fontSize: 10.5, fontWeight: 700 }}>{label}</span>
  );
}

function Step({ n, done, active, icon, title, children }: {
  n: number; done: boolean; active: boolean; icon: React.ReactNode; title: string; children: React.ReactNode;
}) {
  const color = done ? C.grn : active ? C.gold : C.dim;
  return (
    <div style={{ display: "flex", gap: 12, opacity: done || active ? 1 : 0.55 }}>
      <div style={{ width: 26, height: 26, borderRadius: 13, flexShrink: 0, display: "flex",
        alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900,
        background: color + "22", color, border: `1px solid ${color}55` }}>
        {done ? <Check size={14} /> : n}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ color: C.txt, fontSize: 13.5, fontWeight: 800, marginBottom: 6,
          display: "flex", alignItems: "center", gap: 7 }}>{icon} {title}</div>
        {children}
      </div>
    </div>
  );
}
