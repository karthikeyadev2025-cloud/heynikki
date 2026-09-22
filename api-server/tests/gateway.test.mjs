/**
 * Reading `sofia status gateway` — the trunk check the watchdog pages on.
 *
 * The old reader split lines on ": " and looked at registration State, so it
 * answered "unknown" for every gateway, forever. The Jio trunk then sat DOWN
 * from 21 Sep 14:52 IST for 23 hours with nothing saying so. These cases pin
 * the two things that went wrong: the format is tab-separated, and on an
 * IP-authenticated trunk State is NOREG whether the trunk works or not.
 *
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.INTERNAL_SECRET ||= "test-secret";
const { parseGatewayStatus } = await import("../dist/esl.js");

// What ESL hands eslCommand: headers, a blank line, then the body.
const esl = (body) =>
  `Content-Type: api/response\nContent-Length: ${Buffer.byteLength(body)}\n\n${body}`;

// Captured from nikki-voice on 22 Sep 2026, trunk down. Padding then a TAB.
const DOWN = [
  "=================================================================================================",
  "Name    \tjio_primary",
  "Profile \theynikki",
  "Scheme  \tDigest",
  "Realm   \t100.64.0.4",
  "Username\tFreeSWITCH",
  "Password\tno",
  "Ping    \t1790073341",
  "PingTime\t0.00",
  "PingState\t1/0/3",
  "State   \tNOREG",
  "Status  \tDOWN",
  "Uptime  \t0s",
  "CallsIN \t0",
  "CallsOUT\t0",
  "FailedCallsIN\t0",
  "FailedCallsOUT\t3",
  "=================================================================================================",
  "",
].join("\n");

test("a down trunk reads as down, with its ping state and failed calls", () => {
  const g = parseGatewayStatus("jio_primary", esl(DOWN));
  assert.equal(g.status, "down");
  assert.equal(g.pingState, "1/0/3");
  assert.equal(g.failedCallsOut, 3);
  assert.match(g.detail, /DOWN/);
});

test("NOREG does not mean down: the Jio trunk never registers", () => {
  const up = DOWN.replace("Status  \tDOWN", "Status  \tUP").replace("PingState\t1/0/3", "PingState\t3/0/3");
  const g = parseGatewayStatus("jio_primary", esl(up));
  assert.equal(g.state, "NOREG");
  assert.equal(g.status, "up");
});

test("a gateway that was never configured is not_configured, not down", () => {
  const g = parseGatewayStatus("vi_failover", esl("Invalid Gateway!\n"));
  assert.equal(g.status, "not_configured");
});

test("output with no Status line is unknown, so the watchdog neither opens nor clears", () => {
  assert.equal(parseGatewayStatus("jio_primary", "").status, "unknown");
  assert.equal(parseGatewayStatus("jio_primary", esl("-ERR no reply\n")).status, "unknown");
});

test("the old ': ' form is not mistaken for a status", () => {
  // ESL headers use "Key: Value"; a header must never be read as the gateway.
  const g = parseGatewayStatus("jio_primary", "Status: UP\nContent-Type: api/response\n");
  assert.equal(g.status, "unknown");
});
