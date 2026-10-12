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

// ── Desk call screen: slots and remarks ───────────────────────────────────
import * as dc from "../dist/desk-call.js";

test("desk call: a slot must be a real moment that has not passed", () => {
  const now = Date.UTC(2026, 9, 12, 6, 0);              // 12 Oct 2026, 11:30 IST (a Monday)
  const hours = { open_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], open_time: "09:00", close_time: "21:00" };
  assert.deepEqual(dc.checkSlot("2026-10-12", "16:00", hours, now), { ok: true, warning: null });
  assert.equal(dc.checkSlot("2026-10-12", "11:00", hours, now).ok, false, "half an hour ago");
  assert.equal(dc.checkSlot("2026-10-12", "11:28", hours, now).ok, true, "a couple of minutes' grace");
  assert.equal(dc.checkSlot("2026-10-11", "16:00", hours, now).ok, false, "yesterday");
  assert.equal(dc.checkSlot("2026-02-30", "10:00", hours, now).ok, false, "not a date");
  assert.equal(dc.checkSlot("2026-10-13", "25:00", hours, now).ok, false);
  assert.equal(dc.checkSlot("", "10:00", hours, now).ok, false);
  assert.equal(dc.checkSlot("2026-10-13", "4pm", hours, now).ok, false);
  assert.equal(dc.checkSlot("2028-10-13", "10:00", hours, now).ok, false, "a slipped year");
});

test("desk call: closed days and hours warn, they do not refuse", () => {
  const now = Date.UTC(2026, 9, 12, 6, 0);
  const hours = { open_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], open_time: "09:00", close_time: "21:00" };
  const sun = dc.checkSlot("2026-10-18", "10:00", hours, now);
  assert.equal(sun.ok, true); assert.match(sun.warning, /closed on Sun/);
  const late = dc.checkSlot("2026-10-13", "22:00", hours, now);
  assert.equal(late.ok, true); assert.match(late.warning, /outside working hours/);
  // hours nobody filled in properly are not used to second-guess a booking
  assert.equal(dc.checkSlot("2026-10-13", "22:00", { open_time: "01:45", close_time: "01:00" }, now).warning, null);
  assert.equal(dc.checkSlot("2026-10-13", "22:00", {}, now).warning, null);
});

test("desk call: remarks and names are cleaned, not rewritten", () => {
  assert.equal(dc.cleanRemark("  wants a demo  \n\n\n\ncall after 5  "), "wants a demo\n\ncall after 5");
  assert.equal(dc.cleanRemark(""), "");
  assert.equal(dc.cleanRemark("x".repeat(5000)).length, 2000);
  assert.equal(dc.cleanName("  రవి   తేజ <b> "), "రవి తేజ b");
  assert.equal(dc.remarkAsNote("wants a demo\ncall after 5", "Sita", Date.UTC(2026, 9, 12, 6, 5)), "[12/10 11:35 Sita] wants a demo call after 5");
});

// ── Day board and the telecaller's own dashboard ──────────────────────────
import * as dd from "../dist/desk-day.js";

const NOW = Date.UTC(2026, 9, 12, 6, 0);                 // 12 Oct 2026, 11:30 IST
const at = (d, hIst, m = 0) => new Date(Date.UTC(2026, 9, d, hIst, m) - 5.5 * 3600_000).toISOString();

test("day: the last days are IST dates ending today", () => {
  assert.deepEqual(dd.dayKeys(3, NOW), ["2026-10-10", "2026-10-11", "2026-10-12"]);
  // 01:00 IST on the 12th is still the 11th in UTC — it must count as the 12th
  assert.equal(dd.dayKeys(1, Date.parse(at(12, 1)))[0], "2026-10-12");
});

test("day: calls are counted on the IST day they happened, gaps kept", () => {
  const rows = [
    { created_at: at(12, 1), duration_seconds: 40, disposition: "booked" },
    { created_at: at(12, 10), duration_seconds: 5, disposition: "no_answer" },
    { created_at: at(10, 23, 30), duration_seconds: 90, disposition: "interested" },
  ];
  const s = dd.seriesByDay(rows, dd.dayKeys(3, NOW));
  assert.deepEqual(s.map(d => d.calls), [1, 0, 2]);
  assert.deepEqual(s[2], { date: "2026-10-12", calls: 2, connected: 1, talk_seconds: 40, booked: 1, interested: 0 });
  assert.equal(s[0].interested, 1);
});

