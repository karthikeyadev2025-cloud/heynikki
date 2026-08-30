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
const META_WA_VERIFY_TOKEN = process.env.META_WA_VERIFY_TOKEN || "";
const META_WA_APP_SECRET   = process.env.META_WA_APP_SECRET || "";
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

// Raw body for webhook HMAC verification.
//
// ONLY /webhooks/razorpay may take the raw body. It verifies an HMAC over
// the exact bytes received and then JSON.parses them itself, so it needs
// the Buffer intact.
//
// This used to match the whole /webhooks/ prefix, which silently broke
// every other webhook route: express.raw() leaves req.body as a Buffer,
// and destructuring a Buffer yields undefined for every field. The
// FreeSWITCH hangup handler therefore looked up livekit_room_id=undefined
// (matching no row, so no call was ever marked completed and every
// duration stayed 0) and then evaluated parseInt(undefined || "0") < 5
// && undefined !== "NORMAL_CLEARING" as true, firing the missed-call
// automation for EVERY call regardless of how long it lasted. The
// exotel, lead-capture and remaining freeswitch routes were equally
// affected. Keep this exact-path, not a prefix.
app.use((req, res, next) => {
  if (req.path.replace(/\/+$/, "") === "/webhooks/razorpay" ||
      req.path.replace(/\/+$/, "") === "/webhooks/whatsapp") {
    // Same reason as Razorpay: Meta signs the exact bytes it sent with
    // X-Hub-Signature-256, so re-serialising through express.json() would
    // change the payload and every signature check would fail. Listed as an
    // exact path, never a prefix — see the note above.
    express.raw({ type: "application/json" })(req, res, next);
  } else if (req.path.startsWith("/webhooks/exotel/")) {
    // Exotel posts application/x-www-form-urlencoded (CallSid, Status,
    // Duration, From/To...). express.json() ignores a non-JSON content type
    // and leaves req.body = {}, so every field read below silently became
    // "" — indistinguishable from a real empty value. Needs urlencoded.
    express.urlencoded({ extended: false })(req, res, next);
  } else {
    // 2mb, not the 100kb default. /api/public/voice-turn carries a whole
    // spoken turn as base64 audio and rejects anything over ~1.4M chars with
    // a friendly "keep replies under ~20 seconds". That guard was
    // unreachable: express refused the body at 100kb first, so a longer turn
    // died as PayloadTooLargeError → 500 "Internal server error" instead.
    // /api/assets carries an uploaded brochure or photo as base64, and
    // base64 inflates by about a third — so the 8MB the endpoint advertises
    // arrives here as ~11MB and express would refuse it before the endpoint's
    // own, much friendlier, size check ever ran. Raised for that route only;
    // everything else keeps the 2mb ceiling.
    const limit = req.path === "/api/assets" ? "12mb" : "2mb";
    express.json({ limit })(req, res, next);
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

  try {
    const body = req.body as Record<string, string>;
    const callSid = body.CallSid || "";
    const status  = body.Status  || "";
    const duration = parseInt(body.Duration || "0");
    console.log(`[Exotel] Status: ${callSid} → ${status}, ${duration}s`);

    if (status === "completed" && callSid) {
      // Match the specific call by its Exotel SID. This previously filtered
      // on .eq("status","active").limit(1) with no reference to callSid at
      // all, so an Exotel status callback would close whichever active call
      // the query happened to return — potentially another tenant's live
      // call, stamped with a foreign duration. It was inert only because
      // req.body was a Buffer and callSid was always "", which the guard
      // above rejected; parsing the body correctly re-arms it.
      const { error: exoErr } = await sb.from("calls")
        .update({ status: "completed", duration_seconds: duration })
        .eq("exotel_call_sid", callSid);
      if (exoErr) console.error("[Exotel status] update failed:", exoErr.message);
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[Exotel status error]", err.message);
    res.json({ ok: true });
  }
});

// NOTE: /webhooks/lead-capture used to be defined INSIDE the body of the
// exotel status handler above — it was nested after that handler's opening
// brace, so it was only ever registered as a side effect of an Exotel status
// callback arriving, and only after checkExotelToken passed. EXOTEL_WEBHOOK_TOKEN
// is unset here, so the token check failed closed and the route was never
// registered at all: every lead POST got Express's HTML 404 and was dropped
// silently. Re-registering it per request would also have grown the router
// stack unboundedly. It must stay at module scope.

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
      sendWhatsApp(phone, ackMsg, match.tenant_id, match.id, "lead_capture_ack",
        undefined, undefined, match.business_name)
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
        // The invoices table has existed since the first schema and NOTHING
        // has ever written to it, so /billing renders an empty list for a
        // tenant who has genuinely paid. Razorpay's payment id is the natural
        // idempotency key: this webhook is retried, and onConflict stops a
        // retry from billing the customer twice on screen.
        // Guarded insert rather than upsert-onConflict: the unique index this
        // relies on ships in migration 018, and until that is applied
        // PostgREST rejects ON CONFLICT outright ("no unique or exclusion
        // constraint matching"), which would leave invoices silently empty
        // again. This works before and after the migration; the index remains
        // worth applying as the real guarantee against a concurrent retry.
        const { data: seen } = await sb.from("invoices")
          .select("id").eq("razorpay_payment_id", pmt.id).maybeSingle();
        if (!seen) {
          const { error: invErr } = await sb.from("invoices").insert({
            tenant_id:           tenantId,
            razorpay_payment_id: pmt.id,
            razorpay_order_id:   pmt.order_id ?? null,
            amount_paise:        pmt.amount,
            plan_id:             notes.plan_id ?? null,
            description:         notes.type === "addon_minutes"
              ? `Add-on: ${notes.minutes} minutes`
              : "Subscription payment",
            status:              "paid",
          });
          if (invErr) console.error("[Razorpay] invoice insert failed:", invErr.message);
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
// TWO PROVIDERS, ONE INTERFACE.
//
// Wati is a reseller that wraps Meta's WhatsApp Business API and
// charges a monthly fee per account on top of Meta's per-conversation
// pricing. That model suits ONE business managing its own number; it
// does not suit a platform onboarding a WhatsApp sender for every
// tenant, where the per-account fee multiplies.
//
// Meta Cloud API direct removes the middleman and, more importantly,
// supports Embedded Signup — which is how tenants connect their own
// number programmatically instead of somebody doing it by hand in a
// dashboard.
//
// Both are kept because switching a live messaging path in one step is
// how you lose customer follow-ups. Set WHATSAPP_PROVIDER=meta to move,
// and set it back if something misbehaves.
//
// NOTE ON SESSION MESSAGES: both paths below send free-form text, which
// WhatsApp only permits inside the 24-hour customer service window
// (i.e. after the customer messaged you). Outside that window Meta
// requires a pre-approved TEMPLATE and will reject plain text. The
// missed-call follow-up is exactly that case — it goes out through the
// n8n workflows, which use the template endpoint.
type WhatsAppResult = { ok: boolean; error?: string; id?: string };

async function sendViaWati(to: string, message: string): Promise<WhatsAppResult> {
  if (!WATI_KEY || !WATI_URL) return { ok: false, error: "Wati not configured" };
  const resp = await fetch(`${WATI_URL}/api/v1/sendSessionMessage/${to.replace("+", "")}`, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${WATI_KEY}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ messageText: message }),
    signal:  AbortSignal.timeout(10_000),
  });
  if (resp.status === 200 || resp.status === 201) return { ok: true };
  return { ok: false, error: `Wati HTTP ${resp.status}` };
}

async function sendViaMeta(to: string, message: string, senderId?: string): Promise<WhatsAppResult> {
  const token   = process.env.META_WA_TOKEN || "";
  const phoneId = senderId || process.env.META_WA_PHONE_NUMBER_ID || "";
  const version = process.env.META_WA_API_VERSION || "v21.0";
  if (!token || !phoneId) return { ok: false, error: "Meta Cloud API not configured" };

  // Meta wants the number in E.164 WITHOUT a leading +.
  const msisdn = to.replace(/[^\d]/g, "");

  const resp = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type:    "individual",
      to:                msisdn,
      type:              "text",
      text:              { preview_url: false, body: message },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (resp.ok) {
    const okBody = await resp.json().catch(() => ({} as any));
    return { ok: true, id: okBody?.messages?.[0]?.id };
  }

  // Meta's errors are actually useful — surface them rather than a bare
  // status code, because "template required" and "invalid token" need
  // very different fixes and both present as a 400.
  const body = await resp.json().catch(() => ({} as any));
  const detail = body?.error?.message || `HTTP ${resp.status}`;
  return { ok: false, error: `Meta: ${detail}` };
}

// ── PLAN LIMITS ──────────────────────────────────────────────────────
// The tiers were a price list. plan_tier_1/2/3 was read in exactly one place —
// the endpoint that serves the catalogue to the pricing page — so a Starter
// customer at Rs 1,999 could take ten numbers and run ten simultaneous calls,
// which is the Scale plan at a fifth of the price.
//
// Read from platform_config so the limits enforced here and the limits
// advertised on the page cannot drift apart. A tenant on no recognised plan
// gets the trial shape: one number, one call at a time, and credits.
const TRIAL_LIMITS = { minutes: 0, numbers: 1, seats: 0, concurrent: 1 };

async function planLimitsFor(plan?: string | null) {
  const key = String(plan || "").toLowerCase();
  if (!["starter", "growth", "scale"].includes(key)) return { ...TRIAL_LIMITS, tier: "trial" };
  const cfg = await getPlatformConfig();
  for (const k of ["plan_tier_1", "plan_tier_2", "plan_tier_3"]) {
    try {
      const t = JSON.parse(cfg[k] || "{}");
      if (String(t.id).toLowerCase() === key) {
        return {
          minutes:    Number(t.minutes) || 0,
          numbers:    Number(t.numbers) || 1,
          seats:      Number(t.seats) || 0,
          concurrent: Number(t.concurrent) || 1,
          tier: key,
        };
      }
    } catch { /* a malformed tier must not take calls down */ }
  }
  return { ...TRIAL_LIMITS, tier: key };
}

// ── WEB-DEMO TTS CACHE ───────────────────────────────────────────────
// The landing agent's answers repeat heavily across visitors — the greeting,
// "what is Hey Nikki", the pricing lines. Synthesis for a ~200-char reply
// measures ~3.5s, which is the entire remaining latency of a web turn now
// that the LLM leg is ~1.1s. A hit here removes it outright.
// In-memory and bounded: 80 entries × ~600KB ≈ 48MB worst case, evicted
// oldest-first. A restart losing it costs one slow turn per phrase.
const _webTtsCache = new Map<string, string>();
function webTtsGet(key: string): string | undefined {
  const v = _webTtsCache.get(key);
  if (v) { _webTtsCache.delete(key); _webTtsCache.set(key, v); } // LRU bump
  return v;
}
function webTtsPut(key: string, b64: string): void {
  if (_webTtsCache.size >= 80) {
    const oldest = _webTtsCache.keys().next().value;
    if (oldest !== undefined) _webTtsCache.delete(oldest);
  }
  _webTtsCache.set(key, b64);
}

// ── WHICH NUMBER DO WE SEND AS? ──────────────────────────────────────
// One shared number does not survive a second tenant: a customer of Nila
// Everyday Jewellery should not be messaged by "HeyNikki" from a number they
// have never seen. Under Meta's Tech Provider model each client owns a WABA
// and Embedded Signup grants us access, so the tenant row holds identifiers
// only — the platform system-user token already covers every WABA shared
// with us.
//
// Falls back to the platform number whenever the tenant has no ACTIVE
// binding, which is every tenant today. That fallback is also what lets this
// ship before 024 is applied: a missing table resolves to the platform sender
// rather than taking messaging down.
type WaSender = { phoneId: string; tenant: boolean };
const _waSenderCache = new Map<string, { v: WaSender; exp: number }>();

async function resolveWaSender(tenantId?: string): Promise<WaSender> {
  const platform = { phoneId: process.env.META_WA_PHONE_NUMBER_ID || "", tenant: false };
  if (!tenantId) return platform;

  const hit = _waSenderCache.get(tenantId);
  if (hit && hit.exp > Date.now()) return hit.v;

  let out = platform;
  try {
    const { data, error } = await sb.from("tenant_whatsapp")
      .select("phone_number_id, status")
      .eq("tenant_id", tenantId).eq("status", "active").maybeSingle();
    // A missing table (024 not yet applied) is not an error worth shouting
    // about on every send; anything else is.
    if (error && !/tenant_whatsapp/i.test(error.message)) {
      console.error("[WhatsApp] sender lookup failed:", error.message);
    }
    if (data?.phone_number_id) out = { phoneId: data.phone_number_id, tenant: true };
  } catch { /* fall back to platform */ }

  _waSenderCache.set(tenantId, { v: out, exp: Date.now() + 60_000 });
  return out;
}

// ── TEMPLATE SENDING (the only thing that works after a phone call) ──
// A phone call does not open a WhatsApp customer-service window — only an
// inbound WhatsApp message from the customer does. So every message this
// system sends because of a CALL is, by definition, outside the window, and
// Meta rejects free-form text there. That is why call-triggered WhatsApp has
// never arrived: the api-server sent text Meta refused, and the n8n missed-call
// workflow posted its template to $env.WATI_API_URL, which is empty.
//
// These are the templates actually APPROVED on WABA 1082855697732160, checked
// against the Graph API rather than assumed. Each takes exactly one body
// variable: the business name.
const WA_TEMPLATES: Record<string, { name: string; lang: string }> = {
  confirmation: { name: "appointment_confirmed",    lang: "en" },
  missed_call:  { name: "missed_call_followup",     lang: "en" },
  brochure:     { name: "interested_lead_brochure", lang: "en" },
  // ── Onboarding. NOT YET APPROVED on the WABA at the time of writing;
  // until Meta approves them these fall through to free text, which is
  // accepted by the API and silently dropped at delivery. The submissions
  // are in docs/whatsapp-templates.md. Listed here so that the day they are
  // approved, nothing else has to change.
  // Submitted as Telugu ("te"), unlike the three above. These go to the
  // BUSINESS OWNER, who chose a Telugu-first product — and unlike a caller,
  // an owner may never message us, so the 24-hour window may never open and
  // the template is the only text they will ever see. It has to be in their
  // language. If Meta is slow to approve te, submitting the same text under
  // "en" works and only this lang field changes.
  // Renamed. The originals were approved as MARKETING despite being
  // submitted as UTILITY — Meta read "thanks for choosing us" and "call and
  // test her" as promotional, and marketing templates are withheld from
  // anyone opted out of marketing.
  //
  // Deleting them to recategorise was a mistake: Meta locks the NAME for four
  // weeks afterwards and refuses both a new category and a re-create, so two
  // working templates were lost to get here. A fresh name may be UTILITY
  // immediately, which is why these are renamed rather than restored. Do not
  // delete an approved template to change its category.
  onboarding_welcome:        { name: "onboarding_account_ready",   lang: "te" },
  onboarding_kyc_verified:   { name: "onboarding_kyc_verified",   lang: "te" },
  onboarding_number_live:    { name: "onboarding_number_active",  lang: "te" },
  onboarding_setup_reminder: { name: "onboarding_setup_reminder", lang: "te" },
  onboarding_credits_low:    { name: "onboarding_credits_low",    lang: "te" },
  // The 24-hour reminder and the website-form acknowledgement both sent free
  // text, which Meta accepts and then drops outside the window — so neither
  // has ever been delivered to anyone who had not messaged us first.
  reminder:         { name: "appointment_reminder", lang: "te" },
  lead_capture_ack: { name: "lead_capture_ack",     lang: "te" },
};

// interested_lead_brochure is APPROVED but registered as MARKETING, so it is
// withheld from anyone opted out of marketing — and Meta refuses to change the
// category of an approved template ("You cannot update an approved template
// category"). A UTILITY replacement is pending under a new name.
//
// Rather than require a second deploy on the day it is approved, the brochure
// send tries the UTILITY one first and falls back to the approved MARKETING
// one when Meta says it does not exist yet (132001). The fallback disappears
// on its own.
const WA_TEMPLATE_PREFERRED: Record<string, { name: string; lang: string }> = {
  brochure: { name: "lead_brochure_details", lang: "te" },
};

async function sendTemplateViaMeta(
  to: string, template: string, lang: string, params: string[], senderId?: string,
): Promise<WhatsAppResult> {
  const token   = process.env.META_WA_TOKEN || "";
  const phoneId = senderId || process.env.META_WA_PHONE_NUMBER_ID || "";
  const version = process.env.META_WA_API_VERSION || "v21.0";
  if (!token || !phoneId) return { ok: false, error: "Meta Cloud API not configured" };

  const msisdn = to.replace(/[^\d]/g, "");
  const components = params.length
    ? [{ type: "body", parameters: params.map(t => ({ type: "text", text: String(t || "").slice(0, 60) })) }]
    : [];

  const resp = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type:    "individual",
      to:                msisdn,
      type:              "template",
      template: { name: template, language: { code: lang }, components },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const body = await resp.json().catch(() => ({} as any));
  if (resp.ok) return { ok: true, id: body?.messages?.[0]?.id };
  return { ok: false, error: `Meta template ${template}: ${body?.error?.message || `HTTP ${resp.status}`}` };
}

