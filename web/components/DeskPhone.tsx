"use client";

/**
 * The seat's phone, on the Desk.
 *
 * A telecaller chooses once where their calls happen — this computer, or
 * their mobile — and the Desk remembers. On "this computer" the browser is
 * the phone (lib/softphone.ts): the dialer calls from it, an incoming call
 * rings here with Answer and Decline, and the controls a handset has
 * (mute, hold, keypad, hang up) are on screen.
 *
 * usePhone() is the one place the rest of the Desk asks "which phone, and
 * is it ready" — the dialer must not guess from two pieces of state.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  Headphones, Smartphone, Mic, MicOff, Pause, Play, PhoneOff, PhoneIncoming, Grid3x3, Volume2,
} from "lucide-react";
import { NIKKI } from "../lib/brand";
import {
  softphone, savedPhoneMode, savePhoneMode,
  type PhoneMode, type PhoneSnapshot,
} from "../lib/softphone";

const C = {
  surf: NIKKI.surface, hi: NIKKI.vault, bord: NIKKI.border, glow: NIKKI.teal,
  gold: NIKKI.gold, grn: NIKKI.emerald, red: NIKKI.red,
  txt: NIKKI.text, mid: NIKKI.textMid, dim: NIKKI.textDim,
};

const pretty = (n: string) => n.length === 10 ? `${n.slice(0, 5)} ${n.slice(5)}` : (n || "Unknown number");
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const SERVER_SNAPSHOT: PhoneSnapshot = {
  status: "off", call: { state: "none" }, muted: false, held: false, relay: false, quality: null, error: "",
};

export function usePhone(getToken: () => Promise<string>, hasMobile: boolean | null) {
  const snap = useSyncExternalStore(
    (fn) => softphone().subscribe(fn),
    () => softphone().get(),
    () => SERVER_SNAPSHOT,
  );
  const [mode, setModeState] = useState<PhoneMode | null>(null);

  // First visit: a seat with no mobile on file can only work from here, so
  // that is chosen for them. One with a mobile is asked once — it used to
  // be put on "My mobile" silently, and nobody found the other option.
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (mode !== null || hasMobile === null) return;
    const saved = savedPhoneMode();
    if (saved || !hasMobile) setModeState(saved || "browser");
    else setAsked(true);
  }, [mode, hasMobile]);

  // Come back to the Desk on "this computer" and the phone turns itself on.
  useEffect(() => {
    if (mode === "browser" && softphone().get().status === "off") softphone().start(getToken);
  }, [mode, getToken]);

  const setMode = useCallback((m: PhoneMode) => {
    savePhoneMode(m);
    setModeState(m);
    if (m === "browser") softphone().start(getToken);
    else softphone().stop();
  }, [getToken]);

  return {
    mode, setMode, snap,
    /** Nothing chosen on this computer yet; no call is placed until it is. */
    needsChoice: mode === null && asked,
    /** Calls go through the browser right now. */
    viaBrowser: mode === "browser" && snap.status === "ready",
    /** The seat chose the browser but it is not usable yet. */
    browserPending: mode === "browser" && snap.status !== "ready",
  };
}

export type Phone = ReturnType<typeof usePhone>;

const btn = (bg: string, fg = "#fff"): React.CSSProperties => ({
  background: bg, color: fg, border: "none", borderRadius: 8, padding: "9px 14px", minHeight: 40,
  fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  display: "inline-flex", alignItems: "center", gap: 6,
});

function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

