/**
 * The phone app's own door.
 *
 * The Hey Nikki app is the dashboard in a WebView plus one native thing the
 * browser cannot do: a microphone that stays open with the screen off,
 * waiting for "Hey Nikki". That listener runs for hours without the WebView
 * awake, so it cannot borrow the page's one-hour Supabase token. It holds a
 * device token instead (migration 046) and talks only to these routes.
 *
 *   POST /api/app/device-token         (Supabase JWT)  → mint one for this phone
 *   POST /api/app/device-token/revoke  (Supabase JWT)  → sign a phone out
 *   POST /api/app/voice-query          (device token)  → the same brain as the
 *                                                        dashboard's voice widget
 *   GET  /api/app/wake-prompt          (device token)  → "చెప్పండి" as audio
 */
import crypto from "crypto";
import type { Express, Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";

type VoiceResult = { transcript: string; answer: string; audio_base64: string; audio_mime: string };

type Deps = {
  sb:               SupabaseClient;
  verifyJWT:        (req: Request, res: Response, next: NextFunction) => void;
  apiLimiter:       any;
  getTenantId:      (userId: string) => Promise<string | null>;
  audit:            (action: string, ctx: any) => Promise<void>;
  tenantVoiceQuery: (tenantId: string, audioBase64: string, mimeType: string) => Promise<VoiceResult>;
  synthesize:       (text: string) => Promise<string>;   // base64 wav
};

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const TOKEN_TTL_DAYS = 90;

export function mountAppRoutes(app: Express, d: Deps) {
  const { sb, verifyJWT, apiLimiter, getTenantId, audit } = d;

  // "Authorization: Device <token>". Touches last_used_at so a phone that
  // keeps listening keeps its token; one that goes quiet for 90 days loses it.
  async function verifyDevice(req: any, res: Response, next: NextFunction) {
    const auth = String(req.headers.authorization || "");
    if (!auth.startsWith("Device ")) return res.status(401).json({ error: "No device token" });
    const token = auth.slice(7).trim();
    if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) return res.status(401).json({ error: "Bad device token" });

    const { data: row } = await sb.from("app_device_tokens")
      .select("id, tenant_id, user_id, revoked_at, last_used_at, created_at")
      .eq("token_hash", sha256(token)).maybeSingle();
    if (!row || row.revoked_at) return res.status(401).json({ error: "Device signed out — open the app and sign in again." });
    const lastSeen = new Date(row.last_used_at || row.created_at).getTime();
    if (Date.now() - lastSeen > TOKEN_TTL_DAYS * 86400e3) {
      await sb.from("app_device_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", row.id);
      return res.status(401).json({ error: "Device token expired — open the app and sign in again." });
    }
    // Fire and forget; a failed touch must not fail the question.
    sb.from("app_device_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id)
      .then(() => {}, () => {});
    req.device = { id: row.id, tenant_id: row.tenant_id, user_id: row.user_id };
    next();
  }

  app.post("/api/app/device-token", verifyJWT, apiLimiter, async (req: any, res) => {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) return res.status(403).json({ error: "No tenant" });
    const platform = req.body?.platform === "ios" ? "ios" : "android";
    const label = String(req.body?.label || "").trim().slice(0, 80) || null;

    const token = crypto.randomBytes(32).toString("base64url");
    const { data, error } = await sb.from("app_device_tokens").insert({
      tenant_id: tenantId, user_id: req.user.id, token_hash: sha256(token), label, platform,
    }).select("id").single();
    if (error) return res.status(500).json({ error: error.message });

    await audit("app.device_token_issued", { tenantId, actorId: req.user.id, req, metadata: { device_id: data.id, platform, label } });
    res.json({ ok: true, device_id: data.id, token, expires_after_days_idle: TOKEN_TTL_DAYS });
  });

  app.post("/api/app/device-token/revoke", verifyJWT, apiLimiter, async (req: any, res) => {
    const id = String(req.body?.device_id || "");
    if (!id) return res.status(400).json({ error: "device_id required" });
    const { error } = await sb.from("app_device_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // Same brain, same answer, same voice as the dashboard widget — only the
  // credential differs. Audio arrives as 16 kHz mono WAV from AudioRecord.
  app.post("/api/app/voice-query", verifyDevice, async (req: any, res) => {
    const { audio_base64, mime_type } = req.body || {};
    if (!audio_base64) return res.status(400).json({ error: "audio_base64 required" });
    try {
      const out = await d.tenantVoiceQuery(req.device.tenant_id, audio_base64, mime_type || "audio/wav");
      res.json(out);
    } catch (e: any) {
      const msg = e?.message || "Voice query failed";
      console.error("[app voice-query]", msg);
      res.status(/hear anything/i.test(msg) ? 422 : 500).json({ error: msg });
    }
  });

  // What she says when she wakes: "చెప్పండి" (tell me). The app caches it
  // after the first fetch, so the reply never waits on the network.
  const wakeCache = new Map<string, string>();
  app.get("/api/app/wake-prompt", verifyDevice, async (_req: any, res) => {
    try {
      const text = "చెప్పండి";
      let b64 = wakeCache.get(text);
      if (!b64) { b64 = await d.synthesize(text); wakeCache.set(text, b64); }
      res.json({ text, audio_base64: b64, audio_mime: "audio/wav" });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "TTS failed" });
    }
  });
}