async function sendWhatsApp(to: string, message: string, tenantId: string,
  voiceProfileId: string, messageType: string, callId?: string, apptId?: string,
  businessName?: string, templateParams?: string[]) {
  const provider = (process.env.WHATSAPP_PROVIDER || "wati").toLowerCase();
  const tpl = WA_TEMPLATES[messageType];
  const sender = await resolveWaSender(tenantId);

  let result: WhatsAppResult;
  try {
    if (provider === "meta" && tpl) {
      // Template first — it is the only form deliverable outside the window.
      // Most templates take just the business name. A few take more — the
      // number-live message is worthless without the number in it — so an
      // explicit list wins when the caller supplies one.
      const params = templateParams?.length ? templateParams : [businessName || "us"];
      const pref = WA_TEMPLATE_PREFERRED[messageType];
      result = pref
        ? await sendTemplateViaMeta(to, pref.name, pref.lang, params, sender.phoneId)
        : await sendTemplateViaMeta(to, tpl.name, tpl.lang, params, sender.phoneId);
      // 132001 means the preferred template is not approved yet. Anything else
      // is a real failure and must not be papered over by a second attempt.
      if (!result.ok && pref && /132001|does not exist/i.test(result.error || "")) {
        result = await sendTemplateViaMeta(to, tpl.name, tpl.lang, params, sender.phoneId);
      }
      // If the customer HAS messaged recently the window is open, and the
      // free-form version carries what the template cannot: the actual date,
      // time and service. Approved templates here take one variable, the
      // business name, so the detail only ever arrives this way. A failure is
      // ignored on purpose — the template above already landed.
      if (result.ok) {
        sendViaMeta(to, message, sender.phoneId).catch(() => { /* window closed; expected */ });
      }
    } else {
      result = provider === "meta"
        ? await sendViaMeta(to, message, sender.phoneId)
        : await sendViaWati(to, message);
    }
  } catch (err: any) {
    result = { ok: false, error: err.message };
  }

  if (!result.ok) console.error(`[WhatsApp/${provider}]`, result.error);
  else if (tpl) console.log(`[WhatsApp] template ${tpl.name} -> ${to} (as ${sender.tenant ? "tenant" : "platform"} number)`);

  try {
    await sb.from("wa_dispatch_log").insert({
      tenant_id:        tenantId,
      voice_profile_id: voiceProfileId,
      call_id:          callId || null,
      appointment_id:   apptId || null,
      message_type:     messageType,
      to_number:        to,
      message_body:     message,
      // "sent" means Meta ACCEPTED it, which is not the same as delivered.
      // Meta accepts free-form text outside the 24-hour window and drops it
      // asynchronously, so this row said "sent" for messages nobody received.
      // The id is what lets the delivery webhook below correct that.
      status:           result.ok ? "sent" : "failed",
      provider_msg_id:  result.id || null,
    });
  } catch (err: any) {
    // A logging failure must never swallow a successful send.
    console.error("[WhatsApp log error]", err.message);
  }

  return result.ok;
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

  // Mirrors the widget's emotion modes (energetic/cool/gentle), mapped
  // to Sarvam's pace param.
  //
  // pitch and loudness are deliberately absent: Bulbul V3 rejects both
  // with a 400 ("currently not supported for the Bulbul V3 model"), so
  // passing them made this endpoint fail for EVERY request regardless
  // of emotion. Pace is the only prosody control V3 accepts.
  const EMOTION_PACE: Record<string, number> = {
    energetic: 1.08,
    cool:      1.0,
    gentle:    0.92,
  };
  const pace = EMOTION_PACE[emotion || "energetic"] ?? EMOTION_PACE.energetic;

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
        pace,
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
  const { audio_base64, mime_type, text, session_id, persona } = req.body as {
    audio_base64?: string;
    mime_type?:    string;
    text?:         string;
    session_id?:   string;
    // "product" = landing-page assistant describing Hey Nikki itself.
    // Omitted = the simulated inbound-call demo.
    persona?:      string;
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
    // ── 1. Transcribe (auto-detecting STT) ───────────────────────
    let transcript = (text || "").trim();
    // Set from Saarika's detection for spoken turns. For a typed turn we
    // cannot know, so the reply is spoken in Telugu — the default the
    // product is sold on — unless the text is plainly Latin script.
    let detectedLang = "";

    if (!transcript && audio_base64) {
      // ~1.4MB of base64 ≈ 1MB of webm ≈ well over the 20s a single
      // conversational turn should ever need. Reject rather than pay
      // Sarvam to transcribe someone's uploaded album.
      if (audio_base64.length > 1_400_000) {
        return res.status(413).json({ error: "Audio too long — keep replies under ~20 seconds" });
      }

      const audioBuffer = Buffer.from(audio_base64, "base64");
      const sttForm = new FormData();
      // Strip the codecs parameter before it reaches Sarvam.
      //
      // MediaRecorder always reports "audio/webm;codecs=opus", and that exact
      // string was forwarded as the upload's content type. Sarvam matches the
      // type EXACTLY against its allow-list and answers
      //   400 Invalid file type: audio/webm;codecs=opus
      // while the same bytes as bare "audio/webm" transcribe fine. So every
      // spoken turn on the landing page failed and only typed turns worked —
      // the widget has never once heard anyone.
      const mime = (mime_type || "audio/webm").split(";")[0].trim();
      const ext  = mime.split("/")[1] || "webm";
      sttForm.append("file", new Blob([audioBuffer], { type: mime }), `turn.${ext}`);
      sttForm.append("model", "saaras:v3");
      // "unknown" = auto-detect, the same thing the phone path does.
      //
      // This was pinned to te-IN, so a visitor speaking English was
      // transcribed AS Telugu — Saarika returns its best Telugu reading of
      // English phonemes, which is nonsense, and the model then answered the
      // nonsense. The landing demo was behaving worse than the product it
      // exists to sell, and it is the first thing a customer tries.
      sttForm.append("language_code", "unknown");

      const sttResp = await fetch("https://api.sarvam.ai/speech-to-text", {
        method: "POST",
        headers: { "api-subscription-key": SARVAM_KEY },
        body: sttForm as any,
      });
      if (!sttResp.ok) throw new Error(`Sarvam STT ${sttResp.status}`);
      const sttData = await sttResp.json() as any;
      transcript = (sttData.transcript || "").trim();
      // Saarika reports what it detected. Speak the answer back in the same
      // language rather than replying in Telugu to an English question.
      if (sttData.language_code) {
        detectedLang = String(sttData.language_code);
        // Not used to pick the voice — the reply's own script decides that,
        // below. Logged because it is the only signal of what visitors
        // actually speak on the landing page.
        console.log(`[voice-turn] detected ${detectedLang} for session ${sessionId}`);

        // ── Detected something we do not sell ────────────────────────────
        // language_code "unknown" lets Sarvam choose from eleven languages,
        // and on a short utterance it guesses badly: a real session logged
        // 4 turns of 16 as Bengali or Kannada from a Telugu-and-English
        // speaker. That is not a cosmetic mislabel — the audio is
        // TRANSCRIBED with the wrong language model, so the transcript is
        // wrong, and every downstream step reasons on it.
        //
        // This product supports three languages. Anything else is a
        // misdetection by definition, so the turn is transcribed again as
        // Telugu, the site's default. Costs one extra STT call on the
        // minority of turns that need it, at roughly a paisa each.
        const SUPPORTED = ["te-IN", "hi-IN", "en-IN"];
        if (!SUPPORTED.includes(detectedLang)) {
          console.warn(`[voice-turn] ${detectedLang} is not a supported language — re-transcribing as te-IN`);
          try {
            const retryForm = new FormData();
            // Same mime handling and same model as the first attempt — only
            // the language is pinned. A different model here would make the
            // retry a second variable rather than a correction.
            retryForm.append("file", new Blob([audioBuffer], { type: mime }), `turn.${ext}`);
            retryForm.append("model", "saaras:v3");
            retryForm.append("language_code", "te-IN");
            const retryResp = await fetch("https://api.sarvam.ai/speech-to-text", {
              method: "POST",
              headers: { "api-subscription-key": SARVAM_KEY },
              body: retryForm as any,
            });
            if (retryResp.ok) {
              const retryData = await retryResp.json() as any;
              const retryText = (retryData.transcript || "").trim();
              // Keep the original if the retry heard less — a confident
              // wrong-language guess still beats silence.
              if (retryText.length >= transcript.length) {
                transcript = retryText;
                detectedLang = "te-IN";
              }
            }
          } catch (e: any) {
            console.error("[voice-turn] language retry failed:", e.message);
          }
        }
      }
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
          persona: persona === "product" ? "product" : undefined,
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
    // Sarvam speaks a fixed set of Indian languages; anything it detected
    // outside that list still has to be spoken by SOMETHING, and Telugu is
    // the product's default. A Latin-script typed turn is treated as English
    // so the demo answers a typed English question in English.
    // Choose the voice language from the SCRIPT OF THE REPLY, not from what
    // the visitor said. Those differ constantly — a typed English question
    // often gets a Telugu answer, this being a Telugu-first product — and
    // handing Telugu text to an en-IN voice makes Sarvam read Telugu
    // characters with English phonetics, which is the accented mumble that
    // sounds like a broken voice engine. Matching the text is the only rule
    // that is always right.
    const hasTelugu     = /[ఀ-౿]/.test(reply);
    const hasDevanagari = /[ऀ-ॿ]/.test(reply);
    const ttsLang = hasTelugu ? "te-IN" : hasDevanagari ? "hi-IN" : "en-IN";

    try {
      // Speak the FIRST SENTENCE; show the full text. Synthesis time scales
      // with audio length — a 200-char reply costs ~3.5s before the visitor
      // hears anything, and the transcript is already on screen carrying the
      // rest. One spoken sentence lands in ~1.2s and reads as responsiveness;
      // fourteen seconds of read-aloud reads as a screen reader.
      const firstStop = reply.search(/[.!?।?]\s/);
      const speakText = (firstStop > 20 && firstStop < 260)
        ? reply.slice(0, firstStop + 1)
        : (reply.length > 260 ? reply.slice(0, 260) : reply);

      const cacheKey = `${ttsLang}|${speakText}`;
      const cached = webTtsGet(cacheKey);
      if (cached) {
        audioBase64 = cached;
      } else {
      const ttsResp = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: {
          "api-subscription-key": SARVAM_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: [speakText],
          // Speak back in the language the visitor actually used. Pinned to
          // te-IN, an English reply was rendered with Telugu phonetics and
          // came out as an accented mumble — which reads as "the voice is
          // broken" to someone evaluating the product in English.
          target_language_code: ttsLang,
          // Same voice the phone product uses (main.py synthesize default),
          // so what a visitor hears on the site is what their callers will
          // actually get. Do not change it to a livelier-sounding name
          // without checking compatibility first: bulbul:v3 accepts only a
          // subset of Sarvam's speakers and rejects the rest with a 400,
          // which this try/catch turns into audio_base64: null — a silently
          // voiceless demo.
          speaker: "priya",
          model: "bulbul:v3",
          // Slightly quicker than default. A receptionist answering a
          // business line speaks faster than a read-aloud tool, and flat
          // pace is much of what makes synthetic speech sound like
          // recital.
          //
          // NOTE: do NOT add pitch or loudness here. Bulbul V3 rejects
          // both with a 400 ("currently not supported for the Bulbul V3
          // model"), and because the TTS call is wrapped in a try/catch
          // that only warns, the failure surfaces as audio_base64: null
          // — Nikki replies in text with no voice at all, which looks
          // like a broken audio pipeline rather than a bad parameter.
          pace: 1.06,
          speech_sample_rate: 22050,
          enable_preprocessing: true,
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!ttsResp.ok) throw new Error(`Sarvam TTS ${ttsResp.status}`);
      const ttsData = await ttsResp.json() as any;
      audioBase64 = ttsData.audios?.[0] || null;
      if (audioBase64) webTtsPut(cacheKey, audioBase64);
      }
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
    message_type, call_id, appointment_id, req.body.business_name,
    Array.isArray(req.body.template_params) ? req.body.template_params : undefined);
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
    "confirmation", call_id, appointment_id, business_name);
  res.json({ ok });
});

// Missed call auto-response
app.post("/api/whatsapp/missed-call", verifyInternal, async (req, res) => {
  const { caller_number, business_name, tenant_id, voice_profile_id, call_id } = req.body;
  const message = `నమస్కారం! మీరు ${business_name} కి call చేశారు.\n\n` +
    `మేము మీ call miss చేశాము. త్వరలో మేము మీకు call back చేస్తాము.\n\n` +
    `అర్జెంట్ అయితే, మళ్ళీ call చేయండి. ధన్యవాదాలు! 🙏`;
  const ok = await sendWhatsApp(caller_number, message, tenant_id, voice_profile_id,
    "missed_call", call_id, undefined, business_name);
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
    "reminder", undefined, appointment_id, business_name,
    [business_name || "us", slot_time || "your appointment time"]);
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

// ── Agent history and rollback ────────────────────────────────
// A trigger snapshots the previous row on every change (migration 022), so
// this reads history rather than recording it — nothing here can be bypassed
// by editing through some other path.
app.get("/api/voice-profiles/:id/versions", verifyJWT, async (req: any, res) => {
  const tenantId = await getTenantId(req.user.id);
  if (!tenantId) return res.status(403).json({ error: "No tenant" });
  const { data, error } = await sb.from("voice_profile_versions")
    .select("id, snapshot, changed_by, created_at")
    .eq("profile_id", req.params.id).eq("tenant_id", tenantId)
    .order("created_at", { ascending: false }).limit(50);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ versions: data || [] });
});

app.post("/api/voice-profiles/:id/restore/:versionId", verifyJWT, async (req: any, res) => {
  const tenantId = await getTenantId(req.user.id);
  if (!tenantId) return res.status(403).json({ error: "No tenant" });

  const { data: v } = await sb.from("voice_profile_versions")
    .select("snapshot").eq("id", req.params.versionId)
    .eq("profile_id", req.params.id).eq("tenant_id", tenantId).maybeSingle();
  if (!v) return res.status(404).json({ error: "Version not found" });

  // Restore only what a person authored. id, tenant_id and the timestamps
  // identify the row rather than describe the agent, and did_number is the
  // phone line it answers on — restoring an old prompt must not silently
  // move the agent to a number it used to have.
  const snap = v.snapshot as Record<string, any>;
  const IMMUTABLE = new Set(["id", "tenant_id", "created_at", "updated_at", "did_number", "status"]);
  const patch: Record<string, any> = {};
  for (const [k, val] of Object.entries(snap)) if (!IMMUTABLE.has(k)) patch[k] = val;

  // The update fires the trigger, so the version being replaced is itself
  // snapshotted — an undo is undoable.
  const { data, error } = await sb.from("voice_profiles")
    .update(patch).eq("id", req.params.id).eq("tenant_id", tenantId).select().single();
  if (error) return res.status(400).json({ error: error.message });

  await audit("voice_profile_restore", {
    tenantId, actorId: req.user.id,
    metadata: { profile_id: req.params.id, version_id: req.params.versionId },
  });
  res.json({ ok: true, profile: data });
});

