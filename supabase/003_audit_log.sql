-- ============================================================
-- NIKKI — audit_log table (DPDP Section 8 compliance)
-- ============================================================
-- DPDP Act 2023 Section 8(7): data fiduciaries must maintain records
-- of personal data processing activities, especially:
--   - data access events (who saw what)
--   - data correction / deletion events
--   - data exports / portability requests
--   - consent grants and withdrawals
--
-- This table captures those events. Backend services write here via
-- service-role key. End-users see ONLY their own entries via RLS.
-- ============================================================

create table if not exists public.audit_log (
  id           uuid          primary key default uuid_generate_v4(),
  tenant_id    uuid          references public.tenants(id) on delete cascade,
  actor_id     uuid          references auth.users(id) on delete set null,
  actor_email  text,         -- denormalised for queryability after user deletion

  -- Event details
  action       text          not null,         -- e.g. 'call.recording.accessed'
  resource     text,                           -- e.g. 'recordings/<tenant>/<call_id>.wav.enc'
  metadata     jsonb         not null default '{}'::jsonb,

  -- Request context
  ip           inet,
  user_agent   text,

  created_at   timestamptz   not null default now()
);

create index if not exists idx_audit_log_tenant_id   on public.audit_log(tenant_id, created_at desc);
create index if not exists idx_audit_log_actor_id    on public.audit_log(actor_id, created_at desc);
create index if not exists idx_audit_log_action      on public.audit_log(action,    created_at desc);

-- Cap individual metadata blobs to keep table manageable
alter table public.audit_log
  add constraint audit_log_metadata_size
  check (octet_length(metadata::text) < 8192);

-- ─── RLS ──────────────────────────────────────────────
alter table public.audit_log enable row level security;

-- Users (in any tenant) can view their OWN actor_id rows — DPDP gives
-- them a right to know how their data is being processed.
drop policy if exists "audit_log: self read" on public.audit_log;
create policy "audit_log: self read"
  on public.audit_log for select
  using (actor_id = auth.uid());

-- No INSERT/UPDATE/DELETE policy → only service-role key (server-side)
-- can write. Prevents tampering, since DPDP requires the audit log to be
-- a faithful record.

-- ─── Recommended action types ─────────────────────────
-- (Documentation comment — your backend should use these consistently.)
--
-- auth.signup          — new account created
-- auth.signin          — successful login
-- auth.signin.failed   — failed login (with reason in metadata.reason)
-- auth.signout         — explicit signout (token revoked)
-- auth.password.reset  — password changed via reset link
--
-- tenant.created
-- tenant.member.added
-- tenant.member.removed
--
-- voice.profile.created
-- voice.profile.updated
-- voice.profile.deleted
--
-- call.recording.accessed   — recording downloaded from dashboard
-- call.recording.deleted    — manual deletion
-- call.transcript.accessed
--
-- billing.plan.changed
-- billing.payment.succeeded
-- billing.payment.failed
-- billing.refund.issued
--
-- data.export.requested     — DPDP portability right exercised
-- data.deletion.requested   — DPDP erasure right exercised
-- consent.granted
-- consent.withdrawn
--
-- Pruning: audit logs are retained for 24 months by default (matches
-- the recordings retention). To enforce this in pg_cron:
--
--   SELECT cron.schedule(
--     'prune-audit-log',
--     '0 3 * * *',                                         -- daily 3am IST
--     $$delete from public.audit_log where created_at < now() - interval '24 months'$$
--   );
