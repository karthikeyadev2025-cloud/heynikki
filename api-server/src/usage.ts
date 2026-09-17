/**
 * Monthly minutes: what a tenant has used, what its plan includes, and
 * whether it may place or take another call.
 *
 * WHY THIS EXISTS
 * Every call gate checked credit_minutes for trials and then waved paid plans
 * straight through — "credits are the trial, not a cap on customers who pay".
 * Nothing replaced the credit check with the plan's own allowance, so Starter
 * (₹1,999, 200 minutes) had no limit at all: a customer could run 5,000
 * minutes of Sarvam, Gemini and Jio on the one plan the site says includes 200.
 *
 * The rule, matching the pricing page ("200 minutes … upgrade any time"):
 *   - trial:  calls while credit_minutes > 0 (unchanged).
 *   - paid:   calls while this IST month's usage is under the plan's minutes;
 *             past that, only while bought top-up credit remains.
 *
 * Usage is DERIVED from the calls rows, the same sum the dashboard shows, so
 * the number that stops a call is the number the customer can see.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const PAID_PLANS = ["starter", "growth", "scale"];

/** First instant of the current month in IST, as an ISO string with offset. */
export function istMonthStart(now = Date.now()): string {
  const ist = new Date(now + 5.5 * 3600 * 1000).toISOString();
  return `${ist.slice(0, 7)}-01T00:00:00+05:30`;
}

/** The month key ("2026-09") that usage warnings are recorded against. */
export function istMonthKey(now = Date.now()): string {
  return new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 7);
}

/**
 * Seconds of calls this IST month. Paged, because PostgREST returns at most
 * 1000 rows per request and a meter that stops at the thousandth call
 * under-counts exactly the tenants most likely to be over.
 */
export async function monthUsedSeconds(
  sb: SupabaseClient, tenantId: string, excludeCallId?: string,
): Promise<number> {
  const PAGE = 1000;
  let total = 0;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from("calls").select("id,duration_seconds")
      .eq("tenant_id", tenantId).gte("created_at", istMonthStart());
    if (excludeCallId) q = q.neq("id", excludeCallId);
    const { data, error } = await q.order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`usage read failed: ${error.message}`);
    for (const r of data || []) total += Number((r as any).duration_seconds) || 0;
    if (!data || data.length < PAGE) break;
  }
  return total;
}

export async function planMinutes(sb: SupabaseClient, plan: string): Promise<number> {
  const { data, error } = await sb.from("plans").select("minutes_per_month")
    .eq("id", plan).maybeSingle();
  if (error) throw new Error(`plan read failed: ${error.message}`);
  return Number(data?.minutes_per_month) || 0;
}

export type MinutesGate = {
  ok: boolean;
  paid: boolean;
  usedMinutes: number;
  limitMinutes: number;
  credits: number;
  reason?: "no_credits" | "plan_minutes_exhausted";
  message?: string;
};

/**
 * May this tenant place or take another call?
 *
 * Fails OPEN on a read error for a paying tenant — refusing a customer's
 * caller because the meter could not be read is worse than one unmetered
 * call — and keeps the trial check exactly as strict as before.
 */
export async function minutesGate(sb: SupabaseClient, tenantId: string): Promise<MinutesGate> {
  const { data: t } = await sb.from("tenants").select("plan, credit_minutes")
    .eq("id", tenantId).maybeSingle();
  const plan    = String(t?.plan || "").toLowerCase();
  const credits = Number(t?.credit_minutes ?? 0);
  const paid    = PAID_PLANS.includes(plan);

  if (!paid) {
    return credits > 0
      ? { ok: true, paid, usedMinutes: 0, limitMinutes: 0, credits }
      : { ok: false, paid, usedMinutes: 0, limitMinutes: 0, credits,
          reason: "no_credits", message: "This number's free minutes have run out." };
  }

  try {
    const [secs, limit] = await Promise.all([monthUsedSeconds(sb, tenantId), planMinutes(sb, plan)]);
    const used = Math.ceil(secs / 60);
    if (limit <= 0 || used < limit || credits > 0) {
      return { ok: true, paid, usedMinutes: used, limitMinutes: limit, credits };
    }
    return { ok: false, paid, usedMinutes: used, limitMinutes: limit, credits,
             reason: "plan_minutes_exhausted",
             message: "This number's minutes for the month have run out." };
  } catch (e: any) {
    console.error(`[usage] gate read failed for ${tenantId} — allowing the call: ${e?.message || e}`);
    return { ok: true, paid, usedMinutes: 0, limitMinutes: 0, credits };
  }
}

/**
 * How many credit minutes a finished call should spend.
 *
 * Trial: every minute, as before. Paid: only the minutes that fall PAST the
 * plan's allowance. Deducting every call from credit_minutes on a paid plan
 * meant a top-up bought for overage was eaten by calls the plan already
 * covered, and the customer's first extra minute found an empty balance.
 */
export async function creditMinutesToSpend(
  sb: SupabaseClient, tenantId: string, callId: string, callSeconds: number,
): Promise<number> {
  const callMinutes = Math.ceil(callSeconds / 60);
  const { data: t } = await sb.from("tenants").select("plan").eq("id", tenantId).maybeSingle();
  const plan = String(t?.plan || "").toLowerCase();
  if (!PAID_PLANS.includes(plan)) return callMinutes;
  try {
    const [before, limit] = await Promise.all([
      monthUsedSeconds(sb, tenantId, callId), planMinutes(sb, plan),
    ]);
    if (limit <= 0) return 0;
    const usedBefore = Math.ceil(before / 60);
    const usedAfter  = Math.ceil((before + callSeconds) / 60);
    return Math.max(0, usedAfter - limit) - Math.max(0, usedBefore - limit);
  } catch (e: any) {
    // Unknown usage: charge nothing rather than drain a top-up the plan may
    // have covered. The call itself is still on the meter via its row.
    console.error(`[usage] overage calc failed for ${tenantId} — no credit spent: ${e?.message || e}`);
    return 0;
  }
}