// ── Agent builder: describe it, get a draft ───────────────────
// Setting an agent up today means filling in a form: business name, the
// services list, hours, appointment types, the fallback message — in Telugu.
// Most owners abandon that. This turns a sentence into a filled-in profile.
//
// It DRAFTS ONLY. Nothing is written; the caller reviews and then posts to
// /api/voice-profiles as normal. An agent goes live on a real phone number
// that real customers ring, so a model must never be the last thing between
// a prompt and production.
app.post("/api/agents/draft", verifyJWT, apiLimiter, async (req: any, res) => {
  try {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) return res.status(403).json({ error: "No tenant" });

    const description = String(req.body?.description || "").trim();
    if (description.length < 10) {
      return res.status(400).json({ error: "Describe the business in a sentence or two" });
    }
    if (description.length > 2000) {
      return res.status(400).json({ error: "Keep the description under 2000 characters" });
    }
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) return res.status(503).json({ error: "Agent builder is not configured" });

    const prompt = [
      "Turn this description of an Indian small business into a receptionist",
      "agent profile. Return ONLY minified JSON with exactly these keys:",
      '{"business_name":"","display_name":"","profile_sku":"standard|clinic|real_estate|premium",',
      '"services":[],"appointment_types":[],"open_time":"HH:MM","close_time":"HH:MM",',
      '"open_days":["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],"fallback_message":""}',
      "",
      "display_name: what the agent calls itself, in TELUGU SCRIPT. Default నిక్కి.",
      "profile_sku: clinic for doctors/dentists/hospitals, real_estate for",
      "  property, premium for high-value services, otherwise standard.",
      "services: 3-6 short items the business actually offers.",
      "appointment_types: 2-4 things a caller can book.",
      "open_time/close_time: 24-hour. If unstated use 09:00 and 21:00.",
      "open_days: only the days stated; if unstated, Mon-Sat.",
      "fallback_message: one sentence in TELUGU, said when no one can take",
      "  the call. Warm, not apologetic.",
      "",
      "Invent nothing the description does not support beyond the stated",
      "defaults — a wrong service list is worse than a short one.",
      "",
      "DESCRIPTION:",
      description,
    ].join("\n");

    const gen = await geminiGenerate({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, responseMimeType: "application/json" },
    });
    if (!gen.ok) {
      console.error("[agent draft] gemini", gen.status, gen.detail);
      // A stall is not an internal error and must not read like one — the
      // customer has a paragraph typed into the box and needs to know that
      // pressing the button again is the right move.
      return res.status(gen.timedOut ? 504 : 502).json({
        error: gen.timedOut
          ? "The agent builder took too long to respond. Your description is safe — press Draft again."
          : "Could not draft the agent — try again",
      });
    }
    const d = gen.data;


    // Constrain before returning. voice_profiles has CHECK constraints and
    // this output is destined for it — an unvalidated draft would be
    // rejected at INSERT, after the user had already approved it, which
    // reads as the save being broken rather than the draft.
    const SKUS = ["standard", "clinic", "real_estate", "premium"];
    const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const hhmm = (v: any, fb: string) =>
      /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : fb;
    const strArr = (v: any, max: number) =>
      Array.isArray(v) ? v.map((x: any) => String(x).slice(0, 60)).filter(Boolean).slice(0, max) : [];

    res.json({
      draft: {
        business_name:     String(d.business_name || "").slice(0, 120) || "My Business",
        display_name:      String(d.display_name || "నిక్కి").slice(0, 60),
        profile_sku:       SKUS.includes(d.profile_sku) ? d.profile_sku : "standard",
        services:          strArr(d.services, 6),
        appointment_types: strArr(d.appointment_types, 4),
        open_time:         hhmm(d.open_time, "09:00"),
        close_time:        hhmm(d.close_time, "21:00"),
        open_days:         (Array.isArray(d.open_days) ? d.open_days.filter((x: any) => DAYS.includes(x)) : [])
                             .slice(0, 7).length
                           ? d.open_days.filter((x: any) => DAYS.includes(x)).slice(0, 7)
                           : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
        fallback_message:  String(d.fallback_message || "").slice(0, 400),
      },
    });
  } catch (err: any) {
    console.error("[agent draft]", err.message);
    res.status(500).json({ error: "Internal error" });
  }
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
// A real test call. Both halves of this were theatre: the button was a
// setTimeout that alerted "your phone will ring in 5 seconds", and this
// endpoint console.logged and returned ok. A customer pressed it, waited for
// a call that was never placed, and concluded the product does not work.
//
// It now dials the owner's own phone from the business's assigned DID
// through the same originate path campaigns use, so the call that arrives is
// genuinely the caller experience. Every precondition is stated plainly
// rather than faked: no assigned number, no owner phone, or no credits each
// come back as an honest sentence.
// Play a recording. Owner AND staff — anyone in tenant_users for the
// business — since a two-person clinic where the receptionist cannot hear
// the call she missed is a worse product than the tighter rule is a safer
// one. Ownership is checked here, on the call row itself, so a guessed id
// from another tenant gets 404 rather than audio.
//
// This proxies rather than redirecting to a presigned URL because the
// object is AES-256-GCM ciphertext: a browser handed a signed link would
// download an unplayable blob. The key lives in the pipeline with the R2
// credentials, so the pipeline decrypts and we stream the result.
// ── WhatsApp inbox ────────────────────────────────────────────
// Replies, newest first, optionally filtered to one lead's thread.
app.get("/api/whatsapp/inbox", verifyJWT, async (req: any, res) => {
  const tenantId = await getTenantId(req.user.id);
  if (!tenantId) return res.status(403).json({ error: "No tenant" });
  let q = sb.from("wa_inbound")
    .select("id, from_number, body, msg_type, received_at, read_at, lead_id")
    .eq("tenant_id", tenantId)
    .order("received_at", { ascending: false })
    .limit(Math.min(200, parseInt(req.query.limit) || 50));
  if (req.query.lead_id)  q = q.eq("lead_id", String(req.query.lead_id));
  if (req.query.number)   q = q.like("from_number", `%${String(req.query.number).replace(/\D/g, "").slice(-10)}`);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const unread = (data || []).filter((m: any) => !m.read_at).length;
  res.json({ messages: data || [], unread });
});

app.post("/api/whatsapp/inbox/read", verifyJWT, async (req: any, res) => {
  const tenantId = await getTenantId(req.user.id);
  if (!tenantId) return res.status(403).json({ error: "No tenant" });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 200) : [];
  if (!ids.length) return res.status(400).json({ error: "ids required" });
  const { error } = await sb.from("wa_inbound")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).in("id", ids).is("read_at", null);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, marked: ids.length });
});

