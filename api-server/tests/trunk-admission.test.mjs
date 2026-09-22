/**
 * One ledger for every outbound leg, across processes.
 *
 * Click-to-calls are admitted in the api-server; campaign calls are dialled
 * by the outbound-dispatcher, a different process, which asks the API over
 * loopback (POST /internal/trunk/admit). These tests stand a real HTTP
 * server in for that endpoint and race the two, because the failure being
 * closed only exists when both sides read the same stale channel count.
 *
 *   npm test
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.INTERNAL_SECRET ||= "test-secret";
delete process.env.TRUNK_MAX_CHANNELS;       // 10 channels, ceiling 8
delete process.env.TRUNK_OUTBOUND_CEILING;
delete process.env.FREESWITCH_ESL_PASSWORD;  // no ESL: channelsInUse() fails open to 0
const esl = await import("../dist/esl.js");
const { admitLegs, admitClickToCall, trunkAdmit, useRemoteAdmission, pendingClickToCallLegs } = esl;

const stale = (n) => async () => n;

// Stand-in for the API's /internal/trunk/admit, counting against the SAME
// ledger the click-to-calls below use, as the real api-server does.
let serverCount = 0;
const SECRET = "s3cret";
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", async () => {
    if (req.headers["x-internal-secret"] !== SECRET) { res.writeHead(401).end(); return; }
    const { legs, hold_ms } = JSON.parse(body);
    const { counted, hold } = await admitLegs(legs, stale(serverCount));
    if (hold) setTimeout(() => hold.release(), hold_ms).unref();
    res.writeHead(200, { "Content-Type": "application/json" })
       .end(JSON.stringify({ admitted: !!hold, counted }));
  });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const API = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

// Wait for timer-held reservations to lapse between tests.
const settle = async () => { while (pendingClickToCallLegs() > 0) await new Promise(r => setTimeout(r, 50)); };

test("mixed legs share the ceiling: seat (2) + campaign (1) + campaign (1) at 5 in use", async () => {
  const [seat, c1, c2] = await Promise.all([
    admitLegs(2, stale(5)),
    admitLegs(1, stale(5)),
    admitLegs(1, stale(5)),
  ]);
  assert.ok(seat.hold && c1.hold, "5+2=7, then 7+1=8: both fit");
  assert.equal(c2.hold, null, "8+1=9 would take an inbound channel");
  seat.hold.release(); c1.hold.release();
  assert.equal(pendingClickToCallLegs(), 0);
});

test("a campaign leg from the other process and a click-to-call cannot both take the last pair", async () => {
  useRemoteAdmission(API, SECRET);
  serverCount = 6;
  // 6 in use: the seat needs 2 (-> 8), the campaign needs 1 (-> 7). Both
  // together would be 9. Whichever the ledger sees first wins; never both.
  const [seat, campaign] = await Promise.all([
    admitClickToCall(stale(6)),
    trunkAdmit(1),
  ]);
  const admitted = [seat.hold, campaign.hold].filter(Boolean).length;
  assert.equal(admitted, 1);
  seat.hold?.release();
  await settle();                            // the API-held campaign leg lapses on its timer
});

test("the API holds a remote reservation for hold_ms, then lets it go", async () => {
  useRemoteAdmission(API, SECRET);
  serverCount = 0;
  const r = await trunkAdmit(1);
  assert.ok(r.hold);
  assert.equal(pendingClickToCallLegs(), 1, "held by the API, not the caller");
  r.hold.release();                          // the caller's release is a no-op for a remote hold
  assert.equal(pendingClickToCallLegs(), 1);
  await settle();
  assert.equal(pendingClickToCallLegs(), 0);
});

test("API unreachable: the dispatcher counts locally instead of refusing to dial", async () => {
  useRemoteAdmission("http://127.0.0.1:9", SECRET);   // nothing listens on port 9
  const r = await trunkAdmit(1);
  assert.ok(r.hold, "no API means no click-to-call to race with");
  assert.equal(pendingClickToCallLegs(), 1, "reserved in this process's own ledger");
  r.hold.release();
  assert.equal(pendingClickToCallLegs(), 0);
});

test("a wrong secret is not treated as 'trunk full'", async () => {
  useRemoteAdmission(API, "wrong");
  const r = await trunkAdmit(1);
  assert.ok(r.hold, "401 falls back to local counting, it does not block dialling");
  r.hold.release();
});
