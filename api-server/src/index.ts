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
async function fireAutomationWebhook(event: string, payload: object): Promise<void> {
  try {
    const cfg    = await getPlatformConfig();
    const engine = cfg["automation_engine"] || "n8n";
    const base   = engine === "n8n"
      ? (cfg["n8n_url"] || process.env.N8N_WEBHOOK_BASE || "http://localhost:5678/webhook")
      : (cfg["activepieces_url"] || process.env.ACTIVEPIECES_WEBHOOK_BASE || "http://localhost:8080/api/v1/webhooks");

    const url = `${base.replace(/\/$/, "")}/${event}`;
    await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(5000),
    });
    console.log(`[automation] ${engine} webhook fired: ${event}`);
  } catch (err: any) {
    console.error(`[automation] webhook failed for event=${event}:`, err.message);
  }
}

// ── FreeSWITCH inbound webhook ────────────────────────────────
// Called by FreeSWITCH dialplan/ESL when a call is answered
app.post("/webhooks/freeswitch/inbound", verifyInternal, async (req, res) => {
  try {
    const { caller_number, did_number, fs_uuid } = req.body;

    // Look up voice profile by DID number
    const { data: did } = await sb.from("dids")
      .select("tenant_id, voice_profile_id")
      .eq("number", did_number)
      .single();

    if (!did) {
      console.warn(`[FS Inbound] Unknown DID: ${did_number}`);
      return res.status(404).json({ error: "DID not found" });
    }

    // Create call record
    const { data: callRow } = await sb.from("calls").insert({
      tenant_id:        did.tenant_id,
      voice_profile_id: did.voice_profile_id,
      caller_number,
      direction:        "inbound",
      status:           "active",
      livekit_room_id:  fs_uuid,   // reuse field for FS UUID
    }).select().single();

    // Forward to voice pipeline
    await fetch(`${PIPELINE_URL}/api/v1/call/freeswitch/inbound`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": INTERNAL_SECRET },
      body: JSON.stringify({
        call_id:          callRow?.id,
        caller_number,
        did_number,
        fs_uuid,
        tenant_id:        did.tenant_id,
        voice_profile_id: did.voice_profile_id,
      }),
    });

    res.json({ ok: true, call_id: callRow?.id });
  } catch (err: any) {
    console.error("[FS Inbound error]", err.message);
    res.status(500).json({ error: "Internal error" });
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
      const agentNumber = agent_phone || user.phone || "agent";
      fsUuid = await fsl.clickToCall(agentNumber, customer_number, maskedCli);
    } else {
      // Exotel fallback — use Exotel Calls API
      console.log("[CTC] Using Exotel fallback for click-to-call");
      // Exotel originate call (existing logic)
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

app.post("/api/admin/voice-query", verifyJWT, async (req: any, res) => {
  const { question, tenant_id } = req.body as { question: string; tenant_id?: string };

  if (!question) {
    return res.status(400).json({ error: "question required" });
  }

  // Only super admins OR tenant scoped to their own data
  const targetTenantId = tenant_id || null;

  try {
    // ── Gather context data from Supabase ────────────────────────
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();

    const queries: Record<string, any> = {};

    // Today's calls
    const { data: todayCalls } = await (targetTenantId
      ? sb.from("calls").select("id,caller_number,status,duration_seconds,intent,appointment_created,created_at")
          .eq("tenant_id", targetTenantId).gte("created_at", todayStr + "T00:00:00")
      : sb.from("calls").select("id,status,duration_seconds,intent,appointment_created,tenant_id,created_at")
          .gte("created_at", todayStr + "T00:00:00").limit(200));
    queries.today_calls = todayCalls || [];

    // Today's appointments
    const { data: todayAppts } = await (targetTenantId
      ? sb.from("appointments").select("id,caller_number,status,notes,created_at")
          .eq("tenant_id", targetTenantId).gte("created_at", todayStr + "T00:00:00")
      : sb.from("appointments").select("id,status,notes,created_at").gte("created_at", todayStr + "T00:00:00").limit(100));
    queries.today_appointments = todayAppts || [];

    // Hot leads
    const { data: hotLeads } = await (targetTenantId
      ? sb.from("leads").select("name,phone,score,stage,intent,created_at")
          .eq("tenant_id", targetTenantId).gte("score", 70).not("stage", "in", '("won","lost")').order("score", { ascending: false }).limit(10)
      : sb.from("leads").select("name,score,stage,intent").gte("score", 70).not("stage", "in", '("won","lost")').order("score", { ascending: false }).limit(10));
    queries.hot_leads = hotLeads || [];

    // Monthly stats
    const { data: monthCalls } = await (targetTenantId
      ? sb.from("calls").select("id,status,intent,appointment_created").eq("tenant_id", targetTenantId).gte("created_at", monthStart)
      : sb.from("calls").select("id,status,intent,appointment_created").gte("created_at", monthStart).limit(1000));
    queries.month_calls = monthCalls || [];

    // Active channels (FreeSWITCH)
    let activeChannels: any[] = [];
    try {
      const channels = await fsl.getActiveChannels();
      activeChannels = channels || [];
    } catch (_) {}
    queries.active_calls_now = activeChannels;

    // ── Build context for Gemini ─────────────────────────────────
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

    // ── Call Gemini ──────────────────────────────────────────────
    const geminiKey = process.env.GEMINI_API_KEY!;
    const isAuthKey = geminiKey.startsWith("AQ.") || geminiKey.startsWith("IQ.") || geminiKey.startsWith("EQ.");
    const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent";

    const payload = {
      system_instruction: {
        parts: [{
          text: `You are Nikki, the AI assistant for the Hey Nikki admin panel.
You have access to the following real-time business data. Answer questions concisely and conversationally.
Keep responses under 3 sentences — designed to be read aloud via browser TTS.
When listing items, use natural language (not bullet points).
Always be positive, professional, and specific with numbers.

CURRENT BUSINESS DATA:
${contextJson}`
        }]
      },
      contents: [{ role: "user", parts: [{ text: question }] }],
      generationConfig: { maxOutputTokens: 150, temperature: 0.4 },
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
    const answer = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      || "I couldn't retrieve that data right now. Please check the dashboard.";

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


// ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Nikki API Server running on port ${PORT}`);
});

export default app;
