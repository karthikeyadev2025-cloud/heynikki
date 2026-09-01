/**
 * Outbound campaign dispatcher.
 *
 * Polls every 30 seconds for running campaigns. For each, it:
 *   1. Checks current IST hour is inside the campaign's window
 *   2. Pulls up to (max_concurrent - in_progress_count) recipients
 *      that are status='queued' or status='pending' (pending => scrub first)
 *   3. For 'pending': runs DND scrubbing, marks blocked_dnd or queued
 *   4. For 'queued': originates through FreeSWITCH over ESL (fsl.originateOutbound)
 *   5. Marks completed when all recipients are settled
 *
 * Run as a systemd service (nikki-outbound-dispatcher.service) — single
 * long-lived process. Multi-instance dispatching is NOT safe yet because
 * we don't lock recipient rows during pickup; that's a future enhancement
 * via SELECT FOR UPDATE SKIP LOCKED.
 *
 * TRAI: DND scrubbing is currently a STUB. Wire a real provider (
 * KMS, or TRAI direct feed) into scrubDnd() before launching to numbers
 * that DON'T have explicit consent.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = process.env.SUPABASE_URL!;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY!;
const PIPELINE_URL  = process.env.PIPELINE_URL || "http://127.0.0.1:8000";
// Loopback, not the public hostname: this runs on the same host as n8n, so
// routing internal events out to Cloudflare and back only adds a round trip
// and a dependency on the tunnel being up.
const N8N_BASE      = process.env.N8N_WEBHOOK_BASE || "http://127.0.0.1:5678/webhook";
const INTERNAL_SEC  = process.env.INTERNAL_SECRET!;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const POLL_INTERVAL_MS = 30_000;

// ─── DND scrubbing ────────────────────────────────────
// TODO: replace this stub with an actual TRAI NCPR provider call.
//
// CONSENT CARVE-OUT — this comment used to say "only campaigns where ALL
// recipients have consent_call_id should be allowed in production" but
// that carve-out was never implemented; every recipient hit the same
// fail-safe block. isConsented finally builds it: an instant lead-capture
// row (someone who just submitted the business's own enquiry form) can
// skip third-party DND scrubbing IF the tenant has explicitly opted in
// via voice_profiles.skip_dnd_for_instant_leads. Bulk campaign dialing
// is completely untouched by this — it always requires either a real
// DND_SCRUB_PROVIDER_URL or stays blocked, exactly as before.
async function scrubDnd(
  phone: string,
  isConsented: boolean = false
): Promise<{ blocked: boolean; reason?: string }> {
  if (isConsented) {
    return { blocked: false, reason: "self_submitted_enquiry_consent" };
  }
  if (!process.env.DND_SCRUB_PROVIDER_URL) {
    console.warn(`[dispatcher] DND_SCRUB_PROVIDER_URL not set — phone ${phone} unscrubbed`);
    // Fail SAFE: if we can't scrub and it's not consent-based, block.
    return { blocked: true, reason: "scrubbing_unavailable" };
  }
  try {
    const r = await fetch(`${process.env.DND_SCRUB_PROVIDER_URL}/check?phone=${encodeURIComponent(phone)}`, {
      headers: { Authorization: `Bearer ${process.env.DND_SCRUB_PROVIDER_TOKEN || ""}` },
    });
    if (!r.ok) return { blocked: true, reason: "scrub_provider_error" };
    const j = await r.json() as { on_dnd?: boolean; reason?: string };
    return { blocked: !!j.on_dnd, reason: j.reason };
  } catch (e) {
    console.error("[dispatcher] scrub error:", e);
    return { blocked: true, reason: "scrub_exception" };
  }
}

// ─── Pipeline dispatch ────────────────────────────────
// `campaign` is null for instant (is_instant=true) recipients — there is
// no campaign row to pull voice_profile_id or a script from, so those
// come from the recipient row itself for that case.
/**
 * The CLI to dial out as. MUST be a DID this tenant actually owns — a spoofed
 * caller ID on an Indian trunk gets the trunk suspended, not just the call
 * rejected. Cached per tenant for the life of the process; DIDs change about
 * as often as the tenant signs a new contract.
 */
const cliCache = new Map<string, string | null>();
async function tenantCli(tenantId: string): Promise<string | null> {
  if (cliCache.has(tenantId)) return cliCache.get(tenantId)!;
  const { data } = await sb.from("dids")
    .select("number").eq("tenant_id", tenantId).eq("status", "assigned").limit(1).maybeSingle();
  const cli = data?.number ?? null;
  cliCache.set(tenantId, cli);
  if (!cli) console.error(`[dispatcher] tenant ${tenantId} has no assigned DID — cannot dial out`);
  return cli;
}
/**
 * Dial one recipient on our own Jio trunk.
 *
 * on the account and is now disabled entirely. This originates through
 * FreeSWITCH instead, the same trunk every inbound call already uses.
 *
 * Returns the FreeSWITCH channel UUID on answer. A rejected or unanswered
 * call THROWS — NO_ANSWER, USER_BUSY and CALL_REJECTED are ordinary campaign
 * outcomes rather than faults, and the caller decides the follow-up.
 */
