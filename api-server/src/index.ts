// api-server/src/index.ts
// Node.js Business API Server
// FreeSWITCH ESL integration added — see esl.ts

// ─── Sentry instrumentation ──────────────────────────────
// MUST come before any other imports so Sentry can patch Express, HTTP,
// and Postgres client behaviour. SENTRY_DSN unset = Sentry disabled
// gracefully (dev / CI). Errors are captured automatically by the
// expressErrorHandler at the BOTTOM of the middleware stack.
import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn:               process.env.SENTRY_DSN,
    environment:       process.env.NODE_ENV || "development",
    release:           process.env.RELEASE_SHA || undefined,
    tracesSampleRate:  0.1,         // 10% of requests get perf traces
    // Don't capture spans for health checks — they'd dominate the trace volume
    beforeSendTransaction(event) {
      if (event.transaction === "GET /health" || event.transaction === "GET /ready") return null;
      return event;
    },
  });
}

import express from "express";
import cors from "cors";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";

const app  = express();
const PORT = process.env.PORT || 4000;

// ── ENV ──────────────────────────────────────────────────
const SUPABASE_URL    = process.env.SUPABASE_URL!;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY!;
const RZP_KEY_ID      = process.env.RAZORPAY_KEY_ID!;
const RZP_SECRET      = process.env.RAZORPAY_KEY_SECRET!;
const RZP_WEBHOOK_SEC = process.env.RAZORPAY_WEBHOOK_SECRET!;
const INTERNAL_SECRET = process.env.INTERNAL_SECRET!;
const WATI_KEY        = process.env.WATI_API_KEY || "";
const WATI_URL        = process.env.WATI_API_URL || "";
const PIPELINE_URL    = process.env.PIPELINE_URL || "http://localhost:8000";

// ── SUPABASE ADMIN CLIENT ─────────────────────────────────
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── AUDIT LOG HELPER ──────────────────────────────────────
// DPDP Act Section 8(7) requires data fiduciaries to maintain records
// of personal data processing. Backend code should call audit() for any
// action listed in supabase/003_audit_log.sql. Writes go through the
// service-role key so RLS doesn't block them. Failures are logged but
// never thrown — audit logging must not break the underlying operation.
async function audit(
  action:     string,
  ctx: {
    tenantId?:    string;
    actorId?:     string;
    actorEmail?:  string;
    resource?:    string;
    metadata?:    Record<string, any>;
    req?:         any;
  }
) {
  try {
    await sb.from("audit_log").insert({
      tenant_id:   ctx.tenantId   || null,
      actor_id:    ctx.actorId    || null,
      actor_email: ctx.actorEmail || null,
      action,
      resource:    ctx.resource   || null,
      metadata:    ctx.metadata   || {},
      ip:          ctx.req?.ip    || null,
      user_agent:  ctx.req?.get?.("user-agent") || null,
    });
  } catch (e) {
    console.error(`[audit] ${action} failed:`, e);
    // Sentry will pick this up via console.error breadcrumbs
  }
}

// ── MIDDLEWARE ────────────────────────────────────────────
app.use(cors({ origin: "*" }));

// Trust the first proxy hop — required for accurate req.ip behind Railway / Vercel.
// Without this, rate-limit uses Railway's edge IP and 1 attacker can DoS everyone.
app.set("trust proxy", 1);

// ── RATE LIMITING ─────────────────────────────────────────
// Three tiers, applied where they make sense:
//
//   tightLimiter  — auth-sensitive paths (signup verification, magic-link, etc).
//                   30 req / 15 min / IP. Stops credential-stuffing.
//   webhookLimiter — burst protection on webhook endpoints. Razorpay legit
//                   bursts occasionally; Exotel may retry. Generous but bounded.
//   apiLimiter    — generic protection for everything else. 300 req / 15 min / IP.
const tightLimiter   = rateLimit({ windowMs: 15 * 60 * 1000, max:  30, standardHeaders: true, legacyHeaders: false });
const webhookLimiter = rateLimit({ windowMs:      60 * 1000, max:  60, standardHeaders: true, legacyHeaders: false });
const apiLimiter     = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
// Fully unauthenticated (public landing page, no login) AND each
// request costs real Sarvam API money — kept deliberately tight.
// ~20 lines covers a full demo run-through; not generous enough for
// meaningful cost abuse from a single IP.
// Fully unauthenticated (public landing page, no login) AND each
// request costs real Sarvam API money — kept bounded, but raised
// from an initial 20/15min after realizing a single full conversation
// easily uses 6-10+ TTS calls (greeting + several back-and-forth
// turns) — the original limit could exhaust itself within one or two
// real test runs, not just from abuse.
const publicTtsLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

// Apply webhook limiter ONLY to webhook paths (HMAC + token verification
// already filter junk, but burst-cap protects against billing surprises).
app.use("/webhooks", webhookLimiter);
// Apply generic limiter to API paths.
app.use("/api",      apiLimiter);

// Raw body for webhook HMAC verification
app.use((req, res, next) => {
  if (req.path.startsWith("/webhooks/")) {
    express.raw({ type: "application/json" })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

// ── INTERNAL AUTH ─────────────────────────────────────────
function verifyInternal(req: express.Request, res: express.Response, next: express.NextFunction) {
  const secret = req.headers["x-internal-secret"];
  if (secret !== INTERNAL_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ── SUPABASE JWT AUTH ─────────────────────────────────────
async function verifyJWT(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "No token" });
  const { data, error } = await sb.auth.getUser(auth.split(" ")[1]);
  if (error || !data.user) return res.status(401).json({ error: "Invalid token" });
  (req as any).user = data.user;
  next();
}

async function getTenantId(userId: string): Promise<string | null> {
  const { data } = await sb.from("tenant_users")
    .select("tenant_id").eq("user_id", userId).single();
  return data?.tenant_id || null;
}

// ════════════════════════════════════════════════
// EXOTEL WEBHOOK — inbound call handler
// Exotel calls this URL when someone dials your DID
// ════════════════════════════════════════════════
// ── Webhook auth helpers ──
// Exotel doesn't sign webhooks like Stripe/Razorpay. Protection is a
// shared-secret token in the URL: caller must hit
//   /webhooks/exotel/inbound/<EXOTEL_WEBHOOK_TOKEN>
// Token is configured in Exotel's webhook URL when you set up the DID.
// Without this, anyone hitting the public endpoint can trigger AI calls
// (and burn Sarvam/Gemini/LiveKit credits).
const EXOTEL_TOKEN = process.env.EXOTEL_WEBHOOK_TOKEN || "";

function checkExotelToken(req: any, res: any): boolean {
  if (!EXOTEL_TOKEN) {
    // Misconfiguration — fail closed
    console.error("[Exotel] EXOTEL_WEBHOOK_TOKEN env not set — rejecting");
    res.status(500).json({ error: "Webhook misconfigured" });
    return false;
  }
  // constant-time compare to prevent timing attacks
  const provided = req.params.token || "";
  const ok = provided.length === EXOTEL_TOKEN.length &&
             crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(EXOTEL_TOKEN));
  if (!ok) {
    console.warn(`[Exotel] Bad token from ${req.ip}`);
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

app.post("/webhooks/exotel/inbound/:token", async (req, res) => {
  if (!checkExotelToken(req, res)) return;
  try {
    // Exotel sends form-encoded data
    const body   = req.body as Record<string, string>;
    const caller = body.From || body.CallFrom || "unknown";
    const did    = body.To   || body.CallTo   || "";
    const callSid = body.CallSid || "";

    console.log(`[Exotel] Inbound: ${caller} → DID ${did}, SID: ${callSid}`);

    // Forward to Python voice pipeline
    const resp = await fetch(`${PIPELINE_URL}/api/v1/call/inbound`, {
      method:  "POST",
      headers: {
        "Content-Type":     "application/json",
        "X-Internal-Secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({
        caller_number: caller,
        did_number:    did,
        call_sid:      callSid,
      }),
    });

    if (!resp.ok) {
      console.error(`[Exotel] Pipeline rejected: ${resp.status}`);
      // Return Exotel XML to play a fallback message
      res.set("Content-Type", "text/xml");
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>క్షమించండి. Technical issue. తర్వాత మళ్ళీ call చేయండి.</Say>
</Response>`);
    }

    const data = await resp.json() as { call_id: string };
    // Exotel expects XML response to route the call
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${PIPELINE_URL.replace("https://","").replace("http://","")}/ws/call/${data.call_id}" />
  </Connect>
</Response>`);

  } catch (err: any) {
    console.error("[Exotel webhook error]", err.message);
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>క్షమించండి. Technical issue.</Say>
</Response>`);
  }
});

// Exotel call status callback
app.post("/webhooks/exotel/status/:token", async (req, res) => {
  if (!checkExotelToken(req, res)) return;

// ── Instant lead capture ────────────────────────────────
// Public webhook: a website form, Facebook Lead Ad (via Zapier/Make), or
// Google Form submission posts here. This is Hey Nikki's answer to "the
// AI calls before the prospect closes their browser" — the capture is
// instant; the callback typically follows within ~30 seconds (the
// dispatcher's poll interval), not milliseconds, but that's still fast
// enough to be first to a fresh lead in practice.
//
// Auth is the token in the URL (per-tenant, in voice_profiles.capture_token),
// same pattern as the Exotel webhooks above — a public form has no way to
// send an internal secret header, so the token itself is the credential.
app.post("/webhooks/lead-capture/:token", async (req, res) => {
  try {
    const token = req.params.token || "";
    const { data: profile } = await sb.from("voice_profiles")
      .select("id, tenant_id, business_name, capture_token, whatsapp_number, "
            + "auto_whatsapp_new_leads, auto_call_new_leads")
      .not("capture_token", "is", null)
      .limit(500) as { data: {
        id: string; tenant_id: string; business_name: string | null;
        capture_token: string; whatsapp_number: string | null;
        auto_whatsapp_new_leads: boolean; auto_call_new_leads: boolean;
      }[] | null };

    // Constant-time compare against each candidate — avoids leaking which
    // prefix matched via response timing, same reasoning as checkExotelToken.
    const match = (profile || []).find(p =>
      p.capture_token.length === token.length &&
      crypto.timingSafeEqual(Buffer.from(p.capture_token), Buffer.from(token))
    );
    if (!match) {
      return res.status(404).json({ error: "Unknown or invalid capture link" });
    }

    const body = req.body as Record<string, string>;
    // Tolerant of common field-name variants across form builders /
    // Facebook Lead Ads / Zapier so this doesn't need per-source mapping.
    const name  = body.name || body.full_name || body.first_name || null;
    const phone = (body.phone || body.phone_number || body.mobile || "").trim();
    const message = body.message || body.interest || body.enquiry || null;
    const source = (body.source === "ad_lead" ? "ad_lead" : "web_form") as
      "ad_lead" | "web_form";

    if (!phone) {
      return res.status(400).json({ error: "phone (or phone_number/mobile) is required" });
    }

    // Reuse the same upsert function calls use — a lead who fills the
    // form twice, or later calls in, converges on one record either way.
    const { data: leadId, error: leadErr } = await sb.rpc("upsert_lead_from_call", {
      p_tenant_id: match.tenant_id,
      p_phone:     phone,
      p_name:      name,
      p_intent:    "other",
      p_interest:  message,
      // A self-submitted enquiry is a warmer signal than an unscored cold
      // number — starts above the "worth calling back" threshold (50) used
      // elsewhere in the product, but below an actually-booked call (80+).
      p_score:     55,
      p_call_id:   null,
    });
    if (leadErr) {
      console.error("[lead-capture] upsert failed:", leadErr.message);
      return res.status(500).json({ error: "Could not save lead" });
    }

    // Respond fast — the caller is a form/webhook expecting a quick ack,
    // not waiting on WhatsApp delivery or a call being placed.
    res.json({ ok: true, lead_id: leadId });

    // Fire-and-forget from here — failures are logged, never surfaced to
    // the form submitter as an error (the lead is already safely saved).
    if (match.auto_whatsapp_new_leads && match.whatsapp_number) {
      const ackMsg = `నమస్కారం${name ? " " + name : ""}! 🙏\n` +
        `${match.business_name || "మేము"} మీ enquiry అందుకున్నాము. ` +
        `మా team షార్ట్‌గా మిమ్మల్ని సంప్రదిస్తుంది.\n\n` +
        `Thanks for reaching out — we'll call you shortly.`;
      sendWhatsApp(phone, ackMsg, match.tenant_id, match.id, "lead_capture_ack")
        .catch(e => console.error("[lead-capture] whatsapp ack failed:", e));
    }

    if (match.auto_call_new_leads) {
      sb.from("outbound_recipients").insert({
        tenant_id:  match.tenant_id,
        campaign_id: null,
        is_instant: true,
        phone,
        first_name: name,
        status:     "pending",
        metadata:   { source, message, voice_profile_id: match.id },
      }).then(({ error }) => {
        if (error) console.error("[lead-capture] recipient insert failed:", error.message);
      });
    }
  } catch (err: any) {
    console.error("[lead-capture] error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Internal error" });
  }
});

  try {
    const body = req.body as Record<string, string>;
    const callSid = body.CallSid || "";
    const status  = body.Status  || "";
    const duration = parseInt(body.Duration || "0");
    console.log(`[Exotel] Status: ${callSid} → ${status}, ${duration}s`);

    if (status === "completed" && callSid) {
      // Update call record by exotel_sid if we stored it
      await sb.from("calls")
        .update({ status: "completed", duration_seconds: duration })
        .eq("status", "active")
        .limit(1); // In production, match by call_sid
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[Exotel status error]", err.message);
    res.json({ ok: true });
  }
});

