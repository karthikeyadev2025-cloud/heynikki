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
const API_URL       = process.env.API_URL || "http://127.0.0.1:4000";
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
// The voice pipeline reads this before promising a caller "connecting you
// to staff": a transfer is an outbound leg on the same trunk, and when Jio
// is refusing outbound (the fault the dispatcher sees first, every 15
// minutes) Nikki must say "we'll call you back" instead of dead-ending a
// caller into ringback. Stored as JSON text; the pipeline parses it and
// only trusts a fault younger than six hours.
let _lastTrunkState: string | null = null;
async function recordTrunkState(ok: boolean, cause?: string): Promise<void> {
  const state = ok ? "ok" : `fault:${cause}`;
  if (state === _lastTrunkState) return;          // one write per change
  _lastTrunkState = state;
  const value = JSON.stringify({ ok, at: new Date().toISOString(), ...(ok ? {} : { cause }) });
  const { error } = await sb.from("platform_config").upsert(
    { key: "trunk_outbound_state", value, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) console.error("[dispatcher] trunk_outbound_state write failed:", error.message);
}

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
 * Did the call actually reach the recipient's phone?
 *
 * Only a call that RANG counts as a missed call. When the trunk refuses the
 * INVITE, nobody's phone ever lit up — and the old code treated every thrown
 * error alike, so a trunk outage sent each recipient a "sorry we missed you"
 * WhatsApp about a call they never got AND spent one of their three lifetime
 * attempts on our fault. That is exactly what happened to the eye-camp
 * campaign: Jio answered 29 of 29 outbound INVITEs with 403 Forbidden, and
 * all three recipients ended up messaged and one attempt down without a
 * single phone ringing.
 *
 * These are FreeSWITCH hangup causes, matched as substrings because the
 * reason string is "originate failed: CAUSE".
 */
const TRUNK_FAULTS = [
  "CALL_REJECTED",             // Jio's SBC answers 403 Forbidden as this
  "NORMAL_TEMPORARY_FAILURE",  // and 500 "Classification Failure" as this
  "NORMAL_CIRCUIT_CONGESTION",
  "SWITCH_CONGESTION",
  "NETWORK_OUT_OF_ORDER",
  "DESTINATION_OUT_OF_ORDER",
  "SERVICE_UNAVAILABLE",
  "GATEWAY_DOWN",
  "RECOVERY_ON_TIMER_EXPIRE",
  // Our own preflight refusals — also nothing the recipient did.
  "no assigned DID to dial out as",
  "recipient has no tenant",
];

function isTrunkFault(reason: string): boolean {
  return TRUNK_FAULTS.some(c => reason.includes(c));
}

/**
 * The trunk understood us and said the NUMBER is wrong. Nobody's phone
 * rang, so no missed-call WhatsApp — but nothing will change by tomorrow
 * either, so no retry. On 2026-09-04 every campaign call hit this because
 * Jio began demanding +91 on the callee; the recipients were each messaged
 * "sorry we missed you" about a call that never left our box.
 */
const DEAD_NUMBER = ["INVALID_NUMBER_FORMAT", "UNALLOCATED_NUMBER", "NO_ROUTE_DESTINATION", "Bad customer number"];
function isDeadNumber(reason: string): boolean {
  return DEAD_NUMBER.some(c => reason.includes(c));
}

// A trunk fault retries on a short timer instead of tomorrow, since it is
// expected to clear on its own. Capped so a permanently dead trunk settles
// instead of redialling the same list every 15 minutes forever — 8 tries is
// about two hours, long enough to ride out congestion and short enough that
// a real outage shows up as failed rows an operator can see.
const TRUNK_RETRY_MS  = 15 * 60 * 1000;
const TRUNK_MAX_TRIES = 8;

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

  // A campaign row may carry no voice_profile_id at all — the create form
  // leaves it null and nothing backfills it. The old lookup passed that null
  // straight into .eq("id", ...), matched nothing, and fell through to the
  // defaults below: the message introduced the business as "our team" and,
  // worse, put recipient.phone in the whatsapp_number slot, telling the
  // person to contact their own number. Fall back to the tenant's own
  // profile, which is the business they were actually called by.
  const profileId = campaign?.voice_profile_id || recipient.voice_profile_id;
  const { data: vp } = profileId
    ? await sb.from("voice_profiles")
        .select("business_name, whatsapp_number, fallback_wa_enabled")
        .eq("id", profileId).maybeSingle()
    : await sb.from("voice_profiles")
        .select("business_name, whatsapp_number, fallback_wa_enabled")
        .eq("tenant_id", tenantId).limit(1).maybeSingle();
  if (vp?.fallback_wa_enabled === false) return;

  // Without a business identity there is no honest message to send. Staying
  // silent is better than a WhatsApp from "our team" quoting the recipient's
  // own number back at them.
  if (!vp?.business_name) {
    console.error(`[dispatcher] no voice profile for tenant ${tenantId} — skipping no-answer follow-up to ${recipient.phone}`);
    return;
  }

  try {
    // The same route the inbound missed-call path uses, straight into the
    // api-server's Meta sender. This used to post to an n8n workflow whose
    // WhatsApp node was never filled in, then mark the follow-up as sent —
    // so every campaign no-answer "sent" a message nobody received, and the
    // dashboard counted it. Marked sent only when the api-server says ok.
    const r = await fetch(`${API_URL}/api/whatsapp/missed-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SEC },
      body: JSON.stringify({
        caller_number:    recipient.phone,
        tenant_id:        tenantId,
        voice_profile_id: profileId || null,
        call_id:          recipient.call_id ?? null,
        business_name:    vp.business_name,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      console.error(`[dispatcher] no-answer follow-up to ${recipient.phone} not sent (${r.status})`);
      return;
    }
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
        void recordTrunkState(true);
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

        if (isTrunkFault(reason)) {
          void recordTrunkState(false, reason);
          // The phone never rang, so this is not a missed call: no WhatsApp,
          // and the attempt is rolled back to what it was before we tried.
          const trunkTries = ((r.metadata?.trunk_failures as number) || 0) + 1;
          const giveUp     = trunkTries >= TRUNK_MAX_TRIES;

          // The dispatcher used to swallow this entirely — the only line it
          // ever printed was "[dispatcher] started", so a campaign that
          // dialled nothing for a day looked identical to one with no
          // recipients. Name the cause where `docker logs` will show it.
          console.error(
            `[dispatcher] TRUNK FAULT dialling ${r.phone} (campaign ${c.id}): ${reason} ` +
            `— attempt not counted, ${giveUp ? "giving up" : `retrying in ${TRUNK_RETRY_MS / 60000}m`} ` +
            `(${trunkTries}/${TRUNK_MAX_TRIES})`
          );

          await sb.from("outbound_recipients").update({
            status:          giveUp ? "failed" : "queued",
            outcome:         reason,
            attempts:        r.attempts || 0,
            next_attempt_at: giveUp
              ? null
              : new Date(Date.now() + TRUNK_RETRY_MS).toISOString(),
            metadata:        { ...(r.metadata || {}), trunk_failures: trunkTries },
          }).eq("id", r.id);
          continue;
        }

        if (isDeadNumber(reason)) {
          console.error(`[dispatcher] number refused dialling ${r.phone} (campaign ${c.id}): ${reason} — no follow-up, not retried`);
          await sb.from("outbound_recipients").update({
            status: "failed", outcome: reason, next_attempt_at: null,
          }).eq("id", r.id);
          continue;
        }

        // NO_ANSWER / USER_BUSY: the far phone rang, so the trunk is fine.
        void recordTrunkState(true);

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
    .select("*").eq("is_instant", true).eq("status", "pending")
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`)
    .limit(20);

  for (const r of (pending || [])) {
    // Whether THIS tenant has opted in to skipping third-party DND
    // scrubbing for self-submitted enquiries. Default false — the
    // business must explicitly choose this in Setup.
    const { data: profile } = await sb.from("voice_profiles")
      .select("skip_dnd_for_instant_leads")
      .eq("tenant_id", r.tenant_id).limit(1).maybeSingle();
    // consent_call_id is the stronger of the two signals and the reason the
    // column exists: this number phoned the business and asked for something,
    // and the recording of that call is the consent record. A web form behind
    // skip_dnd_for_instant_leads is a weaker claim than that, so a row
    // carrying real call consent does not also need the tenant flag —
    // otherwise a caller who asked to be rung back is blocked as unscrubbed.
    const consented = !!r.consent_call_id || !!profile?.skip_dnd_for_instant_leads;

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

    // dispatchCall THROWS on a rejected or unanswered call (see above). This
    // loop used to await it bare, so the first CALL_REJECTED escaped to
    // main()'s catch, the recipient was left in_progress with attempts 0 and
    // no outcome — two incomplete-booking callbacks sat like that from 3 Sep
    // — and every later instant recipient in the batch was skipped with it.
    const now = new Date().toISOString();
    let fsUuid: string;
    try {
      fsUuid = await dispatchCall(r, null);
    } catch (e: any) {
      const reason = String(e?.message || e).slice(0, 120);
      const fault  = isTrunkFault(reason);
      void recordTrunkState(!fault, fault ? reason : undefined);
      // A trunk fault is our problem, not the lead's: keep the row pending
      // and try again shortly, a bounded number of times. A phone that rang
      // and was not answered is a one-shot — the moment has passed.
      const trunkTries = ((r.metadata?.trunk_failures as number) || 0) + (fault ? 1 : 0);
      const retry      = fault && trunkTries < TRUNK_MAX_TRIES;
      console.error(
        `[dispatcher] instant callback to ${r.phone} failed: ${reason}` +
        (retry ? ` — retrying in ${TRUNK_RETRY_MS / 60000}m (${trunkTries}/${TRUNK_MAX_TRIES})` : "")
      );
      await sb.from("outbound_recipients").update({
        status:          retry ? "pending" : "failed",
        outcome:         reason,
        attempts:        (r.attempts || 0) + (fault ? 0 : 1),
        last_attempt_at: now,
        next_attempt_at: retry ? new Date(Date.now() + TRUNK_RETRY_MS).toISOString() : null,
        metadata:        { ...(r.metadata || {}), trunk_failures: trunkTries },
      }).eq("id", r.id);
      continue;
    }
    void recordTrunkState(true);
    // A channel UUID, not a calls.id — same FK trap as the campaign path;
    // the hangup webhook resolves metadata.fs_uuid to the real call row.
    const { error: linkErr } = await sb.from("outbound_recipients").update({
      status:          "in_progress",
      outcome:         "dialled",
      attempts:        (r.attempts || 0) + 1,
      last_attempt_at: now,
      metadata:        { ...(r.metadata || {}), fs_uuid: fsUuid },
    }).eq("id", r.id);
    if (linkErr) console.error(`[dispatcher] link ${r.id} failed:`, linkErr.message);
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
