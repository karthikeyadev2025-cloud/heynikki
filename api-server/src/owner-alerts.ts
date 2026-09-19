/**
 * Owner alerts — the one endpoint behind the health banner on /dashboard.
 *
 * WHY THIS EXISTS
 * Every condition below already stops the product working, and every one of
 * them was invisible to the person paying for it. A trial whose credits ran
 * out stopped answering calls with no notice anywhere in the app. A tenant
 * with no assigned DID saw a dashboard full of zeros that looked like "quiet
 * week" rather than "you have no phone number". A WhatsApp sender stuck in
 * awaiting_signup meant every confirmation and reminder was silently dropped
 * by Meta. The owner's only signal for any of it was a customer complaining.
 *
 * THE RULE THIS FILE KEEPS
 * An alert nobody can act on is noise. Every alert carries the ONE thing that
 * fixes it and the page that applies it, and nothing is emitted while the
 * situation is normal — a KYC submitted an hour ago is not a problem, and a
 * paid plan at 40% of its minutes is not news.
 *
 * FAILURE POSTURE
 * Every check fails SILENT: a query error logs and emits no alert. The
 * opposite — inventing "you have no phone number" because the dids table was
 * briefly unreadable — would send an owner to support about a fault that does
 * not exist. The endpoint therefore always answers 200 with whatever it could
 * establish, and the banner simply shows less.
 *
 * Also exports the two senders the morning briefing uses. sendEmail() lives
 * in index.ts, which the briefing job cannot import (index.ts binds a port on
 * load), so a small Resend sender lives here instead.
 */
import type { Express, Request, Response, NextFunction } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { minutesGate } from "./usage";

/**
 * What index.ts must hand this module.
 *
 *  sb           the service-key Supabase client (these reads cross RLS —
 *               platform_config is not readable by a tenant's own JWT).
 *  verifyJWT    the Supabase JWT middleware. Auth is the caller's token, so
 *               the tenant is never taken from the request body.
 *  getTenantId  user id -> tenant id, the only scoping this endpoint applies.
 */
export type OwnerAlertsDeps = {
  sb:          SupabaseClient;
  verifyJWT:   (req: Request, res: Response, next: NextFunction) => void;
  getTenantId: (userId: string) => Promise<string | null>;
};

export type OwnerAlert = {
  /** Stable across polls — the browser dismisses by this id, per IST day. */
  id:       string;
  severity: "critical" | "warning" | "info";
  title:    string;
  detail:   string;
  /** The one thing that fixes it. href may be a mailto:. */
  action:   { label: string; href: string };
};

const log = (...a: unknown[]) => console.log("[owner-alerts]", ...a);

