/**
 * Monthly minutes — the gate that decides whether a paid tenant's call is
 * answered, and how much top-up credit a finished call spends.
 *
 * Paid plans had no minute limit at all (Starter's 200 minutes were
 * unlimited), and every call on a paid plan drained credit_minutes even when
 * the plan covered it. Both sides of each boundary are pinned here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.INTERNAL_SECRET ||= "test-secret";
const { minutesGate, creditMinutesToSpend } = await import("../dist/usage.js");

// A stub for the chains usage.ts uses: tenants/plans via maybeSingle, calls
// via a paged range().
function makeSb({ plan = "starter", credits = 0, limit = 200, callSeconds = [], callsError = null }) {
  return {
    from(table) {
      const q = {
        select() { return q; }, eq() { return q; }, gte() { return q; },
        neq() { return q; }, order() { return q; },
        maybeSingle() {
          if (table === "tenants") return Promise.resolve({ data: { plan, credit_minutes: credits }, error: null });
          if (table === "plans")   return Promise.resolve({ data: { minutes_per_month: limit }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        range() {
          if (callsError) return Promise.resolve({ data: null, error: { message: callsError } });
          return Promise.resolve({ data: callSeconds.map((s, i) => ({ id: String(i), duration_seconds: s })), error: null });
        },
      };
      return q;
    },
  };
}

test("trial with credits is allowed, without credits refused", async () => {
  assert.equal((await minutesGate(makeSb({ plan: "trial", credits: 5 }), "t")).ok, true);
  const g = await minutesGate(makeSb({ plan: "trial", credits: 0 }), "t");
  assert.equal(g.ok, false);
  assert.equal(g.reason, "no_credits");
});

test("paid plan under its minutes is allowed", async () => {
  const g = await minutesGate(makeSb({ callSeconds: [199 * 60] }), "t");
  assert.equal(g.ok, true);
  assert.equal(g.usedMinutes, 199);
});

test("paid plan at its minutes with no top-up is refused", async () => {
  const g = await minutesGate(makeSb({ callSeconds: [200 * 60] }), "t");
  assert.equal(g.ok, false);
  assert.equal(g.reason, "plan_minutes_exhausted");
});

test("paid plan past its minutes keeps going on top-up credit", async () => {
  assert.equal((await minutesGate(makeSb({ callSeconds: [250 * 60], credits: 30 }), "t")).ok, true);
});

test("a meter read failure never refuses a paying tenant's call", async () => {
  assert.equal((await minutesGate(makeSb({ callsError: "boom" }), "t")).ok, true);
});

test("a call wholly inside the plan spends no credit", async () => {
  assert.equal(await creditMinutesToSpend(makeSb({ callSeconds: [100 * 60] }), "t", "c", 120), 0);
});

test("a call crossing the limit spends only the minutes past it", async () => {
  // 199 min used before; a 3-minute call ends at 202 → 2 minutes over.
  assert.equal(await creditMinutesToSpend(makeSb({ callSeconds: [199 * 60] }), "t", "c", 180), 2);
});

test("a call entirely past the limit spends all its minutes", async () => {
  assert.equal(await creditMinutesToSpend(makeSb({ callSeconds: [300 * 60] }), "t", "c", 61), 2);
});

test("trial calls spend every minute, rounded up", async () => {
  assert.equal(await creditMinutesToSpend(makeSb({ plan: "trial" }), "t", "c", 61), 2);
});
