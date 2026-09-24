-- ══════════════════════════════════════════════════════════════
-- 069 — outcomes the Desk saves on its own, and what the calls teach
--
-- disposition_auto
--   A telecaller who moves on without choosing an outcome no longer leaves
--   the call blank. On 24 Sep one seat saved none of 30 outcomes, and two
--   customers who asked for details were never sent them. The Desk now
--   saves the call summary's suggested outcome (066) once the telecaller has
--   moved on — and marks it, so reports can tell a person's judgement from
--   the model's, and a person can still change it.
--
-- desk_insights
--   Once a day, per business, the Desk's calls are read together: the
--   objections and questions that came up, what converted, a line per
--   telecaller, and suggested answers for Nikki. The suggestions reach live
--   calls only when the owner approves them (they become knowledge_base
--   rows), the same rule every other taught fact follows.
-- ══════════════════════════════════════════════════════════════

alter table click_to_call_log
  add column if not exists disposition_auto boolean not null default false;

create table if not exists desk_insights (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  day          date not null,
  calls        int  not null default 0,
  digest       jsonb not null default '{}'::jsonb,
  -- [{ "id": "...", "question": "...", "answer": "...", "status": "pending|approved|dismissed" }]
  suggestions  jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  unique (tenant_id, day)
);

-- Read and written by the API with the service key only.
alter table desk_insights enable row level security;

comment on table desk_insights is
  'Daily read of a business''s Desk calls: digest for the owner, and suggested answers for Nikki awaiting approval.';
