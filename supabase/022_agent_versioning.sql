-- Agent versioning: every change to a voice profile keeps the version it
-- replaced, so a prompt change that makes calls worse can be undone.
--
-- WHY A TRIGGER AND NOT APPLICATION CODE
-- voice_profiles is written from at least four places: the setup page writes
-- to Supabase directly (twice), api-server inserts on onboarding, its PATCH
-- endpoint updates, and the super-admin console edits routing. A snapshot
-- taken in any one of them is a snapshot the other three skip. In the
-- database it cannot be bypassed, including by a hand-edit in the SQL editor
-- — which is exactly when you most want the previous value kept.
create table if not exists voice_profile_versions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references voice_profiles(id) on delete cascade,
  tenant_id   uuid references tenants(id) on delete cascade,
  -- The whole row as it was BEFORE the change. jsonb rather than mirrored
  -- columns so adding a field to voice_profiles never needs a matching
  -- migration here, and an old version stays readable after the live table
  -- has moved on.
  snapshot    jsonb not null,
  changed_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz default now()
);

create index if not exists voice_profile_versions_idx
  on voice_profile_versions (profile_id, created_at desc);

create or replace function snapshot_voice_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- updated_at moves on every write, so comparing whole rows would record a
  -- version for saves that changed nothing a caller could hear. Compare the
  -- row with updated_at masked out instead.
  if to_jsonb(old) - 'updated_at' is distinct from to_jsonb(new) - 'updated_at' then
    insert into voice_profile_versions (profile_id, tenant_id, snapshot, changed_by)
    values (old.id, old.tenant_id, to_jsonb(old), auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_voice_profile_version on voice_profiles;
create trigger trg_voice_profile_version
  before update on voice_profiles
  for each row execute function snapshot_voice_profile();

alter table voice_profile_versions enable row level security;
drop policy if exists "vpv_select" on voice_profile_versions;
drop policy if exists "vpv_write"  on voice_profile_versions;
-- Readable by the owning tenant so they can see and restore their own
-- history. Writes come only from the trigger, which runs as definer — a
-- tenant must not be able to forge or delete the record of what it changed.
create policy "vpv_select" on voice_profile_versions for select
  using (is_super_admin() or tenant_id = get_my_tenant_id());
create policy "vpv_write" on voice_profile_versions for all
  using (is_super_admin()) with check (is_super_admin());
