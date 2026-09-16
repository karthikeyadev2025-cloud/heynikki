-- ══════════════════════════════════════════════════════════════
-- 052 — a payment is applied once, even when Razorpay delivers it twice
--
-- Two writes in api-server/src/index.ts are keyed on a Razorpay id and
-- guarded in code by "look, then insert". That is enough for a retry that
-- arrives later; it is not enough for two deliveries of the same event
-- arriving together, which Razorpay does.
--
--   credit_ledger  payment.captured for an add-on grants minutes with
--                  reason 'addon_minutes:<payment id>'. Two concurrent
--                  deliveries could both see no row and both grant.
--   subscriptions  /api/billing/verify records one row per order with its
--                  current_period_end. A double-submitted verify could
--                  record the same order twice and extend the period twice.
--
-- The code already treats a duplicate-key error on either insert as
-- "somebody else applied it" and works without these indexes.
-- ══════════════════════════════════════════════════════════════

create unique index if not exists credit_ledger_addon_payment_key
  on credit_ledger (reason)
  where reason like 'addon_minutes:%';

-- Check first — an existing duplicate makes this fail:
--   select tenant_id, razorpay_order_id, count(*) from subscriptions
--    where razorpay_order_id is not null group by 1, 2 having count(*) > 1;
create unique index if not exists subscriptions_tenant_order_key
  on subscriptions (tenant_id, razorpay_order_id)
  where razorpay_order_id is not null;

-- The plan-expiry job reads a tenant's latest period end on every run.
create index if not exists subscriptions_tenant_period_end_idx
  on subscriptions (tenant_id, current_period_end desc);
