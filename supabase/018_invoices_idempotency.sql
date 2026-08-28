-- Invoices were never written by any code path. The Razorpay webhook now
-- records one on payment.captured, keyed on Razorpay's payment id.
--
-- Razorpay retries a webhook until it gets a 2xx, and our handler can be
-- interrupted between the insert and the response, so the same payment can
-- arrive several times. Without a unique key each retry would add another
-- invoice row and the customer would see one payment billed three times on
-- /billing. This index is what makes the upsert's ON CONFLICT valid — without
-- it PostgREST rejects the write outright with "no unique or exclusion
-- constraint matching the ON CONFLICT specification".
--
-- Partial, because razorpay_payment_id is nullable: rows written by any other
-- means (a manual adjustment, a future reconciliation job) must not collide
-- with each other on NULL.
create unique index if not exists invoices_razorpay_payment_id_key
  on invoices (razorpay_payment_id)
  where razorpay_payment_id is not null;

-- /billing lists a tenant's invoices newest first; without this it is a
-- sequential scan that grows with every payment the platform ever takes.
create index if not exists invoices_tenant_created_idx
  on invoices (tenant_id, created_at desc);
