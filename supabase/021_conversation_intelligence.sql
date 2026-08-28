-- Conversation intelligence: one scored row per analysed call.
--
-- Every call already stores its full transcript as a {ts, role, content}
-- array, and nothing has ever read them back except a human opening one call
-- at a time. This is the table that turns 100% of conversations into
-- something a supervisor can act on without listening to any of them.
--
-- Separate from calls rather than more columns on it: scoring is derived,
-- re-runnable, and model-versioned. When the prompt or the model changes the
-- scores change, and that has to be visible — hence model and analysed_at on
-- every row. Mixing derived judgements into the call record would make it
-- impossible to tell a fact about the call from an opinion about it.
create table if not exists call_quality (
  id                 uuid primary key default gen_random_uuid(),
  -- One score per call. Re-analysis updates in place rather than appending,
  -- so the supervisor list cannot show the same call three times.
  call_id            uuid not null unique references calls(id) on delete cascade,
  tenant_id          uuid not null references tenants(id) on delete cascade,

  -- 0-100. overall is the model's own weighting, not an average of the
  -- others: a call can be courteous and still fail the caller completely.
  overall_score      integer check (overall_score between 0 and 100),
  resolution_score   integer check (resolution_score between 0 and 100),
  courtesy_score     integer check (courtesy_score between 0 and 100),
  compliance_score   integer check (compliance_score between 0 and 100),

  -- How the CALLER sounded, not how the agent performed.
  sentiment          text check (sentiment in ('positive','neutral','negative','mixed')),

  -- Did the call end with something concrete — a booking, a callback, a
  -- number taken? The single strongest predictor of whether it was worth
  -- anything commercially.
  next_step_captured boolean default false,

  objections         text[] default '{}',   -- sales objections raised
  topics             text[] default '{}',   -- voice-of-customer themes
  risk_flags         text[] default '{}',   -- compliance / conduct concerns

  summary            text,                  -- two lines, for the list view
  coaching           text,                  -- what to do differently next time

  model              text,                  -- which model produced this
  analysed_at        timestamptz default now(),
  created_at         timestamptz default now()
);

-- The supervisor view is "worst first", which is where attention is worth
-- most. Nulls last so unscored rows do not head the list.
create index if not exists call_quality_worst_idx
  on call_quality (tenant_id, overall_score asc nulls last);
create index if not exists call_quality_recent_idx
  on call_quality (tenant_id, analysed_at desc);
-- Aggregating themes across calls is the Voice-of-Customer query.
create index if not exists call_quality_topics_idx  on call_quality using gin(topics);
create index if not exists call_quality_objections_idx on call_quality using gin(objections);

alter table call_quality enable row level security;
drop policy if exists "call_quality_select" on call_quality;
drop policy if exists "call_quality_write"  on call_quality;
-- Readable by the tenant it belongs to. Written only by the service role —
-- the analyser job — so a business cannot mark its own calls as perfect.
create policy "call_quality_select" on call_quality for select
  using (is_super_admin() or tenant_id = get_my_tenant_id());
create policy "call_quality_write" on call_quality for all
  using (is_super_admin()) with check (is_super_admin());
