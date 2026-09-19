/**
 * DND scrubbing: is this number allowed to be dialled?
 *
 * WHAT IS AND IS NOT DONE HERE
 * India's DND register (the NCPR) is not a public API. A telemarketer
 * reaches it through a DLT platform — Jio TrueConnect, Airtel IQ, Vi,
 * BSNL, Tata Vilpower — after registering as a principal entity, and each
 * platform exposes a different request shape. So the *transport* to a real
 * registry cannot be written until that commercial choice is made, and
 * guessing one would produce code that looks finished and silently does
 * nothing, which this repo has been bitten by before.
 *
 * Everything around it is written and enforced: the order the checks run
 * in, the consent carve-out, the opt-out list, the caching window, the
 * audit record, and the fail-safe. Wiring a real registry is implementing
 * one function — `queryProvider` — against `ScrubAnswer`, and nothing else
 * moves.
 *
 * ORDER MATTERS. Checks run cheapest-and-most-binding first:
 *   1. The business's own opt-out list. Someone who told THIS business to
 *      stop is never dialled by it, whatever any registry says and
 *      whatever consent was once given. Consent cannot override it —
 *      that is the whole point of a withdrawal.
 *   2. Consent. A person who just asked this business to ring them back
 *      is not a telemarketing target, and the NCPR carve-out for
 *      solicited contact is what the consent columns exist to record.
 *   3. The registry, cached.
 *   4. No answer available -> BLOCK.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { phoneForms } from "./campaign-import";

export interface ScrubAnswer {
  blocked: boolean;
  reason?: string;
}

const PROVIDER_URL   = () => process.env.DND_SCRUB_PROVIDER_URL || "";
const PROVIDER_TOKEN = () => process.env.DND_SCRUB_PROVIDER_TOKEN || "";
const PROVIDER_NAME  = () => process.env.DND_SCRUB_PROVIDER_NAME || "generic-rest";

// A scrub runs inside the dispatcher's single polling loop. The old code
// called fetch() with no timeout at all, so a provider that accepted the
// connection and never answered stopped the dispatcher outright — no
// campaigns, no instant callbacks, no error, until someone restarted it.
const PROVIDER_TIMEOUT_MS = 6_000;

// Seven days is the migration's hard ceiling; default to one so a
// preference registered today is honoured within a day even at worst.
function ttlHours(): number {
  const raw = Number(process.env.DND_SCRUB_TTL_HOURS || 24);
  if (!Number.isFinite(raw) || raw <= 0) return 24;
  return Math.min(raw, 24 * 7);
}

/**
 * Ask the configured registry about one number.
 *
 * ── WIRING A REAL NCPR/DLT PROVIDER ──────────────────────────────────
 * Replace the body below with that platform's call. The contract this
 * must honour, and the reason each part matters:
 *
 *   - Return { blocked: true } when the number is on the register, OR
 *     when the answer cannot be trusted. Never return blocked:false as a
 *     fallback — an unscrubbed dial is the violation.
 *   - THROW on transport failure rather than returning a verdict. The
 *     caller distinguishes "the registry said callable" from "we could
 *     not ask", records them differently, and never caches the second.
 *   - Stay inside PROVIDER_TIMEOUT_MS; the dispatcher loop is waiting.
 *
 * The default implementation speaks the generic REST shape the original
 * stub assumed, so an aggregator that already fits it works by setting
 * DND_SCRUB_PROVIDER_URL alone.
 */
async function queryProvider(phone: string): Promise<ScrubAnswer> {
  const base = PROVIDER_URL();
  if (!base) throw new Error("no_provider_configured");

  const r = await fetch(
    `${base.replace(/\/+$/, "")}/check?phone=${encodeURIComponent(phone)}`,
    {
      headers: { Authorization: `Bearer ${PROVIDER_TOKEN()}` },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    },
  );
  if (!r.ok) throw new Error(`provider_http_${r.status}`);

  const j = (await r.json()) as { on_dnd?: boolean; reason?: string };
  // A provider that answers 200 with no verdict has told us nothing. That
  // is a failure to ask, not permission to dial.
  if (typeof j?.on_dnd !== "boolean") throw new Error("provider_no_verdict");
  return { blocked: j.on_dnd, reason: j.reason || (j.on_dnd ? "on_ncpr" : "not_on_ncpr") };
}

