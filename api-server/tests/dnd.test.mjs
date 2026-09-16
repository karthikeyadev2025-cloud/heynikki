/**
 * DND scrub decisions — the first tests in api-server.
 *
 * These exist because scrubDnd decides whether a phone rings, and the two
 * ways it can be wrong are not symmetric: a false block costs a call, a
 * false allow is a TRAI violation. Every case below is one of those, and
 * the ordering ones (opt-out vs consent) cannot be checked by reading the
 * code — they depend on which branch returns first.
 *
 *   npm test        (builds with tsc, then runs this)
 *
 * No test framework: node's own runner, so this adds zero dependencies to
 * a service that ships to production.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.INTERNAL_SECRET ||= "test-secret";   // dnd.ts's import chain is clean, but keep parity
const { scrubDnd } = await import("../dist/dnd.js");

// ── a Supabase stub that speaks just the chain dnd.ts uses ───────────────
function makeSb({ optOut = null, optOutError = null, cached = null, onInsert = () => {} } = {}) {
  const inserts = [];
  const client = {
    inserts,
    from(table) {
      const q = {
        _table: table,
        select() { return q; },
        eq()     { return q; },
        gt()     { return q; },
        order()  { return q; },
        limit()  { return q; },
        maybeSingle() {
          if (q._table === "outbound_opt_outs") {
            return Promise.resolve({ data: optOut, error: optOutError });
          }
          return Promise.resolve({ data: cached, error: null });
        },
        insert(row) { inserts.push(row); onInsert(row); return Promise.resolve({ error: null }); },
      };
      return q;
    },
  };
  return client;
}

function withProvider(fn, { url = "https://scrub.example", token = "t" } = {}) {
  const prevUrl = process.env.DND_SCRUB_PROVIDER_URL;
  const prevTok = process.env.DND_SCRUB_PROVIDER_TOKEN;
  process.env.DND_SCRUB_PROVIDER_URL = url;
  process.env.DND_SCRUB_PROVIDER_TOKEN = token;
  const prevFetch = globalThis.fetch;
  return Promise.resolve(fn()).finally(() => {
    globalThis.fetch = prevFetch;
    if (prevUrl === undefined) delete process.env.DND_SCRUB_PROVIDER_URL;
    else process.env.DND_SCRUB_PROVIDER_URL = prevUrl;
    if (prevTok === undefined) delete process.env.DND_SCRUB_PROVIDER_TOKEN;
    else process.env.DND_SCRUB_PROVIDER_TOKEN = prevTok;
  });
}

function noProvider(fn) {
  const prev = process.env.DND_SCRUB_PROVIDER_URL;
  delete process.env.DND_SCRUB_PROVIDER_URL;
  return Promise.resolve(fn()).finally(() => {
    if (prev !== undefined) process.env.DND_SCRUB_PROVIDER_URL = prev;
  });
}

// ── ordering: a withdrawal outranks a consent ────────────────────────────
test("an opted-out number is blocked even when consent is on file", async () => {
  const sb = makeSb({ optOut: { phone: "9848012345" } });
  const r = await scrubDnd(sb, "9848012345", { tenantId: "t1", consented: true });
  assert.equal(r.blocked, true, "consent must not override a withdrawal");
  assert.equal(r.reason, "opted_out");
});

test("an opted-out number is blocked even with a provider that would allow it", async () => {
  await withProvider(async () => {
    globalThis.fetch = async () => { throw new Error("provider must not be consulted"); };
    const sb = makeSb({ optOut: { phone: "9848012345" } });
    const r = await scrubDnd(sb, "9848012345", { tenantId: "t1" });
    assert.equal(r.blocked, true);
    assert.equal(r.reason, "opted_out");
  });
});

test("an opt-out lookup that errors blocks rather than assumes", async () => {
  const sb = makeSb({ optOutError: { message: "connection reset" } });
  const r = await scrubDnd(sb, "9848012345", { tenantId: "t1", consented: true });
  assert.equal(r.blocked, true, "a failed lookup is not an absence of opt-out");
});

// ── consent ──────────────────────────────────────────────────────────────
test("consent dials without a provider configured", async () => {
  await noProvider(async () => {
    const sb = makeSb();
    const r = await scrubDnd(sb, "9848012345", { tenantId: "t1", consented: true });
    assert.equal(r.blocked, false);
    assert.equal(r.reason, "self_submitted_enquiry_consent");
  });
});

// ── fail-safe ────────────────────────────────────────────────────────────
test("no consent and no provider blocks", async () => {
  await noProvider(async () => {
    const sb = makeSb();
    const r = await scrubDnd(sb, "9848012345", { tenantId: "t1" });
    assert.equal(r.blocked, true, "bulk dialling must stay blocked until a registry is wired");
    assert.equal(r.reason, "scrubbing_unavailable");
  });
});

test("an unconfigured scrub is NOT written to the ledger as a provider answer", async () => {
  await noProvider(async () => {
    const sb = makeSb();
    await scrubDnd(sb, "9848012345", { tenantId: "t1" });
    assert.equal(sb.inserts.length, 0, "nothing to cache in front of a future provider");
  });
});

// ── the provider ─────────────────────────────────────────────────────────
test("provider says on_dnd -> blocked, and it is recorded", async () => {
  await withProvider(async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ on_dnd: true, reason: "on_ncpr" }) });
    const sb = makeSb();
    const r = await scrubDnd(sb, "9848012345", { tenantId: "t1" });
    assert.equal(r.blocked, true);
    assert.equal(sb.inserts.length, 1);
    assert.equal(sb.inserts[0].source, "provider");
    assert.equal(sb.inserts[0].blocked, true);
  });
});

test("provider says not on dnd -> allowed", async () => {
  await withProvider(async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ on_dnd: false }) });
    const sb = makeSb();
    const r = await scrubDnd(sb, "9848012345", { tenantId: "t1" });
    assert.equal(r.blocked, false);
    assert.equal(sb.inserts[0].source, "provider");
  });
});

test("a 200 with no verdict is a failure to ask, not permission to dial", async () => {
  await withProvider(async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: "fine" }) });
    const sb = makeSb();
    const r = await scrubDnd(sb, "9848012345", { tenantId: "t1" });
    assert.equal(r.blocked, true);
    assert.match(r.reason, /provider_no_verdict/);
  });
});

test("provider HTTP error blocks and is recorded as unavailable, never as an answer", async () => {
  await withProvider(async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const sb = makeSb();
    const r = await scrubDnd(sb, "9848012345", { tenantId: "t1" });
    assert.equal(r.blocked, true);
    assert.equal(sb.inserts[0].source, "unavailable",
      "a failure cached as a provider answer would be served as a verdict later");
    assert.equal(sb.inserts[0].provider, null);
  });
});

test("provider that throws (timeout, DNS, reset) blocks", async () => {
  await withProvider(async () => {
    globalThis.fetch = async () => { throw new Error("The operation was aborted due to timeout"); };
    const sb = makeSb();
    const r = await scrubDnd(sb, "9848012345", { tenantId: "t1" });
    assert.equal(r.blocked, true);
    assert.match(r.reason, /scrub_failed/);
  });
});

// ── caching ──────────────────────────────────────────────────────────────
test("a fresh cached answer is used and the provider is not called", async () => {
  await withProvider(async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({ on_dnd: false }) }; };
    const sb = makeSb({ cached: { blocked: true, reason: "on_ncpr" } });
    const r = await scrubDnd(sb, "9848012345", { tenantId: "t1" });
    assert.equal(r.blocked, true);
    assert.equal(called, false, "a valid cached answer must not cost a provider round trip");
    assert.equal(sb.inserts.length, 0, "a cache hit is not a new scrub record");
  });
});

test("the scrub record carries an expiry inside the seven-day ceiling", async () => {
  await withProvider(async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ on_dnd: false }) });
    const sb = makeSb();
    await scrubDnd(sb, "9848012345", { tenantId: "t1" });
    const row = sb.inserts[0];
    const ms = new Date(row.expires_at) - new Date(row.checked_at);
    assert.ok(ms > 0, "an expiry in the past would re-scrub every time");
    assert.ok(ms <= 7 * 24 * 3600 * 1000,
      "the migration's CHECK constraint rejects anything longer, so this would fail on insert");
  });
});

test("DND_SCRUB_TTL_HOURS cannot push the window past seven days", async () => {
  const prev = process.env.DND_SCRUB_TTL_HOURS;
  process.env.DND_SCRUB_TTL_HOURS = "99999";
  try {
    await withProvider(async () => {
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ on_dnd: false }) });
      const sb = makeSb();
      await scrubDnd(sb, "9848012345", { tenantId: "t1" });
      const row = sb.inserts[0];
      const ms = new Date(row.expires_at) - new Date(row.checked_at);
      assert.ok(ms <= 7 * 24 * 3600 * 1000, "clamped to the ceiling the DB enforces");
    });
  } finally {
    if (prev === undefined) delete process.env.DND_SCRUB_TTL_HOURS;
    else process.env.DND_SCRUB_TTL_HOURS = prev;
  }
});
