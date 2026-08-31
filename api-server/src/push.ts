// ── Push notifications to the Flutter app ─────────────────────
//
// The app has done its half for a while: fcm_service.dart asks Firebase for a
// token and upserts it into device_tokens itself. Nothing ever sent one. The
// only reference to sending in the whole api-server was a comment reading
// "In production: trigger FCM push".
//
// FCM's HTTP v1 API needs an OAuth2 token from a service account, not the
// legacy server key. That is a signed JWT exchanged for an access token —
// forty lines with Node's own crypto, rather than pulling in the Firebase
// admin SDK for one call.
//
// The `type` values here are the ones the app already routes on:
//   missed_call | completed_call | appointment | billing

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
let cached: { token: string; exp: number } | null = null;

function configured(): boolean {
  return !!(process.env.FIREBASE_PROJECT_ID
         && process.env.FIREBASE_CLIENT_EMAIL
         && process.env.FIREBASE_PRIVATE_KEY);
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function accessToken(): Promise<string | null> {
  if (!configured()) return null;
  // Re-use until a minute before expiry; a token per notification would add a
  // round trip to every push for no reason.
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss:   process.env.FIREBASE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud:   TOKEN_URL,
    iat:   now,
    exp:   now + 3600,
  }));
  // The key arrives from an env file with literal \n sequences.
  const key = String(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n");
  const sig = b64url(crypto.createSign("RSA-SHA256")
    .update(`${header}.${payload}`).sign(key));

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:  `${header}.${payload}.${sig}`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    console.error("[push] could not get an access token:", j.error_description || j.error || r.status);
    return null;
  }
  cached = { token: j.access_token, exp: Date.now() + (Number(j.expires_in || 3600) * 1000) };
  return cached.token;
}

export function makePush(sb: SupabaseClient) {
  /** Notify every device belonging to these users. */
  async function pushToUsers(
    userIds: string[],
    msg: { title: string; body: string; data?: Record<string, string> },
  ): Promise<number> {
    if (!configured() || !userIds.length) return 0;
    const token = await accessToken();
    if (!token) return 0;

    const { data: devices } = await sb.from("device_tokens")
      .select("id, token, platform").in("user_id", userIds);
    if (!devices?.length) return 0;

    const project = process.env.FIREBASE_PROJECT_ID;
    let sent = 0;
    for (const d of devices) {
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token: d.token,
            notification: { title: msg.title, body: msg.body },
            // Data values must be strings; a number here is rejected outright.
            data: Object.fromEntries(Object.entries(msg.data || {}).map(([k, v]) => [k, String(v)])),
            android: { priority: "high" },
            apns: { payload: { aps: { sound: "default" } } },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) { sent++; continue; }

      const err: any = await r.json().catch(() => ({}));
      const status = err?.error?.details?.[0]?.errorCode || err?.error?.status || "";
      // A token dies when the app is uninstalled or reinstalled. Keeping it
      // means every future push to that person pays a guaranteed failure.
      if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(String(status))) {
        await sb.from("device_tokens").delete().eq("id", d.id);
        console.log(`[push] pruned a dead ${d.platform} token`);
      } else {
        console.error(`[push] send failed ${r.status}:`, JSON.stringify(err).slice(0, 160));
      }
    }
    return sent;
  }

  /** Notify everyone on a business's account. */
  async function pushToTenant(
    tenantId: string,
    msg: { title: string; body: string; data?: Record<string, string> },
  ): Promise<number> {
    const { data: members } = await sb.from("tenant_users")
      .select("user_id").eq("tenant_id", tenantId);
    return pushToUsers((members || []).map((m: any) => m.user_id), msg);
  }

  return { pushToUsers, pushToTenant, pushConfigured: configured };
}
