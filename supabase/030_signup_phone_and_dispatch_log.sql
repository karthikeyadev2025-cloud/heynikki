-- ══════════════════════════════════════════════════════════════
-- 030 — TWO BUGS THE FIRST ORGANIC SIGNUP EXPOSED
--
-- "riya properties" signed up today, and the machinery worked: the
-- trigger granted 100 minutes, the welcome message went out. Two things
-- did not.
--
-- 1. THE PHONE NUMBER STORED IS 4922013766. No Indian mobile starts
--    with 4 — the owner almost certainly typed eleven digits and the
--    last-10 truncation kept the wrong ten. The welcome was "sent" to a
--    number that cannot receive it, and every later onboarding message
--    will follow it into the void. handle_new_user now requires a
--    plausible mobile ([6-9] + 9 digits) and stores null otherwise —
--    better no number than a stranger's.
--
-- 2. wa_dispatch_log.message_type has a CHECK constraint written before
--    onboarding existed, so EVERY onboarding send fails its log insert
--    with 23514 — swallowed by the "a logging failure must never block a
--    send" catch, which is exactly what it is for, but the result is a
--    message log with holes precisely where the newest messages are.
--    The constraint is dropped rather than widened: a taxonomy that has
--    to be migrated every time a message type is added will always be
--    behind, and the column is descriptive, not load-bearing.
-- ══════════════════════════════════════════════════════════════

do $$
begin
  if exists (select 1 from pg_constraint
             where conname = 'wa_dispatch_log_message_type_check') then
    alter table wa_dispatch_log drop constraint wa_dispatch_log_message_type_check;
  end if;
end $$;

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

  v_phone := nullif(regexp_replace(
    coalesce(new.raw_user_meta_data->>'owner_phone', new.phone, ''),
    '[^0-9]', '', 'g'), '');
  if length(v_phone) > 10 then
    v_phone := right(v_phone, 10);
  end if;
  -- An Indian mobile starts 6-9. Anything else here is a typo, and a typo
  -- kept is worse than a blank: it sends the customer's onboarding to a
  -- stranger, silently, forever.
  if v_phone !~ '^[6-9][0-9]{9}$' then
    v_phone := null;
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

-- The mistyped number already stored: clear it so the follow-up sequence
-- stops messaging a number that cannot answer. The owner can set it on
-- their profile; the dashboard shows it missing.
update tenant_users set phone = null
where phone !~ '^[6-9][0-9]{9}$' and phone is not null;
