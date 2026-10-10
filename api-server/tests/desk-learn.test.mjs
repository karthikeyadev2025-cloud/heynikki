/**
 * What the Desk learns from its calls — the follow-up nobody booked, the
 * suggestion made five days running, and the counts behind "who says yes".
 *
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const L = await import("../dist/desk-learn.js");
const ist = (s) => Date.parse(s + "+05:30");
const at = (r) => new Date(Date.parse(r.at) + 5.5 * 3600_000).toISOString().slice(0, 16);

test("a time the customer named is kept, for interested as well as callback", () => {
  const now = ist("2026-09-30T12:00:00");
  for (const d of ["callback", "interested"]) {
    const r = L.followUpFor(d, "2026-10-03T10:00:00+05:30", now);
    assert.equal(r.explicit, true);
    assert.equal(at(r), "2026-10-03T10:00");
  }
});

test("call me later, said in the morning, comes back at four the same day", () => {
  const r = L.followUpFor("callback", null, ist("2026-09-30T12:26:00"));
  assert.equal(r.explicit, false);
  assert.equal(at(r), "2026-09-30T16:00");
});

test("call me later, said in the afternoon, comes back the next working morning", () => {
  assert.equal(at(L.followUpFor("callback", null, ist("2026-09-30T17:24:00"))), "2026-10-01T11:30");
});

test("interested without a time is rung the next working morning", () => {
  assert.equal(at(L.followUpFor("interested", null, ist("2026-09-29T16:12:00"))), "2026-09-30T11:30");
});

test("Saturday's follow-up skips Sunday", () => {
  // 26 Sep 2026 is a Saturday.
  assert.equal(at(L.followUpFor("interested", null, ist("2026-09-26T15:20:00"))), "2026-09-28T11:30");
});

test("a time already past is treated as no time", () => {
  const r = L.followUpFor("callback", "2026-09-01T10:00:00+05:30", ist("2026-09-30T17:00:00"));
  assert.equal(r.explicit, false);
});

test("other outcomes book nothing", () => {
  for (const d of ["booked", "not_interested", "no_answer"]) {
    assert.equal(L.followUpFor(d, "2026-10-03T10:00:00+05:30", ist("2026-09-30T12:00:00")), null);
  }
});

test("facts drop none/unknown and keep what was said", () => {
  const f = L.cleanFacts({ business_type: " Hospital ", speaker: "employee", has_website: "unknown",
    pitched: ["website", "", "CRM"], price_quoted: "null", objection: "Not mentioned", questions: ["Do you build websites?"], next_step: "call after two weeks" });
  assert.deepEqual(f, { business_type: "hospital", speaker: "employee", pitched: ["website", "CRM"],
    questions: ["Do you build websites?"], next_step: "call after two weeks" });
  assert.deepEqual(L.cleanFacts(null), {});
});

test("transcript turns are labelled agent or customer and empties dropped", () => {
  const t = L.cleanTranscript([{ who: "Telecaller", text: " hello " }, { who: "customer", text: "" }, { speaker: "customer", text: "ok" }]);
  assert.deepEqual(t, [{ who: "agent", text: "hello" }, { who: "customer", text: "ok" }]);
  assert.deepEqual(L.cleanTranscript("nope"), []);
});

test("labels are swapped when the 'customer' is the one saying where they call from", () => {
  const t = L.cleanTranscript([{ who: "agent", text: "Hello" }, { who: "customer", text: "Sir I am calling from Nikki Technologies" },
    { who: "agent", text: "Okay" }]);
  assert.deepEqual(t.map(x => x.who), ["customer", "agent", "customer"]);
  const ok = L.cleanTranscript([{ who: "customer", text: "Hello" }, { who: "agent", text: "nenu software company nunchi call chestunna" }]);
  assert.deepEqual(ok.map(x => x.who), ["customer", "agent"]);
});

test("a question already approved or dismissed is not suggested again", () => {
  const decided = L.decidedQuestions(
    [{ suggestions: [{ question: "Do you build websites?", status: "approved" }, { question: "Do you do SEO?", status: "pending" },
      { question: "Is there EMI?", status: "dismissed" }] }, { suggestions: null }],
    ['If asked "How can you help with our business requirements?": We provide…', "Websites with 5 pages cost ₹7,000."]);
  const out = L.freshSuggestions([
    { question: "do you build websites" }, { question: "Do you do SEO?" }, { question: "Is there EMI ?" },
    { question: "How can you help with our business requirements?" }, { question: "Do you do SEO?" },
  ], decided);
  assert.deepEqual(out.map(x => x.question), ["Do you do SEO?"]);
});

test("patterns: segments, hours, objections and interest rung only once", () => {
  const row = (time, n, o = {}) => ({ created_at: new Date(ist(time)).toISOString(), callee_number: n,
    duration_seconds: 60, customer_answered_at: "x", disposition: "not_interested", ...o });
  const rows = [];
  for (let i = 0; i < 4; i++) rows.push(row("2026-09-30T16:10:00", "h" + i, { ai_facts: { business_type: "hospital", objection: "No requirement." }, disposition: i < 2 ? "interested" : "not_interested" }));
  for (let i = 0; i < 6; i++) rows.push(row("2026-09-30T16:20:00", "s" + i, { ai_facts: { business_type: "shop" } }));
  rows.push(row("2026-09-30T16:30:00", "h0"));                       // h0 was rung again
  rows.push(row("2026-09-30T13:00:00", "x", { ai_facts: { business_type: "hotel" } }));   // one hotel: not shown
  const p = L.patterns(rows, 15, 14);
  assert.deepEqual(p.segments, [{ name: "hospital", talked: 4, positive: 2 }, { name: "shop", talked: 6, positive: 0 }]);
  assert.deepEqual(p.hours, [{ hour: 16, calls: 11, answered: 11, positive: 2 }]);
  assert.deepEqual(p.objections, [{ text: "no requirement", count: 4 }]);
  assert.equal(p.never_called_again, 1);
});