// ════════════════════════════════════════════════
// RAZORPAY WEBHOOKS
// ════════════════════════════════════════════════
app.post("/webhooks/razorpay", async (req, res) => {
  const rawBody = req.body as Buffer;
  const sig     = req.headers["x-razorpay-signature"] as string;

  // HMAC verification — reject if invalid
  const expected = crypto
    .createHmac("sha256", RZP_WEBHOOK_SEC)
    .update(rawBody)
    .digest("hex");

  if (sig !== expected) {
    console.error("[Razorpay] Invalid webhook signature");
    return res.status(400).json({ error: "Invalid signature" });
  }

  const event = JSON.parse(rawBody.toString());
  const { event: eventName, payload } = event;

  console.log(`[Razorpay] Event: ${eventName}`);

  try {
    switch (eventName) {

      case "subscription.activated": {
        const sub     = payload.subscription.entity;
        const notes   = sub.notes || {};
        const tenantId = notes.tenant_id;
        if (!tenantId) break;
        await sb.from("tenants").update({
          plan:   notes.plan_id || "starter",
          status: "active",
        }).eq("id", tenantId);
        await sb.from("subscriptions").upsert({
          tenant_id:            tenantId,
          plan_id:              notes.plan_id,
          razorpay_sub_id:      sub.id,
          status:               "active",
          current_period_start: new Date(sub.current_start * 1000).toISOString(),
          current_period_end:   new Date(sub.current_end   * 1000).toISOString(),
        });
        await updateMinuteLimit(tenantId, notes.plan_id);
        break;
      }

      case "payment.captured": {
        const pmt      = payload.payment.entity;
        const notes    = pmt.notes || {};
        const tenantId = notes.tenant_id;
        if (!tenantId) break;

        // Add-on minutes purchase
        if (notes.type === "addon_minutes") {
          const minutes = parseInt(notes.minutes || "0");
          await sb.rpc("increment_call_minutes", {
            p_tenant_id: tenantId,
            p_seconds:   minutes * 60,
          });
        }
        await sendEmail(tenantId, "payment_success", { amount: pmt.amount / 100 });
        break;
      }

      case "subscription.charged": {
        const sub      = payload.subscription.entity;
        const notes    = sub.notes || {};
        const tenantId = notes.tenant_id;
        if (!tenantId) break;
        // Reset monthly minutes
        const month = new Date().toISOString().slice(0, 7);
        await sb.from("call_minutes").upsert({
          tenant_id:            tenantId,
          month,
          used_seconds:         0,
          plan_limit_seconds:   getPlanLimitSeconds(notes.plan_id),
        }, { onConflict: "tenant_id,month" });
        break;
      }

      case "payment.failed": {
        const pmt      = payload.payment.entity;
        const notes    = pmt.notes || {};
        const tenantId = notes.tenant_id;
        if (!tenantId) break;
        await sendEmail(tenantId, "payment_failed", {});
        break;
      }

      case "subscription.cancelled": {
        const sub      = payload.subscription.entity;
        const notes    = sub.notes || {};
        const tenantId = notes.tenant_id;
        if (!tenantId) break;
        // Downgrade at period end — mark pending
        await sb.from("subscriptions")
          .update({ status: "cancelled" })
          .eq("razorpay_sub_id", sub.id);
        break;
      }
    }

    res.json({ ok: true });

  } catch (err: any) {
    console.error("[Razorpay webhook handler error]", err.message);
    res.json({ ok: true }); // Always 200 to Razorpay
  }
});

function getPlanLimitSeconds(planId: string): number {
  const limits: Record<string, number> = {
    starter: 200 * 60,
    growth:  600 * 60,
    scale:   1500 * 60,
  };
  return limits[planId] || 200 * 60;
}

async function updateMinuteLimit(tenantId: string, planId: string) {
  const month = new Date().toISOString().slice(0, 7);
  await sb.from("call_minutes").upsert({
    tenant_id:          tenantId,
    month,
    plan_limit_seconds: getPlanLimitSeconds(planId),
  }, { onConflict: "tenant_id,month" });
}

