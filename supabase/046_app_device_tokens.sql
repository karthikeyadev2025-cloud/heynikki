-- ══════════════════════════════════════════════════════════════
-- 046 — device tokens for the Hey Nikki phone app
--
-- The app keeps a microphone open for hours with the screen off, waiting
-- for "Hey Nikki". A Supabase access token dies after an hour and the
-- refresh token belongs to the WebView's session (rotating it from native
-- code would sign the dashboard out). So the phone holds its own
-- credential: an opaque 32-byte token minted once after login, stored
-- hashed, revocable per device, good for 90 days of silence.
--
-- Only /api/app/* accepts it, and those routes only do what the owner's
-- voice can do: ask about the business. It never edits anything.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.app_device_tokens (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  token_hash    text not null unique,            -- sha256(token), never the token
  label         text,                            -- "Samsung Galaxy A54 · Android 14"
  platform      text not null default 'android' check (platform in ('android','ios')),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

create index if not exists app_device_tokens_user_idx
  on public.app_device_tokens(user_id, created_at desc);

alter table public.app_device_tokens enable row level security;

-- A person sees and revokes their own devices from the dashboard; minting
-- goes through the API with the service key.
drop policy if exists app_device_tokens_own on public.app_device_tokens;
create policy app_device_tokens_own on public.app_device_tokens
  for select using (auth.uid() = user_id);

drop policy if exists app_device_tokens_revoke on public.app_device_tokens;
create policy app_device_tokens_revoke on public.app_device_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
