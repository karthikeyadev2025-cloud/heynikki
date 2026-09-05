/**
 * The phone app. The dashboard runs unchanged inside a Capacitor WebView;
 * the one thing the phone adds is a microphone that stays open with the
 * screen off, waiting for "Hey Nikki". This is the JS side of that bridge.
 *
 * Everything here is a no-op in a normal browser, so pages can call it
 * without checking first.
 */
import { createClient } from "./supabase";

const API = process.env.NEXT_PUBLIC_API_URL || "https://api.heynikki.in";
const DEVICE_KEY = "nk_device";   // { id, token } in localStorage — the phone's own credential

type Plugin = {
  start(o: { token: string; apiBase: string }): Promise<{ running: boolean }>;
  stop(): Promise<{ running: boolean }>;
  status(): Promise<{ running: boolean; available: boolean; permission: "granted" | "denied" | "prompt" }>;
  requestPermission(): Promise<{ permission: "granted" | "denied" }>;
  forget(): Promise<void>;
};

function cap(): any { return typeof window !== "undefined" ? (window as any).Capacitor : undefined; }

export function isNativeApp(): boolean {
  try { return !!cap()?.isNativePlatform?.(); } catch { return false; }
}

export function nativePlatform(): "android" | "ios" | "web" {
  try { return cap()?.getPlatform?.() || "web"; } catch { return "web"; }
}

function plugin(): Plugin | null {
  const c = cap();
  if (!c?.isNativePlatform?.()) return null;
  return (c.Plugins?.HeyNikki as Plugin) || null;
}

async function deviceToken(): Promise<string> {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (raw) { const j = JSON.parse(raw); if (j?.token) return j.token; }
  } catch { /* storage blocked — mint fresh */ }
  const sb = createClient();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error("Sign in first");
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const label = (ua.match(/\(([^)]+)\)/)?.[1] || "").split(";").slice(0, 2).join(" ·").slice(0, 80);
  const r = await fetch(`${API}/api/app/device-token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ platform: nativePlatform(), label }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw new Error(j.error || "Could not register this phone");
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify({ id: j.device_id, token: j.token })); } catch { /* fine */ }
  return j.token;
}

/** Start the always-on listener. Resolves false (with a reason) when the phone can't. */
export async function startHeyNikki(): Promise<{ ok: boolean; reason?: string }> {
  const p = plugin();
  if (!p) return { ok: false, reason: "Not in the app" };
  const st = await p.status();
  if (!st.available) return { ok: false, reason: "This phone can't run the listener" };
  if (st.permission !== "granted") {
    const { permission } = await p.requestPermission();
    if (permission !== "granted") return { ok: false, reason: "Microphone permission is needed for 'Hey Nikki'" };
  }
  const token = await deviceToken();
  const { running } = await p.start({ token, apiBase: API });
  return running ? { ok: true } : { ok: false, reason: "The listener did not start" };
}

export async function stopHeyNikki(): Promise<void> {
  const p = plugin();
  if (p) await p.stop();
}

export async function heyNikkiRunning(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  try { return (await p.status()).running; } catch { return false; }
}

/** On sign-out: stop listening and forget the phone's token (server-side too). */
export async function forgetDevice(): Promise<void> {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    localStorage.removeItem(DEVICE_KEY);
    await stopHeyNikki();
    // Also wipe the token the native service keeps for restarts.
    try { await plugin()?.forget?.(); } catch {}
    if (!raw) return;
    const { id } = JSON.parse(raw);
    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    if (!session || !id) return;
    await fetch(`${API}/api/app/device-token/revoke`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: id }),
    });
  } catch { /* best effort */ }
}