export default function DeskPhone({ phone, mobile }: { phone: Phone; mobile: string }) {
  const { mode, setMode, snap, needsChoice } = phone;
  const [pad, setPad] = useState(false);
  const sp = softphone();
  const call = snap.call;
  useTick(call.state === "active");

  // An incoming call when the tab is in the background: the ring is audible,
  // but say who it is where the seat is looking.
  useEffect(() => {
    if (call.state !== "incoming" || document.visibilityState === "visible") return;
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        const n = new Notification("Incoming call", { body: pretty(call.from), tag: "nikki-incoming", requireInteraction: true });
        n.onclick = () => { window.focus(); n.close(); };
        return () => n.close();
      }
    } catch { /* notifications are a courtesy */ }
  }, [call]);

  const seg = (m: PhoneMode, icon: React.ReactNode, label: string) => (
    <button type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
      style={{
        flex: 1, minHeight: 40, border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "inherit",
        fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        background: mode === m ? C.surf : "transparent", color: mode === m ? C.txt : C.mid,
        boxShadow: mode === m ? "0 1px 2px rgba(15,23,42,0.12)" : "none",
      }}>
      {icon}{label}
    </button>
  );

  const status = (() => {
    if (mode === null) {
      return needsChoice
        ? { color: C.gold, text: "Choose where your calls happen. This computer needs a headset; My mobile rings your phone first. You can switch at any time." }
        : { color: C.dim, text: "Checking your phone…" };
    }
    if (mode === "mobile") {
      return mobile
        ? { color: C.grn, text: `Calls ring ${pretty(mobile)} first, then connect the customer.` }
        : { color: C.gold, text: "No mobile on file. Add one below, or use this computer." };
    }
    switch (snap.status) {
      case "ready":      return snap.error ? { color: C.red, text: snap.error }
                              : { color: C.grn,  text: "Ready. You call and answer from this computer — use a headset." };
      case "connecting": return { color: C.gold, text: "Connecting the phone…" };
      case "offline":    return { color: C.gold, text: snap.error || "Connection lost. Reconnecting…" };
      case "no_mic":     return { color: C.red,  text: snap.error };
      default:           return { color: C.dim,  text: "The phone is off." };
    }
  })();

  return (
    <>
      <section aria-label="Your phone" style={{ background: C.surf, border: `1px solid ${needsChoice ? C.gold : "#E4E9F0"}`, borderRadius: 12,
        padding: 18, minWidth: 0, boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
        <div style={{ color: C.txt, fontFamily: "var(--font-display), sans-serif", fontSize: 15.5, fontWeight: 700,
          letterSpacing: "-0.01em", display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Headphones size={15} /> Your phone
        </div>

        <div role="radiogroup" aria-label="Where your calls happen"
          style={{ display: "flex", gap: 4, background: C.hi, borderRadius: 9, padding: 4 }}>
          {seg("browser", <Headphones size={14} />, "This computer")}
          {seg("mobile", <Smartphone size={14} />, "My mobile")}
        </div>

        <div role="status" style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: C.mid, lineHeight: 1.45 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: status.color, flexShrink: 0, marginTop: 5 }} />
          <span>{status.text}</span>
        </div>

        {mode === "browser" && snap.status === "ready" && call.state === "none" && (
          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={btn(C.hi, C.txt)}
              onClick={() => sp.selfTest().catch(() => {})}>
              <Volume2 size={14} /> Test my headset
            </button>
            {!snap.relay && (
              <span style={{ fontSize: 12, color: C.dim, flex: "1 1 200px" }}>
                Tested on the office network. From another network a call may not connect.
              </span>
            )}
          </div>
        )}
        {mode === "browser" && snap.status === "no_mic" && (
          <button type="button" style={{ ...btn(C.glow), marginTop: 12 }} onClick={() => setMode("browser")}>Try again</button>
        )}

        {/* On a call */}
        {mode === "browser" && (call.state === "active" || call.state === "calling") && (
          <div style={{ marginTop: 14, borderTop: `1px solid ${C.bord}`, paddingTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <div style={{ fontSize: 13, color: C.txt, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {call.state === "calling" ? "Connecting…"
                  : `${snap.held ? "On hold" : "On call"} · ${mmss(Math.round((Date.now() - call.since) / 1000))}`}
              </div>
              {snap.quality && call.state === "active" && (
                <span style={{ fontSize: 12, fontWeight: 700,
                  color: snap.quality === "good" ? C.grn : snap.quality === "fair" ? C.gold : C.red }}>
                  {snap.quality === "good" ? "Line is clear" : snap.quality === "fair" ? "Line is unsteady" : "Poor connection"}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {call.state === "active" && (
                <>
                  <button type="button" aria-pressed={snap.muted} style={btn(snap.muted ? C.gold : C.hi, snap.muted ? "#fff" : C.txt)}
                    onClick={() => sp.setMuted(!snap.muted)}>
                    {snap.muted ? <MicOff size={14} /> : <Mic size={14} />} {snap.muted ? "Unmute" : "Mute"}
                  </button>
                  <button type="button" aria-pressed={snap.held} style={btn(snap.held ? C.gold : C.hi, snap.held ? "#fff" : C.txt)}
                    onClick={() => sp.setHeld(!snap.held)}>
                    {snap.held ? <Play size={14} /> : <Pause size={14} />} {snap.held ? "Resume" : "Hold"}
                  </button>
                  <button type="button" aria-pressed={pad} style={btn(C.hi, C.txt)} onClick={() => setPad(p => !p)}>
                    <Grid3x3 size={14} /> Keypad
                  </button>
                </>
              )}
              <button type="button" style={{ ...btn(C.red), marginLeft: "auto" }} onClick={() => sp.hangup()}>
                <PhoneOff size={14} /> Hang up
              </button>
            </div>
            {pad && call.state === "active" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 10, maxWidth: 220 }}>
                {"123456789*0#".split("").map(k => (
                  <button key={k} type="button" aria-label={`Key ${k}`} style={{ ...btn(C.hi, C.txt), justifyContent: "center", fontSize: 16 }}
                    onClick={() => sp.sendDigit(k)}>{k}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Incoming: fixed, so it is seen wherever the seat has scrolled. */}
      {call.state === "incoming" && (
        <div role="alertdialog" aria-label="Incoming call" style={{
          position: "fixed", right: 16, bottom: 16, left: "auto", zIndex: 10002, width: "min(360px, calc(100vw - 32px))",
          background: "#0F172A", color: "#F8FAFC", borderRadius: 14, padding: 16,
          boxShadow: "0 24px 60px rgba(15,23,42,0.45)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span style={{ width: 36, height: 36, borderRadius: "50%", background: C.grn, display: "inline-flex",
              alignItems: "center", justifyContent: "center", flexShrink: 0, animation: "deskpulse 1.6s infinite" }}>
              <PhoneIncoming size={18} color="#fff" />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600 }}>Incoming call</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{pretty(call.from)}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" autoFocus style={{ ...btn(C.grn), flex: 1, justifyContent: "center", minHeight: 44 }} onClick={() => sp.answer()}>
              Answer
            </button>
            <button type="button" style={{ ...btn("#334155"), flex: 1, justifyContent: "center", minHeight: 44 }} onClick={() => sp.hangup()}>
              Decline
            </button>
          </div>
        </div>
      )}
    </>
  );
}
