/**
 * Outbound campaign dispatcher.
 *
 * Polls every 30 seconds for running campaigns. For each, it:
 *   1. Checks today (IST) is inside the campaign's start/end dates and the
 *      current IST time is inside its daily window
 *   2. Pulls up to (max_concurrent - in_progress_count) recipients
 *      that are status='queued' or status='pending' (pending => scrub first)
 *   3. For 'pending': runs DND scrubbing, marks blocked_dnd or queued
 *   4. For 'queued': originates through FreeSWITCH over ESL (fsl.originateOutbound)
 *   5. Marks completed when all recipients are settled
 *
 * Run as a systemd service (nikki-outbound-dispatcher.service) — single
 * long-lived process. Every recipient row is now claimed with a
 * compare-and-set on its status (see transition()), so two dispatchers can
 * no longer both dial the same row — but a second one would still double
 * the concurrency a campaign asked for, so run one.
 *
 * TRAI: the scrub PATH is complete — opt-out list, consent carve-out,
 * caching, audit ledger and a fail-safe that blocks when it cannot get an
 * answer. What is not wired is a real registry, because India's NCPR is
 * reached through a DLT platform (Jio TrueConnect, Airtel IQ, Vi, BSNL,
 * Tata Vilpower) whose API differs per platform and needs a telemarketer
 * registration. Until DND_SCRUB_PROVIDER_URL points at one, bulk dialling
 * to numbers without recorded consent stays blocked, by design. See
 * ../dnd.ts — wiring a provider is implementing queryProvider().
 */
import { createClient } from "@supabase/supabase-js";
import { notifyApiCallback, API_CALL_SOURCE } from "../api-callbacks";
import { minutesGate } from "../usage";
import { scrubDnd } from "../dnd";

const SUPABASE_URL  = process.env.SUPABASE_URL!;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY!;
const PIPELINE_URL  = process.env.PIPELINE_URL || "http://127.0.0.1:8000";
// Loopback, not the public hostname: this runs on the same host as n8n, so
// routing internal events out to Cloudflare and back only adds a round trip
// and a dependency on the tunnel being up.
const API_URL       = process.env.API_URL || "http://127.0.0.1:4000";
// Validated at import — a missing secret stops this process rather than
// letting it dispatch calls it cannot authenticate. See internal-secret.ts.
import { INTERNAL_SECRET as INTERNAL_SEC } from "../internal-secret";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const POLL_INTERVAL_MS = 30_000;

// ─── DND scrubbing ────────────────────────────────────
// Moved to ../dnd. What used to be here was a stub that called fetch()
// with no timeout — a provider that accepted the connection and never
// answered stopped this whole polling loop, silently, until a restart.
//
// The module now also checks the tenant's own opt-out list BEFORE consent
// is considered (a withdrawal outranks a consent that predates it), caches
// provider answers for a bounded window, and records every decision in
// dnd_scrub_results so an auditor can be shown what we asked and when.
//
// Wiring a real TRAI NCPR / DLT provider is implementing one function in
// that module; nothing in this file changes.

// ─── Do-not-call ──────────────────────────────────────
// outbound_opt_outs was only consulted when a list was IMPORTED, so a number
// that asked to stop after it was queued — or an instant callback, which is
// never imported — was dialled anyway. One person was rung five times about
// the same abandoned booking and told the bot to stop on the last of them.
// Checked immediately before every dial. Fails CLOSED: if we cannot read the
// list, we do not call.
async function isOptedOut(tenantId: string, phone: string): Promise<boolean> {
  const d = String(phone || "").replace(/\D/g, "").slice(-10);
  if (d.length !== 10) return true;
  const { data, error } = await sb.from("outbound_opt_outs")
    .select("id").eq("tenant_id", tenantId)
    .in("phone", [d, `91${d}`, `+91${d}`, `0${d}`]).limit(1);
  if (error) {
    console.error(`[dispatcher] opt-out lookup failed for …${d.slice(-4)} — not dialling: ${error.message}`);
    return true;
  }
  return !!data?.length;
}

async function markOptedOut(r: any, from: string): Promise<void> {
  if (await transition(r.id, from, {
    status: "opted_out", outcome: "opted_out", next_attempt_at: null,
  }) && r.metadata?.source === API_CALL_SOURCE) void notifyApiCallback(sb, r.id);
}

