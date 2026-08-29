-- ══════════════════════════════════════════════════════════════
-- 026 — THE OWNER'S PHONE NUMBER
--
-- Every onboarding message we want to send — thanks for choosing us,
-- your KYC is verified, your number is live, you have not finished setup
-- — needs somewhere to send it. There is nowhere. Signup collects a
-- business name, an email and a password. tenant_users.phone exists and
-- is null on every row.
--
-- So the WhatsApp onboarding sequence had no recipient, and the first
-- message a customer gets from HeyNikki would have been the one their
-- own caller triggers.
--
-- handle_new_user already reads business_name out of the signup
-- metadata; this teaches it to read a phone as well and put it on the
-- owner's tenant_users row. Everything downstream reads it from there.
-- ══════════════════════════════════════════════════════════════

create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_biz_name  text;
  v_phone     text;
begin
  v_biz_name := coalesce(
    new.raw_user_meta_data->>'business_name',
    split_part(new.email, '@', 1)
  );

  -- Digits only, last 10. A number typed as +91 98765 43210 and one typed
  -- as 09876543210 are the same person, and WhatsApp wants neither form.
  v_phone := nullif(regexp_replace(
    coalesce(new.raw_user_meta_data->>'owner_phone', new.phone, ''),
    '[^0-9]', '', 'g'), '');
  if length(v_phone) > 10 then
    v_phone := right(v_phone, 10);
  end if;
  if length(coalesce(v_phone, '')) <> 10 then
    v_phone := null;   -- better absent than wrong; a wrong number messages a stranger
  end if;

  insert into public.tenants (name, plan, status, owner_id, trial_ends_at)
  values (v_biz_name, 'trial', 'trial', new.id, now() + interval '14 days')
  returning id into v_tenant_id;

  insert into public.tenant_users (tenant_id, user_id, role, phone, display_name)
  values (v_tenant_id, new.id, 'owner', v_phone, v_biz_name);

  insert into public.call_minutes (tenant_id, month, used_seconds, plan_limit_seconds)
  values (v_tenant_id, to_char(now(), 'YYYY-MM'), 0, 12000)
  on conflict do nothing;

  return new;
end $$;

-- ── Which onboarding messages has this tenant had? ──────────────
-- wa_dispatch_log records what was sent but is keyed on the CALLER's
-- number and a call; an onboarding message belongs to the tenant and to a
-- step. Kept separate so a re-send is a decision rather than an accident:
-- the unique index below is what stops the follow-up job messaging the
-- same owner every fifteen minutes forever.
create table if not exists onboarding_events (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  step       text not null,
  channel    text not null default 'whatsapp',
  to_number  text,
  status     text not null default 'sent',
  detail     text,
  created_at timestamptz not null default now()
);

create unique index if not exists onboarding_events_step_key
  on onboarding_events(tenant_id, step);

create index if not exists onboarding_events_recent_idx
  on onboarding_events(created_at desc);

alter table onboarding_events enable row level security;

drop policy if exists onboarding_events_select_own on onboarding_events;
create policy onboarding_events_select_own on onboarding_events
  for select using (tenant_id = get_my_tenant_id() or is_super_admin());

drop policy if exists onboarding_events_admin_write on onboarding_events;
create policy onboarding_events_admin_write on onboarding_events
  for all using (is_super_admin()) with check (is_super_admin());

comment on table onboarding_events is
  'One row per onboarding step per tenant. The unique index is the send-once guard.';
