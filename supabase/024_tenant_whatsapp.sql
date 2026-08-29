-- ══════════════════════════════════════════════════════════════
-- 024 — PER-TENANT WHATSAPP NUMBERS
--
-- Today every WhatsApp this platform sends goes out from ONE number:
-- HeyNikki's own +91 94407 69495, via META_WA_PHONE_NUMBER_ID. A caller
-- who rings Nila Everyday Jewellery gets their appointment confirmed by
-- "HeyNikki", from a number they have never seen. That is survivable for
-- one tenant and wrong for ten.
--
-- Under Meta's Tech Provider model each client owns their own WhatsApp
-- Business Account and completes Embedded Signup; the provider's system
-- user is granted access to it. So what we store per tenant is an
-- IDENTIFIER PAIR, not a credential:
--
--   waba_id          — the client's WhatsApp Business Account
--   phone_number_id  — the number inside it we send as
--
-- Deliberately no access token column. The platform system-user token
-- already carries permission on every WABA shared with us, so a
-- per-tenant token would be a second secret to rotate, leak and expire
-- for no capability we do not already have.
--
-- The number is tied to the DID because that is the promise being made:
-- the business's phone number and its WhatsApp are the same number to a
-- customer. A DID cannot be provisioned for WhatsApp before its owner is
-- KYC-approved, which is what the status column tracks.
-- ══════════════════════════════════════════════════════════════

create table if not exists tenant_whatsapp (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  did_id           uuid references dids(id) on delete set null,
  phone_number     text,
  waba_id          text,
  phone_number_id  text,
  display_name     text,
  -- pending_kyc    : tenant exists, KYC not approved yet
  -- awaiting_signup: KYC approved, client has not completed Embedded Signup
  -- submitted      : signup done, Meta verification in flight
  -- active         : verified, and what sendWhatsApp will use
  -- failed         : Meta rejected; review_note says why
  status           text not null default 'pending_kyc',
  review_note      text,
  verified_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- One WhatsApp binding per tenant. A second row would make "which number
-- do we send as" ambiguous, and sendWhatsApp resolves exactly one.
create unique index if not exists tenant_whatsapp_tenant_key
  on tenant_whatsapp(tenant_id);

-- phone_number_id is what Meta addresses; two tenants sharing one would
-- mean messages sent as the wrong business.
create unique index if not exists tenant_whatsapp_phone_number_id_key
  on tenant_whatsapp(phone_number_id) where phone_number_id is not null;

create index if not exists tenant_whatsapp_status_idx on tenant_whatsapp(status);

alter table tenant_whatsapp enable row level security;

-- A tenant may read its own provisioning state — the dashboard shows it
-- during onboarding — but only the platform may write it. Approving your
-- own WhatsApp number is exactly the decision KYC exists to gate.
drop policy if exists tenant_whatsapp_select_own on tenant_whatsapp;
create policy tenant_whatsapp_select_own on tenant_whatsapp
  for select using (tenant_id = get_my_tenant_id() or is_super_admin());

drop policy if exists tenant_whatsapp_admin_write on tenant_whatsapp;
create policy tenant_whatsapp_admin_write on tenant_whatsapp
  for all using (is_super_admin()) with check (is_super_admin());

comment on table tenant_whatsapp is
  'Per-tenant WhatsApp Business number, provisioned against an assigned DID after KYC approval.';