app.get("/api/calls/:id/recording", verifyJWT, async (req: any, res) => {
  const tenantId = await getTenantId(req.user.id);
  if (!tenantId) return res.status(403).json({ error: "No tenant" });

  const { data: call } = await sb.from("calls")
    .select("id, tenant_id, r2_object_key, recording_url")
    .eq("id", req.params.id).eq("tenant_id", tenantId).maybeSingle();
  if (!call) return res.status(404).json({ error: "Call not found" });
  if (!call.r2_object_key) {
    return res.status(404).json({ error: "No recording was kept for this call" });
  }

  try {
    const url = new URL(`${PIPELINE_URL}/api/v1/recording/fetch`);
    url.searchParams.set("key", call.r2_object_key);
    url.searchParams.set("tenant_id", tenantId);
    url.searchParams.set("call_id", call.id);
    const r = await fetch(url, {
      headers: { "X-Internal-Secret": process.env.INTERNAL_SECRET || "" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      // A purged recording is the expected 404 here: retention is by plan,
      // and a trial keeps audio for seven days.
      return res.status(r.status === 404 ? 404 : 502)
        .json({ error: r.status === 404
          ? "This recording has passed your plan's retention window"
          : "Could not load the recording" });
    }
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e: any) {
    console.error("[recording]", e.message);
    res.status(502).json({ error: "Could not load the recording" });
  }
});

app.post("/api/test-call", verifyJWT, async (req: any, res) => {
  const tenantId = await getTenantId(req.user.id);
  if (!tenantId) return res.status(403).json({ error: "No tenant" });

  const [{ data: did }, { data: owner }, { data: tenant }] = await Promise.all([
    sb.from("dids").select("number").eq("tenant_id", tenantId)
      .eq("status", "assigned").limit(1).maybeSingle(),
    sb.from("tenant_users").select("phone").eq("tenant_id", tenantId)
      // Any member with a phone, owner first. Requiring role='owner'
      // excluded the platform's own tenant, whose single member is a
      // super_admin — so its test call could never find a number to ring.
      .not("phone", "is", null).order("role").limit(1).maybeSingle(),
    sb.from("tenants").select("credit_minutes, plan").eq("id", tenantId).maybeSingle(),
  ]);

  if (!did?.number) {
    return res.status(409).json({
      error: "Your HeyNikki number isn't assigned yet — we'll message you the moment it is.",
    });
  }
  if (!owner?.phone) {
    return res.status(409).json({
      error: "We don't have your mobile number yet. Add it in your profile, then try again.",
    });
  }
  if ((tenant?.credit_minutes ?? 0) <= 0 && !["starter", "growth", "scale"].includes(String(tenant?.plan))) {
    return res.status(402).json({ error: "Your free minutes have run out — add a plan to keep calling." });
  }

  try {
    const uuid = await fsl.originateOutbound(owner.phone, did.number);
    console.log(`[test-call] tenant=${tenantId} -> ${owner.phone} via ${did.number} uuid=${uuid}`);
    res.json({ ok: true, message: `Calling ${owner.phone} now — Nikki will answer.` });
  } catch (e: any) {
    // NOT 502. A carrier refusing the call is an expected operational
    // outcome, not a broken gateway — and a 5xx makes the browser log
    // "net::ERR_FAILED 502" over whatever message we put in the body, so
    // the customer sees a crash instead of an explanation.
    //
    // The Jio trunk currently answers every outbound INVITE with
    // 500 "Classification Failure": it accepts our OPTIONS pings and all
    // inbound calls, but has not been authorised for outbound. Verified by
    // dialling it directly from fs_cli in four number formats, all
    // identical, with a well-formed INVITE carrying our own DID in From.
    const temporary = /TEMPORARY_FAILURE|CLASSIFICATION|GATEWAY/i.test(e?.message || "");
    console.error("[test-call] originate failed:", e?.message);
    res.status(409).json({
      error: temporary
        ? "Outbound calling isn't enabled on your number's trunk yet — we're on it. Inbound calls work normally."
        : "Could not place the call right now. Please try again.",
    });
  }
});

// ════════════════════════════════════════════════
// DASHBOARD ANALYTICS APIS
// ════════════════════════════════════════════════
app.get("/api/analytics/summary", verifyJWT, async (req, res) => {
  const tenantId = await getTenantId((req as any).user.id);
  if (!tenantId) return res.status(400).json({ error: "Tenant not found" });

  const today = new Date().toISOString().split("T")[0];
  const month = new Date().toISOString().slice(0, 7);

  // Usage is DERIVED from the calls themselves, not read from
  // call_minutes.used_seconds. Nothing in this codebase ever incremented that
  // column — 2,703 seconds of completed calls existed while it still read 0 —
  // so the dashboard told every customer they had used no minutes, and any
  // overage billed off it would have been zero forever.
  //
  // A counter that must be maintained in three services drifts; a sum over the
  // rows that already exist cannot. The plan's limit still comes from the
  // subscription, falling back to the tenant's tier.
  const monthStart = month + "-01T00:00:00";
  const [todayCalls, monthCalls, planRow, tenantRow] = await Promise.all([
    sb.from("calls").select("id,status,wa_sent,appointment_created,intent,duration_seconds")
      .eq("tenant_id", tenantId)
      .gte("created_at", today + "T00:00:00"),
    sb.from("calls").select("duration_seconds")
      .eq("tenant_id", tenantId).gte("created_at", monthStart),
    sb.from("call_minutes").select("plan_limit_seconds")
      .eq("tenant_id", tenantId).eq("month", month).maybeSingle(),
    sb.from("tenants").select("plan, credit_minutes").eq("id", tenantId).maybeSingle(),
  ]);

  const usedSeconds = (monthCalls.data || [])
    .reduce((sum: number, c: any) => sum + (c.duration_seconds || 0), 0);
  const PLAN_MINUTES: Record<string, number> = { starter: 200, growth: 600, scale: 1500 };
  const limitMinutes = planRow.data?.plan_limit_seconds
    ? Math.round(planRow.data.plan_limit_seconds / 60)
    : (PLAN_MINUTES[String(tenantRow.data?.plan || "").toLowerCase()] ?? 0);

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
      // Rounded UP, the same way a minute is billed. Reporting 0 used after a
      // 40-second call is how a customer discovers the meter is lying.
      used:  Math.ceil(usedSeconds / 60),
      limit: limitMinutes,
      // Minutes past the plan allowance. Deliberately reported rather than
      // blocked: the pricing page sells extra minutes at Rs 15, so going over
      // is a purchase, not a fault. What was broken is that nobody could see
      // it — usage read 0 forever, so overage could never have been billed.
      overage: limitMinutes > 0 ? Math.max(0, Math.ceil(usedSeconds / 60) - limitMinutes) : 0,
    },
    // Trial balance, so the dashboard can show what is actually left rather
    // than a plan allowance a trial tenant does not have.
    credits: Math.max(0, Math.round(Number(tenantRow.data?.credit_minutes ?? 0))),
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

/**
 * Platform operations — the automations, and whether they are actually running.
 *
 * Everything here is a check for a SILENT failure, because that is the shape
 * every real fault in this system has taken. The knowledge base looked empty
 * when it was structurally unable to embed. Appointments read "confirmed"
 * while holding no date, so no reminder could ever fire. Campaigns could be
 * built and never started. WhatsApp reported HTTP 200 while sending nothing.
 * None of those raised an error anywhere — each one just quietly did nothing.
 *
 * So this does not report uptime. It reports work that should have happened
 * and did not, per check, with the number of rows affected. A green board
 * means the pipelines moved; it does not mean no process crashed, which is
 * what API Health is for.
 */
app.get("/api/admin/operations", verifySuperAdmin, async (_req, res) => {
  try {
    const dayAgo  = new Date(Date.now() - 86400_000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const tomorrow = new Date(Date.now() + 5.5 * 3600_000 + 86400_000).toISOString().slice(0, 10);

    const count = async (table: string, build: (q: any) => any) => {
      const { count: n, error } = await build(
        sb.from(table).select("id", { count: "exact", head: true }));
      if (error) { console.error(`[ops] ${table}:`, error.message); return null; }
      return n ?? 0;
    };

    const [
      knowledgePending, callsWeek, scoredWeek,
      apptsNoDate, apptsTomorrow, remindersPending,
      campaignsRunning, recipientsStuck,
      leadsUnassigned, waFailedDay, recordingsMissing, versionsWeek,
    ] = await Promise.all([
      // Embedding backlog. Non-zero and not falling means the scheduler is
      // not running; every one of these is invisible to RAG until it does.
      count("knowledge_base",  (q: any) => q.is("embedding", null)),
      count("calls",           (q: any) => q.gte("created_at", weekAgo)),
      count("call_quality",    (q: any) => q.gte("created_at", weekAgo)),
      // "Confirmed" with no date. Cannot be reminded, cannot be put in a
      // calendar, and nobody knows when the customer is coming.
      count("appointments",    (q: any) => q.is("slot_date", null).eq("status", "confirmed")),
      count("appointments",    (q: any) => q.eq("slot_date", tomorrow).eq("status", "confirmed")),
      count("appointments",    (q: any) => q.eq("slot_date", tomorrow).eq("status", "confirmed").eq("wa_reminder_sent", false)),
      count("outbound_campaigns", (q: any) => q.eq("status", "running")),
      // Picked up and never resolved — a dispatcher that died mid-dial
      // leaves recipients here forever.
      count("outbound_recipients", (q: any) => q.eq("status", "in_progress").lt("last_attempt_at", dayAgo)),
      count("leads",           (q: any) => q.is("assigned_to", null).gte("score", 60)),
      // sent_at, not created_at — wa_dispatch_log has no created_at column
      // and the query 400s, which this reports as "unknown" rather than ok.
      count("wa_dispatch_log", (q: any) => q.eq("status", "failed").gte("sent_at", dayAgo)),
      count("calls",           (q: any) => q.gte("created_at", weekAgo).is("r2_object_key", null).is("recording_url", null)),
      count("voice_profile_versions", (q: any) => q.gte("created_at", weekAgo)),
    ]);

    // A check is only "ok" when it is genuinely zero. null means the query
    // itself failed, which is reported as unknown rather than passed —
    // treating a broken check as a green one is how this class of fault
    // survives in the first place.
    const check = (id: string, label: string, value: number | null,
                   bad: (v: number) => boolean, hint: string) => ({
      id, label, value,
      state: value === null ? "unknown" : bad(value) ? "attention" : "ok",
      hint,
    });

    res.json({
      generated_at: new Date().toISOString(),
      checks: [
        check("knowledge_backlog", "Knowledge entries awaiting embedding", knowledgePending,
              v => v > 0, "Scheduler embeds these every 15 min. Non-zero and static means it is not running."),
        check("calls_unscored", "Calls this week not yet scored",
              callsWeek === null || scoredWeek === null ? null : Math.max(0, callsWeek - scoredWeek),
              v => v > 20, "Only calls with 4+ turns are scored; a large gap is normal if most calls are silent."),
        check("appts_no_date", "Appointments confirmed with no date", apptsNoDate,
              v => v > 0, "Cannot be reminded or calendared. Extraction runs at call end."),
        check("reminders_pending", "Tomorrow's reminders not yet sent", remindersPending,
              v => v > 0, "Fires in the evening IST window. Non-zero after that means the job is not running."),
        check("recipients_stuck", "Campaign recipients stuck dialling >24h", recipientsStuck,
              v => v > 0, "The dispatcher died mid-dial. Restart it or reset these to queued."),
        check("wa_failed", "WhatsApp sends failed today", waFailedDay,
              v => v > 0, "Check template approval and the access token."),
        check("leads_unassigned", "Hot leads with no owner", leadsUnassigned,
              v => v > 5, "Score 60+ and nobody is following them up."),
        check("recordings_missing", "Calls this week with no recording", recordingsMissing,
              v => v > 20, "R2 credentials, or calls too short to record."),
      ],
      counters: {
        calls_week: callsWeek, scored_week: scoredWeek,
        campaigns_running: campaignsRunning, appts_tomorrow: apptsTomorrow,
        agent_changes_week: versionsWeek,
      },
    });
  } catch (err: any) {
    console.error("[admin operations]", err.message);
    res.status(500).json({ error: "Internal error" });
  }
});

/**
 * Call quality across every tenant.
 *
 * A tenant sees its own scores on /quality. Nobody could see the platform's,
 * so a business whose agent quietly got worse looked identical to one that
 * never called. Aggregated per tenant and sorted worst-first, because that
 * is the order in which they need help.
 */
app.get("/api/admin/quality", verifySuperAdmin, async (_req, res) => {
  try {
    const { data: rows, error } = await sb.from("call_quality")
      .select("tenant_id, overall_score, resolution_score, sentiment, next_step_captured, risk_flags, created_at")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) return res.status(500).json({ error: error.message });

    const ids = [...new Set((rows || []).map(r => r.tenant_id))];
    const { data: tenants } = ids.length
      ? await sb.from("tenants").select("id, name").in("id", ids)
      : { data: [] as any[] };
    const nameOf = new Map((tenants || []).map(t => [t.id, t.name]));

    const acc = new Map<string, any>();
    for (const r of rows || []) {
      const e = acc.get(r.tenant_id) || {
        tenant_id: r.tenant_id, tenant_name: nameOf.get(r.tenant_id) || null,
        scored: 0, sum: 0, next: 0, negative: 0, risks: 0,
      };
      e.scored += 1;
      e.sum += r.overall_score || 0;
      if (r.next_step_captured) e.next += 1;
      if (r.sentiment === "negative") e.negative += 1;
      e.risks += (r.risk_flags || []).length;
      acc.set(r.tenant_id, e);
    }

    const tenantsOut = [...acc.values()].map(e => ({
      tenant_id: e.tenant_id, tenant_name: e.tenant_name, scored: e.scored,
      avg_score: Math.round(e.sum / e.scored),
      next_step_pct: Math.round((e.next / e.scored) * 100),
      negative: e.negative, risk_flags: e.risks,
    })).sort((a, b) => a.avg_score - b.avg_score);

    const total = (rows || []).length || 1;
    res.json({
      tenants: tenantsOut,
      platform: {
        scored: rows?.length || 0,
        avg_score: Math.round((rows || []).reduce((s, r) => s + (r.overall_score || 0), 0) / total),
        next_step_pct: Math.round((rows || []).filter(r => r.next_step_captured).length / total * 100),
        negative: (rows || []).filter(r => r.sentiment === "negative").length,
      },
    });
  } catch (err: any) {
    console.error("[admin quality]", err.message);
    res.status(500).json({ error: "Internal error" });
  }
});

/** Campaigns across tenants, with the recipient breakdown that says whether one is stuck. */
app.get("/api/admin/campaigns", verifySuperAdmin, async (_req, res) => {
  try {
    const { data: camps, error } = await sb.from("outbound_campaigns")
      .select("id, tenant_id, name, status, consent_declared, window_start, window_end, max_concurrent, created_at")
      .order("created_at", { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error: error.message });
    if (!camps?.length) return res.json({ campaigns: [] });

    const { data: recips } = await sb.from("outbound_recipients")
      .select("campaign_id, status").in("campaign_id", camps.map(c => c.id));
    const { data: tenants } = await sb.from("tenants")
      .select("id, name").in("id", [...new Set(camps.map(c => c.tenant_id))]);
    const nameOf = new Map((tenants || []).map(t => [t.id, t.name]));

    const byCampaign = new Map<string, Record<string, number>>();
    for (const r of recips || []) {
      const m = byCampaign.get(r.campaign_id) || {};
      m[r.status] = (m[r.status] || 0) + 1;
      byCampaign.set(r.campaign_id, m);
    }

    res.json({
      campaigns: camps.map(c => {
        const counts = byCampaign.get(c.id) || {};
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        return {
          ...c, tenant_name: nameOf.get(c.tenant_id) || null,
          total, counts,
          // Running with nothing left to dial usually means it finished but
          // was never marked completed.
          idle: c.status === "running" &&
                !((counts.pending || 0) + (counts.queued || 0) + (counts.in_progress || 0)),
        };
      }),
    });
  } catch (err: any) {
    console.error("[admin campaigns]", err.message);
    res.status(500).json({ error: "Internal error" });
  }
});

/** Recent agent edits across tenants — what changed, when, and by whom. */
app.get("/api/admin/agent-versions", verifySuperAdmin, async (_req, res) => {
  try {
    const { data, error } = await sb.from("voice_profile_versions")
      .select("id, profile_id, tenant_id, snapshot, changed_by, created_at")
      .order("created_at", { ascending: false }).limit(100);
    if (error) return res.status(500).json({ error: error.message });

    const ids = [...new Set((data || []).map(v => v.tenant_id).filter(Boolean))];
    const { data: tenants } = ids.length
      ? await sb.from("tenants").select("id, name").in("id", ids)
      : { data: [] as any[] };
    const nameOf = new Map((tenants || []).map(t => [t.id, t.name]));

    // Only the fields that describe how the agent behaves. The snapshot holds
    // the whole row, and shipping all of it to a browser would include
    // columns an operator has no reason to read.
    const KEEP = ["business_name", "display_name", "profile_sku", "services",
                  "appointment_types", "open_time", "close_time", "routing_mode"];
    res.json({
      versions: (data || []).map(v => {
        const snap = (v.snapshot || {}) as Record<string, any>;
        const summary: Record<string, any> = {};
        for (const k of KEEP) if (k in snap) summary[k] = snap[k];
        return {
          id: v.id, profile_id: v.profile_id, tenant_id: v.tenant_id,
          tenant_name: nameOf.get(v.tenant_id) || null,
          changed_by: v.changed_by, created_at: v.created_at, previous: summary,
        };
      }),
    });
  } catch (err: any) {
    console.error("[admin agent-versions]", err.message);
    res.status(500).json({ error: "Internal error" });
  }
});

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
// ── PRICING CATALOGUE ─────────────────────────────────────────
// ONE source of truth for what things cost, read from platform_config so a
// super admin changes prices in one place.
//
// This exists because pricing had drifted into three different answers: the
// billing page hardcoded Starter/Growth/Scale, the landing page and the
// voice agent quoted AI Telecaller / CRM Seat / Number, and platform_config
// held prices nothing read. A caller was quoted Rs 5,999 "unlimited" and
// then shown metered tiers that did not include that plan. Hardcoding in
// three places guarantees they drift again, so nothing may hardcode a price
// after this — read it here.
//
// Structure: ONE base plan (tier or pay-as-you-go) plus per-unit add-ons.
// That reconciles both models rather than picking a winner — the tiers are
// bundles of the same units the landing page sells individually.
app.get("/api/platform/pricing", async (_req, res) => {
  try {
    const cfg = await getPlatformConfig();
    const paise = (k: string, d: number) => Number(cfg[k] ?? d) || d;

    const tiers = ["plan_tier_1", "plan_tier_2", "plan_tier_3"]
      .map(k => { try { return cfg[k] ? JSON.parse(cfg[k]) : null; } catch { return null; } })
      .filter(Boolean);

    // Concurrency can never exceed what the trunk physically carries, whatever
    // a tier claims. Clamped here so a mis-typed config cannot sell capacity
    // that does not exist — Scale previously advertised 15 against 10 channels.
    const maxCh = paise("trunk_max_channels", 10);
    for (const t of tiers) t.concurrent = Math.min(Number(t.concurrent) || 1, maxCh);

    res.json({
      currency: "INR",
      per_minute_paise: paise("price_per_minute_paise", 350),
      overage_paise:    paise("plan_overage_paise", 1500),
      addons: {
        ai_telecaller_paise: paise("price_ai_telecaller_paise", 599900),
        crm_seat_paise:      paise("price_human_crm_seat_paise", 199900),
        number_paise:        paise("price_jio_did_paise", 199900),
      },
      tiers,
      trunk_max_channels: maxCh,
      gst_extra: true,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "pricing unavailable" });
  }
});

// ── OUTBOUND CAMPAIGNS ────────────────────────────────────────
// Upload a list, dial it on our own trunk, hand answered calls to the AI.
//
// COMPLIANCE IS NOT OPTIONAL HERE. Outbound commercial calling in India is
// governed by TCCCPR: DLT registration, consent records, DND scrubbing and
// a 9am-9pm window. The penalty for getting it wrong is the TRUNK being
// disconnected, which would take the inbound business down with it. So:
//   - recipients land as 'pending', never 'queued' — the dispatcher scrubs
//     DND before any number is dialled
//   - consent is recorded per recipient at upload, not assumed
//   - campaigns carry a calling window and the dispatcher enforces it
// The scrubDnd() in jobs/outbound-dispatcher.ts is still a STUB. Wire a
// real provider before dialling a list you did not collect consent for.
app.post("/api/campaigns", verifyJWT, async (req, res) => {
  const tenantId = (req as any).tenantId;
  const { name, voice_profile_id, window_start, window_end, max_concurrent } = req.body as any;
  if (!name) return res.status(400).json({ error: "name required" });

  const { data, error } = await sb.from("campaigns").insert({
    tenant_id: tenantId, name,
    voice_profile_id: voice_profile_id || null,
    status: "draft",
    window_start: window_start ?? 9,      // IST. 9-21 is the legal window.
    window_end:   window_end   ?? 21,
    max_concurrent: Math.min(Number(max_concurrent) || 3, 5),
  }).select("*").single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/api/campaigns/:id/recipients", verifyJWT, async (req, res) => {
  const tenantId = (req as any).tenantId;
  const { rows, csv, consented } = req.body as
    { rows?: any[]; csv?: string; consented?: boolean };

  const { data: camp } = await sb.from("campaigns")
    .select("id, tenant_id, total_contacts").eq("id", req.params.id).single();
  if (!camp || camp.tenant_id !== tenantId) return res.status(404).json({ error: "Campaign not found" });

  // Accept either parsed rows or raw CSV text pasted from Excel.
  let parsed: any[] = Array.isArray(rows) ? rows : [];
  if (!parsed.length && typeof csv === "string" && csv.trim()) {
    const lines = csv.trim().split(/\r?\n/);
    const head  = lines[0].split(/[,\t;]/).map(h => h.trim().toLowerCase());
    const iPhone = head.findIndex(h => /phone|mobile|number|contact/.test(h));
    const iName  = head.findIndex(h => /name/.test(h));
    // No recognisable header means the first line is data, not headers —
    // otherwise a headerless paste silently loses its first contact.
    const start = iPhone === -1 ? 0 : 1;
    for (let i = start; i < lines.length; i++) {
      const c = lines[i].split(/[,\t;]/);
      parsed.push({
        phone: (iPhone === -1 ? c[0] : c[iPhone]) || "",
        name:  (iName  === -1 ? c[1] : c[iName])  || "",
      });
    }
  }

  const seen = new Set<string>();
  const clean = parsed.map(r => {
    const digits = String(r.phone ?? "").replace(/\D/g, "").slice(-10);
    return { digits, name: String(r.name ?? "").trim() };
  }).filter(r => {
    // Indian mobiles start 6-9. Anything else is a landline, a typo or a
    // stray spreadsheet column, and dialling it wastes trunk capacity.
    if (!/^[6-9]\d{9}$/.test(r.digits)) return false;
    if (seen.has(r.digits)) return false;      // duplicates burn channels twice
    seen.add(r.digits);
    return true;
  });

  if (!clean.length) return res.status(400).json({ error: "No valid 10-digit mobile numbers found" });

  const { error } = await sb.from("outbound_recipients").insert(
    clean.map(r => ({
      campaign_id: req.params.id,
      tenant_id:   tenantId,
      phone:       r.digits,
      name:        r.name || null,
      // 'pending' — NOT 'queued'. The dispatcher must scrub DND first.
      status:      "pending",
      consented:   consented === true,
    }))
  );
  if (error) return res.status(500).json({ error: error.message });

  await sb.from("campaigns")
    .update({ total_contacts: (camp.total_contacts || 0) + clean.length })
    .eq("id", req.params.id);

  res.json({
    ok: true,
    accepted: clean.length,
    rejected: parsed.length - clean.length,
    note: "Recipients are pending DND scrubbing and will not be dialled until it runs.",
  });
});

// ── KYC REVIEW ────────────────────────────────────────────────
// The carrier requires customer verification before a number is handed
// over, so this is what the assign step should wait on. Documents live in
// the PRIVATE kyc-documents bucket; only metadata and the decision are
// stored in the table.
//
// Approval is deliberately server-side on the service key. RLS lets a
// tenant insert and read its own rows but NOT write the review columns, so
// a tenant cannot approve itself.
app.get("/api/admin/kyc", verifySuperAdmin, async (req, res) => {
  const status = String(req.query.status || "pending");
  const { data, error } = await sb.from("kyc_documents")
    .select("id, tenant_id, doc_type, file_name, mime_type, size_bytes, status, storage_path, created_at")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });

  const ids = [...new Set((data || []).map(d => d.tenant_id))];
  const { data: tenants } = ids.length
    ? await sb.from("tenants").select("id, name").in("id", ids)
    : { data: [] as any[] };
  const byId = new Map((tenants || []).map(t => [t.id, t.name]));

  // Short-lived signed URLs — the bucket is private and must stay that way.
  // Generated per request rather than stored, so a leaked response expires.
  const docs = await Promise.all((data || []).map(async d => {
    const { data: signed } = await sb.storage.from("kyc-documents")
      .createSignedUrl(d.storage_path, 300);
    return { ...d, tenant_name: byId.get(d.tenant_id) || null, url: signed?.signedUrl || null };
  }));
  res.json({ count: docs.length, documents: docs });
});

app.post("/api/admin/kyc/:id/review", verifySuperAdmin, async (req, res) => {
  const adminId = (req as any).user.id;
  const { decision, note } = req.body as { decision?: string; note?: string };
  if (!["approved", "rejected"].includes(String(decision))) {
    return res.status(400).json({ error: "decision must be approved or rejected" });
  }
  const { data, error } = await sb.from("kyc_documents").update({
    status: decision, review_note: note || null,
    reviewed_by: adminId, reviewed_at: new Date().toISOString(),
  }).eq("id", req.params.id).select("id, tenant_id, status").single();
  if (error) return res.status(500).json({ error: error.message });

  await sb.from("admin_audit_log").insert({
    admin_user_id: adminId, action: `kyc_${decision}`,
    target_tenant_id: data?.tenant_id, details: { kyc_id: req.params.id, note: note || null },
  }).then(r => r.error && console.error("[kyc review] audit:", r.error.message));

  // Approving KYC is what unlocks a WhatsApp number for this business. Until
  // now approval only flipped a status and nothing followed it, so the number
  // a client is promised depended on somebody remembering to start it.
  //
  // The row is opened against the tenant's ASSIGNED DID, because the promise
  // is that the business's phone number and its WhatsApp are the same number.
  // It lands in awaiting_signup: Embedded Signup is the client's step, not
  // ours, and inventing an active binding here would mean sending as a number
  // Meta has not verified.
  if (decision === "approved" && data?.tenant_id) {
    const { data: did } = await sb.from("dids")
      .select("id, number").eq("tenant_id", data.tenant_id)
      .eq("status", "assigned").limit(1).maybeSingle();

    const { error: provErr } = await sb.from("tenant_whatsapp").upsert({
      tenant_id:    data.tenant_id,
      did_id:       did?.id || null,
      phone_number: did?.number || null,
      status:       "awaiting_signup",
      updated_at:   new Date().toISOString(),
    }, { onConflict: "tenant_id" });

    if (provErr) {
      // Not fatal to the KYC decision, which has already been recorded — but
      // it must be visible, or the client waits for a number nobody started.
      console.error("[kyc review] whatsapp provisioning row failed:", provErr.message);
    } else {
      console.log(`[kyc review] tenant ${data.tenant_id} -> awaiting_signup` +
        (did?.number ? ` for DID ${did.number}` : " (no DID assigned yet)"));
    }
  }

  res.json({ ok: true, ...data });
});

// Plan edits, audited. The Pricing panel wrote plans via Supabase directly,
// so price changes had no paper trail — and price history is the first
// thing a billing dispute asks for.
app.post("/api/admin/plans/:id", verifySuperAdmin, async (req: any, res) => {
  // The REAL columns, read from the live table rather than guessed — half
  // of my first list did not exist and every save would have 400'd.
  const ALLOWED = ["display_name", "price_monthly_paise", "price_annual_paise",
                   "minutes_per_month", "max_voice_profiles", "max_phone_numbers",
                   "max_concurrent_calls", "outbound_campaigns", "api_access",
                   "recording_days"];
  const patch: Record<string, any> = {};
  for (const k of ALLOWED) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
  if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to change" });
  const { error } = await sb.from("plans").update(patch).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "plan_updated",
    details: { plan_id: req.params.id, ...patch },
  }).then(r => r.error && console.error("[plans] audit:", r.error.message));
  res.json({ ok: true });
});

// ── FINAL DEFERRED FIVE (audit tier 4) ────────────────────────