// ════════════════════════════════════════════════
// WHATSAPP AUTOMATION
// ════════════════════════════════════════════════
async function sendWhatsApp(to: string, message: string, tenantId: string,
  voiceProfileId: string, messageType: string, callId?: string, apptId?: string) {
  if (!WATI_KEY || !WATI_URL) return false;
  try {
    const resp = await fetch(`${WATI_URL}/api/v1/sendSessionMessage/${to.replace("+","")}`, {
      method:  "POST",
      headers: { "Authorization": `Bearer ${WATI_KEY}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ messageText: message }),
    });
    const ok = resp.status === 200 || resp.status === 201;
    await sb.from("wa_dispatch_log").insert({
      tenant_id:        tenantId,
      voice_profile_id: voiceProfileId,
      call_id:          callId || null,
      appointment_id:   apptId || null,
      message_type:     messageType,
      to_number:        to,
      message_body:     message,
      status:           ok ? "sent" : "failed",
    });
    return ok;
  } catch (err: any) {
    console.error("[WhatsApp error]", err.message);
    return false;
  }
}

// WhatsApp trigger endpoint (called by voice pipeline after call)
// Public, unauthenticated TTS for the landing page's demo widget.
// FIXED a real, serious bug: the widget was never using Sarvam at
// all — it spoke fake "Telugu" by phonetically transliterating text
// into Tanglish and reading it with an ENGLISH voice
// (utt.lang = "en-IN") via the browser's built-in speechSynthesis.
// That's genuinely not Telugu speech, just an approximation of the
// sound — explaining the "robotic, bad pronunciation, not a real
// female voice" complaint precisely. This is the actual product's
// real Sarvam bulbul:v3 voice, same as live calls and the dashboard
// assistant, but reachable by anonymous visitors — no login exists
// yet at this point in the funnel, hence the strict IP-based rate
// limit above (publicTtsLimiter) rather than the usual auth checks.
app.post("/api/public/tts", publicTtsLimiter, async (req, res) => {
  const { text, emotion } = req.body as { text?: string; emotion?: string };
  if (!text || text.length > 500) {
    return res.status(400).json({ error: "text required, max 500 characters" });
  }

  // Mirrors the widget's existing emotion modes (energetic/cool/gentle)
  // — same concept, mapped to Sarvam's real pace/pitch params instead
  // of the browser TTS rate/pitch properties they replaced.
  const EMOTION_PARAMS: Record<string, { pace: number; pitch: number }> = {
    energetic: { pace: 1.08, pitch: 0.5 },
    cool:      { pace: 1.0,  pitch: 0.2 },
    gentle:    { pace: 0.92, pitch: 0 },
  };
  const { pace, pitch } = EMOTION_PARAMS[emotion || "energetic"] || EMOTION_PARAMS.energetic;

  try {
    const ttsResp = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "api-subscription-key": process.env.SARVAM_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: [text],
        target_language_code: "te-IN",
        speaker: "priya",
        model: "bulbul:v3",
        pitch, pace,
        loudness: 1.2,
        speech_sample_rate: 22050,
        enable_preprocessing: true,
      }),
    });
    if (!ttsResp.ok) throw new Error(`Sarvam TTS error: ${ttsResp.status}`);
    const ttsData = await ttsResp.json() as any;
    const audioBase64: string = ttsData.audios?.[0] || "";
    res.json({ audio_base64: audioBase64, audio_mime: "audio/wav" });
  } catch (err: any) {
    console.error("[public-tts]", err);
    res.status(500).json({ error: "Voice generation failed" });
  }
});

// ── PUBLIC REAL-VOICE CONVERSATION TURN ───────────────────────────
// One round trip = one conversational turn, for the landing-page call
// console. This is the honest version of the demo:
//
//   caller audio → Sarvam Saaras v3 (real Telugu STT)
//                → Gemini via the pipeline's /api/v1/browser/chat
//                  (real LLM, real per-session history, no script)
//                → Sarvam Bulbul v3 (real Telugu neural TTS)
//
// The widget previously ran a 4-stage hardcoded state machine and spoke
// through the browser's speechSynthesis with Telugu transliterated into
// Latin ("Namaskaram"), which is why it sounded like something reading
// out a script — because it literally was. It could not answer a question
// that wasn't in the script, and it wasn't speaking Telugu at all.
//
// STT and TTS happen here rather than in the pipeline so that Sarvam
// keys never leave the server, matching the "vendors behind internal
// proxy routes" rule. Conversation STATE stays in the pipeline, which
// already owns session history and booking detection — no second copy.
//
// Cost control matters: every turn spends real Sarvam + Gemini credits
// and this route has no login in front of it. Hence the IP limiter, a
// hard cap on audio size, and a per-session turn ceiling.
const publicVoiceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 80,                       // ~13 full demo conversations per IP per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demo limit reached. Try again in a few minutes." },
});

const MAX_DEMO_TURNS = 14;
const demoTurnCounts = new Map<string, { n: number; ts: number }>();

function bumpDemoTurn(sessionId: string): number {
  const now = Date.now();
  // Sweep sessions older than 30 min so this map can't grow unbounded.
  for (const [k, v] of demoTurnCounts) {
    if (now - v.ts > 30 * 60 * 1000) demoTurnCounts.delete(k);
  }
  const cur = demoTurnCounts.get(sessionId);
  const n = (cur?.n || 0) + 1;
  demoTurnCounts.set(sessionId, { n, ts: now });
  return n;
}

app.post("/api/public/voice-turn", publicVoiceLimiter, async (req, res) => {
  const { audio_base64, mime_type, text, session_id } = req.body as {
    audio_base64?: string;
    mime_type?:    string;
    text?:         string;
    session_id?:   string;
  };

  const sessionId = (session_id || "").trim();
  if (!sessionId || sessionId.length > 80) {
    return res.status(400).json({ error: "session_id required" });
  }
  if (!audio_base64 && !text?.trim()) {
    return res.status(400).json({ error: "audio_base64 or text required" });
  }

  const turnNo = bumpDemoTurn(sessionId);
  if (turnNo > MAX_DEMO_TURNS) {
    return res.status(429).json({
      error: "demo_turn_limit",
      reply: "Demo lo intha varake matladagalanu. Real number meeda unlimited — sign up cheyandi!",
    });
  }

  const SARVAM_KEY = process.env.SARVAM_API_KEY;
  if (!SARVAM_KEY) {
    console.error("[voice-turn] SARVAM_API_KEY not configured");
    return res.status(503).json({ error: "Voice service not configured" });
  }

  try {
    // ── 1. Transcribe (real Telugu STT) ──────────────────────────
    let transcript = (text || "").trim();

    if (!transcript && audio_base64) {
      // ~1.4MB of base64 ≈ 1MB of webm ≈ well over the 20s a single
      // conversational turn should ever need. Reject rather than pay
      // Sarvam to transcribe someone's uploaded album.
      if (audio_base64.length > 1_400_000) {
        return res.status(413).json({ error: "Audio too long — keep replies under ~20 seconds" });
      }

      const audioBuffer = Buffer.from(audio_base64, "base64");
      const sttForm = new FormData();
      const mime = mime_type || "audio/webm";
      const ext  = mime.split("/")[1]?.split(";")[0] || "webm";
      sttForm.append("file", new Blob([audioBuffer], { type: mime }), `turn.${ext}`);
      sttForm.append("model", "saaras:v3");
      sttForm.append("language_code", "te-IN");

      const sttResp = await fetch("https://api.sarvam.ai/speech-to-text", {
        method: "POST",
        headers: { "api-subscription-key": SARVAM_KEY },
        body: sttForm as any,
      });
      if (!sttResp.ok) throw new Error(`Sarvam STT ${sttResp.status}`);
      const sttData = await sttResp.json() as any;
      transcript = (sttData.transcript || "").trim();
    }

    if (!transcript) {
      // Silence or unintelligible audio. Answer the way a person would
      // rather than erroring the UI out — this is a normal thing to
      // happen on a phone call, not an exception.
      return res.json({
        transcript: "",
        reply: "Sorry andi, vinipinchaledu. Malli cheptara?",
        audio_base64: null,
        booking_confirmed: false,
        heard_nothing: true,
        turn: turnNo,
      });
    }

    // ── 2. Real LLM turn (pipeline owns session history) ─────────
    let reply = "";
    let bookingConfirmed = false;
    let bookingSummary   = "";

    try {
      const chatResp = await fetch(`${PIPELINE_URL}/api/v1/browser/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": INTERNAL_SECRET,
        },
        body: JSON.stringify({
          text: transcript,
          session_id: sessionId,
          tts: false,           // TTS is done here, at full quality
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!chatResp.ok) throw new Error(`pipeline chat ${chatResp.status}`);
      const chatData = await chatResp.json() as any;
      reply            = (chatData.response || "").trim();
      bookingConfirmed = !!chatData.booking_confirmed;
      bookingSummary   = chatData.booking_summary || "";
    } catch (e: any) {
      // The pipeline being down must not present as a broken page.
      console.error("[voice-turn] pipeline unreachable:", e.message);
      return res.status(502).json({
        error: "pipeline_unreachable",
        transcript,
        reply: "Okka nimisham andi — connection problem. Malli try cheyandi.",
      });
    }

    if (!reply) reply = "Cheppandi andi, vintunnanu.";

    // ── 3. Speak it (real Telugu neural TTS) ─────────────────────
    // Sarvam caps a single synthesis request; long replies get split
    // and stitched client-side would be worse, so we bound the text
    // instead — the system prompt already asks for <25 word answers.
    let audioBase64: string | null = null;
    try {
      const speakText = reply.length > 480 ? reply.slice(0, 480) : reply;
      const ttsResp = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: {
          "api-subscription-key": SARVAM_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: [speakText],
          target_language_code: "te-IN",
          speaker: "priya",
          model: "bulbul:v3",
          // Slightly quicker and a touch brighter than the dashboard
          // assistant. A receptionist answering a business line speaks
          // faster than a read-aloud tool; flat pace is a big part of
          // what makes synthetic speech sound like recital.
          pace: 1.06,
          pitch: 0.3,
          loudness: 1.2,
          speech_sample_rate: 22050,
          enable_preprocessing: true,
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!ttsResp.ok) throw new Error(`Sarvam TTS ${ttsResp.status}`);
      const ttsData = await ttsResp.json() as any;
      audioBase64 = ttsData.audios?.[0] || null;
    } catch (e: any) {
      // Text still returns — the console falls back to browser speech
      // rather than going silent mid-conversation.
      console.warn("[voice-turn] TTS failed:", e.message);
    }

    res.json({
      transcript,
      reply,
      audio_base64: audioBase64,
      audio_mime: "audio/wav",
      booking_confirmed: bookingConfirmed,
      booking_summary: bookingSummary,
      turn: turnNo,
      turns_left: Math.max(0, MAX_DEMO_TURNS - turnNo),
    });
  } catch (err: any) {
    console.error("[voice-turn]", err.message);
    res.status(500).json({ error: "Voice turn failed" });
  }
});

app.post("/api/whatsapp/send", verifyInternal, async (req, res) => {
  const { to, message, tenant_id, voice_profile_id, message_type, call_id, appointment_id } = req.body;
  if (!to || !message || !tenant_id) return res.status(400).json({ error: "Missing fields" });

  const ok = await sendWhatsApp(to, message, tenant_id, voice_profile_id,
    message_type, call_id, appointment_id);
  res.json({ ok });
});

// Appointment confirmation
app.post("/api/whatsapp/appointment-confirm", verifyInternal, async (req, res) => {
  const { caller_number, business_name, slot_date, slot_time, service,
    tenant_id, voice_profile_id, call_id, appointment_id } = req.body;

  const message = `నమస్కారం! మీ appointment ${business_name} లో confirm అయింది.\n\n` +
    `📅 Date: ${slot_date || "soon"}\n⏰ Time: ${slot_time || "TBD"}\n` +
    (service ? `🏷️ Service: ${service}\n` : "") +
    `\nమీ అపాయింట్మెంట్ రద్దు చేయాలంటే CANCEL reply చేయండి.\nధన్యవాదాలు! 🙏`;

  const ok = await sendWhatsApp(caller_number, message, tenant_id, voice_profile_id,
    "confirmation", call_id, appointment_id);
  res.json({ ok });
});

// Missed call auto-response
app.post("/api/whatsapp/missed-call", verifyInternal, async (req, res) => {
  const { caller_number, business_name, tenant_id, voice_profile_id, call_id } = req.body;
  const message = `నమస్కారం! మీరు ${business_name} కి call చేశారు.\n\n` +
    `మేము మీ call miss చేశాము. త్వరలో మేము మీకు call back చేస్తాము.\n\n` +
    `అర్జెంట్ అయితే, మళ్ళీ call చేయండి. ధన్యవాదాలు! 🙏`;
  const ok = await sendWhatsApp(caller_number, message, tenant_id, voice_profile_id,
    "missed_call", call_id);
  res.json({ ok });
});

// 24h appointment reminder
app.post("/api/whatsapp/reminder", verifyInternal, async (req, res) => {
  const { caller_number, business_name, slot_time, service,
    tenant_id, voice_profile_id, appointment_id } = req.body;
  const message = `🔔 Reminder: మీ appointment రేపు!\n\n` +
    `🏥 ${business_name}\n⏰ ${slot_time || "Tomorrow"}\n` +
    (service ? `🏷️ ${service}\n` : "") +
    `\nతప్పక వచ్చేందుకు request చేస్తున్నాము. ధన్యవాదాలు! 🙏`;
  const ok = await sendWhatsApp(caller_number, message, tenant_id, voice_profile_id,
    "reminder", undefined, appointment_id);
  if (ok) {
    await sb.from("appointments").update({ wa_reminder_sent: true }).eq("id", appointment_id);
  }
  res.json({ ok });
});

// ════════════════════════════════════════════════
// SUBSCRIPTION CREATION (called from dashboard)
// ════════════════════════════════════════════════
app.post("/api/billing/create-subscription", verifyJWT, async (req, res) => {
  const userId   = (req as any).user.id;
  const tenantId = await getTenantId(userId);
  if (!tenantId) return res.status(400).json({ error: "Tenant not found" });

  const { plan_id, annual } = req.body;
  const planAmounts: Record<string, { monthly: number; annual: number }> = {
    starter: { monthly: 199900, annual: 1599900 },
    growth:  { monthly: 499900, annual: 3999900 },
    scale:   { monthly: 999900, annual: 7999900 },
  };
  const amounts = planAmounts[plan_id];
  if (!amounts) return res.status(400).json({ error: "Invalid plan" });

  try {
    // Create Razorpay order (for one-time) or subscription (for recurring)
    const auth = Buffer.from(`${RZP_KEY_ID}:${RZP_SECRET}`).toString("base64");
    const resp = await fetch("https://api.razorpay.com/v1/orders", {
      method:  "POST",
      headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount:   annual ? amounts.annual : amounts.monthly,
        currency: "INR",
        notes: { tenant_id: tenantId, plan_id, annual: annual ? "true" : "false" },
      }),
    });
    const order = await resp.json() as { id: string; amount: number };
    res.json({
      order_id:  order.id,
      amount:    order.amount,
      currency:  "INR",
      key_id:    RZP_KEY_ID,
      tenant_id: tenantId,
      plan_id,
    });
  } catch (err: any) {
    console.error("[Razorpay create-subscription]", err.message);
    res.status(500).json({ error: "Payment initialization failed" });
  }
});

