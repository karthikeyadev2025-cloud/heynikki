-- ══════════════════════════════════════════════════════════════
-- 067 — when the customer actually answered a Desk call
--
-- A Desk call rings the telecaller first, then the customer. Its length was
-- measured from the telecaller picking up, so the customer's ringing counted
-- as talk: on 24 Sep a call logged at 26 s had 11 s of ringing and 15 s of
-- conversation. "Conversations", the connect rate, the daily targets and
-- the call summary's "was anything said" check all read that number, and a
-- customer who never answered but rang for 20 s counted as a conversation.
--
-- The API records the moment the telecaller's leg is bridged to the
-- customer (the customer answering), and the hangup hook measures talk time
-- from it. The calls row keeps the full length: the trunk carried both.
-- ══════════════════════════════════════════════════════════════

alter table click_to_call_log
  add column if not exists customer_answered_at timestamptz;

comment on column click_to_call_log.customer_answered_at is
  'When the customer picked up (the seat''s leg was bridged). duration_seconds is talk time from here.';
