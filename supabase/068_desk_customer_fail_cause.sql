-- ══════════════════════════════════════════════════════════════
-- 068 — why a Desk call never reached the customer
--
-- A Desk call rings the telecaller, then the customer. When the customer's
-- leg failed — a number that does not exist, a phone switched off, busy —
-- the carrier said so in its own recording, which the telecaller never
-- hears (we play our own ringback to them), and the call simply ended.
-- On 24 Sep telecallers redialled dead numbers two and three times.
--
-- The dialplan now reports the failed bridge's cause (originate_disposition)
-- to /webhooks/freeswitch/ctc-failed, the Desk shows it in words, and the
-- call's talk time is 0.
-- ══════════════════════════════════════════════════════════════

alter table click_to_call_log
  add column if not exists customer_fail_cause text;

comment on column click_to_call_log.customer_fail_cause is
  'FreeSWITCH cause when the customer leg never connected (UNALLOCATED_NUMBER, USER_BUSY, NO_ANSWER, …). NULL = connected or unknown.';