// ─── Row ownership ────────────────────────────────────
// A tick reads up to 20 rows and then dials them one after another, each
// taking up to ~50 s — so the snapshot is minutes old by the time the last
// row is dialled. Every write used to be a bare .eq("id"): an API DELETE of a
// pending call (which sets it failed), an opt-out (which flips pending/queued
// to opted_out) or a hangup that already closed the row was silently
// overwritten back to in_progress, and the withdrawn number was rung anyway.
//
// Every status change is now a compare-and-set on the status this process
// last saw. Zero rows back means somebody else moved the row: leave it.
// A write error counts as "not ours" — fail closed, never dial on a guess.
async function transition(
  id: string, from: string | string[], patch: Record<string, unknown>,
): Promise<boolean> {
  let q = sb.from("outbound_recipients").update(patch).eq("id", id);
  q = Array.isArray(from) ? q.in("status", from) : q.eq("status", from);
  const { data, error } = await q.select("id");
  if (error) {
    console.error(`[dispatcher] recipient ${id} ${[from].flat().join("|")} → ${patch.status ?? "(same)"} failed: ${error.message}`);
    return false;
  }
  if (!data?.length) {
    console.warn(`[dispatcher] recipient ${id} is no longer ${[from].flat().join("|")} — changed elsewhere, left alone`);
    return false;
  }
  return true;
}

// Paused or cancelled from the dashboard while this tick was working through
// its batch: the old code only read the campaign once, at the top of the
// tick, and kept dialling the rest of the batch after the client pressed
// Pause. Read again right before each dial. An unreadable status is not
// "running".
// Minutes, checked BEFORE a row is claimed so a tenant out of minutes leaves
// its queue untouched and resumes when the month resets or it upgrades. An
// outbound leg is refused at /webhooks/freeswitch/inbound too, but only
// after the phone has rung and been answered — by a caller who then hears
// nothing. Cached for one tick: a batch is one tenant's twenty rows.
let _gateCache = new Map<string, boolean>();
async function tenantHasMinutes(tenantId: string): Promise<boolean> {
  if (_gateCache.has(tenantId)) return _gateCache.get(tenantId)!;
  const gate = await minutesGate(sb, tenantId);
  if (!gate.ok) console.warn(`[dispatcher] tenant ${tenantId} ${gate.reason} (${gate.usedMinutes}/${gate.limitMinutes} min) — not dialling`);
  _gateCache.set(tenantId, gate.ok);
  return gate.ok;
}

async function campaignStillRunning(campaignId: string): Promise<boolean> {
  const { data, error } = await sb.from("outbound_campaigns")
    .select("status").eq("id", campaignId).maybeSingle();
  if (error) {
    console.error(`[dispatcher] campaign ${campaignId} status re-check failed — not dialling: ${error.message}`);
    return false;
  }
  return data?.status === "running";
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
  const { fsl, useRemoteAdmission } = await import("../esl");
  // Admit through the API, which owns the ledger that click-to-calls use,
  // so a campaign leg and a seat's call cannot both take the last channel.
  // Idempotent; the first dispatch sets it for the life of the process.
  useRemoteAdmission(API_URL, INTERNAL_SEC);
  const reason = campaign ? "" : String(recipient.metadata?.source || "");
  return fsl.originateOutbound(recipient.phone, cli, campaign?.id, 35, reason, recipient.id);
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
];

/**
 * Our own preflight refusals: nothing the recipient did, and nothing wrong
 * with the trunk either. They are handled like a trunk fault (no missed-call
 * WhatsApp, no attempt burned) but must NOT reach recordTrunkState — that
 * writes the PLATFORM-wide trunk_outbound_state, which the voice pipeline
 * reads for six hours and uses to stop offering every caller, on every
 * tenant, a transfer to a human. One tenant with no DID assigned would have
 * degraded every conversation on the system.
 */
const CONFIG_FAULTS = [
  "no assigned DID to dial out as",
  "recipient has no tenant",
];

function isConfigFault(reason: string): boolean {
  return CONFIG_FAULTS.some(c => reason.includes(c));
}

function isTrunkFault(reason: string): boolean {
  return TRUNK_FAULTS.some(c => reason.includes(c)) || isConfigFault(reason);
}

/**
 * The trunk is FULL, which is not the same as broken.
 *
 * esl.ts refuses to originate once outbound is using its share of the ten
 * channels, so inbound callers always have room. That refusal must not be
 * filed as a trunk fault: recordTrunkState(false) is read by the voice
 * pipeline for six hours and makes Nikki stop offering to connect people to
 * a person — so a busy five minutes would degrade every live conversation.
 * It must not burn a retry either; nothing is wrong, and the same call will
 * go through as soon as a channel frees.
 */
