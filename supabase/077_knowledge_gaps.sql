-- ══════════════════════════════════════════════════════════════
-- 077 — what callers asked that Nikki did not know
--
-- Teach Nikki only learned what an owner thought to type. The questions
-- that actually stumped her on calls — "how much for 100 visiting cards?",
-- "when will it be ready?" on the All Rounder Ads calls of 16 Oct — were
-- answered with "the owner will tell you" and then forgotten. Nothing
-- read Nikki's own calls for them; the daily insights (069) read only the
-- Desk's.
--
-- After every call the scorer lists the business questions she could not
-- answer. Each lands here once per business (question_key), counted when
-- asked again, and the owner is pushed at once. Answering one on the
-- Teach Nikki page writes a knowledge_base fact, which the next call
-- already reads — no embedding wait.
--
-- Also: knowledge_base had select/insert/delete policies but no update, so
-- correcting a price meant deleting the fact and typing it again.
-- ══════════════════════════════════════════════════════════════

create table if not exists knowledge_gaps (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  voice_profile_id uuid references voice_profiles(id) on delete cascade,
  question         text not null,          -- short, in English, as the owner reads it
  question_key     text not null,          -- normalised question, for counting repeats
  caller_said      text,                   -- the caller's own words, last time asked
  call_id          uuid references calls(id) on delete set null,
  times_asked      int  not null default 1,
  status           text not null default 'open'
                     check (status in ('open', 'answered', 'dismissed')),
  answer           text,
  created_at       timestamptz not null default now(),
  last_asked_at    timestamptz not null default now(),
  answered_at      timestamptz,
  unique (tenant_id, question_key)
);

create index if not exists knowledge_gaps_open_idx
  on knowledge_gaps (tenant_id, last_asked_at desc) where status = 'open';

alter table knowledge_gaps enable row level security;

drop policy if exists "kg_select" on knowledge_gaps;
drop policy if exists "kg_update" on knowledge_gaps;
create policy "kg_select" on knowledge_gaps for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "kg_update" on knowledge_gaps for update
  using (tenant_id = get_my_tenant_id())
  with check (tenant_id = get_my_tenant_id());

drop policy if exists "kb_update" on knowledge_base;
create policy "kb_update" on knowledge_base for update
  using (tenant_id = get_my_tenant_id())
  with check (tenant_id = get_my_tenant_id());

comment on table knowledge_gaps is
  'Business questions callers asked that Nikki could not answer; answered on Teach Nikki into knowledge_base.';