/** Today in IST. Every day boundary in this product is +05:30, never UTC. */
function istToday(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * Calls that have been "active" for longer than the scheduler's abandoned-call
 * sweep could possibly have left them.
 *
 * runCloseAbandonedCalls closes anything active for 2 h, every 15 minutes. So
 * a row still active at 3 h means the sweep is not running — and the owner is
 * looking at a dashboard that says a call is in progress when no channel
 * exists. The extra hour past the sweep's own threshold is what stops this
 * firing for the ordinary 15-minute gap between a call passing 2 h and the
 * next tick clearing it.
 */
const STUCK_CALL_MS = 3 * 3600 * 1000;

/** Trunk faults older than this are history — the same six hours the voice
 *  pipeline trusts a fault for (voice-pipeline/main.py). */
const TRUNK_FRESH_MS = 6 * 3600 * 1000;

/** A KYC submission younger than this is just being reviewed, not stuck. */
const KYC_SLOW_MS = 24 * 3600 * 1000;

const SUPPORT = "mailto:support@heynikki.in";

/**
 * Everything wrong with one tenant right now, worst first.
 *
 * Exported so the morning briefing can reuse the same judgement rather than
 * asking the same questions in a second, differently-worded way.
 */
export async function buildOwnerAlerts(
  sb: SupabaseClient, tenantId: string,
): Promise<OwnerAlert[]> {
  const alerts: OwnerAlert[] = [];
  const today = istToday();
  const now = Date.now();

  const [gate, didRes, kycRes, waRes, vpRes, trunkRes, stuckRes, campRes] = await Promise.all([
    // The plan/credit rules live in usage.ts and are not restated here: this
    // is the same call that decides whether a caller gets answered, so the
    // banner and the gate can never disagree.
    minutesGate(sb, tenantId).catch((e: any) => {
      log(`minutes gate failed for ${tenantId}:`, e?.message || e);
      return null;
    }),
    sb.from("dids").select("number").eq("tenant_id", tenantId)
      .eq("status", "assigned").limit(1).maybeSingle(),
    // Newest first: a rejection followed by a fresh upload must read as
    // "pending", not as the old rejection.
    sb.from("kyc_documents").select("status, review_note, created_at")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(10),
    sb.from("tenant_whatsapp").select("status, review_note").eq("tenant_id", tenantId).maybeSingle(),
    sb.from("voice_profiles").select("id, status, services, open_time")
      .eq("tenant_id", tenantId).limit(1).maybeSingle(),
    sb.from("platform_config").select("value").eq("key", "trunk_outbound_state").maybeSingle(),
    // head + count: the rows themselves are never rendered, only the number.
    sb.from("calls").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("status", "active")
      .lt("created_at", new Date(now - STUCK_CALL_MS).toISOString()),
    // Campaigns the DISPATCHER paused, which is the only kind the owner did
    // not choose: it pauses a running campaign whose end date passed with
    // recipients still outstanding. A campaign the owner paused by hand has
    // no end_date test to fail and is left alone.
    sb.from("outbound_campaigns").select("id, name, end_date")
      .eq("tenant_id", tenantId).eq("status", "paused").lt("end_date", today).limit(5),
  ]);

  /* ── Minutes and credits ──────────────────────────────────── */
  if (gate) {
    if (gate.paid) {
      if (!gate.ok) {
        alerts.push({
          id: "minutes_exhausted", severity: "critical",
          title: "Nikki has stopped answering calls",
          detail: `All ${gate.limitMinutes} minutes in your plan are used for this month, ` +
                  `and there is no top-up left. Calls to your number are not being answered.`,
          action: { label: "Add minutes", href: "/billing" },
        });
      } else if (gate.limitMinutes > 0 && gate.usedMinutes >= gate.limitMinutes) {
        // Past the plan and still answering, which means bought top-up credit
        // is paying for it. "30 of 200 minutes left" would be a lie here, and
        // the earlier version of this branch printed exactly that.
        const credits = Math.round(gate.credits);
        alerts.push({
          id: "minutes_on_topup", severity: "warning",
          title: `You are past your plan's ${gate.limitMinutes} minutes`,
          detail: `Calls are being paid for out of your top-up, which has about ${credits} ` +
                  `minute${credits === 1 ? "" : "s"} left. Nikki stops answering when it reaches zero.`,
          action: { label: "Upgrade or top up", href: "/billing" },
        });
      } else if (gate.limitMinutes > 0 && gate.usedMinutes / gate.limitMinutes >= 0.8) {
        const left = gate.limitMinutes - gate.usedMinutes;
        alerts.push({
          id: "minutes_low", severity: "warning",
          title: `${left} minute${left === 1 ? "" : "s"} left this month`,
          detail: `You have used ${gate.usedMinutes} of ${gate.limitMinutes} minutes. ` +
                  `When they run out Nikki stops answering until the month resets.`,
          action: { label: "Upgrade", href: "/billing" },
        });
      }
    } else if (gate.credits <= 0) {
      alerts.push({
        id: "trial_credits_out", severity: "critical",
        title: "Your free minutes have run out",
        detail: "Nikki has stopped answering calls to your number. A plan switches her back on straight away.",
        action: { label: "Choose a plan", href: "/billing" },
      });
    } else if (gate.credits <= 20) {
      alerts.push({
        id: "trial_credits_low", severity: "warning",
        title: `${Math.round(gate.credits)} free minutes left`,
        detail: "Calls stop being answered when this reaches zero.",
        action: { label: "Choose a plan", href: "/billing" },
      });
    }
  }

  /* ── KYC, and the number it gates ─────────────────────────── */
  // The dids row an operator assigned is the only trustworthy answer to "does
  // this business have a HeyNikki number" — voice_profiles.did_number is a
  // field somebody typed.
  const hasDid = !didRes.error && !!didRes.data?.number;
  if (didRes.error) log(`did read failed for ${tenantId}:`, didRes.error.message);

  // A failed read is NOT "no documents". Without this the kyc_missing branch
  // below would tell a verified business to upload its papers again because
  // one query timed out.
  const kycReadable = !kycRes.error;
  const kyc = kycReadable ? (kycRes.data || []) : [];
  if (kycRes.error) log(`kyc read failed for ${tenantId}:`, kycRes.error.message);
  const kycApproved = kyc.some((k: any) => k.status === "approved");
  const kycPending  = kyc.find((k: any) => k.status === "pending");
  const kycRejected = kyc.find((k: any) => k.status === "rejected");

  if (!kycReadable) {
    // Nothing to say either way; every branch below would be a guess.
  } else if (!kycApproved && kycRejected && !kycPending) {
    // Only when nothing newer is in review — otherwise the owner has already
    // done the thing this alert would ask them to do.
    alerts.push({
      id: "kyc_rejected", severity: "critical",
      title: "Your KYC documents were rejected",
      detail: kycRejected.review_note
        ? `Reason: ${String(kycRejected.review_note).slice(0, 200)}`
        : "Upload a clearer copy and we will review it again. Your number cannot be assigned until this passes.",
      action: { label: "Upload again", href: "/setup" },
    });
  } else if (!kycApproved && !kyc.length && !hasDid) {
    // No documents at all AND no number yet. A tenant who somehow already has
    // a number is not blocked by this, so it would be nagging.
    alerts.push({
      id: "kyc_missing", severity: "warning",
      title: "KYC documents not uploaded",
      detail: "TRAI requires a verified business before a phone number can be assigned to it. " +
              "Nikki cannot take calls until yours is.",
      action: { label: "Upload documents", href: "/setup" },
    });
  } else if (!kycApproved && kycPending &&
             now - Date.parse(kycPending.created_at || "") > KYC_SLOW_MS) {
    // Same-day review is normal and not worth an alert. Past a day it has
    // stalled on our side, and chasing us IS the action.
    alerts.push({
      id: "kyc_slow", severity: "info",
      title: "Your KYC is still being reviewed",
      detail: "This is usually done within a working day. If it has been longer, tell us and we will push it through.",
      action: { label: "Email support", href: SUPPORT },
    });
  }

  if (!hasDid && !didRes.error && kycApproved) {
    // KYC passed, so nothing is left for the owner to submit — the number is
    // ours to assign, and chasing us is the only move they have.
    alerts.push({
      id: "no_did", severity: "warning",
      title: "No phone number assigned yet",
      detail: "Your KYC is approved, so your HeyNikki number is next. Until it is assigned there is nothing for callers to ring.",
      action: { label: "Ask us to assign it", href: SUPPORT },
    });
  }

  /* ── WhatsApp sender ──────────────────────────────────────── */
  // Confirmations, reminders and missed-call follow-ups all go out on this.
  // While it is not 'active' they are sent as the platform number or not at
  // all, which is exactly the kind of failure that looks like success.
  if (!waRes.error) {
    // No row at all, with a number already assigned, is the same situation as
    // awaiting_signup: nothing has been started.
    const waStatus = waRes.data?.status || (hasDid ? "awaiting_signup" : null);
    if (waStatus === "pending_verification") {
      // The half-finished case, and the one that looks finished from the
      // outside: the number is on the WABA and the owner never typed in the
      // code Meta sent, so resolveWaSender still falls back to the platform
      // number and nothing ever tells them. A live tenant has been sitting
      // here for weeks.
      alerts.push({
        id: "whatsapp_needs_code", severity: "warning",
        title: "Your WhatsApp number is waiting for its verification code",
        detail: "WhatsApp sent a six-digit code to the number you added. Until it is entered, " +
                "confirmations and reminders still go out from HeyNikki's number rather than yours.",
        action: { label: "Enter the code", href: "/whatsapp" },
      });
    } else if (waStatus === "awaiting_signup" || waStatus === "requested") {
      alerts.push({
        id: "whatsapp_not_live", severity: "warning",
        title: "WhatsApp is not connected to your number yet",
        detail: "Appointment confirmations and reminders go out from HeyNikki's number instead of yours " +
                "until you finish the WhatsApp signup. It takes about two minutes.",
        action: { label: "Connect WhatsApp", href: "/whatsapp" },
      });
    } else if (waStatus === "failed") {
      alerts.push({
        id: "whatsapp_failed", severity: "warning",
        title: "Meta rejected your WhatsApp number",
        detail: waRes.data?.review_note
          ? `Reason: ${String(waRes.data.review_note).slice(0, 200)}`
          : "The verification did not go through. Start it again from the WhatsApp page.",
        action: { label: "Try again", href: "/whatsapp" },
      });
    }
    // 'submitted' is Meta verifying, 'pending_kyc' is the KYC alert above, and
    // 'active' is working — none has an action the owner has not already taken.
  } else {
    log(`tenant_whatsapp read failed for ${tenantId}:`, waRes.error.message);
  }

  /* ── Is there an agent at all? ────────────────────────────── */
  if (!vpRes.error) {
    const vp = vpRes.data as any;
    if (!vp) {
      alerts.push({
        id: "no_voice_profile", severity: "critical",
        title: "Nikki has not been set up",
        detail: "She has no voice, no business hours and nothing to say about your business. " +
                "Calls to your number cannot be answered until she does.",
        action: { label: "Set Nikki up", href: "/setup" },
      });
    } else if (!Array.isArray(vp.services) || vp.services.length === 0) {
      // A profile with no services answers "what do you do?" with nothing, and
      // cannot book an appointment for anything.
      alerts.push({
        id: "no_services", severity: "warning",
        title: "Nikki does not know what you sell",
        detail: "No services are listed, so she cannot tell a caller what you offer or book them in for one.",
        action: { label: "Add your services", href: "/setup" },
      });
    } else if (!vp.open_time) {
      alerts.push({
        id: "no_hours", severity: "warning",
        title: "Your business hours are not set",
        detail: "Nikki cannot tell callers when you are open, and after-hours calls are not counted as after-hours.",
        action: { label: "Set your hours", href: "/setup" },
      });
    }
  } else {
    log(`voice_profiles read failed for ${tenantId}:`, vpRes.error.message);
  }

  /* ── Trunk ────────────────────────────────────────────────── */
  // Platform-wide, written by the outbound dispatcher. Only shown while the
  // fault is FRESH: a six-hour-old "fault:CALL_REJECTED" that nothing has
  // overwritten because no campaign has dialled since is not an outage, and
  // telling every owner on the platform that calls are failing when they are
  // not is the fastest way to make this banner ignored.
  if (!trunkRes.error && trunkRes.data?.value) {
    try {
      const st = JSON.parse(trunkRes.data.value) as { ok?: boolean; at?: string; cause?: string };
      const fresh = Date.now() - Date.parse(st.at || "") < TRUNK_FRESH_MS;
      if (st.ok === false && fresh) {
        alerts.push({
          id: "trunk_down", severity: "critical",
          title: "Outbound calls are failing",
          detail: "Our carrier is refusing outgoing calls, so campaigns and callbacks are queued rather than dialled. " +
                  "Incoming calls to your number are unaffected. Queued numbers dial themselves the moment it clears.",
          action: { label: "See what is queued", href: "/campaigns" },
        });
      }
    } catch { /* unreadable value = no claim either way, so say nothing */ }
  }

  /* ── Calls stuck showing as live ──────────────────────────── */
  if (!stuckRes.error && (stuckRes.count || 0) > 0) {
    const n = stuckRes.count || 0;
    alerts.push({
      id: "calls_stuck_active", severity: "warning",
      title: `${n} call${n === 1 ? "" : "s"} still showing as in progress`,
      detail: `${n === 1 ? "A call" : "These calls"} ended hours ago — the hangup never reached us, so ` +
              `${n === 1 ? "it is" : "they are"} still counted as live. The figures on this page are short by that much.`,
      action: { label: "Review the calls", href: "/calls" },
    });
  } else if (stuckRes.error) {
    log(`stuck-call count failed for ${tenantId}:`, stuckRes.error.message);
  }

  /* ── Campaigns the system paused ──────────────────────────── */
  if (!campRes.error && campRes.data?.length) {
    const c = campRes.data;
    const name = c[0].name ? `"${String(c[0].name).slice(0, 40)}"` : "A campaign";
    alerts.push({
      id: "campaign_paused", severity: "warning",
      title: c.length === 1
        ? `${name} stopped with numbers left to call`
        : `${c.length} campaigns stopped with numbers left to call`,
      detail: `Its end date (${c[0].end_date}) passed before every number had been tried, so dialling stopped. ` +
              `Extend the end date to finish the list.`,
      action: { label: "Extend the dates", href: "/campaigns" },
    });
  } else if (campRes.error) {
    log(`campaign read failed for ${tenantId}:`, campRes.error.message);
  }

  const RANK = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

/**
 * GET /api/owner/alerts
 *
 * Tenant comes from the caller's JWT, never from the request. Always 200 —
 * a banner that renders an error where a warning belongs is worse than a
 * banner that renders nothing.
 *
 * Mount from index.ts with:
 *   mountOwnerAlerts(app, { sb, verifyJWT, getTenantId });
 */
export function mountOwnerAlerts(app: Express, d: OwnerAlertsDeps) {
  const { sb, verifyJWT, getTenantId } = d;

  app.get("/api/owner/alerts", verifyJWT, async (req: any, res) => {
    const tenantId = await getTenantId(req.user.id);
    if (!tenantId) return res.status(403).json({ error: "No tenant" });
    try {
      const alerts = await buildOwnerAlerts(sb, tenantId);
      res.json({ alerts, checked_at: new Date().toISOString() });
    } catch (e: any) {
      console.error("[owner-alerts] build failed:", e?.message || e);
      res.json({ alerts: [], checked_at: new Date().toISOString() });
    }
  });
}

/* ── Senders for the morning briefing ───────────────────────── */

/**
 * One email, via Resend, to one address.
 *
 * index.ts has a sendEmail() with a fixed template list, but importing
 * index.ts from a job would start an HTTP listener, so this is its own tiny
 * copy. Returns false rather than throwing: a briefing that cannot be
 * delivered must not take down the scheduler run that produced it.
 */
export async function sendOwnerEmail(
  to: string, subject: string, html: string,
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `Nikki <noreply@${process.env.FROM_EMAIL || "heynikki.in"}>`,
        to: [to], subject, html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      console.error(`[owner-alerts] resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e: any) {
    console.error("[owner-alerts] email failed:", e?.message || e);
    return false;
  }
}

/**
 * One APPROVED WhatsApp template, to the business owner, logged the way every
 * other dispatch on this system is.
 *
 * A scheduled message is by definition outside the 24-hour service window, so
 * free-form text is accepted by Meta and then dropped — which is why the
 * briefing only ever sends a template. index.ts's sendWhatsApp() picks the
 * template from a fixed message_type map that this module cannot add to, and
 * reusing an existing key there would collide with the evening summary's
 * dedupe. So the template is named explicitly here, and the dispatch row
 * carries its own message_type.
 *
 * Sends as the tenant's own verified number when they have one, exactly as
 * resolveWaSender does, so the owner sees their own business calling them.
 */
/**
 * Which template to send, when a better one is waiting on Meta's review.
 *
 * `daily_business_summary` is APPROVED but Meta reclassified it from UTILITY
 * to MARKETING (the Graph API still shows previous_category: UTILITY), and a
 * marketing template is withheld from anyone opted out of marketing — so the
 * owners most likely to have opted out silently stop getting their own
 * account's numbers. `daily_account_update` was submitted as UTILITY with the
 * promotional closing line removed, and carries the same four parameters, so
 * it is a drop-in the day it clears review.
 *
 * Checked against Meta rather than hard-coded, and cached, so the switch
 * happens on its own without a deploy — and falls back the moment the
 * preferred one is rejected or paused.
 */
const _tplCache = new Map<string, { approved: boolean; at: number }>();
const TPL_TTL_MS = 30 * 60_000;

export async function templateApproved(name: string): Promise<boolean> {
  const hit = _tplCache.get(name);
  if (hit && Date.now() - hit.at < TPL_TTL_MS) return hit.approved;
  const token   = process.env.META_WA_TOKEN || "";
  const version = process.env.META_WA_API_VERSION || "v21.0";
  const waba    = process.env.META_WA_WABA_ID || "1082855697732160";
  if (!token) return false;
  try {
    const r = await fetch(
      `https://graph.facebook.com/${version}/${waba}/message_templates?name=${encodeURIComponent(name)}&limit=5`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000) });
    const j = await r.json() as any;
    const approved = (j?.data || []).some((t: any) => t.name === name && t.status === "APPROVED");
    _tplCache.set(name, { approved, at: Date.now() });
    return approved;
  } catch {
    // Unknown is not "approved": keep sending the template that works.
    return false;
  }
}

export async function sendOwnerTemplate(
  sb: SupabaseClient,
  o: {
    to: string; tenantId: string; voiceProfileId: string | null;
    messageType: string; template: string; lang: string;
    params: string[];
    /** Stored on the dispatch row so support can read what was sent. */
    logBody: string;
  },
): Promise<boolean> {
  const token   = process.env.META_WA_TOKEN || "";
  const version = process.env.META_WA_API_VERSION || "v21.0";
  if (!token) return false;

  let phoneId = process.env.META_WA_PHONE_NUMBER_ID || "";
  const { data: own } = await sb.from("tenant_whatsapp")
    .select("phone_number_id").eq("tenant_id", o.tenantId).eq("status", "active").maybeSingle();
  if (own?.phone_number_id) phoneId = own.phone_number_id;
  if (!phoneId) return false;

  let ok = false, providerId: string | null = null, err = "";
  try {
    const r = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: o.to.replace(/\D/g, ""),
        type: "template",
        template: {
          name: o.template, language: { code: o.lang },
          // Meta caps a body parameter at 60 characters and rejects the whole
          // send over it, so every value is clipped rather than risked.
          components: [{ type: "body", parameters: o.params.map(t => ({ type: "text", text: String(t ?? "").slice(0, 60) })) }],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body: any = await r.json().catch(() => ({}));
    ok = r.ok;
    providerId = body?.messages?.[0]?.id || null;
    if (!ok) err = body?.error?.message || `HTTP ${r.status}`;
  } catch (e: any) {
    err = e?.message || String(e);
  }
  if (!ok) console.error(`[owner-alerts] template ${o.template} -> ${o.to}: ${err}`);

  // Logged whatever happened. The row is what the briefing's own idempotency
  // guard reads on the next run, so a send that failed must still leave a
  // 'failed' row rather than nothing — otherwise nothing distinguishes
  // "never tried" from "tried and Meta refused".
  const { error: logErr } = await sb.from("wa_dispatch_log").insert({
    tenant_id:        o.tenantId,
    voice_profile_id: o.voiceProfileId,
    message_type:     o.messageType,
    to_number:        o.to,
    message_body:     o.logBody,
    status:           ok ? "sent" : "failed",
    provider_msg_id:  providerId,
  });
  if (logErr) console.error("[owner-alerts] dispatch log failed:", logErr.message);
  return ok;
}