// SIP trunk CRUD. Credential rotation was SQL-only; the panel could only
// toggle Jio/Vi. Passwords are AES-256-GCM under a key derived from
// INTERNAL_SECRET, and are NEVER returned — the list shows metadata only.
function encTrunkPassword(plain: string): string {
  const key = crypto.createHash("sha256").update("trunk:" + (process.env.INTERNAL_SECRET || "")).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

app.get("/api/admin/trunks", verifySuperAdmin, async (_req, res) => {
  const { data, error } = await sb.from("sip_trunks")
    .select("id, provider, display_name, host, port, username, transport, priority, status")
    .order("priority");
  if (error) return res.status(500).json({ error: error.message });
  res.json({ trunks: data || [] });
});

app.post("/api/admin/trunks", verifySuperAdmin, async (req: any, res) => {
  const { provider, display_name, host, port, username, password, transport, priority } = req.body || {};
  if (!provider || !display_name || !host || !username || !password) {
    return res.status(400).json({ error: "provider, display_name, host, username, password required" });
  }
  const { data, error } = await sb.from("sip_trunks").insert({
    provider, display_name, host, port: port || 5060, username,
    password_enc: encTrunkPassword(String(password)),
    transport: transport || "udp", priority: priority || 2, status: "standby",
  }).select("id").single();
  if (error) return res.status(500).json({ error: error.message });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "trunk_created",
    details: { trunk_id: data.id, provider, host },
  }).then(r => r.error && console.error("[trunk] audit:", r.error.message));
  res.json({ ok: true, id: data.id,
    note: "Created as standby — FreeSWITCH gateway config is separate; activate after testing" });
});

app.post("/api/admin/trunks/:id", verifySuperAdmin, async (req: any, res) => {
  const patch: Record<string, any> = {};
  for (const k of ["host", "port", "username", "transport", "priority", "status", "display_name"]) {
    if (req.body?.[k] !== undefined) patch[k] = req.body[k];
  }
  if (req.body?.password) patch.password_enc = encTrunkPassword(String(req.body.password));
  if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to change" });
  const { error } = await sb.from("sip_trunks").update(patch).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "trunk_updated",
    details: { trunk_id: req.params.id,
      fields: Object.keys(patch).map(k => k === "password_enc" ? "password" : k) },
  }).then(r => r.error && console.error("[trunk] audit:", r.error.message));
  res.json({ ok: true });
});

// API keys behind the operator's own JWT — the internal routes exist but
// needed the server-to-server secret, which an operator does not have.
app.get("/api/admin/api-keys/:tenantId", verifySuperAdmin, async (req, res) => {
  const { data, error } = await sb.from("api_keys")
    .select("id, name, prefix, scopes, created_at, expires_at, revoked_at")
    .eq("tenant_id", req.params.tenantId).order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ keys: data || [] });
});

app.post("/api/admin/api-keys/:id/revoke", verifySuperAdmin, async (req: any, res) => {
  const { data, error } = await sb.from("api_keys")
    .update({ revoked_at: new Date().toISOString(), revoked_by: req.user.id })
    .eq("id", req.params.id).select("id, tenant_id, name").single();
  if (error || !data) return res.status(404).json({ error: "Not found" });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "api_key_revoked",
    target_tenant_id: data.tenant_id, details: { key_id: data.id, name: data.name },
  }).then(r => r.error && console.error("[keys] audit:", r.error.message));
  res.json({ ok: true });
});

// Annotate an STT eval sample — truth is what a human heard, entities are
// what the metric actually scores.
app.post("/api/admin/voice-lab/samples/:id/annotate", verifySuperAdmin, async (req: any, res) => {
  const { truth_transcript, entities, noise_band } = req.body || {};
  const patch: Record<string, any> = { annotated: true };
  if (truth_transcript !== undefined) patch.truth_transcript = String(truth_transcript).slice(0, 4000);
  if (entities && typeof entities === "object") patch.entities = entities;
  if (["quiet", "street", "speakerphone", "unknown"].includes(noise_band)) patch.noise_band = noise_band;
  const { error } = await sb.from("stt_eval_samples").update(patch).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Demo tenants: a sandbox with a stamped expiry the scheduler enforces,
// instead of the "Hey Nikki" demo rows that sat as ordinary tenants for
// two months because nothing knew they were disposable.
app.post("/api/admin/demo-tenants", verifySuperAdmin, async (req: any, res) => {
  const name = String(req.body?.name || "").trim();
  const days = Math.min(Math.max(Number(req.body?.days) || 7, 1), 30);
  if (name.length < 3) return res.status(400).json({ error: "name required (3+ chars)" });
  const { data, error } = await sb.from("tenants").insert({
    name: `[demo] ${name}`, plan: "trial", status: "trial",
    is_demo: true,
    demo_expires_at: new Date(Date.now() + days * 86400_000).toISOString(),
  }).select("id, demo_expires_at").single();
  if (error) return res.status(500).json({ error: error.message });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "demo_tenant_created",
    target_tenant_id: data.id, details: { name, days },
  }).then(r => r.error && console.error("[demo] audit:", r.error.message));
  res.json({ ok: true, tenant_id: data.id, expires_at: data.demo_expires_at });
});

// ── STAFF ACL / LIFECYCLE / TRIAGE (audit tier 3) ─────────────

// Staff and roles. tenant_users had no mutation route anywhere — the panel
// that super_admin protects could not grant or revoke super_admin. Roles
// come from the schema CHECK (owner|member|support|super_admin), and
// is_super_admin() reads exactly this table, so a change here takes effect
// on the target's next request.
app.get("/api/admin/staff/:tenantId", verifySuperAdmin, async (req, res) => {
  const { data, error } = await sb.from("tenant_users")
    .select("id, user_id, role, phone, display_name, created_at")
    .eq("tenant_id", req.params.tenantId).order("created_at");
  if (error) return res.status(500).json({ error: error.message });
  res.json({ staff: data || [] });
});

app.post("/api/admin/staff/:rowId/role", verifySuperAdmin, async (req: any, res) => {
  const role = String(req.body?.role || "");
  if (!["owner", "member", "support", "super_admin"].includes(role)) {
    return res.status(400).json({ error: "role must be owner|member|support|super_admin" });
  }
  // The one guard that matters: you cannot demote YOURSELF out of
  // super_admin. A panel that can lock out its last operator is a panel
  // that will, eventually, at the worst moment.
  const { data: row } = await sb.from("tenant_users")
    .select("user_id, role, tenant_id").eq("id", req.params.rowId).maybeSingle();
  if (!row) return res.status(404).json({ error: "Staff row not found" });
  if (row.user_id === req.user.id && row.role === "super_admin" && role !== "super_admin") {
    return res.status(400).json({ error: "You cannot remove your own super_admin role" });
  }
  const { error } = await sb.from("tenant_users")
    .update({ role }).eq("id", req.params.rowId);
  if (error) return res.status(500).json({ error: error.message });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "role_changed",
    target_tenant_id: row.tenant_id,
    details: { row_id: req.params.rowId, from: row.role, to: role },
  }).then(r => r.error && console.error("[acl] audit:", r.error.message));
  res.json({ ok: true });
});

// Delete a tenant, with the fan-out done in the right order: numbers back
// to inventory FIRST (a deleted tenant must never keep a DID routed at it),
// then the dependent rows cascade with the tenant row.
app.delete("/api/admin/tenants/:id", verifySuperAdmin, async (req: any, res) => {
  const tid = req.params.id;
  const { data: t } = await sb.from("tenants").select("name, status").eq("id", tid).maybeSingle();
  if (!t) return res.status(404).json({ error: "Tenant not found" });
  // Refuse to delete a tenant that is live. Cancel first — deletion is for
  // dead signups and expired demos, not an alternative to offboarding.
  if (!["trial", "suspended", "cancelled"].includes(String(t.status))) {
    return res.status(409).json({ error: `Tenant is '${t.status}' — cancel or suspend before deleting` });
  }
  const { data: dids } = await sb.from("dids")
    .select("number").eq("tenant_id", tid);
  await sb.from("dids").update({
    tenant_id: null, voice_profile_id: null, status: "available",
  }).eq("tenant_id", tid);
  const { error } = await sb.from("tenants").delete().eq("id", tid);
  if (error) return res.status(500).json({ error: error.message });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "tenant_deleted",
    details: { tenant_id: tid, name: t.name, released_dids: (dids || []).map((d: any) => d.number) },
  }).then(r => r.error && console.error("[delete] audit:", r.error.message));
  res.json({ ok: true, released: (dids || []).length });
});

// WhatsApp per-message triage: the Operations panel counted failures;
// nobody could see WHICH message failed or send it again.
app.get("/api/admin/wa-log", verifySuperAdmin, async (req, res) => {
  let q = sb.from("wa_dispatch_log")
    .select("id, tenant_id, message_type, to_number, message_body, status, created_at:sent_at")
    .order("sent_at", { ascending: false }).limit(100);
  if (req.query.status) q = q.eq("status", String(req.query.status));
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ rows: data || [] });
});

app.post("/api/admin/wa-log/:id/resend", verifySuperAdmin, async (req: any, res) => {
  const { data: row } = await sb.from("wa_dispatch_log")
    .select("tenant_id, voice_profile_id, message_type, to_number, message_body")
    .eq("id", req.params.id).maybeSingle();
  if (!row) return res.status(404).json({ error: "Message not found" });
  const ok = await sendWhatsApp(row.to_number, row.message_body, row.tenant_id,
    row.voice_profile_id, row.message_type);
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "wa_resent",
    target_tenant_id: row.tenant_id, details: { to: row.to_number, type: row.message_type, ok },
  }).then(r => r.error && console.error("[wa resend] audit:", r.error.message));
  res.json({ ok });
});

// Re-score a tenant's call quality: deleting the rows is the whole action —
// the 15-minute scheduler job re-analyses anything unscored.
app.post("/api/admin/quality/rescore/:tenantId", verifySuperAdmin, async (req: any, res) => {
  const { data, error } = await sb.from("call_quality")
    .delete().eq("tenant_id", req.params.tenantId).select("id");
  if (error) return res.status(500).json({ error: error.message });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "quality_rescore",
    target_tenant_id: req.params.tenantId, details: { cleared: (data || []).length },
  }).then(r => r.error && console.error("[rescore] audit:", r.error.message));
  res.json({ ok: true, cleared: (data || []).length,
             note: "The scheduler re-scores within 15 minutes" });
});

// ── AGENT REPAIR + INCIDENT LEVERS (audit tier 2) ─────────────
// The audit's next-to-hurt findings: an operator could SEE a broken agent
// in Call Quality and do nothing about it, could see a no-consent campaign
// and not pause it, and could not rotate a leaked capture token.

// Cross-tenant restore. Same whitelist discipline as the tenant route —
// id/tenant_id/timestamps identify the row, did_number is the phone line and
// status is the kill switch; restoring an old prompt must move none of them.
app.post("/api/admin/voice-profiles/:id/restore/:versionId", verifySuperAdmin, async (req: any, res) => {
  const { data: v } = await sb.from("voice_profile_versions")
    .select("snapshot, tenant_id").eq("id", req.params.versionId)
    .eq("profile_id", req.params.id).maybeSingle();
  if (!v) return res.status(404).json({ error: "Version not found" });
  const snap = v.snapshot as Record<string, any>;
  const IMMUTABLE = new Set(["id", "tenant_id", "created_at", "updated_at", "did_number", "status"]);
  const patch: Record<string, any> = {};
  for (const [k, val] of Object.entries(snap)) if (!IMMUTABLE.has(k)) patch[k] = val;
  const { error } = await sb.from("voice_profiles")
    .update(patch).eq("id", req.params.id).select("id").single();
  if (error) return res.status(400).json({ error: error.message });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "agent_restored",
    target_tenant_id: v.tenant_id,
    details: { profile_id: req.params.id, version_id: req.params.versionId },
  }).then(r => r.error && console.error("[restore] audit:", r.error.message));
  res.json({ ok: true });
});

// Knowledge moderation: the entry making an agent answer wrongly, findable
// and removable without SQL.
app.get("/api/admin/knowledge/:tenantId", verifySuperAdmin, async (req, res) => {
  const { data, error } = await sb.from("knowledge_base")
    .select("id, content, source_type, source_name, created_at")
    .eq("tenant_id", req.params.tenantId)
    .order("created_at", { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ rows: data || [] });
});

app.delete("/api/admin/knowledge/:rowId", verifySuperAdmin, async (req: any, res) => {
  const { data, error } = await sb.from("knowledge_base")
    .delete().eq("id", req.params.rowId).select("tenant_id, content").single();
  if (error) return res.status(500).json({ error: error.message });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "knowledge_deleted",
    target_tenant_id: data.tenant_id, details: { content: String(data.content).slice(0, 120) },
  }).then(r => r.error && console.error("[kb] audit:", r.error.message));
  res.json({ ok: true });
});

// Per-DID routing after assignment — switching an existing number between
// ai/human/hybrid/ivr previously required SQL.
app.post("/api/admin/dids/:number/routing", verifySuperAdmin, async (req: any, res) => {
  const number = String(req.params.number || "").replace(/\D/g, "").slice(-10);
  const { routing_mode, fallback_message } = req.body || {};
  const patch: Record<string, any> = {};
  if (routing_mode !== undefined) {
    if (!["ai", "human", "hybrid", "ivr"].includes(String(routing_mode))) {
      return res.status(400).json({ error: "routing_mode must be ai|human|hybrid|ivr" });
    }
    patch.routing_mode = routing_mode;
  }
  if (fallback_message !== undefined) patch.fallback_message = String(fallback_message).slice(0, 400) || null;
  if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to change" });
  const { data, error } = await sb.from("dids")
    .update(patch).eq("number", number).select("tenant_id").single();
  if (error) return res.status(500).json({ error: error.message });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "did_routing_changed",
    target_tenant_id: data.tenant_id, details: { number, ...patch },
  }).then(r => r.error && console.error("[routing] audit:", r.error.message));
  res.json({ ok: true });
});

// Campaign pause/resume from the operator's seat. Previously pause lived
// behind verifyInternal, so the only panel lever against a bad campaign
// was suspending the whole tenant.
app.post("/api/admin/campaigns/:id/pause", verifySuperAdmin, async (req: any, res) => {
  const { data, error } = await sb.from("outbound_campaigns")
    .update({ status: "paused" }).eq("id", req.params.id)
    .eq("status", "running").select("tenant_id").maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(409).json({ error: "Campaign is not running" });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "campaign_paused",
    target_tenant_id: data.tenant_id, details: { campaign_id: req.params.id },
  }).then(r => r.error && console.error("[pause] audit:", r.error.message));
  res.json({ ok: true });
});

app.post("/api/admin/campaigns/:id/resume", verifySuperAdmin, async (req: any, res) => {
  const { data, error } = await sb.from("outbound_campaigns")
    .update({ status: "running" }).eq("id", req.params.id)
    .eq("status", "paused").select("tenant_id").maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(409).json({ error: "Campaign is not paused" });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "campaign_resumed",
    target_tenant_id: data.tenant_id, details: { campaign_id: req.params.id },
  }).then(r => r.error && console.error("[resume] audit:", r.error.message));
  res.json({ ok: true });
});

// Rotate a leaked lead-capture token. The old token stops working the
// moment this returns; the response carries the new URL to hand back.
app.post("/api/admin/voice-profiles/:id/rotate-capture-token", verifySuperAdmin, async (req: any, res) => {
  const fresh = crypto.randomBytes(24).toString("hex");
  const { data, error } = await sb.from("voice_profiles")
    .update({ capture_token: fresh }).eq("id", req.params.id)
    .select("tenant_id").single();
  if (error) return res.status(500).json({ error: error.message });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "capture_token_rotated",
    target_tenant_id: data.tenant_id, details: { profile_id: req.params.id },
  }).then(r => r.error && console.error("[token] audit:", r.error.message));
  res.json({ ok: true, capture_url: `${process.env.SELF_URL || "https://api.heynikki.in"}/webhooks/lead-capture/${fresh}` });
});

// ── BILLING / TENANT LEVERS ───────────────────────────────────
// The audit's disqualifying gap: an operator could provision a tenant but
// not touch money — no credit grant, no ledger view, no invoices, no
// refunds. "Where did my minutes go" is the named first support ticket in
// migration 025, and until now the only answer was service-key SQL.
app.get("/api/admin/tenants/:id/ledger", verifySuperAdmin, async (req, res) => {
  const tid = req.params.id;
  const [{ data: ledger }, { data: invoices }, { data: tenant }] = await Promise.all([
    sb.from("credit_ledger")
      .select("delta, reason, balance_after, call_id, created_at")
      .eq("tenant_id", tid).order("created_at", { ascending: false }).limit(200),
    sb.from("invoices")
      .select("id, amount_paise, plan_id, description, status, razorpay_payment_id, created_at")
      .eq("tenant_id", tid).order("created_at", { ascending: false }).limit(100),
    sb.from("tenants")
      .select("name, plan, status, credit_minutes, trial_ends_at, wallet_balance, razorpay_cust_id")
      .eq("id", tid).maybeSingle(),
  ]);
  res.json({ tenant, ledger: ledger || [], invoices: invoices || [] });
});

