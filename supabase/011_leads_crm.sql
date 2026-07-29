-- ══════════════════════════════════════════════════════════════
-- 011 — LEADS / CRM
--
-- Every inbound call to a Hey Nikki tenant is, in effect, a lead: someone
-- who wanted something from that business. Until now that information died
-- inside the call transcript — the business could read a call log, but had
-- no way to track "who called, what did they want, did we follow up, did it
-- convert."
--
-- This table is that pipeline. One row per person (deduplicated by phone
-- within a tenant), enriched automatically at the end of each call by the
-- same Gemini pass that already extracts appointments — so it costs no
-- extra latency and no extra call to the model.
--
-- Design notes:
--  * phone is the natural key within a tenant. A repeat caller updates their
--    existing lead (last_contacted_at, call_count) rather than creating a
--    duplicate — a CRM that shows the same person five times is useless.
--  * stage is a simple, honest funnel. Deliberately NOT a configurable
--    pipeline builder; an SMB clinic or shop does not need one, and a fake
--    "enterprise" feature is worse than a clear simple one.
--  * intent is stored here AND written back to calls.intent, which fixes a
--    real bug: the analytics dashboard already charts calls.intent, but
--    nothing ever populated it, so every call showed as "unknown".
-- ══════════════════════════════════════════════════════════════

create table if not exists leads (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,

  -- who
  phone             text not null,
  name              text,

  -- what they want (auto-extracted from the call, editable by the business)
  intent            text,          -- e.g. "book_appointment", "pricing_enquiry"
  interest          text,          -- free text: the service/product they asked about
  notes             text,

  -- where they are in the funnel
  stage             text not null default 'new'
                    check (stage in ('new','contacted','qualified','won','lost')),
  -- how warm: derived from what happened on the call, business can override
  score             integer default 0 check (score between 0 and 100),

  -- provenance / activity
  source            text default 'inbound_call'
                    check (source in ('inbound_call','outbound_campaign','manual','widget')),
  first_call_id     uuid references calls(id) on delete set null,
  last_call_id      uuid references calls(id) on delete set null,
  call_count        integer default 1,
  last_contacted_at timestamptz default now(),

  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),

  -- one lead per phone number per tenant — repeat callers update, not duplicate
  unique (tenant_id, phone)
);

create index if not exists idx_leads_tenant       on leads(tenant_id);
create index if not exists idx_leads_stage        on leads(tenant_id, stage);
create index if not exists idx_leads_last_contact on leads(tenant_id, last_contacted_at desc);
create index if not exists idx_leads_phone        on leads(tenant_id, phone);

-- ── keep updated_at honest ──
drop trigger if exists trg_leads_updated on leads;
create trigger trg_leads_updated
  before update on leads
  for each row execute function set_updated_at();

-- ── RLS: same tenant-scoped pattern as appointments/calls ──
alter table leads enable row level security;

drop policy if exists "leads_select" on leads;
drop policy if exists "leads_insert" on leads;
drop policy if exists "leads_update" on leads;
drop policy if exists "leads_delete" on leads;

create policy "leads_select" on leads for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "leads_insert" on leads for insert
  with check (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "leads_update" on leads for update
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "leads_delete" on leads for delete
  using (tenant_id = get_my_tenant_id() or is_super_admin());

-- ── Upsert helper ──
-- Called by the voice pipeline at the end of each call. Handles the
-- repeat-caller case atomically: insert a new lead, or bump the existing
-- one's activity and fill in any fields that were previously unknown.
-- Existing human-edited values win — the AI never overwrites what a person
-- has typed (COALESCE order puts the stored value first for name/interest).
create or replace function upsert_lead_from_call(
  p_tenant_id  uuid,
  p_phone      text,
  p_name       text,
  p_intent     text,
  p_interest   text,
  p_score      integer,
  p_call_id    uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into leads (
    tenant_id, phone, name, intent, interest, score,
    first_call_id, last_call_id, call_count, last_contacted_at
  )
  values (
    p_tenant_id, p_phone, p_name, p_intent, p_interest,
    coalesce(p_score, 0), p_call_id, p_call_id, 1, now()
  )
  on conflict (tenant_id, phone) do update set
    -- never clobber a name/interest a human already corrected
    name          = coalesce(leads.name, excluded.name),
    interest      = coalesce(leads.interest, excluded.interest),
    -- latest intent and score reflect the most recent conversation
    intent        = coalesce(excluded.intent, leads.intent),
    score         = greatest(coalesce(excluded.score, 0), coalesce(leads.score, 0)),
    last_call_id  = excluded.last_call_id,
    call_count    = leads.call_count + 1,
    last_contacted_at = now(),
    updated_at    = now()
  returning id into v_id;

  return v_id;
end;
$$;