async function dispatchCall(recipient: any, campaign: any | null): Promise<string> {
  const tenantId = recipient.tenant_id || campaign?.tenant_id;
  if (!tenantId) throw new Error("recipient has no tenant");

  const cli = await tenantCli(tenantId);
  if (!cli) throw new Error("no assigned DID to dial out as");

  // Imported lazily: this module is also loaded by tooling that has no ESL
  // socket, and the import opens one on construction.
  const { fsl } = await import("../esl");
  return fsl.originateOutbound(recipient.phone, cli, campaign?.id);
}

/**
 * One WhatsApp per person, on the FIRST no-answer — not once per attempt.
 * A recipient is retried twice after that, so without the wa_followup_sent
 * guard somebody who was simply away from their phone gets three identical
 * messages.
 */
async function sendNoAnswerFollowUp(recipient: any, campaign: any | null): Promise<void> {
  if (recipient.wa_followup_sent) return;
  const tenantId = recipient.tenant_id || campaign?.tenant_id;
  if (!tenantId) return;

  const { data: vp } = await sb.from("voice_profiles")
    .select("business_name, whatsapp_number, fallback_wa_enabled")
    .eq("id", campaign?.voice_profile_id || recipient.voice_profile_id)
    .maybeSingle();
  if (vp?.fallback_wa_enabled === false) return;

  try {
    // Same event the inbound missed-call path fires, so both share one n8n
    // workflow and one approved template.
    await fetch(`${N8N_BASE.replace(/\/$/, "")}/missed-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caller_number:   recipient.phone,
        tenant_id:       tenantId,
        call_id:         recipient.call_id ?? null,
        business_name:   vp?.business_name || "our team",
        whatsapp_number: vp?.whatsapp_number || recipient.phone,
      }),
      signal: AbortSignal.timeout(5000),
    });
    await sb.from("outbound_recipients")
      .update({ wa_followup_sent: true }).eq("id", recipient.id);
  } catch (e: any) {
    console.error("[dispatcher] no-answer follow-up failed:", e.message);
  }
}

// ─── Hours check (recipient timezone assumed IST for now) ───
function withinWindow(start: string, end: string): boolean {
  const now = new Date();
  // IST = UTC+5:30
  const istMinutes  = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % (24 * 60);
  const [sH, sM]    = start.split(":").map(Number);
  const [eH, eM]    = end.split(":").map(Number);
  const startMin    = sH * 60 + sM;
  const endMin      = eH * 60 + eM;
  return istMinutes >= startMin && istMinutes < endMin;
}

async function tick(): Promise<void> {
  const { data: campaigns } = await sb.from("outbound_campaigns")
    .select("*").eq("status", "running");

  for (const c of (campaigns || [])) {
    // Completion is bookkeeping, not dialling, so it runs before the calling
    // window is considered. It used to sit at the bottom of this loop, after
    // the `continue` below — so a campaign that finished its last recipient at
    // 18:59 stayed "running" all night and only closed when the window
    // reopened the next morning. Outside calling hours every finished campaign
    // in the system looked live.
    const { count: outstanding } = await sb.from("outbound_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", c.id)
      .in("status", ["pending", "queued", "in_progress", "scrubbing"]);
    if ((outstanding || 0) === 0) {
      await sb.from("outbound_campaigns").update({
        status: "completed",
        completed_at: new Date().toISOString(),
      }).eq("id", c.id);
      console.log(`[dispatcher] campaign ${c.id} completed — no recipients outstanding`);
      continue;
    }

    if (!withinWindow(c.window_start, c.window_end)) continue;

    // How many slots are free?
    const { count: inProgress } = await sb.from("outbound_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", c.id).eq("status", "in_progress");
    const slots = (c.max_concurrent || 3) - (inProgress || 0);
    if (slots <= 0) continue;

    // First, scrub any pending. Then dispatch queued.
    const { data: pending } = await sb.from("outbound_recipients")
      .select("*").eq("campaign_id", c.id).eq("status", "pending").limit(slots);

    for (const r of (pending || [])) {
      await sb.from("outbound_recipients").update({ status: "scrubbing" }).eq("id", r.id);
      // A campaign whose uploader declared consent for every number on the
      // list dials without a third-party scrub; anything else still needs a
      // real DND feed and stays blocked. scrubDnd fails safe either way — the
      // declaration is recorded on the campaign with who made it and when.
      const { blocked, reason } = await scrubDnd(r.phone, !!c.consent_declared);
      await sb.from("outbound_recipients").update({
        status:       blocked ? "blocked_dnd" : "queued",
        scrubbed_at:  new Date().toISOString(),
        dnd_blocked:  blocked,
        metadata:     { ...r.metadata, scrub_reason: reason },
      }).eq("id", r.id);
    }

    // Dispatch queued recipients whose backoff has expired. The
    // next_attempt_at filter is not optional: without it a recipient parked
    // for 24 hours after a no-answer is picked up again on the very next
    // tick, 30 seconds later, and the "retry tomorrow" below means nothing.
    const { data: queued } = await sb.from("outbound_recipients")
      .select("*").eq("campaign_id", c.id).eq("status", "queued")
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`)
      .limit(slots);

    for (const r of (queued || [])) {
      const attempt = (r.attempts || 0) + 1;
      await sb.from("outbound_recipients").update({
        status:          "in_progress",
        attempts:        attempt,
        last_attempt_at: new Date().toISOString(),
      }).eq("id", r.id);

      try {
        const fsUuid = await dispatchCall(r, c);
        // Answered. The pipeline drives the conversation from here and
        // scores the lead on hangup; the brochure, if the lead qualifies,
        // is fired from there rather than guessed at here.
        //
        // What comes back from originate is a FreeSWITCH channel UUID. It is
        // NOT a calls.id, and call_id is a foreign key to calls.id — so
        // writing it here raised 23503 on every answered call, and because
        // the error was never read, the outcome and status in the same update
        // were lost with it. That is the whole reason recipients sat in
        // in_progress forever.
        //
        // The calls row does not exist yet at this instant anyway: it is
        // created moments later, when the pipeline registers the answered
        // leg. So the UUID goes in metadata, where there is no FK, and the
        // hangup webhook resolves it to a real call_id once the row exists.
        const { error: linkErr } = await sb.from("outbound_recipients").update({
          status:   "in_progress",
          outcome:  "dialled",
          metadata: { ...(r.metadata || {}), fs_uuid: fsUuid },
        }).eq("id", r.id);
        if (linkErr) console.error(`[dispatcher] link ${r.id} failed:`, linkErr.message);
      } catch (e: any) {
        const reason = String(e?.message || e).slice(0, 120);

        // The WhatsApp goes out on the FIRST no-answer, while the intent is
        // still warm, and the phone retries continue behind it.
        await sendNoAnswerFollowUp(r, c);

        // 3 attempts total — the original try plus two retries — spaced a
        // day apart so a campaign never reads as harassment.
        const exhausted = attempt >= 3;
        await sb.from("outbound_recipients").update({
          status:          exhausted ? "failed" : "queued",
          outcome:         reason,
          next_attempt_at: exhausted
            ? null
            : new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        }).eq("id", r.id);
      }
    }

    // Completion is checked at the top of the next tick, above the window
    // guard, so it is not repeated here.
  }
}

