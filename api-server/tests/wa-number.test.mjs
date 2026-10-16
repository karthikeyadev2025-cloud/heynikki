/**
 * The number Meta is handed: country code explicit, landlines refused.
 *
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { waMsisdn } = await import("../dist/wa-number.js");

test("Indian mobiles in every shape become 91 + ten digits", () => {
  for (const n of ["9849313355", "09849313355", "+91 98493 13355", "919849313355"]) {
    assert.deepEqual(waMsisdn(n), { ok: true, msisdn: "919849313355" });
  }
});

test("a landline or a short number is refused before it costs a send", () => {
  assert.equal(waMsisdn("4045208195").ok, false);
  assert.equal(waMsisdn("12345").ok, false);
});

test("a foreign number with its country code is left alone", () => {
  assert.deepEqual(waMsisdn("+1 404 520 8195"), { ok: true, msisdn: "14045208195" });
});
