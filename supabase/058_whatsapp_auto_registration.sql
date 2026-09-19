-- When Meta was last asked to ring a number with its verification code.
--
-- Registering a tenant's HeyNikki number on WhatsApp is now automatic: the
-- API adds the number to the WABA and asks Meta for the code BY VOICE (a SIP
-- DID cannot receive SMS), Nikki answers Meta's call, and the pipeline posts
-- the six digits back to /webhooks/whatsapp/verify-otp, which verifies and
-- registers the sender.
--
-- The piece that needs storing is WHEN the code was last asked for. Meta
-- rate-limits request_code, and every request makes a real phone ring — so
-- the scheduler's sweep, which runs every fifteen minutes, must not ask again
-- for a tenant that is simply still waiting. Without this column the code
-- falls back to the row's updated_at, which any other write moves; with it,
-- the ten-minute quiet period means what it says.
alter table public.tenant_whatsapp
  add column if not exists code_requested_at timestamptz;

comment on column public.tenant_whatsapp.code_requested_at is
  'Last time Meta was asked to phone this number with a verification code.
   The auto-registration sweep will not ask again within ten minutes.';

-- The sweep reads status + oldest-first; this keeps that cheap as the number
-- of tenants grows.
create index if not exists tenant_whatsapp_pending_idx
  on public.tenant_whatsapp (status, updated_at)
  where status in ('awaiting_signup', 'pending_verification');