test("day: a streak survives an unfinished today, not a missed yesterday", () => {
  const mk = (calls) => calls.map((c, i) => ({ date: String(i), calls: c, connected: 0, talk_seconds: 0, booked: 0, interested: 0 }));
  assert.equal(dd.streak(mk([50, 50, 50, 10]), 40), 3, "today not done yet");
  assert.equal(dd.streak(mk([50, 50, 50, 45]), 40), 4);
  assert.equal(dd.streak(mk([50, 10, 50, 10]), 40), 1);
  assert.equal(dd.streak(mk([50, 50]), 0), 0, "no target, no streak");
});

test("day: best hour needs enough calls to mean something", () => {
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push({ created_at: at(12, 11, i), duration_seconds: i < 4 ? 60 : 3 });
  for (let i = 0; i < 6; i++) rows.push({ created_at: at(12, 16, i), duration_seconds: i < 2 ? 60 : 3 });
  rows.push({ created_at: at(12, 7), duration_seconds: 120 });      // one lucky call
  const b = dd.bestHour(rows);
  assert.equal(b.hour, 11); assert.equal(b.calls, 6); assert.ok(Math.abs(b.rate - 4 / 6) < 1e-9);
  assert.equal(dd.bestHour(rows.slice(0, 3)), null);
});

test("day: a missed call is pending until someone rings back or they get through", () => {
  const missed = [
    { id: "m1", caller_number: "+919848012345", created_at: at(12, 9) },
    { id: "m2", caller_number: "9848012345", created_at: at(12, 9, 30) },
    { id: "m3", caller_number: "9000000001", created_at: at(12, 10) },
    { id: "m4", caller_number: "9000000002", created_at: at(12, 10) },
    { id: "m5", caller_number: "anonymous", created_at: at(12, 10) },
  ];
  const out = dd.unreturnedMissed(missed,
    [{ callee_number: "9000000001", created_at: at(12, 10, 30) }],          // rung back
    [{ caller_number: "+919000000002", created_at: at(12, 9) }]);            // answered BEFORE the miss: still pending
  assert.deepEqual(out.map(o => [o.phone, o.times]).sort(), [["9000000002", 1], ["9848012345", 2]]);
  assert.equal(out.find(o => o.phone === "9848012345").id, "m2", "the latest miss");
  // rang back, then they called and were missed again: pending again, once
  const again = dd.unreturnedMissed(
    [{ id: "a", caller_number: "9000000003", created_at: at(12, 9) }, { id: "b", caller_number: "9000000003", created_at: at(12, 11) }],
    [{ callee_number: "9000000003", created_at: at(12, 10) }], []);
  assert.deepEqual(again.map(o => [o.id, o.times]), [["b", 1]]);
});

test("day: change against last week", () => {
  assert.equal(dd.pctChange(60, 40), 50);
  assert.equal(dd.pctChange(30, 40), -25);
  assert.equal(dd.pctChange(10, 0), null);
});

// ── WhatsApp as conversations (wa-chat.ts) ───────────────────────────
import * as wc from "../dist/wa-chat.js";

test("chats: one row per customer, newest first, whichever side spoke last", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  const chats = wc.buildChats(
    [{ id: "a", from_number: "919876543210", body: "Price?", msg_type: "text", received_at: "2026-10-12T09:00:00Z", read_at: null, lead_id: "L1" },
     { id: "b", from_number: "9876543210", body: "Hello", msg_type: "text", received_at: "2026-10-12T08:00:00Z", read_at: "2026-10-12T08:01:00Z" },
     { id: "c", from_number: "9000000001", body: null, msg_type: "image", received_at: "2026-10-10T08:00:00Z", read_at: null }],
    [{ to_number: "+919876543210", message_type: "manual_reply", message_body: "₹500", status: "read", sent_at: "2026-10-12T10:00:00Z" },
     { to_number: "9111111111", message_type: "confirmation", message_body: "Booked", status: "delivered", sent_at: "2026-10-12T11:00:00Z" }], now);
  assert.deepEqual(chats.map(c => c.number), ["9111111111", "9876543210", "9000000001"]);
  const [auto, replied, old] = chats;
  assert.equal(auto.window_open, false);          // they never wrote
  assert.equal(auto.waiting, false);
  assert.deepEqual([replied.last, replied.last_dir, replied.last_status, replied.unread, replied.lead_id],
    ["₹500", "out", "read", 1, "L1"]);
  assert.equal(replied.window_open, true);
  assert.equal(replied.window_closes_at, "2026-10-13T09:00:00.000Z");
  assert.deepEqual([old.last, old.waiting, old.window_open, old.unread], ["[image]", true, false, 1]);
});

