-- ══════════════════════════════════════════════════════════════
-- 033 — re-apply the voice_profiles half of migration 013
--
-- Migration 013 declared four columns on voice_profiles. None of them
-- exist in the live database. Its outbound_recipients half DOES exist
-- (is_instant was re-added by 023 after the same discovery), so 013 was
-- applied partially or not at all and nobody noticed for the simple
-- reason that nothing checks.
--
-- What that cost, all of it invisible until a customer hit it today:
--
--   * The SETUP WIZARD has never once saved. web/app/setup/page.tsx
--     POSTs auto_whatsapp_new_leads, auto_call_new_leads and
--     skip_dnd_for_instant_leads on every save; PostgREST rejects the
--     whole row with 42703. A new business could not configure its own
--     agent, and the error surfaced as a bare 400 in the console.
--   * WEBSITE LEAD CAPTURE cannot work at all: the webhook in
--     api-server/src/index.ts authenticates by matching capture_token,
--     and selecting a column that does not exist fails the query before
--     any comparison happens.
--   * The admin rotate-capture-token endpoint writes the same column.
--   * The outbound dispatcher's DND consent check reads
--     skip_dnd_for_instant_leads and silently got nothing.
--
-- Verified missing against the live schema before writing this, and
-- swept all 77 objects declared across every migration to find any
-- others. The only other gap is outbound_recipients.exotel_call_sid
-- from 010, which is referenced solely by voice-pipeline/app/exotel/ —
-- the retired Exotel path — and is deliberately NOT re-added here.
-- ══════════════════════════════════════════════════════════════

alter table voice_profiles
  add column if not exists capture_token text
    default encode(gen_random_bytes(16), 'hex'),
  add column if not exists auto_whatsapp_new_leads boolean not null default true,
  add column if not exists auto_call_new_leads boolean not null default false,
  add column if not exists skip_dnd_for_instant_leads boolean not null default false;

-- The column default fires on INSERT only, never on this ALTER, so every
-- row that already exists needs its own token before the NOT NULL below.
update voice_profiles set capture_token = encode(gen_random_bytes(16), 'hex')
  where capture_token is null;

alter table voice_profiles alter column capture_token set not null;

create unique index if not exists idx_voice_profiles_capture_token
  on voice_profiles(capture_token);

comment on column voice_profiles.capture_token is
  'Secret in the lead-capture webhook URL. Regenerate to invalidate old integrations.';
