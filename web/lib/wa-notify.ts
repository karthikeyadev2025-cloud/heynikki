// lib/wa-notify.ts — tell the person a WhatsApp message arrived, wherever
// in the dashboard they are. Until this, a reply was only seen by someone
// who happened to open the WhatsApp page.
import { useEffect, useState } from "react";
import { deskApi } from "./desk-api";
import { toast } from "../components/Toast";

const SEEN_KEY = "nk_wa_last_seen";
/** Fired with the unread count each time it is checked. */
export const WA_EVENT = "nk-wa-unread";

function chime() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    [[880, 0], [1175, 0.12]].forEach(([freq, at]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.3);
    });
    setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch { /* a browser that will not play is not an error */ }
}

export function alertsState(): "on" | "off" | "blocked" | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission === "granted" ? "on" : Notification.permission === "denied" ? "blocked" : "off";
}

/** Must be called from a click: browsers refuse the prompt otherwise. */
export async function enableAlerts(): Promise<boolean> {
  if (alertsState() === "unsupported") return false;
  return (await Notification.requestPermission()) === "granted";
}

/** Unread WhatsApp messages for this business, checked every half minute. */
export function useWaUnread(enabled: boolean): number {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const check = async () => {
      try {
        const j = await deskApi("/api/whatsapp/unread");
        if (stop) return;
        setUnread(j.unread || 0);
        window.dispatchEvent(new CustomEvent(WA_EVENT, { detail: j.unread || 0 }));
        const m = j.latest;
        if (!m) return;
        let seen = "";
        try { seen = localStorage.getItem(SEEN_KEY) || ""; } catch { /* private mode */ }
        if (m.at <= seen) return;
        try { localStorage.setItem(SEEN_KEY, m.at); } catch { /* private mode */ }
        // The first check on a new device has nothing to compare with; do
        // not ring for a message that may be days old.
        if (!seen) return;
        const from = m.name || m.number;
        chime();
        if (!window.location.pathname.startsWith("/whatsapp")) toast.ok(`WhatsApp from ${from}: ${String(m.body).slice(0, 80)}`);
        if (alertsState() === "on" && document.hidden) {
          const n = new Notification(`WhatsApp · ${from}`, { body: String(m.body).slice(0, 140), tag: `wa-${m.number}`, icon: "/icon.svg" });
          n.onclick = () => { window.focus(); window.location.href = `/whatsapp?chat=${m.number}`; n.close(); };
        }
      } catch { /* offline or signed out; the next check will say */ }
    };
    check();
    const t = setInterval(check, 30_000);
    return () => { stop = true; clearInterval(t); };
  }, [enabled]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const bare = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = unread > 0 ? `(${unread}) ${bare}` : bare;
  }, [unread]);
  return unread;
}
