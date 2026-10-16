/**
 * Questions Nikki could not answer — filed once, counted when asked again.
 *
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const G = await import("../dist/knowledge-gaps.js");

test("the same question in different case and punctuation files as one", () => {
  assert.equal(G.gapKey("How much for 100 visiting cards?"), G.gapKey("how much for 100 Visiting Cards"));
  assert.equal(G.gapKey("  When  will it be ready?? "), "when will it be ready");
});

test("Telugu questions keep their letters", () => {
  assert.equal(G.gapKey("ఎంత అవుతుంది?"), "ఎంత అవుతుంది");
});

test("the scorer's list is cleaned: real questions, no repeats, at most three", () => {
  const out = G.cleanGaps([
    { question: "Price of 100 visiting cards?", caller_said: "100 card-లు ఎంత" },
    { question: "price of 100 visiting cards" },
    { question: "ok" },
    { question: "When will the T-shirts be ready?" },
    { question: "Do you deliver?" },
    { question: "Is there parking?" },
    null,
  ]);
  assert.deepEqual(out.map(g => g.question),
    ["Price of 100 visiting cards?", "When will the T-shirts be ready?", "Do you deliver?"]);
  assert.equal(out[0].caller_said, "100 card-లు ఎంత");
  assert.deepEqual(G.cleanGaps("nonsense"), []);
});
