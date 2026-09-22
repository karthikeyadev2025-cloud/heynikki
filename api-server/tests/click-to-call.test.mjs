/**
 * Click-to-call line capacity.
 *
 * Every click-to-call takes two trunk channels, the seat's mobile and the
 * customer, and nothing counted them: with four telecallers dialling on a
 * 10-channel trunk, a fifth leg was refused by Jio's SBC as a generic
 * failure that looked like a dead line. These pin the arithmetic that now
 * refuses it first, with inbound headroom kept.
 *
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.INTERNAL_SECRET ||= "test-secret";
delete process.env.TRUNK_MAX_CHANNELS;       // the contract default: 10
delete process.env.TRUNK_OUTBOUND_CEILING;   // default: channels - 2 = 8
const { clickToCallFits, CTC_LEGS, admitClickToCall, pendingClickToCallLegs } =
  await import("../dist/esl.js");

// A channel count that every caller reads at the same stale value, which
// is exactly the race: all requests counted before any call appeared.
const staleCount = (n) => async () => n;

test("a click-to-call is two legs", () => {
  assert.equal(CTC_LEGS, 2);
});

test("four telecallers fit on a 10-channel trunk, a fifth does not", () => {
  // Channels in use when each seat presses Call.
  assert.equal(clickToCallFits(0), true);   // seat 1 -> 2
  assert.equal(clickToCallFits(2), true);   // seat 2 -> 4
  assert.equal(clickToCallFits(4), true);   // seat 3 -> 6
  assert.equal(clickToCallFits(6), true);   // seat 4 -> 8
  assert.equal(clickToCallFits(8), false);  // seat 5 would take the inbound pair
});

test("one channel short is refused: half a call cannot connect", () => {
  // 7 in use (say three seats and one inbound caller): 7 + 2 = 9 > 8.
  assert.equal(clickToCallFits(7), false);
});

test("the ceiling follows the contract when it changes", () => {
  // e.g. Jio sells 20 channels: TRUNK_MAX_CHANNELS=20 -> ceiling 18.
  assert.equal(clickToCallFits(16, 18), true);
  assert.equal(clickToCallFits(17, 18), false);
});

/* ── the race between seats ─────────────────────────────────── */

test("two seats pressing Call together at 6 in use: exactly one gets through", async () => {
  const [a, b] = await Promise.all([
    admitClickToCall(staleCount(6)),
    admitClickToCall(staleCount(6)),
  ]);
  const admitted = [a, b].filter(r => r.hold);
  assert.equal(admitted.length, 1, "the second must count the first's reserved legs");
  assert.equal(pendingClickToCallLegs(), 2);
  admitted.forEach(r => r.hold.release());
  assert.equal(pendingClickToCallLegs(), 0);
});

test("five seats at once on an idle trunk: four admitted, the fifth refused", async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => admitClickToCall(staleCount(0))));
  const admitted = results.filter(r => r.hold);
  assert.equal(admitted.length, 4);
  assert.equal(pendingClickToCallLegs(), 8);
  const refused = results.find(r => !r.hold);
  assert.equal(refused.counted, 8, "the refusal reports what it counted, reservations included");
  admitted.forEach(r => r.hold.release());
  assert.equal(pendingClickToCallLegs(), 0);
});

test("a released call frees its lines for the next seat", async () => {
  const first = await admitClickToCall(staleCount(6));
  assert.ok(first.hold);
  assert.equal((await admitClickToCall(staleCount(6))).hold, null);
  first.hold.release();                      // e.g. the seat did not answer
  const next = await admitClickToCall(staleCount(6));
  assert.ok(next.hold);
  next.hold.release();
});

test("releasing in parts, and past zero, never corrupts the count", async () => {
  const r = await admitClickToCall(staleCount(0));
  r.hold.release(1);                         // the seat's leg became visible
  assert.equal(pendingClickToCallLegs(), 1);
  r.hold.release();                          // the customer's leg bridged
  r.hold.release();                          // a late timer firing again
  r.hold.release(5);
  assert.equal(pendingClickToCallLegs(), 0);
});