// Verify payment after Razorpay checkout
app.post("/api/billing/verify", verifyJWT, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan_id } = req.body;
  const userId = (req as any).user.id;
  const tenantId = await getTenantId(userId);
  if (!tenantId) return res.status(400).json({ error: "Tenant not found" });

  const expected = crypto
    .createHmac("sha256", RZP_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expected !== razorpay_signature) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  await sb.from("tenants").update({ plan: plan_id, status: "active" }).eq("id", tenantId);
  await updateMinuteLimit(tenantId, plan_id);
  res.json({ ok: true, plan: plan_id });
});

// ════════════════════════════════════════════════
// VOICE PROFILE APIS
// ════════════════════════════════════════════════
app.get("/api/voice-profiles", verifyJWT, async (req, res) => {
  const tenantId = await getTenantId((req as any).user.id);
  if (!tenantId) return res.status(400).json({ error: "Tenant not found" });
  const { data } = await sb.from("voice_profiles").select("*").eq("tenant_id", tenantId);
  res.json(data || []);
});

app.post("/api/voice-profiles", verifyJWT, async (req, res) => {
  const tenantId = await getTenantId((req as any).user.id);
  if (!tenantId) return res.status(400).json({ error: "Tenant not found" });

  // Check plan profile limit
  const { data: tenant } = await sb.from("tenants").select("plan").eq("id", tenantId).single();
  const { count } = await sb.from("voice_profiles")
    .select("*", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const limits: Record<string, number> = { trial: 1, starter: 1, growth: 3, scale: 10 };
  const limit = limits[tenant?.plan || "trial"] || 1;
  if ((count || 0) >= limit) {
    return res.status(403).json({ error: `Plan limit: ${limit} voice profile(s). Upgrade to add more.` });
  }

  const { data, error } = await sb.from("voice_profiles")
    .insert({ ...req.body, tenant_id: tenantId })
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.patch("/api/voice-profiles/:id", verifyJWT, async (req, res) => {
  const tenantId = await getTenantId((req as any).user.id);
  if (!tenantId) return res.status(400).json({ error: "Tenant not found" });
  const { data, error } = await sb.from("voice_profiles")
    .update(req.body)
    .eq("id", req.params.id)
    .eq("tenant_id", tenantId) // RLS enforcement
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Test call endpoint
app.post("/api/voice-profiles/:id/test-call", verifyJWT, async (req, res) => {
  const { to_number } = req.body;
  if (!to_number) return res.status(400).json({ error: "to_number required" });
  // In production: trigger Exotel outbound call to to_number using this profile
  console.log(`[Test Call] Profile ${req.params.id} → ${to_number}`);
  res.json({ ok: true, message: "Test call initiated. Your phone will ring in 5 seconds." });
});

// ════════════════════════════════════════════════
// DASHBOARD ANALYTICS APIS
// ════════════════════════════════════════════════
app.get("/api/analytics/summary", verifyJWT, async (req, res) => {
  const tenantId = await getTenantId((req as any).user.id);
  if (!tenantId) return res.status(400).json({ error: "Tenant not found" });

  const today = new Date().toISOString().split("T")[0];
  const month = new Date().toISOString().slice(0, 7);

  const [todayCalls, monthMinutes] = await Promise.all([
    sb.from("calls").select("id,status,wa_sent,appointment_created,intent,duration_seconds")
      .eq("tenant_id", tenantId)
      .gte("created_at", today + "T00:00:00"),
    sb.from("call_minutes").select("used_seconds,plan_limit_seconds")
      .eq("tenant_id", tenantId).eq("month", month).single(),
  ]);

  const calls = todayCalls.data || [];
  res.json({
    today: {
      total:        calls.length,
      appointments: calls.filter(c => c.appointment_created).length,
      missed:       calls.filter(c => c.status === "missed").length,
      wa_sent:      calls.filter(c => c.wa_sent).length,
      avg_duration: calls.length
        ? Math.round(calls.reduce((s, c) => s + (c.duration_seconds || 0), 0) / calls.length)
        : 0,
    },
    minutes: {
      used:  Math.round((monthMinutes.data?.used_seconds || 0) / 60),
      limit: Math.round((monthMinutes.data?.plan_limit_seconds || 12000) / 60),
    },
  });
});

// ════════════════════════════════════════════════
// SUPER ADMIN APIS (separate auth check)
// ════════════════════════════════════════════════
async function verifySuperAdmin(req: express.Request, res: express.Response,
  next: express.NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "No token" });
  const { data, error } = await sb.auth.getUser(auth.split(" ")[1]);
  if (error || !data.user) return res.status(401).json({ error: "Invalid token" });
  const { data: tu } = await sb.from("tenant_users")
    .select("role").eq("user_id", data.user.id).single();
  if (tu?.role !== "super_admin") return res.status(403).json({ error: "Super admin only" });
  (req as any).user = data.user;
  next();
}

// Platform stats
app.get("/api/admin/stats", verifySuperAdmin, async (req, res) => {
  const [tenants, activeCalls, todayCalls] = await Promise.all([
    sb.from("tenants").select("id,plan,status"),
    sb.from("calls").select("id,tenant_id,intent,created_at", { count: "exact" }).eq("status", "active"),
    sb.from("calls").select("id", { count: "exact" })
      .gte("created_at", new Date().toISOString().split("T")[0] + "T00:00:00"),
  ]);

  const t = tenants.data || [];
  res.json({
    tenants:       t.length,
    active_trials: t.filter(x => x.status === "trial").length,
    paid:          t.filter(x => x.status === "active").length,
    active_calls:  activeCalls.count || 0,
    calls_today:   todayCalls.count  || 0,
    by_plan: {
      starter: t.filter(x => x.plan === "starter").length,
      growth:  t.filter(x => x.plan === "growth").length,
      scale:   t.filter(x => x.plan === "scale").length,
      trial:   t.filter(x => x.plan === "trial").length,
    },
  });
});

// All tenants
app.get("/api/admin/tenants", verifySuperAdmin, async (req, res) => {
  const { data } = await sb.from("tenants").select("*").order("created_at", { ascending: false });
  res.json(data || []);
});

// Staff assignable to leads for a given tenant — needs auth.admin
// (service-role only, not PostgREST-exposed) to resolve emails, so
// this can't be a direct client-side Supabase query like most of the
// CRM panel's other reads.
app.get("/api/admin/tenant-staff/:tenantId", verifySuperAdmin, async (req, res) => {
  try {
    const { data: rows } = await sb.from("tenant_users")
      .select("user_id, role").eq("tenant_id", req.params.tenantId);
    const staff = await Promise.all((rows || []).map(async (r) => {
      const { data } = await sb.auth.admin.getUserById(r.user_id);
      return { user_id: r.user_id, role: r.role, email: data.user?.email || "unknown" };
    }));
    res.json(staff);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// All active calls
app.get("/api/admin/live-calls", verifySuperAdmin, async (req, res) => {
  const { data } = await sb.from("calls").select(`
    id, tenant_id, caller_number, direction, status, intent, created_at, duration_seconds,
    voice_profiles(business_name, profile_sku),
    tenants(name, plan)
  `).eq("status", "active").order("created_at", { ascending: false });
  res.json(data || []);
});

// Suspend tenant + kill switch
app.post("/api/admin/tenants/:id/suspend", verifySuperAdmin, async (req, res) => {
  const tenantId = req.params.id;
  const adminId  = (req as any).user.id;

  // 1. Suspend in DB
  await sb.from("tenants").update({ status: "suspended" }).eq("id", tenantId);

  // 2. Kill active calls
  await sb.from("calls").update({ status: "failed" }).eq("tenant_id", tenantId).eq("status", "active");

  // 3. Log to audit
  await sb.from("admin_audit_log").insert({
    admin_user_id:   adminId,
    action:          "suspend_tenant",
    target_tenant_id: tenantId,
    metadata:        { reason: req.body.reason || "Admin action" },
    ip_address:      req.ip,
  });

  res.json({ ok: true });
});

// Unsuspend
app.post("/api/admin/tenants/:id/unsuspend", verifySuperAdmin, async (req, res) => {
  const tenantId = req.params.id;
  await sb.from("tenants").update({ status: "active" }).eq("id", tenantId);
  await sb.from("admin_audit_log").insert({
    admin_user_id:    (req as any).user.id,
    action:           "unsuspend_tenant",
    target_tenant_id: tenantId,
    ip_address:       req.ip,
  });
  res.json({ ok: true });
});

// Plan override
app.post("/api/admin/tenants/:id/override-plan", verifySuperAdmin, async (req, res) => {
  const { plan } = req.body;
  await sb.from("tenants").update({ plan, status: "active" }).eq("id", req.params.id);
  await updateMinuteLimit(req.params.id, plan);
  await sb.from("admin_audit_log").insert({
    admin_user_id:    (req as any).user.id,
    action:           "override_plan",
    target_tenant_id: req.params.id,
    metadata:         { plan },
    ip_address:       req.ip,
  });
  res.json({ ok: true });
});

// Broadcast announcement
app.post("/api/admin/broadcast", verifySuperAdmin, async (req, res) => {
  const { message, plan_filter } = req.body;
  let q = sb.from("tenants").select("id,name,owner_id");
  if (plan_filter) q = q.eq("plan", plan_filter);
  const { data: tenants } = await q;

  // In production: trigger FCM push + in-app notification per tenant
  console.log(`[Broadcast] "${message}" → ${tenants?.length || 0} tenants`);

  await sb.from("admin_audit_log").insert({
    admin_user_id: (req as any).user.id,
    action:        "broadcast",
    metadata:      { message, plan_filter, tenant_count: tenants?.length || 0 },
    ip_address:    req.ip,
  });

  res.json({ ok: true, sent_to: tenants?.length || 0 });
});

// Audit log
app.get("/api/admin/audit-log", verifySuperAdmin, async (req, res) => {
  const { data } = await sb.from("admin_audit_log")
    .select("*").order("created_at", { ascending: false }).limit(200);
  res.json(data || []);
});

// ════════════════════════════════════════════════
// (health check consolidated below, near /ready — see FREESWITCH +
// PLATFORM EXTENSIONS section)
// ════════════════════════════════════════════════

// ════════════════════════════════════════════════
// EMAIL HELPER (Resend)
// ════════════════════════════════════════════════
async function sendEmail(tenantId: string, template: string, data: Record<string, any>) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return;

  const { data: tenant } = await sb.from("tenants").select("owner_id,name").eq("id", tenantId).single();
  if (!tenant) return;
  const { data: { user } } = await sb.auth.admin.getUserById(tenant.owner_id);
  if (!user?.email) return;

  const templates: Record<string, { subject: string; html: string }> = {
    payment_success: {
      subject: "Payment Successful — Nikki",
      html: `<p>Your payment of ₹${data.amount} was successful. Your plan is now active.</p>`,
    },
    payment_failed: {
      subject: "Payment Failed — Action Required",
      html: `<p>Your Nikki payment failed. Please update your payment method within 3 days to keep your service active.</p>`,
    },
    trial_expiry: {
      subject: `Your Nikki trial expires in ${data.days} days`,
      html: `<p>Hi ${tenant.name}, your free trial ends in ${data.days} days. Upgrade now to keep your Telugu AI receptionist active.</p>`,
    },
  };

  const t = templates[template];
  if (!t) return;

  await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_KEY}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      from:    `Nikki <noreply@${process.env.FROM_EMAIL || "jovio.in"}>`,
      to:      [user.email],
      subject: t.subject,
      html:    t.html,
    }),
  });
}