test("chats: an automatic message is labelled, a person's reply is not", () => {
  assert.equal(wc.outLabel("manual_reply"), null);
  assert.equal(wc.outLabel("confirmation"), "Booking confirmation");
  assert.equal(wc.outLabel("desk_brochure"), "Desk brochure");
  // What the platform sends the owner is not a customer conversation.
  assert.deepEqual(wc.buildChats([], [
    { to_number: "9000000002", message_type: "daily_summary", message_body: "12 calls", status: "sent", sent_at: "2026-10-12T02:00:00Z" },
    { to_number: "9000000002", message_type: "onboarding_welcome", message_body: "Welcome", status: "sent", sent_at: "2026-10-01T02:00:00Z" }]), []);
});

// ── Lists shared out to the team (lead-assign.ts) ────────────────────
import * as la from "../dist/lead-assign.js";

test("import: every shape Excel gives a mobile number becomes ten digits", () => {
  for (const v of ["9876543210", 9876543210, "+91 98765 43210", "09876543210", "919876543210", "9876543210.0", "9.87654321E9", " 98765-43210 "]) {
    assert.equal(la.cleanPhone(v), v === "9.87654321E9" ? "9876543210" : "9876543210", String(v));
  }
  for (const v of ["", "12345", "5876543210", "98765432101", "name", null]) assert.equal(la.cleanPhone(v), null, String(v));
});

test("import: bad and repeated rows are counted, not kept", () => {
  const r = la.cleanRows([{ phone: "9876543210", name: " Ravi ", note: "" }, { phone: "+919876543210" },
    { phone: "abc" }, { phone: 9000000001 }, {}]);
  assert.deepEqual(r.rows, [{ phone: "9876543210", name: "Ravi", note: null }, { phone: "9000000001", name: null, note: null }]);
  assert.deepEqual([r.invalid, r.repeated], [2, 1]);
});

test("sharing: dealt evenly, and whoever holds least gets the next one", () => {
  const even = la.dealOut([1, 2, 3, 4, 5], ["a", "b"]);
  assert.deepEqual([even.get("a"), even.get("b")], [[1, 3, 5], [2, 4]]);
  const fair = la.dealOut([1, 2, 3, 4], ["a", "b"], { a: 10, b: 8 });
  assert.deepEqual([fair.get("a").length, fair.get("b").length], [1, 3]);
  assert.equal(la.dealOut([1], []).size, 0);
});

test("chats: a telecaller sees their own customers and unowned ones; the owner sees all", () => {
  const tele = { userId: "t1", owner: false };
  assert.equal(wc.mayOpen(tele, "t1"), true);
  assert.equal(wc.mayOpen(tele, null), true);
  assert.equal(wc.mayOpen(tele, undefined), true);
  assert.equal(wc.mayOpen(tele, "t2"), false);
  assert.equal(wc.mayOpen({ userId: "o", owner: true }, "t2"), true);
});

test("chats: only what WhatsApp will carry is sent as a file", () => {
  assert.deepEqual(wc.mediaKind("image/jpeg", 1_000_000), { kind: "image" });
  assert.deepEqual(wc.mediaKind("application/pdf; charset=binary", 2_000_000), { kind: "document" });
  assert.ok("error" in wc.mediaKind("image/jpeg", 6 * 1048576));
  assert.ok("error" in wc.mediaKind("image/webp", 1000));
  assert.ok("error" in wc.mediaKind("application/x-msdownload", 1000));
  // The owner's morning briefing is not a customer chat either.
  assert.equal(wc.toOwner("morning_briefing"), true);
  assert.equal(wc.toOwner("manual_reply"), false);
});

// ── The floor, the rules and the evening report (desk-floor.ts) ──────
import * as fl from "../dist/desk-floor.js";

test("rules: anything posted becomes something safe to act on", () => {
  assert.deepEqual(fl.cleanRules({ stale_days: "3", stale_to: "team", team_report: false }), { stale_days: 3, stale_to: "team", team_report: false });
  assert.deepEqual(fl.cleanRules({ stale_days: -1, stale_to: "everyone" }), { stale_days: 0, stale_to: "pool", team_report: true });
  assert.deepEqual(fl.cleanRules(null), fl.DEFAULT_RULES);
  assert.equal(fl.cleanRules({ stale_days: 500 }).stale_days, 0);
});

