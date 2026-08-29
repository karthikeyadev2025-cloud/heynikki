-- ══════════════════════════════════════════════════════════════
-- 028 — IVR MENUS
--
-- dids.routing_mode has allowed 'ivr' since 015 and nothing has ever
-- implemented it. A tenant could set the value and get the plain AI agent,
-- which is worse than not offering the option.
--
-- This is a SPOKEN menu, not a keypad one. Two reasons, and the second is
-- the one that matters: mod_audio_stream carries audio, not DTMF events,
-- so keypresses would need a second channel and a dialplan rewrite — and a
-- voice product asking people to press buttons is arguing against itself.
-- The caller says "appointment" or "speak to someone" and Nikki routes it.
--
-- Options are stored, not hardcoded, because "press 1 for sales" is a
-- business's own language: a clinic routes by department, a jeweller by
-- repair versus purchase.
-- ══════════════════════════════════════════════════════════════

create table if not exists ivr_menus (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  -- Null means it applies to every number this tenant holds. A tenant with
  -- one number should not have to think about which number this is for.
  did_number  text,
  enabled     boolean not null default true,
  -- What Nikki says after the TRAI disclosure, before listening.
  greeting    text,
  -- [{ "say": "appointment", "label": "Book an appointment",
  --    "action": "ai" | "transfer", "target": "9876543210" }]
  options     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists ivr_menus_tenant_did_key
  on ivr_menus(tenant_id, coalesce(did_number, ''));

alter table ivr_menus enable row level security;

drop policy if exists ivr_menus_own on ivr_menus;
create policy ivr_menus_own on ivr_menus
  for all using (tenant_id = get_my_tenant_id() or is_super_admin())
  with check (tenant_id = get_my_tenant_id() or is_super_admin());

-- voice_profiles.routing_mode was constrained to ai/human/hybrid in 016
-- while dids allowed ivr as well, so the two disagreed about what a valid
-- mode is. Widened to match.
do $$
begin
  if exists (select 1 from pg_constraint
             where conname = 'voice_profiles_routing_mode_check') then
    alter table voice_profiles drop constraint voice_profiles_routing_mode_check;
  end if;
  alter table voice_profiles
    add constraint voice_profiles_routing_mode_check
    check (routing_mode in ('ai', 'human', 'hybrid', 'ivr'));
end $$;

comment on table ivr_menus is
  'Spoken call menu. The caller says an option; Nikki either handles it or transfers.';