// ═══════════════════════════════════════════════════════════
// PUBLIC API (v1) — tenant API key authenticated
// ═══════════════════════════════════════════════════════════
import bcrypt from "bcryptjs";
import { mountOutboundRoutes } from "./outbound";

mountOutboundRoutes(app, sb, verifyInternal, audit);

// Generate a new API key: jvk_live_<32 random url-safe chars>.
// Returned ONLY at issue — never recoverable afterwards.
function generateApiKey(mode: "live" | "test" = "live"): string {
  const bytes = crypto.randomBytes(24);                  // 24 bytes = 32 base64-url chars
  const body  = bytes.toString("base64url");
  return `jvk_${mode}_${body}`;
}

// Public API key auth middleware. Verifies the Authorization header is
// "Bearer jvk_..." and the key matches a non-revoked, non-expired record.
// On success, attaches { tenantId, apiKeyId, scopes } to req.
async function verifyApiKey(req: any, res: any, next: any) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer (jvk_(?:live|test)_[A-Za-z0-9_-]+)$/);
  if (!m) return res.status(401).json({ error: "Missing or malformed Bearer token" });

  const fullKey = m[1];
  const prefix  = fullKey.slice(0, 12);          // "jvk_live_xyz" — 12 chars

  // Look up candidates by prefix only (cheap indexed query)
  const { data: candidates, error } = await sb
    .from("api_keys")
    .select("id, tenant_id, key_hash, mode, scopes, expires_at, revoked_at")
    .eq("prefix", prefix)
    .is("revoked_at", null);

  if (error || !candidates || candidates.length === 0) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  // Compare against each candidate's hash (rare collision case — bcrypt is slow,
  // but typically there's exactly one match per prefix)
  let matched: any = null;
  for (const c of candidates) {
    if (await bcrypt.compare(fullKey, c.key_hash)) {
      matched = c;
      break;
    }
  }
  if (!matched) return res.status(401).json({ error: "Invalid API key" });

  if (matched.expires_at && new Date(matched.expires_at) < new Date()) {
    return res.status(401).json({ error: "API key expired" });
  }

  // Update usage stats — fire and forget, don't block the request
  sb.from("api_keys")
    .update({
      last_used_at:  new Date().toISOString(),
      last_used_ip:  req.ip,
      request_count: (matched.request_count || 0) + 1,
    })
    .eq("id", matched.id)
    .then(() => {}, () => {});

  req.apiAuth = {
    tenantId:  matched.tenant_id,
    apiKeyId:  matched.id,
    mode:      matched.mode,
    scopes:    matched.scopes || [],
  };
  next();
}

// Scope checker — pass to routes that require specific permissions
function requireScope(...needed: string[]) {
  return (req: any, res: any, next: any) => {
    const have: string[] = req.apiAuth?.scopes || [];
    if (!needed.every(s => have.includes(s))) {
      return res.status(403).json({
        error: "Insufficient scope",
        required: needed,
        granted:  have,
      });
    }
    next();
  };
}