test("rules: a lead moves on only when it has truly sat", () => {
  const now = Date.parse("2026-10-12T06:00:00Z"), d = (n) => new Date(now - n * 86400000).toISOString();
  const base = { assigned_to: "a", last_contacted_at: null, follow_up_at: null, follow_up_done_at: null };
  const rows = [
    { id: "sat", ...base, updated_at: d(5), created_at: d(9) },
    { id: "handed-over-today", ...base, updated_at: d(0.2), created_at: d(9) },
    { id: "rung-yesterday", ...base, last_contacted_at: d(1), updated_at: d(5), created_at: d(9) },
    { id: "callback-to-come", ...base, updated_at: d(5), created_at: d(9), follow_up_at: new Date(now + 86400000).toISOString() },
    { id: "callback-missed", ...base, updated_at: d(5), created_at: d(9), follow_up_at: d(4) },
    { id: "nobodys", ...base, assigned_to: null, updated_at: d(5), created_at: d(9) },
  ];
  assert.deepEqual(fl.staleLeads(rows, 2, now).map(l => l.id), ["sat", "callback-missed"]);
  assert.deepEqual(fl.staleLeads(rows, 0, now), []);
});

test("floor: one word for where each person is", () => {
  assert.equal(fl.presence({ on_call: true, checked_in: false, phone_online: false }), "on_call");
  assert.equal(fl.presence({ on_call: false, checked_in: true, phone_online: true }), "free");
  assert.equal(fl.presence({ on_call: false, checked_in: true, phone_online: false }), "away");
  assert.equal(fl.presence({ on_call: false, checked_in: false, phone_online: true }), "out");
});

test("evening report: busiest first, targets said plainly, the idle left out", () => {
  const r = (name, calls, target_calls = 0, extra = {}) => ({ name, calls, conversations: 0, booked: 0, interested: 0, no_outcome: 0, target_calls, ...extra });
  assert.deepEqual(fl.teamReportLines([r("Ravi", 12, 40), r("Sita", 45, 40, { conversations: 20, booked: 3, no_outcome: 2 }), r("Owner", 0)]), [
    "Sita: 45 calls, 20 conversations, 3 booked, 2 with no outcome saved — target met",
    "Ravi: 12 calls, 0 conversations — 28 short of 40",
  ]);
  assert.deepEqual(fl.teamReportLines([r("Owner", 0)]), []);
});

test("softphone proxy reaches the switch from a network address, never loopback", async () => {
  const sp = await import("../dist/softphone.js");
  const ifaces = {
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    eth0: [{ address: "fe80::1", family: "IPv6", internal: false }, { address: "192.168.1.12", family: "IPv4", internal: false }],
    eth1: [{ address: "100.65.188.4", family: "IPv4", internal: false }],
  };
  assert.equal(sp.switchSourceAddress(ifaces, ""), "192.168.1.12");
  assert.equal(sp.switchSourceAddress(ifaces, "100.65.188.4"), "100.65.188.4");
  // A configured address this machine does not have is not used.
  assert.equal(sp.switchSourceAddress(ifaces, "10.9.9.9"), undefined);
  assert.equal(sp.switchSourceAddress({ lo: ifaces.lo }, ""), undefined);
});

test("a browser contact the switch marks as behind NAT can still be rung", async () => {
  const sp = await import("../dist/softphone.js");
  assert.ok(sp.isBrowserContact(
    "sofia/webrtc/sip:l3hu0e9t@sah4d9v12eal.invalid;transport=ws;fs_nat=yes;fs_path=sip%3Al3hu0e9t%40100.65.188.4%3A41331%3Btransport%3Dws"));
});

test("softphone: a browser's WSS Via is WS to the switch and WSS again on the reply", async () => {
  const sp = await import("../dist/softphone.js");
  const reg = "REGISTER sip:heynikki.in SIP/2.0\r\nVia: SIP/2.0/WSS ki89q238t4lo.invalid;branch=z9hG4bK6472606\r\nTo: <sip:u1@heynikki.in>\r\n\r\n";
  const up = sp.viaForSwitch(reg);
  assert.equal(up.changed, true);
  assert.match(up.msg, /\r\nVia: SIP\/2\.0\/WS ki89q238t4lo\.invalid;branch=z9hG4bK6472606\r\n/);
  // Already WS (a test page on ws://): untouched.
  assert.equal(sp.viaForSwitch(up.msg).changed, false);
  const ok = "SIP/2.0 200 OK\r\nVia: SIP/2.0/WS ki89q238t4lo.invalid;branch=z9hG4bK6472606\r\n\r\n";
  assert.match(sp.viaForBrowser(ok), /Via: SIP\/2\.0\/WSS ki89q238t4lo/);
  // A request from the switch carries the switch's own Via: left alone.
  const inv = "INVITE sip:x@y.invalid SIP/2.0\r\nVia: SIP/2.0/WS 127.0.0.1;branch=z9hG4bKabc\r\n\r\n";
  assert.equal(sp.viaForBrowser(inv), inv);
});