app.post("/api/admin/tenants/:id/credits", verifySuperAdmin, async (req: any, res) => {
  const delta = Number(req.body?.delta);
  const reason = String(req.body?.reason || "").trim();
  // Bounded and reasoned: a grant without a reason is unexplainable in the
  // ledger a customer will one day read, and a fat-fingered 10000 should
  // fail loudly rather than mint a year of free minutes.
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1000) {
    return res.status(400).json({ error: "delta must be a non-zero number of minutes, |delta| <= 1000" });
  }
  if (reason.length < 5) {
    return res.status(400).json({ error: "A reason of at least 5 characters is required — it appears in the customer's ledger" });
  }
  const { data, error } = await sb.from("credit_ledger").insert({
    tenant_id: req.params.id, delta, reason: `admin: ${reason}`,
  }).select("balance_after").single();
  if (error) return res.status(500).json({ error: error.message });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "credits_adjusted",
    target_tenant_id: req.params.id, details: { delta, reason },
  }).then(r => r.error && console.error("[credits] audit:", r.error.message));
  res.json({ ok: true, balance_after: data.balance_after });
});

app.post("/api/admin/invoices/:id/refund", verifySuperAdmin, async (req: any, res) => {
  // Marks the RECORD refunded — the actual Razorpay refund is done in their
  // dashboard, which holds the money. Pretending this endpoint moves rupees
  // would be worse than the gap it closes.
  const { data, error } = await sb.from("invoices")
    .update({ status: "refunded" }).eq("id", req.params.id)
    .select("id, tenant_id, amount_paise").single();
  if (error) return res.status(500).json({ error: error.message });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "invoice_refunded",
    target_tenant_id: data.tenant_id, details: { invoice_id: data.id, amount_paise: data.amount_paise },
  }).then(r => r.error && console.error("[refund] audit:", r.error.message));
  res.json({ ok: true });
});

app.post("/api/admin/tenants/:id/trial", verifySuperAdmin, async (req: any, res) => {
  const days = Number(req.body?.days);
  if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 90) {
    return res.status(400).json({ error: "days must be non-zero, |days| <= 90" });
  }
  const { data: t } = await sb.from("tenants")
    .select("trial_ends_at").eq("id", req.params.id).maybeSingle();
  if (!t) return res.status(404).json({ error: "Tenant not found" });
  // Extends from whichever is LATER — now, or the current end. Extending an
  // already-expired trial from its old date would grant less than promised.
  const base = Math.max(Date.now(), new Date(t.trial_ends_at || Date.now()).getTime());
  const next = new Date(base + days * 86400_000).toISOString();
  const { error } = await sb.from("tenants")
    .update({ trial_ends_at: next }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "trial_adjusted",
    target_tenant_id: req.params.id, details: { days, new_end: next },
  }).then(r => r.error && console.error("[trial] audit:", r.error.message));
  res.json({ ok: true, trial_ends_at: next });
});

app.post("/api/admin/tenants/:id/cancel", verifySuperAdmin, async (req: any, res) => {
  const { error } = await sb.from("tenants")
    .update({ status: "cancelled" }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "tenant_cancelled",
    target_tenant_id: req.params.id, details: { reason: req.body?.reason || null },
  }).then(r => r.error && console.error("[cancel] audit:", r.error.message));
  res.json({ ok: true });
});

app.post("/api/admin/tenants/:id/owner-phone", verifySuperAdmin, async (req: any, res) => {
  // The exact riya incident: a mistyped signup phone had no fix but SQL.
  const digits = String(req.body?.phone || "").replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(digits)) {
    return res.status(400).json({ error: "Need a 10-digit Indian mobile starting 6-9" });
  }
  const { data, error } = await sb.from("tenant_users")
    .update({ phone: digits }).eq("tenant_id", req.params.id)
    .in("role", ["owner", "super_admin"])
    .select("id");
  if (error) return res.status(500).json({ error: error.message });
  if (!data?.length) return res.status(404).json({ error: "No owner row for this tenant" });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "owner_phone_fixed",
    target_tenant_id: req.params.id, details: { phone: digits },
  }).then(r => r.error && console.error("[phone] audit:", r.error.message));
  res.json({ ok: true, phone: digits });
});

// ── VOICE LAB ─────────────────────────────────────────────────
// Per-tenant pronunciation lexicons and the noisy-Telugu entity test set.
app.get("/api/admin/voice-lab", verifySuperAdmin, async (_req, res) => {
  const [{ data: profiles }, { data: samples }] = await Promise.all([
    sb.from("voice_profiles")
      .select("id, tenant_id, business_name, pronunciation_map")
      .order("business_name"),
    sb.from("stt_eval_samples")
      .select("id, noise_band, annotated, created_at")
      .order("created_at", { ascending: false }).limit(200),
  ]);
  const tenantIds = [...new Set((profiles || []).map((p: any) => p.tenant_id))];
  const { data: tenants } = tenantIds.length
    ? await sb.from("tenants").select("id, name").in("id", tenantIds)
    : { data: [] as any[] };
  const nameOf = new Map((tenants || []).map((t: any) => [t.id, t.name]));
  res.json({
    profiles: (profiles || []).map((p: any) => ({
      ...p, tenant_name: nameOf.get(p.tenant_id) || null,
    })),
    samples: {
      total: (samples || []).length,
      annotated: (samples || []).filter((x: any) => x.annotated).length,
      recent: (samples || []).slice(0, 20),
    },
  });
});

// The map is written whole, not patched: a lexicon is small (tens of
// entries) and merge semantics on a jsonb of pronunciations invite the
// stale-entry bug where a deleted word keeps being applied forever.
app.post("/api/admin/voice-lab/:profileId/pronunciations", verifySuperAdmin, async (req: any, res) => {
  const map = req.body?.pronunciation_map;
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    return res.status(400).json({ error: "pronunciation_map must be an object of written -> spoken" });
  }
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (typeof v === "string" && k.trim() && v.trim() && k.length <= 120 && v.length <= 200) {
      clean[k.trim()] = v.trim();
    }
  }
  const { error } = await sb.from("voice_profiles")
    .update({ pronunciation_map: clean }).eq("id", req.params.profileId);
  if (error) return res.status(500).json({ error: error.message });
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "pronunciations_updated",
    details: { profile_id: req.params.profileId, entries: Object.keys(clean).length },
  }).then(r => r.error && console.error("[voice-lab] audit:", r.error.message));
  res.json({ ok: true, entries: Object.keys(clean).length });
});

// Capture a real call into the test set. Copies nothing — the recording is
// already in R2; this records WHICH calls are part of the ruler.
app.post("/api/admin/voice-lab/samples", verifySuperAdmin, async (req: any, res) => {
  const { call_id, noise_band } = req.body || {};
  if (!call_id) return res.status(400).json({ error: "call_id required" });
  const { data: call } = await sb.from("calls")
    .select("id, tenant_id, r2_object_key, transcript").eq("id", call_id).maybeSingle();
  if (!call) return res.status(404).json({ error: "Call not found" });
  if (!call.r2_object_key) return res.status(400).json({ error: "Call has no recording" });
  const machine = Array.isArray(call.transcript)
    ? call.transcript.filter((t: any) => t.role === "user").map((t: any) => t.content).join(" ")
    : null;
  const { data, error } = await sb.from("stt_eval_samples").insert({
    call_id: call.id, tenant_id: call.tenant_id, r2_object_key: call.r2_object_key,
    machine_transcript: machine,
    noise_band: ["quiet", "street", "speakerphone"].includes(noise_band) ? noise_band : "unknown",
  }).select("id").single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, sample_id: data.id });
});

// ── ONBOARDING INTERVIEW ──────────────────────────────────────
// Ring a new customer so Nikki can ask what their business does and fill
// their setup from the answers. The most reliable way to finish onboarding
// is to stop asking someone to type.
app.post("/api/admin/onboarding-call/:tenantId", verifySuperAdmin, async (req: any, res) => {
  const tenantId = req.params.tenantId;

  const { data: owner } = await sb.from("tenant_users")
    .select("phone, display_name").eq("tenant_id", tenantId)
    .not("phone", "is", null).order("role")
    .not("phone", "is", null).limit(1).maybeSingle();
  if (!owner?.phone) {
    return res.status(400).json({
      error: "No owner phone on file. It is collected at signup; this tenant predates that.",
    });
  }

  // Dialled FROM a number we own. Any assigned DID works — the pipeline uses
  // it only to resolve the tenant's profile, and presenting a number the
  // customer already knows is better than an unfamiliar one.
  const { data: did } = await sb.from("dids")
    .select("number").eq("tenant_id", tenantId).eq("status", "assigned").limit(1).maybeSingle();
  const { data: anyDid } = did ? { data: did } : await sb.from("dids")
    .select("number").eq("status", "available").limit(1).maybeSingle();
  const cli = (did || anyDid)?.number;
  if (!cli) return res.status(400).json({ error: "No number available to call from" });

  try {
    const uuid = await fsl.originateOnboarding(owner.phone, cli, tenantId);
    await sb.from("admin_audit_log").insert({
      admin_user_id: req.user.id, action: "onboarding_call",
      target_tenant_id: tenantId, details: { to: owner.phone, from: cli, fs_uuid: uuid },
    }).then(r => r.error && console.error("[onboarding call] audit:", r.error.message));
    res.json({ ok: true, calling: owner.phone, from: cli, fs_uuid: uuid });
  } catch (e: any) {
    // NO_ANSWER and USER_BUSY are ordinary outcomes for a call to a person,
    // not faults — say so plainly rather than returning a 500.
    res.status(200).json({ ok: false, reason: e.message });
  }
});

