-- ════════════════════════════════════════════════════════════════
-- 057 — BROADCAST DELIVERY RECORD
--
-- Broadcast now sends: one email per tenant owner, through Resend
-- (api-server/src/admin-extras.ts). The thing that made the old endpoint
-- dangerous was not that it failed — it was that it reported a single
-- number. "Sent to 40 tenants" is not a record of anything: it cannot say
-- which three bounced, which owner has no email address at all, or whether
-- the same announcement went out twice.
--
-- So every send writes one broadcasts row and one broadcast_recipients row
-- PER TENANT, carrying the outcome for that one address. That is the only
-- place a question like "did the price-change note actually reach Go motion"
-- can be answered.
--
-- WITHOUT THIS FILE the broadcast still sends and still writes its
-- admin_audit_log row (which carries the same per-recipient outcomes in
-- metadata, capped at 200). The API detects the missing tables and falls
-- back to reading that log, so the history screen degrades from "searchable
-- per-recipient table" to "the last 25 audit rows" rather than to an error.
--
-- Safe to run twice.
-- ════════════════════════════════════════════════════════════════

begin;

create table if not exists public.broadcasts (
  id             uuid primary key default gen_random_uuid(),
  admin_user_id  uuid references auth.users(id) on delete set null,
  -- 'email' is the only value today. WhatsApp is not a channel here: Meta
  -- approves templates by NAME and there is no approved operator
  -- announcement template, so free-text broadcast over WhatsApp would be
  -- rejected by the API and would cost the business number quality rating.
  channel        text not null default 'email' check (channel in ('email')),
  subject        text not null,
  message        text not null,
  -- The filter as it was submitted (plan / status / has_did / include_demo /
  -- explicit tenant_ids). Kept verbatim so a send can be explained later
  -- even after a tenant changes plan.
  audience       jsonb not null default '{}'::jsonb,
  sent_count     integer not null default 0,
  failed_count   integer not null default 0,
  no_email_count integer not null default 0,
  -- The admin_audit_log row for the same send. The audit row is written
  -- first and is the record of record; this is the searchable copy.
  audit_id       uuid references public.admin_audit_log(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists broadcasts_created_idx
  on public.broadcasts (created_at desc);

create table if not exists public.broadcast_recipients (
  id            uuid primary key default gen_random_uuid(),
  broadcast_id  uuid not null references public.broadcasts(id) on delete cascade,
  -- No FK to tenants: a deleted demo tenant must not erase the record that
  -- it was mailed. The name is stored alongside for the same reason.
  tenant_id     uuid,
  tenant_name   text,
  email         text,
  -- 'no_email' is decided BEFORE anything is sent — a tenant with no owner
  -- or an owner with no address was never a failed send, and counting it as
  -- one hides a data problem inside a delivery problem.
  state         text not null check (state in ('sent', 'failed', 'no_email')),
  error         text,
  provider_message_id text,
  created_at    timestamptz not null default now()
);

create index if not exists broadcast_recipients_broadcast_idx
  on public.broadcast_recipients (broadcast_id);
create index if not exists broadcast_recipients_tenant_idx
  on public.broadcast_recipients (tenant_id, created_at desc);

-- Super admin only, both tables. A tenant has no business reading the list
-- of every other business on the platform, which is exactly what a
-- broadcast's recipient list is. The API writes with the service key, which
-- bypasses RLS; these policies govern anything holding a user JWT.
alter table public.broadcasts            enable row level security;
alter table public.broadcast_recipients  enable row level security;

drop policy if exists "broadcasts: super admin" on public.broadcasts;
create policy "broadcasts: super admin"
  on public.broadcasts for all
  using (is_super_admin()) with check (is_super_admin());

drop policy if exists "broadcast_recipients: super admin" on public.broadcast_recipients;
create policy "broadcast_recipients: super admin"
  on public.broadcast_recipients for all
  using (is_super_admin()) with check (is_super_admin());

commit;
