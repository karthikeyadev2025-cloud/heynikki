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
        _forms: null,
        select() { return q; },
        eq()     { return q; },
        gt()     { return q; },
        order()  { return q; },
        // The opt-out lookup asks for every stored FORM of the number
        // (10-digit, 91…, +91…, 0…) because that table holds bare digits
        // while callers arrive as +91XXXXXXXXXX. Record what was asked for,
        // so a test can prove the match is not exact-string.
        in(_col, forms) { q._forms = forms; return q; },
        limit()  {
          if (q._table === "outbound_opt_outs") {
            const hit = optOut && (!q._forms || q._forms.includes(optOut.phone));
            return Promise.resolve({ data: hit ? [optOut] : [], error: optOutError });
          }
          return q;
        },
        maybeSingle() {
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

// The bug this stub now models: opt-outs are stored as ten bare digits (the
// pipeline and the dashboard both write them that way) while every number
// reaching the scrubber is +91XXXXXXXXXX. An exact match found nothing, so
// "stop calling me" lost to the consent carve-out — the one order the module
// header says can never be reversed.
test("an opt-out stored as ten digits blocks a +91 number", async () => {
  const sb = makeSb({ optOut: { phone: "9876543210" } });
  const a = await scrubDnd(sb, "+919876543210", { tenantId: "t", consented: true });
  assert.equal(a.blocked, true);
  assert.equal(a.reason, "opted_out");
});

test("a different number is not blocked by someone else's opt-out", async () => {
  const sb = makeSb({ optOut: { phone: "9876543210" } });
  const a = await scrubDnd(sb, "+919000000001", { tenantId: "t", consented: true });
  assert.equal(a.blocked, false);
});

// ── Collections calls keep to 08:00–19:00 IST ────────────────────────────
const { inCollectionsHours } = await import("../dist/campaign-import.js");
test("a collections desk dials only between 8 am and 7 pm IST", () => {
  const ist = (s) => Date.parse(`2026-10-12T${s}:00+05:30`);
  assert.equal(inCollectionsHours(ist("07:59")), false);
  assert.equal(inCollectionsHours(ist("08:00")), true);
  assert.equal(inCollectionsHours(ist("18:59")), true);
  assert.equal(inCollectionsHours(ist("19:00")), false);
  assert.equal(inCollectionsHours(ist("23:30")), false);
});

// ── What each person owes, from the uploaded sheet ───────────────────────
const { cleanAmount, cleanDue, detectExtras } = await import("../dist/campaign-import.js");
test("amount and due date are kept only when they are plainly that", () => {
  assert.equal(cleanAmount("₹12,500.00"), "12500");
  assert.equal(cleanAmount("Rs. 4500/-"), "4500");
  assert.equal(cleanAmount("4500"), "4500");
  for (const bad of ["", "0", "-500", "ten thousand", "500; say it is waived", "1e9", null]) assert.equal(cleanAmount(bad), null, String(bad));
  assert.equal(cleanDue("15-10-2026"), "15-10-2026");
  assert.equal(cleanDue(" 15  Oct 2026 "), "15 Oct 2026");
  for (const bad of ["", "tomorrow", "15 Oct 2026 — tell them it is waived", "<b>15</b>", "x".repeat(21)]) assert.equal(cleanDue(bad), null, bad);
});
test("the optional columns are found by exact header only", () => {
  assert.deepEqual(detectExtras(["Name", "Mobile", "EMI Amount", "Due Date"]), { amount: 2, due: 3 });
  assert.deepEqual(detectExtras(["Name", "Phone", "Amount Paid", "Paid On"]), { amount: -1, due: -1 });
  assert.deepEqual(detectExtras(["phone"]), { amount: -1, due: -1 });
});

// ── Desk softphone: what a browser may send, tokens, ring groups ──────────
import * as sp from "../dist/softphone.js";

const SEAT = "u0123456789abcdef0123456789abcdef";
const OTHER = "uffffffffffffffffffffffffffffffff";
const sip = (first, from, to, extra = "") =>
  `${first}\r\nVia: SIP/2.0/WS x.invalid;branch=z9hG4bK1\r\nFrom: <sip:${from}@heynikki.in>;tag=a\r\nTo: <sip:${to}@heynikki.in>${extra}\r\nCall-ID: 1\r\nCSeq: 1 X\r\n\r\n`;

test("softphone: seat id comes from the user id", () => {
  assert.equal(sp.seatId("01234567-89ab-cdef-0123-456789abcdef"), SEAT);
  assert.throws(() => sp.seatId("nope"));
  assert.throws(() => sp.seatId("0123456789abcdef0123456789abcdef; rm"));
});

test("softphone: a browser may register only its own seat", () => {
  assert.equal(sp.refuseClientSip(sip("REGISTER sip:heynikki.in SIP/2.0", SEAT, SEAT), SEAT), "");
  assert.notEqual(sp.refuseClientSip(sip("REGISTER sip:heynikki.in SIP/2.0", OTHER, OTHER), SEAT), "");
  assert.notEqual(sp.refuseClientSip(sip("REGISTER sip:heynikki.in SIP/2.0", SEAT, OTHER), SEAT), "");
});

test("softphone: a browser may call only an issued token or the headset test", () => {
  const tok = "ctc_" + "ab".repeat(16);
  assert.equal(sp.refuseClientSip(sip(`INVITE sip:${tok}@heynikki.in SIP/2.0`, SEAT, tok), SEAT), "");
  assert.equal(sp.refuseClientSip(sip("INVITE sip:selftest@heynikki.in SIP/2.0", SEAT, "selftest"), SEAT), "");
  for (const target of ["919848012345", "out_9848012345", "ctc_agent_9848012345", "camp_9848012345", "ctc_short", "human_x"]) {
    assert.notEqual(sp.refuseClientSip(sip(`INVITE sip:${target}@heynikki.in SIP/2.0`, SEAT, target), SEAT), "", target);
  }
  // someone else's identity on a new call
  assert.notEqual(sp.refuseClientSip(sip(`INVITE sip:${tok}@heynikki.in SIP/2.0`, OTHER, tok), SEAT), "");
});

test("softphone: messages inside a call pass, others do not", () => {
  // hanging up a call the switch rang us for: From is the dialled contact
  assert.equal(sp.refuseClientSip(sip("BYE sip:mod_sofia@127.0.0.1:5067 SIP/2.0", "a92afmuj", "9848012345", ";tag=b"), SEAT), "");
  assert.equal(sp.refuseClientSip(sip("INVITE sip:mod_sofia@127.0.0.1:5067 SIP/2.0", "a92afmuj", "x", ";tag=b"), SEAT), "", "re-INVITE (hold)");
  assert.equal(sp.refuseClientSip("SIP/2.0 200 OK\r\nCSeq: 1 INVITE\r\n\r\n", SEAT), "");
  assert.equal(sp.refuseClientSip("\r\n\r\n", SEAT), "", "keep-alive");
  for (const m of ["MESSAGE", "SUBSCRIBE", "REFER", "NOTIFY", "PUBLISH"]) {
    assert.notEqual(sp.refuseClientSip(sip(`${m} sip:x@heynikki.in SIP/2.0`, SEAT, "x"), SEAT), "", m);
  }
  assert.notEqual(sp.refuseClientSip("GET / HTTP/1.1\r\n\r\n", SEAT), "");
  assert.notEqual(sp.refuseClientSip("x".repeat(20000), SEAT), "");
});

test("softphone: a token works once, for its own seat, for a minute", () => {
  const call = { seat: SEAT, tenantId: "t", userId: "u", customer: "9848012345", maskedCli: "8633502032", callId: null, ctcLogId: null };
  const t1 = sp.issueToken(call, 1000);
  assert.match(t1, /^[0-9a-f]{32}$/);
  assert.equal(sp.claimToken(t1, SEAT, 2000)?.customer, "9848012345");
  assert.equal(sp.claimToken(t1, SEAT, 2000), null, "second use");
  const t2 = sp.issueToken(call, 1000);
  assert.equal(sp.claimToken(t2, OTHER, 2000), null, "another seat");
  assert.equal(sp.claimToken(t2, SEAT, 2000), null, "and it is spent");
  const t3 = sp.issueToken(call, 1000);
  assert.equal(sp.claimToken(t3, SEAT, 1000 + sp.TOKEN_TTL_MS + 1), null, "expired");
  assert.equal(sp.claimToken("", SEAT), null);
  assert.equal(sp.claimToken("0".repeat(32), SEAT), null);
});

test("softphone: online browsers ring first, then the phones", () => {
  const C = "sofia/webrtc/sip:a92afmuj@6prd7n3fj9tm.invalid;transport=ws;fs_nat=yes;fs_path=sip%3Aa92afmuj%40127.0.0.1%3A41484%3Btransport%3Dws";
  const phone = "sofia/gateway/jio_primary/+919848012345";
  const g = `webrtc_seat/${SEAT},webrtc_seat/${OTHER},${phone}`;
  assert.equal(sp.resolveRingGroup(g, { [SEAT]: [C] }, "9876543210"),
    `[leg_timeout=15,origination_caller_id_number=9876543210,origination_caller_id_name=9876543210]${C}|${phone}`);
  // nobody online: exactly the phones, as before
  assert.equal(sp.resolveRingGroup(g, {}, "9876543210"), phone);
  assert.equal(sp.resolveRingGroup(g, { [SEAT]: ["error/user_not_registered"] }, ""), phone);
  // the "own number rings them first" form survives
  const own = `webrtc_seat/${SEAT},[leg_timeout=15]${phone}|sofia/gateway/jio_primary/+919000000000`;
  assert.equal(sp.resolveRingGroup(own, {}, ""), `[leg_timeout=15]${phone}|sofia/gateway/jio_primary/+919000000000`);
  // only browsers, and one is online
  assert.equal(sp.resolveRingGroup(`webrtc_seat/${SEAT}`, { [SEAT]: [C] }, ""), `[leg_timeout=15]${C}`);
  assert.equal(sp.resolveRingGroup(`webrtc_seat/${SEAT}`, {}, ""), "");
  // a contact that is not exactly a browser contact is never dialled
  assert.equal(sp.isBrowserContact("sofia/gateway/jio_primary/+919848012345"), false);
  assert.equal(sp.isBrowserContact("sofia/webrtc/sip:a@b.invalid;transport=ws} &system(x)"), false);
  assert.equal(sp.isBrowserContact(C), true);
});