// ── WHATSAPP PROVISIONING ─────────────────────────────────────
// What each tenant's WhatsApp number is, and how far through onboarding it
// got. Without this the state lives only in somebody's memory of which
// client has finished Embedded Signup.
app.get("/api/admin/whatsapp-numbers", verifySuperAdmin, async (_req, res) => {
  const { data, error } = await sb.from("tenant_whatsapp")
    .select("id, tenant_id, did_id, phone_number, waba_id, phone_number_id, " +
            "display_name, status, review_note, verified_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const tenantIds = [...new Set((data || []).map((r: any) => r.tenant_id))];
  const { data: tenants } = tenantIds.length
    ? await sb.from("tenants").select("id, name").in("id", tenantIds)
    : { data: [] as any[] };
  const nameOf = new Map((tenants || []).map((t: any) => [t.id, t.name]));

  res.json({
    numbers: (data || []).map((r: any) => ({ ...r, tenant_name: nameOf.get(r.tenant_id) || null })),
    platform_fallback: process.env.META_WA_PHONE_NUMBER_ID || null,
  });
});

// Bind the identifiers Embedded Signup returns. Manual today because the
// Tech Provider application is still pending; when the callback exists it
// writes the same two fields, so nothing downstream changes.
app.post("/api/admin/whatsapp-numbers/:tenantId/bind", verifySuperAdmin, async (req: any, res) => {
  const { waba_id, phone_number_id, display_name, phone_number } = req.body || {};
  if (!waba_id || !phone_number_id) {
    return res.status(400).json({ error: "waba_id and phone_number_id are required" });
  }
  // Verified against Meta before it is stored. A typo here does not fail
  // loudly — it sends every one of that tenant's messages as somebody else's
  // number, or silently as nobody's.
  const token   = process.env.META_WA_TOKEN || "";
  const version = process.env.META_WA_API_VERSION || "v21.0";
  let verified: any = null;
  try {
    const r = await fetch(
      `https://graph.facebook.com/${version}/${encodeURIComponent(String(phone_number_id))}` +
      `?fields=display_phone_number,verified_name,quality_rating`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    const body: any = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(400).json({ error: `Meta rejected phone_number_id: ${body?.error?.message || r.status}` });
    verified = body;
  } catch (e: any) {
    return res.status(502).json({ error: `Could not reach Meta to verify: ${e.message}` });
  }

  const { data, error } = await sb.from("tenant_whatsapp").upsert({
    tenant_id:       req.params.tenantId,
    waba_id:         String(waba_id),
    phone_number_id: String(phone_number_id),
    phone_number:    phone_number || verified?.display_phone_number || null,
    display_name:    display_name || verified?.verified_name || null,
    status:          "active",
    verified_at:     new Date().toISOString(),
    updated_at:      new Date().toISOString(),
  }, { onConflict: "tenant_id" }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  _waSenderCache.delete(req.params.tenantId);
  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "whatsapp_bind",
    target_tenant_id: req.params.tenantId,
    details: { phone_number_id, waba_id, verified_name: verified?.verified_name },
  }).then(r => r.error && console.error("[wa bind] audit:", r.error.message));

  res.json({ ok: true, number: data, meta: verified });
});

// ── DID INVENTORY + ASSIGNMENT ────────────────────────────────
// The bottleneck to onboarding a second client. Everything else existed:
// signup creates the tenant via the handle_new_user trigger, the setup page
// collects business details, routing reads dids -> voice_profiles. But there
// was no way to hand a number to a tenant except editing rows by hand.
//
// dids.status drives routing: get_voice_profile only matches status='assigned'
// (voice-pipeline). A number in any other state simply never reaches a caller.
app.get("/api/admin/dids", verifySuperAdmin, async (_req, res) => {
  const { data, error } = await sb.from("dids")
    .select("number, status, provider, tenant_id, voice_profile_id, routing_mode, created_at")
    .order("number");
  if (error) return res.status(500).json({ error: error.message });

  const tenantIds = [...new Set((data || []).map(d => d.tenant_id).filter(Boolean))];
  const { data: tenants } = tenantIds.length
    ? await sb.from("tenants").select("id, name, status").in("id", tenantIds)
    : { data: [] as any[] };
  const byId = new Map((tenants || []).map(t => [t.id, t]));

  res.json({
    total:     (data || []).length,
    available: (data || []).filter(d => d.status !== "assigned").length,
    dids: (data || []).map(d => ({ ...d, tenant: byId.get(d.tenant_id) || null })),
  });
});

// Put a number INTO inventory. Assign and release existed, but nothing could
// add a number, so every DID Jio provisions had to be inserted into the table
// by hand in Supabase — which is why inventory holds two numbers, both on the
// same tenant, and a new client cannot be given a number at all.
app.post("/api/admin/dids", verifySuperAdmin, async (req: any, res) => {
  const raw    = String(req.body?.number || "");
  const number = raw.replace(/\D/g, "").slice(-10);
  // Indian mobile and landline DIDs both arrive as 10 digits here; the
  // dialplan normalises +91/0 prefixes before matching, so storing anything
  // longer would simply never be found by a call.
  if (number.length !== 10) {
    return res.status(400).json({ error: `Need a 10-digit number, got "${raw}"` });
  }

  const { data: existing } = await sb.from("dids")
    .select("number, status, tenant_id").eq("number", number).maybeSingle();
  if (existing) {
    return res.status(409).json({
      error: `${number} is already in inventory (${existing.status})`,
      did: existing,
    });
  }

  const cfg  = await getPlatformConfig();
  const cost = Number(req.body?.monthly_cost_paise);

  const { data, error } = await sb.from("dids").insert({
    number,
    display_number:     req.body?.display_number || number,
    provider:           req.body?.provider || "jio",
    // Defaults to what a DID is sold for, from the one pricing catalogue, so
    // a number added today does not disagree with the pricing page.
    monthly_cost_paise: Number.isFinite(cost) && cost >= 0
      ? cost : parseInt(cfg["price_jio_did_paise"] || "199900"),
    status:             "available",
    routing_mode:       "ai",
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await sb.from("admin_audit_log").insert({
    admin_user_id: req.user.id, action: "did_added",
    details: { number, provider: data.provider },
  }).then(r => r.error && console.error("[did add] audit:", r.error.message));

  res.json({ ok: true, did: data });
});

app.post("/api/admin/dids/:number/assign", verifySuperAdmin, async (req, res) => {
  const number   = String(req.params.number || "").replace(/\D/g, "").slice(-10);
  const adminId  = (req as any).user.id;
  const { tenant_id, business_name, profile_sku, routing_mode } = req.body as {
    tenant_id?: string; business_name?: string;
    profile_sku?: string; routing_mode?: string;
  };
  if (!number || number.length !== 10) return res.status(400).json({ error: "10-digit number required" });
  if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

  // The plan says how many numbers this tenant may hold, and until now nothing
  // read it — Starter includes one number and there was no code path that
  // would have stopped a tenth being assigned.
  const { data: planT } = await sb.from("tenants").select("plan").eq("id", tenant_id).maybeSingle();
  const numLimits = await planLimitsFor(planT?.plan);
  const { count: heldNow } = await sb.from("dids")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant_id).eq("status", "assigned");
  // Re-assigning a number the tenant already holds is not a new number.
  const { data: alreadyMine } = await sb.from("dids")
    .select("id").eq("number", number).eq("tenant_id", tenant_id).maybeSingle();
  if (!alreadyMine && (heldNow || 0) >= numLimits.numbers) {
    return res.status(409).json({
      error: `${numLimits.tier} includes ${numLimits.numbers} number(s); this tenant already holds ${heldNow}. Upgrade the plan first.`,
      held: heldNow, limit: numLimits.numbers, tier: numLimits.tier,
    });
  }

  const { data: did, error: didErr } = await sb.from("dids")
    .select("number, status, tenant_id").like("number", `%${number}`).single();
  if (didErr || !did) return res.status(404).json({ error: `DID ${number} not in inventory` });
  // Reassigning a live number silently would send another tenant's callers to
  // the wrong business, so it has to be released first.
  if (did.status === "assigned" && did.tenant_id && did.tenant_id !== tenant_id) {
    return res.status(409).json({ error: "Already assigned to another tenant — release it first" });
  }

  const { data: tenant } = await sb.from("tenants").select("id, name").eq("id", tenant_id).single();
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  // Reuse this tenant's profile if it has one; a second profile would leave
  // the older one orphaned and routing would pick whichever the join returned.
  let { data: profile } = await sb.from("voice_profiles")
    .select("id").eq("tenant_id", tenant_id).limit(1).maybeSingle();

  if (!profile) {
    const { data: created, error: vpErr } = await sb.from("voice_profiles").insert({
      tenant_id,
      business_name: business_name || tenant.name,
      display_name:  "నిక్కి",
      profile_sku:   profile_sku || "standard",
      did_number:    number,
      routing_mode:  routing_mode || "ai",
      status:        "active",
    }).select("id").single();
    if (vpErr) return res.status(500).json({ error: `profile: ${vpErr.message}` });
    profile = created;
  }

  const { error: updErr } = await sb.from("dids").update({
    tenant_id,
    voice_profile_id: profile!.id,
    routing_mode:     routing_mode || "ai",
    status:           "assigned",     // required — routing ignores any other state
  }).eq("number", did.number);
  if (updErr) return res.status(500).json({ error: `did: ${updErr.message}` });

  // Mirror the assignment onto the profile. did_number was written ONLY when
  // this endpoint created a profile, so any tenant that already had one — every
  // tenant that used the brochure flow or the setup wizard — kept whatever was
  // in that column before. For the live customer that was their own mobile,
  // typed into a field that used to be labelled "Your Business Phone Number",
  // which is why their dashboard showed a personal number where their HeyNikki
  // number belongs.
  const { error: mirrorErr } = await sb.from("voice_profiles")
    .update({ did_number: did.number }).eq("id", profile!.id);
  if (mirrorErr) console.error("[assign_did] profile mirror failed:", mirrorErr.message);

  await sb.from("admin_audit_log").insert({
    admin_user_id: adminId, action: "assign_did",
    target_tenant_id: tenant_id, details: { number, voice_profile_id: profile!.id },
  }).then(r => r.error && console.error("[assign_did] audit:", r.error.message));

  res.json({ ok: true, number: did.number, tenant: tenant.name, voice_profile_id: profile!.id });
});

app.post("/api/admin/dids/:number/release", verifySuperAdmin, async (req, res) => {
  const number  = String(req.params.number || "").replace(/\D/g, "").slice(-10);
  const adminId = (req as any).user.id;
  const { data: did } = await sb.from("dids").select("number, tenant_id").like("number", `%${number}`).single();
  if (!did) return res.status(404).json({ error: "DID not found" });

  const { error } = await sb.from("dids")
    .update({ tenant_id: null, voice_profile_id: null, status: "available" })
    .eq("number", did.number);
  if (error) return res.status(500).json({ error: error.message });

  // Take it off the profile too, or the business keeps showing a number that
  // no longer routes to them.
  if (did.tenant_id) {
    await sb.from("voice_profiles")
      .update({ did_number: null })
      .eq("tenant_id", did.tenant_id).eq("did_number", did.number);
  }

  await sb.from("admin_audit_log").insert({
    admin_user_id: adminId, action: "release_did",
    target_tenant_id: did.tenant_id, details: { number: did.number },
  }).then(r => r.error && console.error("[release_did] audit:", r.error.message));

  res.json({ ok: true, number: did.number });
});

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
      from:    `Nikki <noreply@${process.env.FROM_EMAIL || "heynikki.in"}>`,
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
import { geminiGenerate } from "./gemini.js";
import { mountAssetRoutes } from "./assets";
import { mountCampaignImport } from "./campaign-import";

// MUST be mounted BEFORE outbound.ts. Express matches routes in registration
// order, and outbound.ts also defines /api/campaigns/:id/start and /pause —
// behind verifyInternal, which a browser can never satisfy because that
// secret must not ship to one. Registering these first means the dashboard
// reaches the JWT, tenant-scoped versions; the internal copies stay
// available to anything server-side that still calls them.
mountCampaignImport(app, sb, verifyJWT, getTenantId, audit);

mountOutboundRoutes(app, sb, verifyInternal, audit);
mountAssetRoutes(app, verifyJWT, getTenantId);

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
    const { caller_number, did_number, fs_uuid, direction, campaign_id } = req.body;

    // An outbound campaign call reaches this endpoint too — it reuses the
    // inbound handler deliberately, so it inherits profile lookup, disclosure
    // and lead scoring. What it must NOT inherit is the assumption that the
    // caller rang us.
    const isOutbound = String(direction || "inbound").toLowerCase() === "outbound";

    // Jio sends Indian numbers in inconsistent formats on the same
    // trunk — 08633502031 and +918633502031 have both been observed for
    // the same DID. The dialplan normalises before calling us, but this
    // endpoint is also reachable from the pipeline and from tests, so
    // normalise here too rather than trust the caller.
    //
    // For caller_number this is not cosmetic: without it the same human
    // becomes two separate leads depending on how the network happened
    // to format their number that day, and their call history splits.
    const toTenDigit = (n: unknown): string => {
      const s = String(n ?? "").replace(/[^\d+]/g, "");
      const m = s.match(/^(?:\+?91|0)?(\d{10})$/);
      return m ? m[1] : s;
    };

    const didDigits = toTenDigit(did_number);
    const caller    = toTenDigit(caller_number);

    // Match the stored DID on its last 10 digits so a row saved as
    // "+918633502031" still matches a call that arrived as "08633502031".
    const { data: did } = await sb.from("dids")
      .select("tenant_id, voice_profile_id, routing_mode, missed_call_guard, fallback_message")
      .like("number", `%${didDigits}`)
      .single();

    if (!did) {
      console.warn(`[FS Inbound] Unknown DID: ${did_number} (normalised: ${didDigits})`);
      return res.status(404).json({ error: "DID not found" });
    }

    // ── Can this tenant afford the call? ────────────────────────
    // Checked before the row is created, so an exhausted trial does not
    // accumulate call records it was never going to be billed for.
    //
    // A paying subscription overrides the balance: credits are the trial
    // and the prepaid top-up, not a cap on customers who pay monthly.
    // Getting this backwards would cut off the accounts that matter most.
    const { data: tenantRow } = await sb.from("tenants")
      .select("credit_minutes, status, plan").eq("id", did.tenant_id).maybeSingle();
    // An ALLOWLIST of the tiers that actually pay, not a denylist of the ones
    // that do not. Written as a denylist first, and plan='demo' — which two
    // tenants still carry — fell through it as "paid" and would have dialled
    // for free forever. A new plan name should default to needing credits,
    // never to unlimited.
    const PAID_PLANS = ["starter", "growth", "scale"];
    const onPaidPlan = PAID_PLANS.includes(String(tenantRow?.plan || "").toLowerCase());

    // Concurrency is the cap with real cost behind it: the trunk carries ten
    // channels in total, so one tenant on Scale can occupy all of them.
    const limits = await planLimitsFor(tenantRow?.plan);
    const { count: liveNow } = await sb.from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", did.tenant_id).eq("status", "active");
    if ((liveNow || 0) >= limits.concurrent) {
      console.warn(`[FS Inbound] tenant ${did.tenant_id} at concurrency cap ` +
        `(${liveNow}/${limits.concurrent}, ${limits.tier}) — refusing`);
      return res.json({
        ok: false, reason: "concurrency_limit", routing_mode: "reject",
        message: `All ${limits.concurrent} lines on this plan are busy.`,
      });
    }
    if (!onPaidPlan && Number(tenantRow?.credit_minutes ?? 0) <= 0) {
      console.warn(`[FS Inbound] tenant ${did.tenant_id} out of credits — refusing`);
      return res.json({
        ok: false, reason: "no_credits",
        routing_mode: "reject",
        message: "This number's free minutes have run out.",
      });
    }

    const { data: callRow } = await sb.from("calls").insert({
      tenant_id:        did.tenant_id,
      voice_profile_id: did.voice_profile_id,
      caller_number:    caller,
      direction:        isOutbound ? "outbound" : "inbound",
      status:           "active",
      livekit_room_id:  fs_uuid,   // reuse field for FS UUID
    }).select().single();

    // Resolve the ring group for human/hybrid routing.
    let ringGroup = "";
    // routing_mode answers "what happens when someone rings this number".
    // On an outbound leg the DID is our own CLI, not a number anybody dialled,
    // so a tenant on 'human' would have had the customer we just called
    // transferred to their own reception the moment the call connected.
    // Computed for EVERY inbound leg, not just human/hybrid. It is only
    // auto-dialled at call start when routing_mode is 'human' — but a caller
    // on a plain 'ai' number who says "put me through to someone" needs it
    // too, and for them it was always empty, so Nikki could only ever answer
    // that nobody is available. A number is not a routing decision.
    if (!isOutbound) {
      // tenant_users.phone did not exist until migration 020, so this query
      // returned 42703, agents came back null, and the ring group was an
      // empty string — a DID on 'human' or 'hybrid' rang nobody, silently.
      // The error is checked now rather than discarded, because an empty ring
      // group and a failed query look identical from here and only one of
      // them is worth waking someone up about.
      const { data: agents, error: agentErr } = await sb.from("tenant_users")
        .select("phone")
        .eq("tenant_id", did.tenant_id)
        .not("phone", "is", null);
      if (agentErr) {
        console.error("[routing] ring group lookup failed:", agentErr.message);
      } else if (!agents?.length) {
        console.warn(`[routing] tenant ${did.tenant_id} is on '${did.routing_mode}' but no seat has a phone number — nobody will ring`);
      }
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
    // An outbound leg is always the AI: routing_mode describes how calls TO
    // this number are answered. Otherwise a 'human' DID with nobody to ring
    // falls back to AI rather than to silence, and 'ivr' passes through — it
    // degrades to AI further down if no menu is configured.
    const effectiveMode = isOutbound
      ? "ai"
      : (did.routing_mode === "human" && !ringGroup ? "ai" : (did.routing_mode || "ai"));

    if (did.routing_mode === "human" && !ringGroup) {
      console.warn(`[FS Inbound] DID ${did_number} is human-routed but no agent has a phone — falling back to AI`);
    }

    // A spoken menu, when the tenant has configured one. Fetched here rather
    // than in the pipeline so the pipeline keeps one source for everything it
    // needs about a call — it already gets routing_mode and ring_group from
    // this response.
    let ivr: any = null;
    if (effectiveMode === "ivr") {
      const { data: menu } = await sb.from("ivr_menus")
        .select("greeting, options, enabled")
        .eq("tenant_id", did.tenant_id).eq("enabled", true)
        .or(`did_number.eq.${didDigits},did_number.is.null`)
        // A menu for this specific number beats the tenant-wide one.
        .order("did_number", { ascending: false, nullsFirst: false })
        .limit(1).maybeSingle();
      if (menu?.options?.length) ivr = menu;
      else console.warn(`[routing] DID ${didDigits} is on 'ivr' with no menu configured — using AI`);
    }

    res.json({
      ok: true,
      ivr,
      call_id:            callRow?.id,
      tenant_id:          did.tenant_id,
      voice_profile_id:   did.voice_profile_id,
      routing_mode:       effectiveMode,
      ring_group:         ringGroup,
      direction:          isOutbound ? "outbound" : "inbound",
      campaign_id:        campaign_id || null,
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

// ── Calendar invite (.ics) ────────────────────────────────────
/**
 * A calendar file the caller can open from WhatsApp.
 *
 * Google Calendar sync needs an OAuth app, a consent screen and a token per
 * business. An .ics needs none of that and lands in Google Calendar, Apple
 * Calendar and Outlook alike, which covers the customer side of "put it in
 * my calendar" completely. Two-way sync into the BUSINESS's calendar still
 * wants OAuth; this is the half that works today.
 *
 * The link is opened from a WhatsApp message, so it cannot require a login.
 * It is signed instead: an HMAC of the appointment id, truncated to 16 hex
 * characters. Without it the id alone would let anyone walk the table and
 * read customers' names, numbers and appointment times.
 */
function inviteToken(appointmentId: string): string {
  return crypto.createHmac("sha256", INTERNAL_SECRET)
    .update(`ics:${appointmentId}`).digest("hex").slice(0, 16);
}

/** RFC 5545 escaping: backslash first, or it double-escapes what follows. */
const icsEscape = (v: string) =>
  String(v ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;")
                 .replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

app.get("/api/appointments/:id/invite.ics", async (req, res) => {
  try {
    const { id } = req.params;
    const token = String(req.query.t || "");
    // timingSafeEqual throws on a length mismatch, so compare lengths first.
    const expected = inviteToken(id);
    const ok = token.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (!ok) return res.status(404).json({ error: "Not found" });

    const { data: a } = await sb.from("appointments")
      .select("id, slot_date, slot_time, service, caller_name, tenant_id, status")
      .eq("id", id).maybeSingle();
    if (!a) return res.status(404).json({ error: "Not found" });
    // An appointment with no date is the one thing that cannot become a
    // calendar entry. Extraction fills these in at call end; before that ran,
    // every row looked like this.
    if (!a.slot_date) return res.status(409).json({ error: "This appointment has no date yet" });

    const { data: t } = await sb.from("tenants")
      .select("business_name").eq("id", a.tenant_id).maybeSingle();
    const business = t?.business_name || "Your appointment";

    // Slots are stored as local IST wall-clock. Emitting them as UTC would
    // shift every appointment 5.5 hours; TZID keeps 3pm meaning 3pm.
    const time = (a.slot_time || "10:00").slice(0, 5).replace(":", "");
    const date = String(a.slot_date).replace(/-/g, "");
    const start = `${date}T${time}00`;
    const endH = String(Math.min(23, parseInt(time.slice(0, 2), 10) + 1)).padStart(2, "0");
    const end = `${date}T${endH}${time.slice(2)}00`;
    const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//HeyNikki//Appointment//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${a.id}@heynikki.in`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Kolkata:${start}`,
      `DTEND;TZID=Asia/Kolkata:${end}`,
      `SUMMARY:${icsEscape(a.service ? `${a.service} — ${business}` : business)}`,
      `DESCRIPTION:${icsEscape(`Booked with ${business}${a.caller_name ? ` for ${a.caller_name}` : ""}.`)}`,
      "STATUS:CONFIRMED",
      "BEGIN:VALARM",
      "TRIGGER:-PT2H",
      "ACTION:DISPLAY",
      "DESCRIPTION:Reminder",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n") + "\r\n";   // RFC 5545 requires CRLF throughout

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="appointment.ics"`);
    res.send(ics);
  } catch (err: any) {
    console.error("[ics]", err.message);
    res.status(500).json({ error: "Internal error" });
  }
});

/** The signed link to hand to a caller. Used by the confirmation message. */
app.get("/api/appointments/:id/invite-link", verifyJWT, async (req: any, res) => {
  const tenantId = await getTenantId(req.user.id);
  if (!tenantId) return res.status(403).json({ error: "No tenant" });
  const { data: a } = await sb.from("appointments")
    .select("id").eq("id", req.params.id).eq("tenant_id", tenantId).maybeSingle();
  if (!a) return res.status(404).json({ error: "Not found" });
  const base = process.env.PUBLIC_API_URL || "https://api.heynikki.in";
  res.json({ url: `${base}/api/appointments/${a.id}/invite.ics?t=${inviteToken(a.id)}` });
});

// ── Call recording playback ───────────────────────────────────
// The bucket is private, so a recording has no permanent URL. This checks
// the caller owns the call and then asks the pipeline — which has boto3 —
// for a link that expires in fifteen minutes.
//
// A public bucket would have been less code and is what the upload path
// originally assumed. It also means every customer's recorded phone call
// sits at an unauthenticated URL that never expires, written into the
// database and rendered into dashboards. Not a trade worth making.
app.get("/api/calls/:id/recording", verifyJWT, apiLimiter, async (req: any, res) => {
  try {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) return res.status(403).json({ error: "No tenant" });

    const { data: call } = await sb.from("calls")
      .select("id, tenant_id, r2_object_key, recording_url")
      .eq("id", req.params.id).eq("tenant_id", tenantId).maybeSingle();
    // Same 404 whether the call does not exist or belongs to someone else —
    // distinguishing them tells a stranger which call ids are real.
    if (!call) return res.status(404).json({ error: "Call not found" });

    // Older rows, and deployments with a public bucket, carry a plain URL.
    if (call.recording_url) return res.json({ url: call.recording_url, expires_in: 0 });
    if (!call.r2_object_key) return res.status(404).json({ error: "No recording for this call" });

    const r = await fetch(`${PIPELINE_URL}/api/v1/recording/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": INTERNAL_SECRET },
      body: JSON.stringify({ object_key: call.r2_object_key, expires_in: 900 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      console.error("[recording] presign failed:", r.status, await r.text().catch(() => ""));
      return res.status(502).json({ error: "Could not prepare the recording" });
    }
    res.json(await r.json());
  } catch (err: any) {
    console.error("[recording]", err.message);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Meta WhatsApp Cloud API webhook ───────────────────────────
// Callback URL to register in Meta: https://api.heynikki.in/webhooks/whatsapp
//
// Meta verifies a callback URL by GETting it once with hub.challenge and
// expects the challenge echoed back as a bare body. If this route is missing
// or the token does not match, "Verify and Save" in the App Dashboard fails
// with no useful detail, so both failure paths are logged here.
app.get("/webhooks/whatsapp", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (!META_WA_VERIFY_TOKEN) {
    console.error("[WhatsApp] META_WA_VERIFY_TOKEN is unset — cannot verify subscription");
    return res.sendStatus(500);
  }
  if (mode === "subscribe" && token === META_WA_VERIFY_TOKEN) {
    console.log("[WhatsApp] webhook verified by Meta");
    return res.status(200).send(String(challenge ?? ""));
  }
  console.error("[WhatsApp] verification rejected — token mismatch");
  return res.sendStatus(403);
});

app.post("/webhooks/whatsapp", async (req, res) => {
  const rawBody = req.body as Buffer;
  const sig     = (req.headers["x-hub-signature-256"] as string) || "";

  // Fail closed. Without the app secret there is no way to tell a real Meta
  // delivery from anyone who has learned the URL, and this endpoint is public.
  if (!META_WA_APP_SECRET) {
    console.error("[WhatsApp] META_WA_APP_SECRET is unset — rejecting delivery");
    return res.sendStatus(500);
  }

  const expected = "sha256=" + crypto
    .createHmac("sha256", META_WA_APP_SECRET)
    .update(rawBody)
    .digest("hex");

  // timingSafeEqual throws on length mismatch, so compare lengths first.
  const ok = sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) {
    console.error("[WhatsApp] invalid X-Hub-Signature-256");
    return res.sendStatus(401);
  }

  // Meta retries any delivery it does not get a prompt 200 for, and a retry
  // storm is worse than a dropped log line — acknowledge first, then process.
  res.sendStatus(200);

  try {
    const body = JSON.parse(rawBody.toString());
    for (const entry of body.entry || []) {
      for (const ch of entry.changes || []) {
        const v = ch.value || {};
        for (const m of v.messages || []) {
          const text = m.text?.body ?? `[${m.type}]`;
          const from = String(m.from || "").replace(/\D/g, "").slice(-10);
          console.log(`[WhatsApp] in from ${from}: ${String(text).slice(0, 200)}`);
          if (!from) continue;

          // WHOSE reply is this? Meta tells us the sender and the number it
          // arrived on, not which of our businesses it belongs to. Match the
          // sender against the leads and calls we already hold: a person
          // replying to a HeyNikki message has, by definition, been in touch
          // with exactly the business that messaged them. Most recent wins
          // when a number somehow reaches two.
          const [{ data: lead }, { data: call }] = await Promise.all([
            sb.from("leads").select("id, tenant_id")
              .like("phone", `%${from}`).order("updated_at", { ascending: false })
              .limit(1).maybeSingle(),
            sb.from("calls").select("tenant_id")
              .like("caller_number", `%${from}`).order("created_at", { ascending: false })
              .limit(1).maybeSingle(),
          ]);
          const tenantId = lead?.tenant_id || call?.tenant_id;
          if (!tenantId) {
            // Nobody we have ever spoken to. Storing it against a guessed
            // tenant would put a stranger's message in someone's inbox.
            console.warn(`[WhatsApp] reply from unknown number ${from} — not stored`);
            continue;
          }

          const { error: inErr } = await sb.from("wa_inbound").insert({
            tenant_id: tenantId,
            lead_id:   lead?.id || null,
            from_number: from,
            body:      String(text).slice(0, 4000),
            msg_type:  m.type || "text",
            provider_msg_id: m.id || null,
            received_at: m.timestamp
              ? new Date(Number(m.timestamp) * 1000).toISOString()
              : new Date().toISOString(),
          });
          // A duplicate is Meta redelivering, which is expected and fine.
          if (inErr && !/duplicate key/i.test(inErr.message)) {
            console.error("[WhatsApp] inbound store failed:", inErr.message);
          }

          // A reply is a live lead. Nudge the lead's recency so it surfaces
          // in the follow-up worklist instead of ageing out silently.
          if (lead?.id) {
            await sb.from("leads")
              .update({ last_contacted_at: new Date().toISOString() })
              .eq("id", lead.id);
          }
        }
        for (const st of v.statuses || []) {
          console.log(`[WhatsApp] status ${st.id} -> ${st.status}`);
          // Meta reports delivery asynchronously, and until now nothing read
          // it: wa_dispatch_log kept whatever it guessed at send time. A
          // message Meta accepted and then failed to deliver stayed "sent"
          // forever, so the log could not answer the one question it exists
          // to answer. Terminal states only — 'sent' here would overwrite a
          // later 'delivered' depending on webhook ordering.
          if (["delivered", "read", "failed"].includes(st.status) && st.id) {
            const { error: stErr } = await sb.from("wa_dispatch_log")
              .update({ status: st.status })
              .eq("provider_msg_id", st.id);
            if (stErr) console.error("[WhatsApp] status reconcile failed:", stErr.message);
          }
        }
      }
    }
  } catch (err: any) {
    console.error("[WhatsApp] payload parse failed:", err.message);
  }
});

// ── FreeSWITCH hangup webhook ─────────────────────────────────
app.post("/webhooks/freeswitch/hangup", verifyInternal, async (req, res) => {
  try {
    const { fs_uuid, duration, hangup_cause, did_number, caller_number } = req.body;

    // Find call by FS UUID
    // supabase-js RESOLVES {data:null,error} on failure rather than throwing,
    // so the enclosing try/catch never sees a DB problem. Without checking
    // error, a failed query is indistinguishable from "no such call" and the
    // completion update below is silently skipped.
    const { data: callRow, error: selErr } = await sb.from("calls")
      .select("id, tenant_id, voice_profile_id, created_at, direction")
      .eq("livekit_room_id", fs_uuid)
      .single();
    if (selErr) console.error("[FS Hangup] call lookup failed:", selErr.message);

    // billsec from the dialplan's api_reporting_hook has now arrived as 0 or
    // absent three separate times (raw-body Buffer, api_hangup_hook firing
    // before CDR, and whatever is doing it today), and every time the symptom
    // was the same: real conversations stored as status=missed with
    // duration_seconds=0, and the missed-call automation firing on answered
    // calls. Stop trusting it as the only source. The calls row is inserted by
    // the inbound webhook at call start, so wall-clock since created_at is a
    // sound fallback — accurate to the second or two of setup time, and always
    // better than 0. Only used when billsec is missing or non-positive.
    let secs = parseInt(duration || "0");
    if (!Number.isFinite(secs) || secs <= 0) {
      if (callRow?.created_at) {
        secs = Math.max(0, Math.round((Date.now() - new Date(callRow.created_at).getTime()) / 1000));
        console.warn(`[FS Hangup] billsec missing for ${fs_uuid}; derived ${secs}s from created_at`);
      } else {
        secs = 0;
      }
    }

    if (callRow) {
      // Update call status
      const { error: updErr } = await sb.from("calls").update({
        status:           "completed",
        duration_seconds: secs,
        updated_at:       new Date().toISOString(),
      }).eq("id", callRow.id);
      if (updErr) console.error("[FS Hangup] completion update failed:", updErr.message);

      // ── Close the campaign recipient ────────────────────────────
      // The dispatcher sets a recipient to in_progress when the originate
      // succeeds and nothing ever moved it out again. That is not a cosmetic
      // stall: the tick() slot count subtracts in_progress from
      // max_concurrent, so a campaign dialled max_concurrent people and then
      // never dialled again, and the "no work remaining" check counts
      // in_progress as work, so the campaign never reached completed either.
      // The admin operations panel already had a detector for recipients
      // stuck in_progress over a day old — built before the cause was found.
      //
      // Matched on the FS UUID, which the dispatcher stored as call_id. There
      // is no calls.campaign_id column, and this linkage means there needn't
      // be one.
      // Matched on metadata->>fs_uuid, not call_id: call_id is a foreign key
      // to calls.id, and at dial time the dispatcher only has a FreeSWITCH
      // channel UUID and no calls row yet. This is the first point where both
      // exist, so it is also where call_id finally gets a real value.
      const answered = secs >= 5;
      const { data: recip, error: recipErr } = await sb.from("outbound_recipients")
        .update({
          status:  "completed",
          outcome: answered ? "answered" : `no_conversation_${hangup_cause || "unknown"}`,
          call_id: callRow.id,
        })
        .eq("metadata->>fs_uuid", fs_uuid)
        .eq("status", "in_progress")
        .select("id, campaign_id");
      if (recipErr) console.error("[FS Hangup] recipient close failed:", recipErr.message);
      else if (recip?.length) {
        console.log(`[FS Hangup] closed campaign recipient ${recip[0].id} (${answered ? "answered" : "no conversation"})`);
      }

      // ── Spend the minute ────────────────────────────────────────
      // Billed on completion, from the same derived seconds the call row
      // stores, so what a customer is charged and what they see in their
      // call list can never disagree.
      //
      // Rounded UP to the minute: a 10-second wrong number costs a credit.
      // That is how the tiers already describe minutes, and rounding down
      // would let a hundred hangups cost nothing while consuming a hundred
      // real Sarvam and Gemini calls.
      //
      // The unique index on credit_ledger(call_id) is what makes this safe
      // to run twice — FreeSWITCH has delivered a duplicate hangup before,
      // and a second insert is rejected rather than billing the minute
      // again. A conflict here is expected, not an error.
      if (callRow.tenant_id && secs > 0) {
        const minutes = Math.ceil(secs / 60);
        const { error: cErr } = await sb.from("credit_ledger").insert({
          tenant_id: callRow.tenant_id,
          delta:     -minutes,
          reason:    callRow.direction === "outbound" ? "outbound_call" : "inbound_call",
          call_id:   callRow.id,
        });
        if (cErr && !/duplicate key/i.test(cErr.message)) {
          console.error("[credits] deduction failed:", cErr.message);
        } else if (!cErr) {
          console.log(`[credits] tenant ${callRow.tenant_id} -${minutes} min (call ${callRow.id})`);
        }
      }

      // Trigger R2 upload in voice pipeline (async)
      fetch(`${PIPELINE_URL}/api/v1/call/freeswitch/hangup`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Secret": INTERNAL_SECRET },
        body: JSON.stringify({ fs_uuid, call_id: callRow.id, tenant_id: callRow.tenant_id }),
      }).catch(e => console.error("[Pipeline hangup]", e.message));
    }

    // Check if missed call (duration < 5 seconds = unanswered).
    // Uses the derived seconds above, not the raw body field: when billsec
    // arrives empty this test read parseInt(undefined || "0") < 5 as true and
    // overwrote the "completed" status set moments earlier, which is how a
    // two-minute conversation ended up stored as a missed call.
    // Outbound is excluded on purpose. This branch sends the "sorry we missed
    // your call" WhatsApp, and on a campaign leg WE placed the call — telling
    // someone we missed a call they never made is both wrong and the second
    // message they get, since the dispatcher already sends its own no-answer
    // follow-up on the first failed attempt.
    const wasOutbound = callRow?.direction === "outbound";
    if (!wasOutbound && secs < 5 && hangup_cause !== "NORMAL_CLEARING") {
      // The n8n missed-call workflow reads business_name straight into the
      // WhatsApp template's {{1}}, and picks the recipient from
      // whatsapp_number falling back to caller_number. This call site sent
      // neither, so the template variable arrived empty and Meta rejected the
      // send — while /webhooks/freeswitch/missed-call, which fires far less
      // often, had always sent both. Look the profile up the same way it does,
      // including the fallback_wa_enabled opt-out.
      let vp: { business_name?: string; whatsapp_number?: string;
                fallback_wa_enabled?: boolean } | null = null;
      if (callRow?.voice_profile_id) {
        const { data, error: vpErr } = await sb.from("voice_profiles")
          .select("business_name, whatsapp_number, fallback_wa_enabled")
          .eq("id", callRow.voice_profile_id).single();
        if (vpErr) console.error("[FS Hangup] voice profile lookup failed:", vpErr.message);
        vp = data;
      }

      // Sent directly rather than through n8n. The missed-call workflow's
      // send node posts a template to $env.WATI_API_URL, which is empty — so
      // the workflow ran green, reported success, and delivered nothing. This
      // path uses the approved missed_call_followup template on Meta, and
      // writes wa_dispatch_log itself.
      if (vp?.fallback_wa_enabled !== false && callRow?.tenant_id) {
        const msg = `నమస్కారం! మీరు ${vp?.business_name || "మా team"} కి call చేశారు.\n\n` +
          `మేము మీ call miss చేశాము. త్వరలో మేము మీకు call back చేస్తాము. ధన్యవాదాలు! 🙏`;
        await sendWhatsApp(caller_number, msg, callRow.tenant_id,
          callRow.voice_profile_id, "missed_call", callRow.id, undefined,
          vp?.business_name || "our team");
      }

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

    // Match on the last 10 digits, same as /webhooks/freeswitch/inbound.
    // dids.number is stored E.164 ("+918633502031") but the dialplan posts
    // the normalised 10-digit form ("8633502031"), so .eq() could never
    // match and this whole route was a silent no-op. Commit 54f251d fixed
    // the inbound route and missed this one.
    const didDigits10 = String(did_number ?? "").replace(/[^\d+]/g, "")
      .match(/^(?:\+?91|0)?(\d{10})$/)?.[1] ?? String(did_number ?? "");
    const { data: did, error: didErr } = await sb.from("dids")
      .select("tenant_id, voice_profile_id")
      .like("number", `%${didDigits10}`).single();

    if (didErr) console.error("[FS missed-call] DID lookup failed:", didErr.message);
    if (!did) console.warn(`[FS missed-call] no DID row matched ${did_number} — automation skipped`);

    if (did) {
      // Get voice profile for WhatsApp number
      const { data: vp } = await sb.from("voice_profiles")
        .select("business_name, whatsapp_number, fallback_wa_enabled")
        .eq("id", did.voice_profile_id).single();

      // Sent directly rather than through n8n. The missed-call workflow's
      // send node posts a template to $env.WATI_API_URL, which is empty — so
      // the workflow ran green, reported success, and delivered nothing. This
      // path uses the approved missed_call_followup template on Meta, and
      // writes wa_dispatch_log itself.
      if (vp?.fallback_wa_enabled !== false) {
        const msg = `నమస్కారం! మీరు ${vp?.business_name || "మా team"} కి call చేశారు.\n\n` +
          `మేము మీ call miss చేశాము. త్వరలో మేము మీకు call back చేస్తాము. ధన్యవాదాలు! 🙏`;
        await sendWhatsApp(caller_number, msg, did.tenant_id,
          did.voice_profile_id, "missed_call", undefined, undefined,
          vp?.business_name || "our team");
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
      if (lead?.phone) {
        // Sent here rather than through the interested-lead n8n workflow, for
        // the same reason as missed-call: that workflow's send node posts to
        // $env.WATI_API_URL, which is empty. The brochure a caller was
        // promised on the phone has never actually been sent.
        // Resolved by tenant, not by lead.voice_profile_id — leads has no such
        // column. Checked against the live table rather than assumed, because
        // a select on a column that does not exist returns 400 and this whole
        // block would have gone quiet again.
        const { data: vp } = await sb.from("voice_profiles")
          .select("id, business_name").eq("tenant_id", tenantId)
          .eq("status", "active").limit(1).maybeSingle();
        const bn = vp?.business_name || "our team";
        const msg = `నమస్కారం${lead.name ? " " + lead.name : ""}! ${bn} గురించి ` +
          `మీ ఆసక్తికి ధన్యవాదాలు. మీరు అడిగిన details ఇక్కడ ఉన్నాయి. ` +
          `ఏవైనా సందేహాలుంటే ఇక్కడే reply చేయండి. 🙏`;
        await sendWhatsApp(lead.phone, msg, tenantId, vp?.id as string,
          "brochure", undefined, undefined, bn);
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
        // No pitch/loudness — Bulbul V3 400s on both.
        pace: 1.0,
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
// Bind loopback ONLY. This service runs with network_mode: host, so
// app.listen(PORT) alone binds 0.0.0.0 and publishes the API — including the
// admin and ESL-backed routes — on the box's public interface. Every
// consumer is local: FreeSWITCH's dialplan, the voice pipeline, and
// cloudflared, which fronts it publicly and terminates TLS. Override with
// BIND_HOST only if something genuinely off-box must reach it directly.
const BIND_HOST = process.env.BIND_HOST || "127.0.0.1";
app.listen(Number(PORT), BIND_HOST, () => {
  console.log(`Nikki API Server running on port ${PORT}`);
});

export default app;
