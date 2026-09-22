/**
 * Shift arithmetic — hours are what a telecaller is judged (and maybe paid)
 * on, so the edge cases are pinned: midnight, the forgotten check-out, the
 * 12-hour cap, and a shift still running.
 *
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.INTERNAL_SECRET ||= "test-secret";
const A = await import("../dist/attendance.js");

const ist = (s) => Date.parse(s + "+05:30");        // "2026-09-22T09:00:00" in IST
const iso = (s) => new Date(ist(s)).toISOString();
const H = 3600_000;

test("IST day boundaries", () => {
  assert.equal(A.istDate(ist("2026-09-22T00:10:00")), "2026-09-22");
  assert.equal(A.istDate(ist("2026-09-21T23:50:00")), "2026-09-21");
  assert.equal(A.istDayStartMs(ist("2026-09-22T15:00:00")), ist("2026-09-22T00:00:00"));
});

test("a closed shift counts exactly its length", () => {
  const s = [{ user_id: "u", check_in_at: iso("2026-09-22T09:00:00"), check_out_at: iso("2026-09-22T13:30:00") }];
  const day = A.istDayStartMs(ist("2026-09-22T12:00:00"));
  assert.equal(A.workedMs(s, day, day + 24 * H), 4.5 * H);
});

test("a shift still running counts up to now, and is open", () => {
  const s = { user_id: "u", check_in_at: iso("2026-09-22T09:00:00"), check_out_at: null };
  const now = ist("2026-09-22T11:15:00");
  assert.equal(A.isOpen(s, now), true);
  assert.equal(A.workedMs([s], ist("2026-09-22T00:00:00"), now + 1, now), 2.25 * H);
});

test("a forgotten check-out stops at 12 hours, not at now", () => {
  const s = { user_id: "u", check_in_at: iso("2026-09-22T09:00:00"), check_out_at: null };
  const next = ist("2026-09-23T10:00:00");           // they never checked out
  assert.equal(A.isOpen(s, next), false);
  assert.equal(A.workedMs([s], ist("2026-09-22T00:00:00"), next, next), 12 * H);
});

test("a late shift left open stops at 23:59:59 IST, before 12 hours", () => {
  const s = { user_id: "u", check_in_at: iso("2026-09-22T18:00:00"), check_out_at: null };
  assert.equal(A.autoCloseAtMs(s.check_in_at), ist("2026-09-22T23:59:59"));
});

test("a shift across midnight splits between the two days", () => {
  const s = [{ user_id: "u", check_in_at: iso("2026-09-22T22:00:00"), check_out_at: iso("2026-09-23T02:00:00") }];
  const d1 = ist("2026-09-22T00:00:00"), d2 = ist("2026-09-23T00:00:00");
  assert.equal(A.workedMs(s, d1, d2), 2 * H);
  assert.equal(A.workedMs(s, d2, d2 + 24 * H), 2 * H);
  assert.equal(A.daysPresent(s, d1, d2 + 24 * H), 2);
});

test("days present counts days, not shifts", () => {
  const s = [
    { user_id: "u", check_in_at: iso("2026-09-22T09:00:00"), check_out_at: iso("2026-09-22T12:00:00") },
    { user_id: "u", check_in_at: iso("2026-09-22T14:00:00"), check_out_at: iso("2026-09-22T18:00:00") },
    { user_id: "u", check_in_at: iso("2026-09-24T09:00:00"), check_out_at: iso("2026-09-24T10:00:00") },
  ];
  assert.equal(A.daysPresent(s, ist("2026-09-20T00:00:00"), ist("2026-09-27T00:00:00")), 2);
});

test("a missing table is recognised, other errors are not", () => {
  assert.equal(A.missingTable({ code: "PGRST205", message: "Could not find the table 'public.seat_attendance'" }), true);
  assert.equal(A.missingTable({ code: "42P01", message: 'relation "seat_targets" does not exist' }), true);
  assert.equal(A.missingTable({ code: "23505", message: "duplicate key" }), false);
  assert.equal(A.missingTable(null), false);
});
