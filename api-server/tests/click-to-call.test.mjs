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
const { clickToCallFits, CTC_LEGS } = await import("../dist/esl.js");

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