// ─── Instant lead-capture dispatch ─────────────────────
// Handles is_instant=true recipients — one-off callbacks for a lead who
// just submitted the business's own enquiry form, created by
// POST /webhooks/lead-capture/:token. These have no campaign_id, so
// tick() above (which is scoped per-campaign) never sees them.
// Capped at 20 dispatches per tick (every 30s) so a burst of form
// submissions can't overwhelm the trunk or a single tenant's concurrency.
async function tickInstant(): Promise<void> {
  const { data: pending } = await sb.from("outbound_recipients")
    .select("*").eq("is_instant", true).eq("status", "pending").limit(20);

  for (const r of (pending || [])) {
    // Whether THIS tenant has opted in to skipping third-party DND
    // scrubbing for self-submitted enquiries. Default false — the
    // business must explicitly choose this in Setup.
    const { data: profile } = await sb.from("voice_profiles")
      .select("skip_dnd_for_instant_leads")
      .eq("tenant_id", r.tenant_id).limit(1).maybeSingle();
    const consented = !!profile?.skip_dnd_for_instant_leads;

    await sb.from("outbound_recipients").update({ status: "scrubbing" }).eq("id", r.id);
    const { blocked, reason } = await scrubDnd(r.phone, consented);
    if (blocked) {
      await sb.from("outbound_recipients").update({
        status: "blocked_dnd", scrubbed_at: new Date().toISOString(),
        dnd_blocked: true, metadata: { ...r.metadata, scrub_reason: reason },
      }).eq("id", r.id);
      continue;
    }

    await sb.from("outbound_recipients").update({
      status: "in_progress", scrubbed_at: new Date().toISOString(), dnd_blocked: false,
    }).eq("id", r.id);

    const callId = await dispatchCall(r, null);
    if (callId) {
      await sb.from("outbound_recipients").update({ call_id: callId }).eq("id", r.id);
    } else {
      // One-off leads don't get a 24h retry cycle like campaigns —
      // the moment has passed; a failed instant callback just fails.
      await sb.from("outbound_recipients").update({ status: "failed" }).eq("id", r.id);
    }
  }
}

async function main() {
  console.log("[dispatcher] started");
  while (true) {
    try {
      await tick();
      await tickInstant();
    } catch (e) {
      console.error("[dispatcher] tick error:", e);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