function isTrunkBusy(reason: string): boolean {
  return reason.includes("trunk busy");
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
// A full trunk clears in the time one call takes, not in fifteen minutes.
const TRUNK_BUSY_RETRY_MS = 90 * 1000;
const TRUNK_MAX_TRIES = 8;
// CALL_REJECTED is ALSO what a person pressing Decline produces (SIP 603), and
// the two cannot be told apart from the cause alone. Eight redials every 15
// minutes to someone who is declining is harassment, so this cause gets two.
const REJECTED_MAX_TRIES = 2;
function maxTrunkTries(reason: string): number {
  return reason.includes("CALL_REJECTED") ? REJECTED_MAX_TRIES : TRUNK_MAX_TRIES;
}

/**
 * Our OWN side failed to talk to FreeSWITCH. These used to fall through to
 * the no-answer branch, so a FreeSWITCH restart sent every queued recipient a
 * "sorry we missed you" WhatsApp about a call that never left the box.
 *  - nothing was dialled: connection refused, no password — retry quietly.
 *  - ESL timeout: the originate may still have gone out and connected, so
 *    no quick redial (that could ring a live call twice) and no WhatsApp.
 */
function isEslUnreachable(reason: string): boolean {
  return reason.includes("ESL connection error") || reason.includes("FREESWITCH_ESL_PASSWORD");
}
function isEslTimeout(reason: string): boolean {
  return reason.includes("ESL timeout");
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
// The campaign's own window is the only limit; there is no platform-wide
// calling band. A window may cross midnight (22:00–06:00), and one whose
// start equals its end (00:00–00:00) is open around the clock.

function hhmmToMinutes(t: unknown): number | null {
  const m = String(t ?? "").match(/^(\d{1,2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : null;
}

function withinWindow(start: string, end: string): boolean {
  const now = new Date();
  // IST = UTC+5:30
  const istMinutes  = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % (24 * 60);
  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  // An unreadable window used to throw on .split and take the whole tick
  // down with it; it is now simply "closed".
  if (s === null || e === null) return false;
  if (s === e) return true;
  return s < e
    ? istMinutes >= s && istMinutes < e
    : istMinutes >= s || istMinutes < e;
}

// IST calendar day as YYYY-MM-DD, comparable to the date columns as strings.
function istToday(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

// A recipient that has been in_progress longer than any real call lasts.
// The hangup webhook is what normally closes the row; when it never arrives
// (the campaign dialplan shipped without api_reporting_hook for months, and
// a curl can still be lost on an api-server restart) the row sat in_progress
// forever, held a concurrency slot, and kept the campaign from completing.
// Long enough that a genuine 20-minute conversation is never cut short by
// bookkeeping — this only touches rows, never live channels.
const STALE_IN_PROGRESS_MS = 30 * 60_000;

async function reapStaleInProgress(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_IN_PROGRESS_MS).toISOString();
  // Rows from before last_attempt_at was stamped on dispatch have it NULL,
  // and NULL < cutoff is never true — two such rows sat in_progress for a
  // day. Fall back to created_at for those.
  const { data: stale, error } = await sb.from("outbound_recipients")
    .select("id, phone, campaign_id, metadata, last_attempt_at")
    .eq("status", "in_progress")
    .or(`last_attempt_at.lt.${cutoff},and(last_attempt_at.is.null,created_at.lt.${cutoff})`)
    .limit(50);
  if (error) { console.error("[dispatcher] stale scan failed:", error.message); return; }

  for (const r of (stale || [])) {
    const fsUuid = (r.metadata as any)?.fs_uuid as string | undefined;
    // Prefer the truth the pipeline already wrote: the calls row carries the
    // real duration, so the outcome matches what the hangup webhook would
    // have recorded, and call_id gets linked the same way.
    let outcome = "no_conversation_stale";
    let call_id: string | null = null;
    if (fsUuid) {
      const call = await callForChannel(fsUuid);
      if (call) {
        call_id = call.id;
        outcome = (call.duration_seconds || 0) >= 5 ? "answered" : "no_conversation_stale";
      }
    }
    await closeUnreported(r, outcome, call_id,
      `reaped stale in_progress recipient ${r.id} (${r.phone}) → ${outcome}` +
      ` — dialled ${r.last_attempt_at}, no hangup report received`);
  }

  // A call that ended before the dispatcher had written metadata.fs_uuid.
  // The hangup hook matches the recipient ON that uuid, so a callee who
  // answered and hung up within a second or two — before originate's reply
  // had even come back — left a report that matched nothing, and the row sat
  // in_progress for the full 30 minutes above. For an API-placed reminder
  // that was 30 minutes of the customer's system polling a call that was
  // long over. Once the calls row for that channel is closed, the call is
  // over whatever the recipient row says.
  const quickCutoff = new Date(Date.now() - UNREPORTED_GRACE_MS).toISOString();
  const { data: recent, error: recentErr } = await sb.from("outbound_recipients")
    .select("id, phone, campaign_id, metadata, last_attempt_at")
    .eq("status", "in_progress")
    .not("metadata->>fs_uuid", "is", null)
    .lt("last_attempt_at", quickCutoff)
    .gte("last_attempt_at", cutoff)
    .limit(50);
  if (recentErr) { console.error("[dispatcher] unreported-hangup scan failed:", recentErr.message); return; }
  for (const r of (recent || [])) {
    const call = await callForChannel((r.metadata as any).fs_uuid);
    if (!call || !["completed", "missed"].includes(call.status)) continue;
    const answered = (call.duration_seconds || 0) >= 5;
    await closeUnreported(r, answered ? "answered" : "no_conversation_unreported", call.id,
      `closed recipient ${r.id} (${r.phone}) — call ${call.id} already ${call.status}, hangup report never matched it`);
  }
}

// How long after dialling a closed calls row is trusted over a hangup report
// that may still be on its way. The hook fires within a second of hangup.
const UNREPORTED_GRACE_MS = 3 * 60_000;

// order + limit(1), never maybeSingle on its own: livekit_room_id is not
// unique, and a channel with two calls rows (the pipeline's insert racing
// the inbound webhook's) made maybeSingle error, which read as "no call".
async function callForChannel(fsUuid: string): Promise<{ id: string; status: string; duration_seconds: number | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(String(fsUuid || ""))) return null;
  const { data, error } = await sb.from("calls")
    .select("id, status, duration_seconds")
    .eq("livekit_room_id", fsUuid).order("created_at", { ascending: true }).limit(1);
  if (error) { console.error(`[dispatcher] call lookup for ${fsUuid} failed: ${error.message}`); return null; }
  return (data?.[0] as any) ?? null;
}

// The hangup webhook is what normally tells an API customer their call is
// over. The reaper closed rows WITHOUT that, so a reminder placed over the
// API whose hangup report was lost never got its callback at all.
async function closeUnreported(r: any, outcome: string, call_id: string | null, msg: string): Promise<void> {
  if (!await transition(r.id, "in_progress", { status: "completed", outcome, call_id })) return;
  console.warn(`[dispatcher] ${msg}`);
  if (r.metadata?.source === API_CALL_SOURCE) void notifyApiCallback(sb, r.id);
}

async function tick(): Promise<void> {
  _gateCache = new Map();
  await reapStaleInProgress();

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
      // Conditional, like every write below: a campaign the client cancelled
      // in the meantime stays cancelled.
      await sb.from("outbound_campaigns").update({
        status: "completed",
        completed_at: new Date().toISOString(),
      }).eq("id", c.id).eq("status", "running");
      console.log(`[dispatcher] campaign ${c.id} completed — no recipients outstanding`);
      continue;
    }

    // Calendar first, clock second. A campaign whose end date has passed
    // with contacts still outstanding is paused rather than left "running"
    // forever — the client sees "paused" and can extend the date or leave it.
    const today = istToday();
    if (c.start_date && today < c.start_date) continue;
    if (c.end_date && today > c.end_date) {
      await sb.from("outbound_campaigns").update({ status: "paused" }).eq("id", c.id).eq("status", "running");
      console.log(`[dispatcher] campaign ${c.id} paused — end date ${c.end_date} passed with ${outstanding} outstanding`);
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
      // Claimed, not assumed: an opt-out that landed after the select above
      // has already moved this row off 'pending', and scrubbing it back to
      // 'queued' is what put an opted-out number back in the dial queue.
      if (!await transition(r.id, "pending", { status: "scrubbing" })) continue;
      // A campaign whose uploader declared consent for every number on the
      // list dials without a third-party scrub; anything else still needs a
      // real DND feed and stays blocked. scrubDnd fails safe either way — the
      // declaration is recorded on the campaign with who made it and when.
      const { blocked, reason } = await scrubDnd(sb, r.phone, {
        tenantId: r.tenant_id, consented: !!c.consent_declared,
      });
      await transition(r.id, "scrubbing", {
        status:       blocked ? "blocked_dnd" : "queued",
        scrubbed_at:  new Date().toISOString(),
        dnd_blocked:  blocked,
        metadata:     { ...r.metadata, scrub_reason: reason },
      });
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
      // Both checks sit HERE, per dial, not once per batch. The batch is
      // dialled sequentially at up to ~50 s a call, so a window checked at
      // 20:59 went on ringing people well past 21:00, and a campaign paused
      // at the first call still rang the other nineteen.
      if (!withinWindow(c.window_start, c.window_end)) break;
      if (!await campaignStillRunning(c.id)) break;
      if (!await tenantHasMinutes(r.tenant_id || c.tenant_id)) break;

      const attempt = (r.attempts || 0) + 1;
      if (!await transition(r.id, "queued", {
        status:          "in_progress",
        attempts:        attempt,
        last_attempt_at: new Date().toISOString(),
      })) continue;

      // After the claim, so an opt-out recorded while this row sat in the
      // batch is still seen — and nothing but this process can now move it.
      if (await isOptedOut(r.tenant_id || c.tenant_id, r.phone)) {
        await markOptedOut(r, "in_progress");
        continue;
      }

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
        // Only while still in_progress: a very short call can already have
        // been closed by the hangup webhook (or the reaper), and this write
        // must not drag it back open.
        await transition(r.id, "in_progress", {
          outcome:  "dialled",
          metadata: { ...(r.metadata || {}), fs_uuid: fsUuid },
        });
      } catch (e: any) {
        const reason = String(e?.message || e).slice(0, 120);

        if (isTrunkBusy(reason)) {
          console.warn(`[dispatcher] ${reason} — ${r.phone} waits for a free channel`);
          await transition(r.id, "in_progress", {
            status:          "queued",
            outcome:         reason,
            attempts:        r.attempts || 0,
            next_attempt_at: new Date(Date.now() + TRUNK_BUSY_RETRY_MS).toISOString(),
          });
          continue;
        }

        if (isEslTimeout(reason)) {
          console.error(`[dispatcher] ESL timeout dialling ${r.phone} (campaign ${c.id}) — outcome unknown, no follow-up, next try tomorrow`);
          await transition(r.id, "in_progress", {
            status:          attempt >= 3 ? "failed" : "queued",
            outcome:         reason,
            next_attempt_at: attempt >= 3 ? null : new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          });
          continue;
        }

        if (isTrunkFault(reason) || isEslUnreachable(reason)) {
          if (!isEslUnreachable(reason) && !isConfigFault(reason)) void recordTrunkState(false, reason);
          // The phone never rang, so this is not a missed call: no WhatsApp,
          // and the attempt is rolled back to what it was before we tried.
          const trunkTries = ((r.metadata?.trunk_failures as number) || 0) + 1;
          const giveUp     = trunkTries >= maxTrunkTries(reason);

          // The dispatcher used to swallow this entirely — the only line it
          // ever printed was "[dispatcher] started", so a campaign that
          // dialled nothing for a day looked identical to one with no
          // recipients. Name the cause where `docker logs` will show it.
          console.error(
            `[dispatcher] TRUNK FAULT dialling ${r.phone} (campaign ${c.id}): ${reason} ` +
            `— attempt not counted, ${giveUp ? "giving up" : `retrying in ${TRUNK_RETRY_MS / 60000}m`} ` +
            `(${trunkTries}/${maxTrunkTries(reason)})`
          );

          await transition(r.id, "in_progress", {
            status:          giveUp ? "failed" : "queued",
            outcome:         reason,
            attempts:        r.attempts || 0,
            next_attempt_at: giveUp
              ? null
              : new Date(Date.now() + TRUNK_RETRY_MS).toISOString(),
            metadata:        { ...(r.metadata || {}), trunk_failures: trunkTries },
          });
          continue;
        }

        if (isDeadNumber(reason)) {
          console.error(`[dispatcher] number refused dialling ${r.phone} (campaign ${c.id}): ${reason} — no follow-up, not retried`);
          await transition(r.id, "in_progress", {
            status: "failed", outcome: reason, next_attempt_at: null,
          });
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
        await transition(r.id, "in_progress", {
          status:          exhausted ? "failed" : "queued",
          outcome:         reason,
          next_attempt_at: exhausted
            ? null
            : new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        });
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
// Instant callbacks have no campaign window and dial as soon as the row
// appears, at any hour.
async function tickInstant(): Promise<void> {
  _gateCache = new Map();
  const { data: pending } = await sb.from("outbound_recipients")
    .select("*").eq("is_instant", true).eq("status", "pending")
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`)
    .limit(20);

  for (const r of (pending || [])) {
    if (!await tenantHasMinutes(r.tenant_id)) continue;

    // Claim before anything else. An API DELETE (pending → failed) or an
    // opt-out (pending → opted_out) that arrived after the select above is
    // respected here instead of being overwritten by "scrubbing".
    if (!await transition(r.id, "pending", { status: "scrubbing" })) continue;

    if (await isOptedOut(r.tenant_id, r.phone)) {
      await markOptedOut(r, "scrubbing");
      continue;
    }
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
    // consent_declared is the third: a call placed over the public API,
    // where the business's own software attests — per call, on the record
    // — that this customer asked to be reminded. The API refuses a request
    // without that attestation, so a row with the flag has it on file.
    const consented = !!r.consent_call_id || !!r.consent_declared
      || !!profile?.skip_dnd_for_instant_leads;

    const { blocked, reason } = await scrubDnd(sb, r.phone, {
      tenantId: r.tenant_id, consented,
    });
    if (blocked) {
      if (await transition(r.id, "scrubbing", {
        status: "blocked_dnd", scrubbed_at: new Date().toISOString(),
        dnd_blocked: true, metadata: { ...r.metadata, scrub_reason: reason },
      }) && r.metadata?.source === API_CALL_SOURCE) void notifyApiCallback(sb, r.id);
      continue;
    }

    if (!await transition(r.id, "scrubbing", {
      status: "in_progress", scrubbed_at: new Date().toISOString(), dnd_blocked: false,
      // Stamped at the claim, not after the dial: the reapers age an
      // in_progress row by this, and a retry still carried the previous
      // attempt's time.
      last_attempt_at: new Date().toISOString(),
    })) continue;

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
      if (isTrunkBusy(reason)) {
        console.warn(`[dispatcher] ${reason} — instant callback to ${r.phone} waits`);
        await transition(r.id, "in_progress", {
          status:          "pending",
          outcome:         reason,
          attempts:        r.attempts || 0,
          next_attempt_at: new Date(Date.now() + TRUNK_BUSY_RETRY_MS).toISOString(),
        });
        continue;
      }
      const unreachable = isEslUnreachable(reason);
      const fault  = isTrunkFault(reason) || unreachable;
      // A per-tenant config fault says nothing about the trunk either way:
      // neither "down" (which degrades every tenant for six hours) nor "ok".
      if (!unreachable && !isEslTimeout(reason) && !isConfigFault(reason)) {
        void recordTrunkState(!fault, fault ? reason : undefined);
      }
      // A trunk fault is our problem, not the lead's: keep the row pending
      // and try again shortly, a bounded number of times. A phone that rang
      // and was not answered is a one-shot — the moment has passed.
      const trunkTries = ((r.metadata?.trunk_failures as number) || 0) + (fault ? 1 : 0);
      const retry      = fault && trunkTries < maxTrunkTries(reason);
      console.error(
        `[dispatcher] instant callback to ${r.phone} failed: ${reason}` +
        (retry ? ` — retrying in ${TRUNK_RETRY_MS / 60000}m (${trunkTries}/${maxTrunkTries(reason)})` : "")
      );
      const settled = await transition(r.id, "in_progress", {
        status:          retry ? "pending" : "failed",
        outcome:         reason,
        attempts:        (r.attempts || 0) + (fault ? 0 : 1),
        last_attempt_at: now,
        next_attempt_at: retry ? new Date(Date.now() + TRUNK_RETRY_MS).toISOString() : null,
        metadata:        { ...(r.metadata || {}), trunk_failures: trunkTries },
      });
      // A call the API asked for and we could not place is a result the
      // caller is waiting on — only a final failure, a retry is still ours.
      if (settled && !retry && r.metadata?.source === API_CALL_SOURCE) void notifyApiCallback(sb, r.id);
      continue;
    }
    void recordTrunkState(true);
    // A channel UUID, not a calls.id — same FK trap as the campaign path;
    // the hangup webhook resolves metadata.fs_uuid to the real call row.
    // Conditional for the same reason as the campaign link: a callee who
    // hung up at once may already have been closed by the hangup webhook.
    if (!await transition(r.id, "in_progress", {
      outcome:         "dialled",
      attempts:        (r.attempts || 0) + 1,
      last_attempt_at: now,
      metadata:        { ...(r.metadata || {}), fs_uuid: fsUuid },
    })) continue;
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