/** Has this business been told, by this person, to stop calling? */
async function isOptedOut(sb: SupabaseClient, tenantId: string, phone: string): Promise<boolean> {
  if (!tenantId || !phone) return false;
  // outbound_opt_outs stores TEN BARE DIGITS (written that way by the pipeline
  // when a caller says "stop calling me", and by the dashboard), while every
  // number reaching this function is +91XXXXXXXXXX — outbound_recipients.phone
  // is normalised to E.164 on import. An exact .eq() therefore matched nothing,
  // ever: step 1 of the order above — the one the header calls the whole point
  // of a withdrawal, the one consent must never override — silently passed
  // every opted-out number straight through to the consent carve-out below.
  // Compare against every stored form, the same way campaign-import.ts and the
  // dispatcher's own dial-time check already do.
  const { data, error } = await sb.from("outbound_opt_outs")
    .select("phone").eq("tenant_id", tenantId).in("phone", phoneForms(phone)).limit(1);
  // A failed lookup is not an absence of opt-out. Treat it as one — the
  // caller turns this into a block — rather than dialling someone who may
  // have withdrawn because Postgres blinked.
  if (error) {
    console.error("[dnd] opt-out lookup failed:", error.message);
    return true;
  }
  return !!data?.length;
}

/** The newest still-valid provider answer for this number, if any. */
async function cachedAnswer(sb: SupabaseClient, phone: string): Promise<ScrubAnswer | null> {
  const { data, error } = await sb.from("dnd_scrub_results")
    .select("blocked, reason")
    .eq("phone", phone)
    .eq("source", "provider")          // never reuse a failure
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(1).maybeSingle();
  if (error || !data) return null;
  return { blocked: data.blocked, reason: data.reason || "cached" };
}

async function record(
  sb: SupabaseClient, phone: string, a: ScrubAnswer,
  source: "provider" | "unavailable" | "consent" | "opted_out",
): Promise<void> {
  const now = new Date();
  const { error } = await sb.from("dnd_scrub_results").insert({
    phone,
    blocked:    a.blocked,
    reason:     a.reason || null,
    source,
    provider:   source === "provider" ? PROVIDER_NAME() : null,
    checked_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlHours() * 3_600_000).toISOString(),
  });
  // The ledger is evidence, not a gate. Losing a write must not stop a
  // lawful call from being placed, but it must be loud.
  if (error) console.error("[dnd] scrub ledger write failed:", error.message);
}

/**
 * The decision. See the order-of-checks note at the top of this file.
 *
 * `consented` is the caller's judgement, not this module's: the dispatcher
 * knows which of consent_call_id / consent_declared /
 * skip_dnd_for_instant_leads applies to the row it holds.
 */
export async function scrubDnd(
  sb: SupabaseClient,
  phone: string,
  opts: { tenantId?: string; consented?: boolean } = {},
): Promise<ScrubAnswer> {
  const { tenantId = "", consented = false } = opts;

  // 1. Withdrawal beats everything, including consent. Someone who said
  //    stop has said stop.
  if (await isOptedOut(sb, tenantId, phone)) {
    const answer = { blocked: true, reason: "opted_out" };
    await record(sb, phone, answer, "opted_out");
    return answer;
  }

  // 2. Solicited contact.
  if (consented) {
    // Recorded, not just returned. Every call this platform actually places
    // takes THIS branch — no DND provider is configured, so everything else
    // is blocked — which meant the compliance ledger was empty of precisely
    // the calls that were made. An auditor asking "on what basis did you
    // ring this person" needs a row, not an absence of one.
    const answer = { blocked: false, reason: "self_submitted_enquiry_consent" };
    await record(sb, phone, answer, "consent");
    return answer;
  }

  // 3. The registry.
  if (!PROVIDER_URL()) {
    // Deliberately not cached: the day a provider IS configured, nothing
    // stale should be standing in front of it.
    console.warn(`[dnd] no DND_SCRUB_PROVIDER_URL — ${phone} cannot be scrubbed, blocking`);
    return { blocked: true, reason: "scrubbing_unavailable" };
  }

  const hit = await cachedAnswer(sb, phone);
  if (hit) return hit;

  try {
    const answer = await queryProvider(phone);
    await record(sb, phone, answer, "provider");
    return answer;
  } catch (e: any) {
    const reason = String(e?.message || e).slice(0, 120);
    console.error(`[dnd] scrub failed for ${phone}: ${reason}`);
    const answer = { blocked: true, reason: `scrub_failed:${reason}` };
    // 4. Recorded so an audit shows we asked and could not get an answer,
    //    and marked 'unavailable' so it is never served as a cache hit.
    await record(sb, phone, answer, "unavailable");
    return answer;
  }
}

/** True when a real registry is wired up — used to explain, in the UI and
 *  the logs, why bulk dialling is refusing to run. */
export function scrubProviderConfigured(): boolean {
  return !!PROVIDER_URL();
}
