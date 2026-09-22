/**
 * Telecaller shifts: the rules for turning check-in rows into hours.
 *
 * Shared by the Desk (a person's own day, the owner's team view) and Super
 * Admin (hours across a period), so the two can never disagree about how
 * long somebody worked. The time arithmetic is pure and tested
 * (tests/attendance.test.mjs); only closeStale touches the database.
 *
 * THE RULES
 *  - Days are IST days. A shift that crosses midnight counts in each day
 *    for the part that fell in it.
 *  - A shift nobody closed ends at the EARLIER of 23:59:59 IST on the day it
 *    began, or 12 hours after it began. Until the API writes that close, the
 *    same cap is applied on read, so an open row from yesterday never shows
 *    someone "on shift" for 30 hours.
 *  - Migration 061 creates the tables. Until it is applied, reads report
 *    "not ready" rather than erroring, so deploying this before the SQL is
 *    pasted cannot break the Desk.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const IST_MS       = 5.5 * 3600_000;
export const MAX_SHIFT_MS = 12 * 3600_000;
/** A call of this many seconds or more is counted as a conversation (see
 *  admin-ops.ts for why duration > 0 is not a connect). */
export const CONVERSATION_SECS = 15;

export type Shift = { user_id: string; check_in_at: string; check_out_at: string | null; auto_closed?: boolean };

/** yyyy-mm-dd of the IST day containing `t`. */
export function istDate(t: number): string {
  return new Date(t + IST_MS).toISOString().slice(0, 10);
}
/** Epoch ms of 00:00 IST on the day containing `t`. */
export function istDayStartMs(t = Date.now()): number {
  return Date.parse(`${istDate(t)}T00:00:00+05:30`);
}

/** When an unclosed shift is treated as over. */
export function autoCloseAtMs(checkInIso: string): number {
  const t = Date.parse(checkInIso);
  const dayEnd = Date.parse(`${istDate(t)}T23:59:59+05:30`);
  return Math.min(dayEnd, t + MAX_SHIFT_MS);
}

/** The shift's effective end: its check-out, or now, or the auto-close cap. */
export function effectiveEndMs(s: Shift, now = Date.now()): number {
  if (s.check_out_at) return Date.parse(s.check_out_at);
  return Math.min(now, autoCloseAtMs(s.check_in_at));
}

/** On shift right now: no check-out, and not past its auto-close cap. */
export function isOpen(s: Shift, now = Date.now()): boolean {
  return !s.check_out_at && now < autoCloseAtMs(s.check_in_at);
}

/** Milliseconds of the shifts that fall inside [fromMs, toMs). */
export function workedMs(shifts: Shift[], fromMs: number, toMs: number, now = Date.now()): number {
  let total = 0;
  for (const s of shifts) {
    const a = Math.max(Date.parse(s.check_in_at), fromMs);
    const b = Math.min(effectiveEndMs(s, now), toMs);
    if (b > a) total += b - a;
  }
  return total;
}

/** Distinct IST days on which the person was on shift at all. */
export function daysPresent(shifts: Shift[], fromMs: number, toMs: number, now = Date.now()): number {
  const days = new Set<string>();
  for (const s of shifts) {
    let a = Math.max(Date.parse(s.check_in_at), fromMs);
    const b = Math.min(effectiveEndMs(s, now), toMs);
    while (a < b) {
      days.add(istDate(a));
      a = istDayStartMs(a) + 24 * 3600_000;       // next IST midnight
    }
  }
  return days.size;
}

/** The table does not exist yet: migration 061 has not been applied. */
export function missingTable(err: any): boolean {
  return !!err && (err.code === "PGRST205" || err.code === "42P01"
    || /could not find the table|does not exist/i.test(String(err.message || "")));
}

/**
 * Write the auto-close for shifts past their cap, so the table matches what
 * reads already assume. Guarded on check_out_at IS NULL, so a real check-out
 * that lands at the same moment always wins.
 */
export async function closeStale(sb: SupabaseClient, tenantId: string, userId?: string, now = Date.now()): Promise<void> {
  let q = sb.from("seat_attendance").select("id, check_in_at")
    .eq("tenant_id", tenantId).is("check_out_at", null);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  if (error) return;                                 // not ready, or transient: reads cap anyway
  for (const r of data || []) {
    const cap = autoCloseAtMs(r.check_in_at);
    if (now < cap) continue;
    await sb.from("seat_attendance")
      .update({ check_out_at: new Date(cap).toISOString(), auto_closed: true })
      .eq("id", r.id).is("check_out_at", null);
  }
}
