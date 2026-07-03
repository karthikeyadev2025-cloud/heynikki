-- ============================================================
-- NIKKI — device_tokens table (FCM push registration)
-- ============================================================
-- Stores Firebase Cloud Messaging tokens per (user, platform) so the
-- api-server can push notifications to a specific user's active devices.
--
-- Design:
--  - Composite uniqueness on (user_id, platform) so a re-install
--    upserts cleanly rather than creating a duplicate row
--  - tenant_id derived from tenant_users via FK chain — not stored
--    redundantly. Backend joins when querying recipients.
--  - RLS: users can only see/manipulate their own tokens. Service-role
--    key bypasses RLS for server-side push fan-out.
-- ============================================================

create table if not exists public.device_tokens (
  id          uuid          primary key default uuid_generate_v4(),
  user_id     uuid          not null references auth.users(id) on delete cascade,
  platform    text          not null check (platform in ('ios','android','web')),
  token       text          not null,
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now(),
  unique (user_id, platform)
);

create index if not exists idx_device_tokens_user_id on public.device_tokens(user_id);

-- ─── RLS ───────────────────────────────────────────────────
alter table public.device_tokens enable row level security;

drop policy if exists "device_tokens: owner can read"  on public.device_tokens;
drop policy if exists "device_tokens: owner can write" on public.device_tokens;
drop policy if exists "device_tokens: owner can delete" on public.device_tokens;

create policy "device_tokens: owner can read"
  on public.device_tokens for select
  using (auth.uid() = user_id);

create policy "device_tokens: owner can write"
  on public.device_tokens for insert
  with check (auth.uid() = user_id);

create policy "device_tokens: owner can update"
  on public.device_tokens for update
  using (auth.uid() = user_id);

create policy "device_tokens: owner can delete"
  on public.device_tokens for delete
  using (auth.uid() = user_id);

-- Auto-bump updated_at on update so backend can prune stale tokens
create or replace function public.touch_device_tokens_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_device_tokens_updated on public.device_tokens;
create trigger trg_device_tokens_updated
  before update on public.device_tokens
  for each row execute function public.touch_device_tokens_updated_at();

comment on table public.device_tokens is
  'FCM tokens for push notifications. One row per (user, platform). Upserted from Flutter app post-login; deleted on logout. Server-side push fan-out uses service-role key to read across all users.';
