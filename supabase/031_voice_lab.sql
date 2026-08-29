-- ══════════════════════════════════════════════════════════════
-- 031 — VOICE LAB: pronunciation lexicon + the entity test set
--
-- PRONUNCIATION (B10). In an eval Nikki re-spelled a business's own name:
-- రామ్య came out రామ్మా. A receptionist mispronouncing her employer's name
-- is the most trust-costly mistake she can make, and no prompt rule fully
-- prevents it — the fix is a per-tenant map applied to the TEXT just
-- before synthesis ({"రామ్య": "రామ్యా"}), which corrects both the model
-- re-spelling a name and the TTS misreading a correct one. Local and
-- vendor-independent; Sarvam's hosted dictionary API can layer on later.
--
-- ENTITY TEST SET (B11). The only independent noisy-Telugu benchmark
-- shows 33-47% WER across ALL vendors — clean-speech numbers are
-- meaningless for clinic calls, and no public Telugu telephony corpus
-- exists. Real calls annotated for the entities that matter (names,
-- numbers, times, amounts) are the ruler for every future STT decision
-- and a data moat no competitor has. Consent rides the TRAI disclosure;
-- the flag is still stored per sample because the export must be able to
-- prove it.
-- ══════════════════════════════════════════════════════════════

alter table voice_profiles
  add column if not exists pronunciation_map jsonb not null default '{}'::jsonb;

comment on column voice_profiles.pronunciation_map is
  'Written form -> spoken form, applied to text just before TTS. Longest keys win.';

create table if not exists stt_eval_samples (
  id             uuid primary key default gen_random_uuid(),
  call_id        uuid references calls(id) on delete set null,
  tenant_id      uuid references tenants(id) on delete set null,
  r2_object_key  text,
  machine_transcript text,
  truth_transcript   text,
  -- {"names": [...], "phones": [...], "times": [...], "amounts": [...]}
  entities       jsonb not null default '{}'::jsonb,
  noise_band     text check (noise_band in ('quiet','street','speakerphone','unknown'))
                 default 'unknown',
  consented      boolean not null default true,
  annotated      boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists stt_eval_pending_idx
  on stt_eval_samples(annotated) where annotated = false;

alter table stt_eval_samples enable row level security;

-- Platform-only in BOTH directions: these are recordings of real people's
-- calls, held for measurement. No tenant browses another business's audio,
-- and no tenant needs to browse their own here — their calls page has it.
drop policy if exists stt_eval_admin on stt_eval_samples;
create policy stt_eval_admin on stt_eval_samples
  for all using (is_super_admin()) with check (is_super_admin());

comment on table stt_eval_samples is
  'Annotated noisy-Telugu call samples. Entity accuracy, not WER, is the metric.';