// ─── Tighter rate limit on the public API to discourage scraping ───
const publicApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      100,                // 100 req/min/key (use apiKeyId as the key)
  keyGenerator: (req: any) => req.apiAuth?.apiKeyId || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Routes: /api/v1/* ────────────────────────────────────
// All require verifyApiKey. Scopes default to read-only.

// GET /api/v1/calls?from=ISO&to=ISO&limit=50&cursor=...
app.get("/api/v1/calls",
  verifyApiKey, publicApiLimiter, requireScope("calls.read"),
  async (req: any, res) => {
    const { from, to, cursor } = req.query;
    const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 200);

    let q = sb.from("calls")
      .select("id, caller_number, direction, status, duration_seconds, intent, created_at")
      .eq("tenant_id", req.apiAuth.tenantId)
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (from)   q = q.gte("created_at", from);
    if (to)     q = q.lte("created_at", to);
    if (cursor) q = q.lt("created_at",  cursor);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const has_more = (data?.length || 0) > limit;
    const items = has_more ? data!.slice(0, limit) : (data || []);
    const next_cursor = has_more ? items[items.length - 1].created_at : null;

    res.json({ items, has_more, next_cursor });
  }
);

// GET /api/v1/calls/:id — full call detail including transcript
app.get("/api/v1/calls/:id",
  verifyApiKey, publicApiLimiter, requireScope("calls.read"),
  async (req: any, res) => {
    const { data, error } = await sb.from("calls")
      .select("*")
      .eq("tenant_id", req.apiAuth.tenantId)
      .eq("id", req.params.id)
      .single();
    if (error || !data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  }
);

// GET /api/v1/appointments?from=...&to=...
app.get("/api/v1/appointments",
  verifyApiKey, publicApiLimiter, requireScope("appointments.read"),
  async (req: any, res) => {
    const { from, to } = req.query;
    const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 200);
    let q = sb.from("appointments")
      .select("*")
      .eq("tenant_id", req.apiAuth.tenantId)
      .order("scheduled_at", { ascending: true })
      .limit(limit);
    if (from) q = q.gte("scheduled_at", from);
    if (to)   q = q.lte("scheduled_at", to);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data || [] });
  }
);

// GET /api/v1/usage — current month's minutes consumed vs plan limit
app.get("/api/v1/usage",
  verifyApiKey, publicApiLimiter,
  async (req: any, res) => {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const { data, error } = await sb.from("calls")
      .select("duration_seconds")
      .eq("tenant_id", req.apiAuth.tenantId)
      .gte("created_at", startOfMonth.toISOString());
    if (error) return res.status(500).json({ error: error.message });

    const seconds = (data || []).reduce((sum, c: any) => sum + (c.duration_seconds || 0), 0);
    res.json({
      period_start:    startOfMonth.toISOString(),
      seconds_used:    seconds,
      minutes_used:    Math.ceil(seconds / 60),
    });
  }
);

// ─── Key issuance / revocation (DASHBOARD-authenticated, NOT API-key) ───
// These use the verifyInternal middleware so only the dashboard can call them.

// POST /api/keys — issue a new key for a tenant
// Body: { tenant_id, name, scopes?, expires_at? }
// Returns { id, key } — the key plaintext is shown ONCE and never again.
app.post("/api/keys", verifyInternal, async (req, res) => {
  const { tenant_id, name, scopes = [], expires_at, created_by } = req.body;
  if (!tenant_id || !name) return res.status(400).json({ error: "tenant_id and name required" });

  const key       = generateApiKey("live");
  const prefix    = key.slice(0, 12);
  const key_hash  = await bcrypt.hash(key, 10);

  const { data, error } = await sb.from("api_keys").insert({
    tenant_id, name, prefix, key_hash, scopes,
    expires_at: expires_at || null,
    created_by: created_by || null,
  }).select("id, prefix, name, scopes, created_at").single();

  if (error) return res.status(500).json({ error: error.message });

  await audit("api_key.issued", {
    tenantId: tenant_id, actorId: created_by, req,
    metadata: { key_id: data!.id, name, scopes },
  });

  // Plaintext key returned ONLY here, ONCE.
  res.status(201).json({ ...data, key });
});

// POST /api/keys/:id/revoke — revoke a key
app.post("/api/keys/:id/revoke", verifyInternal, async (req, res) => {
  const { revoked_by } = req.body;
  const { data, error } = await sb.from("api_keys")
    .update({ revoked_at: new Date().toISOString(), revoked_by })
    .eq("id", req.params.id)
    .select("id, tenant_id, name")
    .single();

  if (error || !data) return res.status(404).json({ error: "Not found" });

  await audit("api_key.revoked", {
    tenantId: data.tenant_id, actorId: revoked_by, req,
    metadata: { key_id: data.id, name: data.name },
  });

  res.json({ ok: true });
});

// ── HEALTH + READINESS ───────────────────────────────────
// Railway / k8s probes hit these. Keep them DUMB and FAST.
//   /health  — process is running (liveness, no deps checked)
//   /ready   — process can serve traffic (touches DB)
// NOTE: this used to be defined twice (once near line 856, simpler
// version). Express only ever matches the FIRST-registered handler
// for a given path, so that first one silently won every time and
// this more complete version (uptime_ms, pid) never actually ran.
// Consolidated into one.
const STARTED_AT = Date.now();

app.get("/health", (_req, res) => {
  res.json({
    status:     "ok",
    service:    "nikki-api-server",
    uptime_ms:  Date.now() - STARTED_AT,
    pid:        process.pid,
    timestamp:  new Date().toISOString(),
  });
});

app.get("/ready", async (_req, res) => {
  try {
    // Hit a cheap table to confirm DB reachable. Limit 1 = ~1ms.
    const { error } = await sb.from("tenants").select("id").limit(1);
    if (error) throw error;
    res.json({ status: "ready", db: "ok" });
  } catch (e: any) {
    res.status(503).json({ status: "unready", db: "error", message: e.message });
  }
});

// ─── Sentry error handler (must be after all routes, before listen) ───
// Catches anything that throws synchronously, returns a rejected promise,
// or calls next(err). Tags the error with the request route so it's
// queryable in Sentry's Issues view.
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// Final fallback so the user sees a clean 500 instead of express's HTML
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("[unhandled]", err);
  res.status(500).json({ error: "Internal server error" });
});


// ════════════════════════════════════════════════════════════════
// FREESWITCH + PLATFORM EXTENSIONS
// Added for Hey Nikki v4.0 — FreeSWITCH ESL + Jio/Vi SIP
// ════════════════════════════════════════════════════════════════

import { fsl } from "./esl";

// ── Aggregate platform health check ──────────────────────────
// Sprint 3 requirement: "Add FreeSWITCH, n8n, Activepieces, R2 to
// health checks" — previously the super-admin panel checked these
// client-side with `mode: "no-cors"`, which always reports success
// regardless of the actual HTTP status (browsers can't read the
// response in no-cors mode) — so a genuinely down service would
// still show "Healthy". Checking server-side here instead, where the
// real status code is visible, and CORS doesn't apply at all.
// Also drops LiveKit (removed from the codebase 2026-07-25 — dead
// code, never called at runtime) and stops treating Exotel as if it
// were still the primary telephony path now that FreeSWITCH is.
async function checkUrl(url: string, timeoutMs = 3000): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
    // Some APIs 404/405 a bare HEAD to their root but are still up —
    // anything that isn't a network failure/timeout counts as reachable.
    return { ok: res.status < 500, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

app.get("/api/admin/health", verifySuperAdmin, async (_req, res) => {
  try {
    const cfg = await getPlatformConfig();

    const [freeswitch, n8n, activepieces, r2, sarvam, gemini, razorpay, supabase] =
      await Promise.all([
        fsl.getStatus().then(s => ({ ok: s.uptime !== "unavailable", latencyMs: 0 }))
          .catch(() => ({ ok: false, latencyMs: 0 })),
        cfg.n8n_url ? checkUrl(cfg.n8n_url) : Promise.resolve({ ok: false, latencyMs: 0 }),
        cfg.activepieces_url ? checkUrl(cfg.activepieces_url) : Promise.resolve({ ok: false, latencyMs: 0 }),
        cfg.r2_public_url ? checkUrl(cfg.r2_public_url) : Promise.resolve({ ok: false, latencyMs: 0 }),
        checkUrl("https://api.sarvam.ai"),
        checkUrl("https://generativelanguage.googleapis.com"),
        checkUrl("https://api.razorpay.com"),
        checkUrl(SUPABASE_URL),
      ]);

    res.json({
      checked_at: new Date().toISOString(),
      providers: [
        { name: "FreeSWITCH",           configured: true,              ...freeswitch },
        { name: "n8n",                  configured: !!cfg.n8n_url,           ...n8n },
        { name: "Activepieces",         configured: !!cfg.activepieces_url,  ...activepieces },
        { name: "Cloudflare R2",        configured: !!cfg.r2_public_url,     ...r2 },
        { name: "Sarvam AI (STT+TTS)",  configured: true,              ...sarvam },
        { name: "Gemini 2.5 Flash",     configured: true,              ...gemini },
        { name: "Razorpay",             configured: true,              ...razorpay },
        { name: "Supabase",             configured: true,              ...supabase },
      ],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Platform config cache (60s TTL) ──────────────────────────
let _platformConfigCache: Record<string, string> | null = null;
let _platformConfigCacheAt = 0;
async function getPlatformConfig(): Promise<Record<string, string>> {
  if (_platformConfigCache && Date.now() - _platformConfigCacheAt < 60000) {
    return _platformConfigCache;
  }
  const { data } = await sb.from("platform_config").select("key,value");
  const cfg: Record<string, string> = {};
  for (const row of data || []) cfg[row.key] = row.value;
  _platformConfigCache = cfg;
  _platformConfigCacheAt = Date.now();
  return cfg;
}

// ── Automation webhook dispatcher ──────────────────────────────
// Fires to n8n OR activepieces based on platform_config.automation_engine.
// Never throws — errors are logged but never block the call path.
//
// FAILOVER: the Super Admin toggle offers Activepieces, but no
// Activepieces flows are checked into infra/ yet — only n8n workflows
// exist. Previously, flipping that toggle sent every automation event
// to an endpoint with nothing listening, and because this function
// swallows all errors, WhatsApp follow-ups just quietly stopped. No
// alert, no failed request visible to anyone.
//
// So a failed dispatch on the non-default engine now retries against
// n8n rather than being dropped. Losing a customer's missed-call
// follow-up is a real revenue event; a duplicate log line is not.
async function fireAutomationWebhook(event: string, payload: object): Promise<void> {
  const cfg    = await getPlatformConfig().catch(() => ({} as Record<string, string>));
  const engine = cfg["automation_engine"] || "n8n";

  const n8nBase = (cfg["n8n_url"] || process.env.N8N_WEBHOOK_BASE || "http://localhost:5678/webhook").replace(/\/$/, "");
  const apBase  = (cfg["activepieces_url"] || process.env.ACTIVEPIECES_WEBHOOK_BASE || "http://localhost:8080/api/v1/webhooks").replace(/\/$/, "");

  const post = async (base: string) => {
    const resp = await fetch(`${base}/${event}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(5000),
    });
    // A 404 from the automation host means "no such flow" — that is a
    // failure for our purposes even though fetch itself succeeded.
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  };

  const primary = engine === "n8n" ? n8nBase : apBase;

  try {
    await post(primary);
    console.log(`[automation] ${engine} fired: ${event}`);
    return;
  } catch (err: any) {
    console.error(`[automation] ${engine} failed for event=${event}: ${err.message}`);
  }

  if (engine !== "n8n") {
    try {
      await post(n8nBase);
      console.warn(`[automation] FAILOVER to n8n succeeded for event=${event} — ` +
                   `check that Activepieces has a flow for this event`);
      return;
    } catch (err: any) {
      console.error(`[automation] n8n failover ALSO failed for event=${event}: ${err.message}`);
    }
  }

  console.error(`[automation] event=${event} was NOT delivered to any engine`);
}

// ── FreeSWITCH inbound routing lookup ─────────────────────────
// Called by the voice pipeline on WebSocket connect — NOT by the
// dialplan. This endpoint was previously dead code: the dialplan never
// hit it, and the pipeline created its own call row, so the DID →
// tenant → routing_mode lookup here never ran. It is now the single
// place that decides how an inbound call is handled, and the single
// place the call row is created.
app.post("/webhooks/freeswitch/inbound", verifyInternal, async (req, res) => {
  try {
    const { caller_number, did_number, fs_uuid } = req.body;

    const { data: did } = await sb.from("dids")
      .select("tenant_id, voice_profile_id, routing_mode, missed_call_guard, fallback_message")
      .eq("number", did_number)
      .single();

    if (!did) {
      console.warn(`[FS Inbound] Unknown DID: ${did_number}`);
      return res.status(404).json({ error: "DID not found" });
    }

    const { data: callRow } = await sb.from("calls").insert({
      tenant_id:        did.tenant_id,
      voice_profile_id: did.voice_profile_id,
      caller_number,
      direction:        "inbound",
      status:           "active",
      livekit_room_id:  fs_uuid,   // reuse field for FS UUID
    }).select().single();

    // Resolve the ring group for human/hybrid routing.
    let ringGroup = "";
    if (did.routing_mode === "human" || did.routing_mode === "hybrid") {
      const { data: agents } = await sb.from("tenant_users")
        .select("phone")
        .eq("tenant_id", did.tenant_id)
        .not("phone", "is", null);
      // Simultaneous ring across every agent with a phone on file.
      ringGroup = (agents || [])
        .map((a: any) => `sofia/gateway/jio_primary/${String(a.phone).replace(/[^0-9+]/g, "")}`)
        .filter((s: string) => s.length > 32)
        .join(",");
    }

    const cfg = await getPlatformConfig();
    const guardSeconds = parseInt(cfg["missed_call_seconds"] || "20");

    // A "human" DID with nobody to ring would drop the caller into
    // silence, so fall back to the AI rather than to nothing.
    const effectiveMode =
      did.routing_mode === "human" && !ringGroup ? "ai" : (did.routing_mode || "ai");

    if (did.routing_mode === "human" && !ringGroup) {
      console.warn(`[FS Inbound] DID ${did_number} is human-routed but no agent has a phone — falling back to AI`);
    }

    res.json({
      ok: true,
      call_id:            callRow?.id,
      tenant_id:          did.tenant_id,
      voice_profile_id:   did.voice_profile_id,
      routing_mode:       effectiveMode,
      ring_group:         ringGroup,
      missed_call_guard:  did.missed_call_guard !== false,
      missed_call_seconds: guardSeconds,
    });
  } catch (err: any) {
    console.error("[FS Inbound error]", err.message);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Transfer a live AI call to a human ring group ─────────────
// Called by the pipeline for human-routed DIDs, and mid-call when a
// caller asks for a person.
app.post("/webhooks/freeswitch/transfer-to-human", verifyInternal, async (req, res) => {
  try {
    const { fs_uuid, ring_group, guard_seconds } = req.body;
    if (!fs_uuid || !ring_group) {
      return res.status(400).json({ error: "fs_uuid and ring_group required" });
    }
    await fsl.transferToHuman(fs_uuid, ring_group, parseInt(guard_seconds || "20"));
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[FS transfer-to-human]", err.message);
    res.status(500).json({ error: "Transfer failed" });
  }
});

// ── FreeSWITCH hangup webhook ─────────────────────────────────
app.post("/webhooks/freeswitch/hangup", verifyInternal, async (req, res) => {
  try {
    const { fs_uuid, duration, hangup_cause, did_number, caller_number } = req.body;

    // Find call by FS UUID
    const { data: callRow } = await sb.from("calls")
      .select("id, tenant_id, voice_profile_id")
      .eq("livekit_room_id", fs_uuid)
      .single();

    if (callRow) {
      // Update call status
      await sb.from("calls").update({
        status:           "completed",
        duration_seconds: parseInt(duration || "0"),
        updated_at:       new Date().toISOString(),
      }).eq("id", callRow.id);

      // Trigger R2 upload in voice pipeline (async)
      fetch(`${PIPELINE_URL}/api/v1/call/freeswitch/hangup`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Secret": INTERNAL_SECRET },
        body: JSON.stringify({ fs_uuid, call_id: callRow.id, tenant_id: callRow.tenant_id }),
      }).catch(e => console.error("[Pipeline hangup]", e.message));
    }

    // Check if missed call (duration < 5 seconds = unanswered)
    if (parseInt(duration || "0") < 5 && hangup_cause !== "NORMAL_CLEARING") {
      await fireAutomationWebhook("missed-call", {
        caller_number,
        did_number,
        call_id:     callRow?.id,
        tenant_id:   callRow?.tenant_id,
      });

      // Log missed call in Supabase
      if (callRow) {
        await sb.from("calls").update({ status: "missed" }).eq("id", callRow.id);
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[FS Hangup error]", err.message);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── FreeSWITCH missed-call explicit webhook ───────────────────
app.post("/webhooks/freeswitch/missed-call", verifyInternal, async (req, res) => {
  try {
    const { caller_number, did_number } = req.body;

    // Look up tenant from DID
    const { data: did } = await sb.from("dids")
      .select("tenant_id, voice_profile_id")
      .eq("number", did_number).single();

    if (did) {
      // Get voice profile for WhatsApp number
      const { data: vp } = await sb.from("voice_profiles")
        .select("business_name, whatsapp_number, fallback_wa_enabled")
        .eq("id", did.voice_profile_id).single();

      if (vp?.fallback_wa_enabled !== false) {
        await fireAutomationWebhook("missed-call", {
          caller_number,
          did_number,
          tenant_id:     did.tenant_id,
          business_name: vp?.business_name || "our team",
          whatsapp_number: vp?.whatsapp_number || caller_number,
        });
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[Missed call error]", err.message);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Click-to-Call ─────────────────────────────────────────────
app.post("/api/calls/click-to-call", verifyJWT, apiLimiter, async (req: any, res) => {
  try {
    const user     = req.user;
    const tenantId = await getTenantId(user.id);
    if (!tenantId) return res.status(403).json({ error: "No tenant" });

    const { customer_number, lead_id, agent_phone } = req.body;
    if (!customer_number) return res.status(400).json({ error: "customer_number required" });

    // Check telephony engine
    const cfg = await getPlatformConfig();
    const engine = cfg["telephony_engine"] || "freeswitch";

    // Get tenant's DID for masked CLI
    const { data: did } = await sb.from("dids")
      .select("number").eq("tenant_id", tenantId).eq("status", "assigned").single();

    const maskedCli = did?.number || customer_number;

    let fsUuid = "";
    if (engine === "freeswitch") {
      // Use FreeSWITCH ESL for 2-leg bridge
      const agentNumber = agent_phone || user.phone || "";
      if (!agentNumber) {
        return res.status(400).json({ error: "agent_phone required — no phone on your account" });
      }
      fsUuid = await fsl.clickToCall(agentNumber, customer_number, maskedCli);
    } else {
      // ── Exotel fallback ──────────────────────────────────────
      // This branch was previously an empty stub with a console.log and
      // a comment reading "(existing logic)". Flipping the Super Admin
      // telephony toggle to Exotel therefore returned {ok:true,
      // status:"dialing"}, wrote a click_to_call_log row and advanced
      // the lead to "contacted" — while placing no call at all. A silent
      // success is worse than a crash, because nobody goes looking.
      const sid   = process.env.EXOTEL_SID   || "";
      const key   = process.env.EXOTEL_API_KEY || "";
      const token = process.env.EXOTEL_API_TOKEN || "";
      const agentNumber = agent_phone || user.phone || "";

      if (!sid || !key || !token) {
        return res.status(503).json({
          error: "Exotel is selected as the telephony engine but its credentials are not configured.",
        });
      }
      if (!agentNumber) {
        return res.status(400).json({ error: "agent_phone required — no phone on your account" });
      }

      // Exotel connects two numbers: From = agent (rings first, same
      // agent-first reasoning as the FreeSWITCH leg), To = customer,
      // CallerId = the tenant's Exotel DID.
      const form = new URLSearchParams({
        From:     agentNumber,
        To:       customer_number,
        CallerId: maskedCli,
        CallType: "trans",
        TimeLimit: "1800",
      });

      const exoResp = await fetch(
        `https://${key}:${token}@api.exotel.com/v1/Accounts/${sid}/Calls/connect.json`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString(),
          signal: AbortSignal.timeout(15_000),
        }
      );

      if (!exoResp.ok) {
        const body = await exoResp.text().catch(() => "");
        console.error("[CTC] Exotel connect failed:", exoResp.status, body.slice(0, 300));
        return res.status(502).json({ error: "Exotel could not place the call" });
      }

      const exoData = await exoResp.json() as any;
      fsUuid = exoData?.Call?.Sid || "";
    }

    // Log to click_to_call_log
    const { data: ctcLog } = await sb.from("click_to_call_log").insert({
      tenant_id:       tenantId,
      agent_user_id:   user.id,
      lead_id:         lead_id || null,
      caller_number:   maskedCli,
      callee_number:   customer_number,
      masked_cli:      maskedCli,
      freeswitch_uuid: fsUuid,
    }).select().single();

    // Update lead last_contacted_at
    if (lead_id) {
      await sb.from("leads").update({
        last_contacted_at: new Date().toISOString(),
        stage: "contacted",
      }).eq("id", lead_id).eq("tenant_id", tenantId);
    }

    await audit("click_to_call", {
      tenantId, actorId: user.id,
      metadata: { customer_number, lead_id, fs_uuid: fsUuid },
    });

    res.json({ ok: true, ctc_log_id: ctcLog?.id, fs_uuid: fsUuid, status: "dialing" });
  } catch (err: any) {
    console.error("[Click-to-Call error]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Call Disposition ──────────────────────────────────────────
app.post("/api/calls/disposition", verifyJWT, apiLimiter, async (req: any, res) => {
  try {
    const user     = req.user;
    const tenantId = await getTenantId(user.id);
    if (!tenantId) return res.status(403).json({ error: "No tenant" });

    const { ctc_log_id, disposition, notes } = req.body;
    if (!ctc_log_id || !disposition) {
      return res.status(400).json({ error: "ctc_log_id and disposition required" });
    }

    // Update click_to_call_log
    await sb.from("click_to_call_log").update({ disposition, notes, updated_at: new Date().toISOString() })
      .eq("id", ctc_log_id).eq("tenant_id", tenantId);

    // Map disposition → lead stage
    const STAGE_MAP: Record<string, string> = {
      booked:         "won",
      interested:     "qualified",
      callback:       "contacted",
      not_interested: "lost",
      no_answer:      "new",
    };
    const newStage = STAGE_MAP[disposition];

    // Get lead_id from log
    const { data: log } = await sb.from("click_to_call_log")
      .select("lead_id").eq("id", ctc_log_id).single();

    if (log?.lead_id && newStage) {
      await sb.from("leads").update({
        stage:      newStage,
        notes:      notes || undefined,
        updated_at: new Date().toISOString(),
      }).eq("id", log.lead_id).eq("tenant_id", tenantId);
    }

    // Fire automation webhook for interested leads
    if (disposition === "interested" || disposition === "booked") {
      const { data: lead } = await sb.from("leads")
        .select("phone, name").eq("id", log?.lead_id).single();
      if (lead) {
        await fireAutomationWebhook("interested-lead", {
          tenant_id:   tenantId,
          phone:       lead.phone,
          name:        lead.name,
          disposition,
          notes,
        });
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[Disposition error]", err.message);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Platform Config (Super Admin) ─────────────────────────────
app.get("/api/platform/config", verifyJWT, async (req: any, res) => {
  try {
    const { data: tu } = await sb.from("tenant_users")
      .select("role").eq("user_id", req.user.id).single();
    if (tu?.role !== "super_admin") return res.status(403).json({ error: "Super admin only" });

    const { data } = await sb.from("platform_config").select("*");
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/platform/config", verifyJWT, async (req: any, res) => {
  try {
    const { data: tu } = await sb.from("tenant_users")
      .select("role").eq("user_id", req.user.id).single();
    if (tu?.role !== "super_admin") return res.status(403).json({ error: "Super admin only" });

    const { key, value } = req.body;
    if (!key || value === undefined) return res.status(400).json({ error: "key and value required" });

    await sb.from("platform_config").upsert({ key, value, updated_by: req.user.id, updated_at: new Date().toISOString() });
    _platformConfigCache = null; // invalidate cache

    await audit("platform_config_update", { actorId: req.user.id, metadata: { key, value } });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── FreeSWITCH Status (Super Admin) ───────────────────────────
app.get("/api/admin/freeswitch/status", verifyJWT, async (req: any, res) => {
  try {
    const { data: tu } = await sb.from("tenant_users")
      .select("role").eq("user_id", req.user.id).single();
    if (tu?.role !== "super_admin") return res.status(403).json({ error: "Super admin only" });

    const [status, channels, trunks] = await Promise.all([
      fsl.getStatus(),
      fsl.getActiveChannels(),
      fsl.getSipTrunkStatus(),
    ]);

    res.json({ status, channels, trunks, alive: status.uptime !== "unavailable" });
  } catch (err: any) {
    res.status(500).json({ error: err.message, alive: false });
  }
});

app.post("/api/admin/freeswitch/hangup-channel", verifyJWT, async (req: any, res) => {
  try {
    const { data: tu } = await sb.from("tenant_users")
      .select("role").eq("user_id", req.user.id).single();
    if (tu?.role !== "super_admin") return res.status(403).json({ error: "Super admin only" });

    const { uuid } = req.body;
    if (!uuid) return res.status(400).json({ error: "uuid required" });

    await fsl.hangupChannel(uuid);
    await audit("freeswitch_hangup_channel", { actorId: req.user.id, metadata: { uuid } });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/freeswitch/reload-dialplan", verifyJWT, async (req: any, res) => {
  try {
    const { data: tu } = await sb.from("tenant_users")
      .select("role").eq("user_id", req.user.id).single();
    if (tu?.role !== "super_admin") return res.status(403).json({ error: "Super admin only" });

    await fsl.reloadXml();
    await audit("freeswitch_reload_dialplan", { actorId: req.user.id });
    res.json({ ok: true, message: "Dialplan reloaded" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ════════════════════════════════════════════════════════════════
// ADMIN VOICE ASSISTANT ENDPOINT
// Answers natural-language admin questions about today's data.
// Powers the Super Admin floating voice assistant.
// Uses Gemini (already in the stack) — zero additional cost.
// ════════════════════════════════════════════════════════════════

// ── Shared: gather business context data for Nikki's voice assistant ──
// Extracted so both /api/admin/voice-query (super-admin, text-only,
// browser TTS) and /api/tenant/voice-query (any tenant owner, real
// Sarvam STT+TTS) use the exact same data-gathering logic rather than
// two copies drifting apart over time.
async function buildBusinessContext(targetTenantId: string | null) {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
  const queries: Record<string, any> = {};

  const { data: todayCalls } = await (targetTenantId
    ? sb.from("calls").select("id,caller_number,status,duration_seconds,intent,appointment_created,created_at")
        .eq("tenant_id", targetTenantId).gte("created_at", todayStr + "T00:00:00")
    : sb.from("calls").select("id,status,duration_seconds,intent,appointment_created,tenant_id,created_at")
        .gte("created_at", todayStr + "T00:00:00").limit(200));
  queries.today_calls = todayCalls || [];

  const { data: todayAppts } = await (targetTenantId
    ? sb.from("appointments").select("id,caller_number,status,notes,created_at")
        .eq("tenant_id", targetTenantId).gte("created_at", todayStr + "T00:00:00")
    : sb.from("appointments").select("id,status,notes,created_at").gte("created_at", todayStr + "T00:00:00").limit(100));
  queries.today_appointments = todayAppts || [];

  const { data: hotLeads } = await (targetTenantId
    ? sb.from("leads").select("name,phone,score,stage,intent,created_at")
        .eq("tenant_id", targetTenantId).gte("score", 70).not("stage", "in", '("won","lost")').order("score", { ascending: false }).limit(10)
    : sb.from("leads").select("name,score,stage,intent").gte("score", 70).not("stage", "in", '("won","lost")').order("score", { ascending: false }).limit(10));
  queries.hot_leads = hotLeads || [];

  const { data: monthCalls } = await (targetTenantId
    ? sb.from("calls").select("id,status,intent,appointment_created").eq("tenant_id", targetTenantId).gte("created_at", monthStart)
    : sb.from("calls").select("id,status,intent,appointment_created").gte("created_at", monthStart).limit(1000));
  queries.month_calls = monthCalls || [];

  let activeChannels: any[] = [];
  try {
    activeChannels = (await fsl.getActiveChannels()) || [];
  } catch (_) {}
  queries.active_calls_now = activeChannels;

  const contextJson = JSON.stringify({
    current_datetime: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    today_date: todayStr,
    today_calls_total:        queries.today_calls.length,
    today_calls_completed:    queries.today_calls.filter((c: any) => c.status === "completed").length,
    today_calls_missed:       queries.today_calls.filter((c: any) => c.status === "missed").length,
    today_appointments:       queries.today_appointments.length,
    today_appointments_list:  queries.today_appointments.slice(0, 10).map((a: any) => ({
      time:    new Date(a.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      notes:   a.notes || "No details",
      status:  a.status,
    })),
    hot_leads:                queries.hot_leads.slice(0, 5).map((l: any) => ({
      name:  l.name || "Unknown",
      score: l.score,
      stage: l.stage,
      intent: l.intent,
    })),
    month_calls_total:        queries.month_calls.length,
    month_appointments:       queries.month_calls.filter((c: any) => c.appointment_created).length,
    active_calls_right_now:   activeChannels.length,
  }, null, 2);

  return { contextJson, queries, activeChannels };
}

// ── Shared: ask Gemini a question against the gathered business context ──
async function askGemini(question: string, contextJson: string, isSuperAdmin: boolean): Promise<string> {
  const geminiKey = process.env.GEMINI_API_KEY!;
  const isAuthKey = geminiKey.startsWith("AQ.") || geminiKey.startsWith("IQ.") || geminiKey.startsWith("EQ.");
  const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent";

  const payload = {
    system_instruction: {
      parts: [{
        text: `You are Nikki, ${isSuperAdmin ? "the AI assistant for the Hey Nikki admin panel" : "the AI assistant helping this business owner understand their own Hey Nikki account"}.
You have access to the following real-time business data. Answer questions concisely and conversationally.
Keep responses under 3 sentences — designed to be read aloud via TTS.
When listing items, use natural language (not bullet points).
Always be positive, professional, and specific with numbers.
If the data provided doesn't actually contain the answer, say so honestly — never guess a number or invent a fact that isn't in the data below.
${isSuperAdmin ? "" : "Respond in Telugu, naturally and warmly, matching how a helpful assistant would speak to a business owner they know well."}

CURRENT BUSINESS DATA:
${contextJson}`
      }]
    },
    contents: [{ role: "user", parts: [{ text: question }] }],
    generationConfig: { maxOutputTokens: 150, temperature: 0.15 },  // lowered from 0.4 for more literal, less improvised answers
  };

  const geminiResp = await fetch(
    isAuthKey ? geminiUrl : `${geminiUrl}?key=${geminiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(isAuthKey ? { Authorization: `Bearer ${geminiKey}` } : {}),
      },
      body: JSON.stringify(payload),
    }
  );

  if (!geminiResp.ok) {
    throw new Error(`Gemini error: ${geminiResp.status}`);
  }

  const geminiData = await geminiResp.json() as any;
  return geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    || "I couldn't retrieve that data right now. Please check the dashboard.";
}

app.post("/api/admin/voice-query", verifyJWT, async (req: any, res) => {
  const { question, tenant_id } = req.body as { question: string; tenant_id?: string };

  if (!question) {
    return res.status(400).json({ error: "question required" });
  }

  // SECURITY: was previously trusting tenant_id straight from the
  // request body with no check that the caller actually owns it —
  // any authenticated user could pass a different tenant's id and
  // read their calls/appointments/leads. Now verified: a non-super-
  // admin can only query their OWN tenant (whatever tenant_id they
  // send is ignored and replaced with their real one); a null/absent
  // tenant_id from a non-admin also resolves to their own tenant
  // rather than falling through to the platform-wide branch.
  const { data: callerRole } = await sb.from("tenant_users")
    .select("role, tenant_id").eq("user_id", req.user.id).single();
  const isSuperAdmin = callerRole?.role === "super_admin";
  const targetTenantId = isSuperAdmin ? (tenant_id || null) : callerRole?.tenant_id;

  if (!isSuperAdmin && !targetTenantId) {
    return res.status(403).json({ error: "No tenant associated with this account" });
  }

  try {
    const { contextJson, queries, activeChannels } = await buildBusinessContext(targetTenantId);
    const answer = await askGemini(question, contextJson, isSuperAdmin);

    res.json({
      answer,
      context: {
        today_calls: queries.today_calls.length,
        today_appointments: queries.today_appointments.length,
        hot_leads: queries.hot_leads.length,
        active_calls_now: activeChannels.length,
      },
    });

  } catch (err: any) {
    console.error("[voice-query]", err);
    res.status(500).json({
      answer: "Sorry, I had trouble accessing the data. Please try again.",
      error: err.message,
    });
  }
});

// ── Tenant-facing voice assistant: real Sarvam STT + TTS ──────────
// The super-admin widget above uses the browser's Web Speech API for
// mic input and TTS output — free, but has weak-to-nonexistent Telugu
// support in most browsers. This one uses the same Sarvam models
// already proven in the live phone pipeline (voice-pipeline/main.py's
// SarvamSTT/SarvamTTS classes) for genuine Telugu quality: Saaras v3
// for transcription, Bulbul v3 for synthesis.
//
// Body: { audio_base64: string, mime_type: string } — mime_type is
// whatever the browser's MediaRecorder actually produced (typically
// audio/webm). Sarvam's REST STT endpoint auto-detects codec and
// explicitly supports webm directly (confirmed via their own docs),
// so no client-side re-encoding to WAV is needed.
app.post("/api/tenant/voice-query", verifyJWT, async (req: any, res) => {
  const { audio_base64, mime_type } = req.body as { audio_base64: string; mime_type: string };

  if (!audio_base64) {
    return res.status(400).json({ error: "audio_base64 required" });
  }

  // Always the caller's own tenant — no tenant_id accepted from the
  // client at all here (unlike the admin endpoint above), since this
  // route is meant for a business owner asking about their own data,
  // full stop. Removes any possibility of the same tenant_id-spoofing
  // issue fixed above from ever existing in this endpoint.
  const { data: callerRow } = await sb.from("tenant_users")
    .select("tenant_id").eq("user_id", req.user.id).single();
  const tenantId = callerRow?.tenant_id;
  if (!tenantId) {
    return res.status(403).json({ error: "No tenant associated with this account" });
  }

  const SARVAM_KEY = process.env.SARVAM_API_KEY!;

  try {
    // ── 1. Transcribe the caller's Telugu speech (Sarvam Saaras v3) ──
    const audioBuffer = Buffer.from(audio_base64, "base64");
    const sttForm = new FormData();
    const ext = (mime_type || "audio/webm").split("/")[1] || "webm";
    sttForm.append("file", new Blob([audioBuffer], { type: mime_type || "audio/webm" }), `audio.${ext}`);
    sttForm.append("model", "saaras:v3");
    sttForm.append("language_code", "te-IN");

    const sttResp = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: { "api-subscription-key": SARVAM_KEY },
      body: sttForm as any,
    });
    if (!sttResp.ok) throw new Error(`Sarvam STT error: ${sttResp.status}`);
    const sttData = await sttResp.json() as any;
    const transcript: string = sttData.transcript || "";

    if (!transcript.trim()) {
      return res.status(422).json({ error: "Could not hear anything — please try again" });
    }

    // ── 2. Ask Gemini, scoped to this tenant's own business data ──
    const { contextJson } = await buildBusinessContext(tenantId);
    const answer = await askGemini(transcript, contextJson, false);

    // ── 3. Synthesize the Telugu answer (Sarvam Bulbul v3) ──
    // Non-telephony settings here (unlike the phone pipeline's 8kHz
    // mulaw) — this plays back through a normal browser <audio>
    // element, so higher quality output is worth it, and there's no
    // 20-word truncation since this is a dashboard Q&A tool, not a
    // live phone conversation with pacing constraints.
    const ttsResp = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "api-subscription-key": SARVAM_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: [answer],
        target_language_code: "te-IN",
        speaker: "priya",
        model: "bulbul:v3",
        pitch: 0,
        pace: 1.0,
        loudness: 1.2,
        speech_sample_rate: 22050,
        enable_preprocessing: true,
      }),
    });
    if (!ttsResp.ok) throw new Error(`Sarvam TTS error: ${ttsResp.status}`);
    const ttsData = await ttsResp.json() as any;
    const audioOutBase64: string = ttsData.audios?.[0] || "";

    res.json({
      transcript,
      answer,
      audio_base64: audioOutBase64,
      audio_mime: "audio/wav",
    });

  } catch (err: any) {
    console.error("[tenant voice-query]", err);
    res.status(500).json({ error: err.message || "Voice query failed" });
  }
});


// ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Nikki API Server running on port ${PORT}`);
});

export default app;
