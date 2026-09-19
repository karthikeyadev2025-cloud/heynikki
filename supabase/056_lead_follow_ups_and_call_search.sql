-- ══════════════════════════════════════════════════════════════
-- 056 — LEAD FOLLOW-UPS, AND A SEARCHABLE CALL TRANSCRIPT
--
-- Two unrelated gaps, one migration, because both are additive columns /
-- objects on tables the dashboard already reads.
--
-- 1. FOLLOW-UPS
--    A lead could be moved between stages but never *scheduled*. "Call her
--    back Thursday morning" lived in the owner's head or on a slip of
--    paper, so the most valuable leads — the ones that asked to be called
--    later — were exactly the ones that got dropped.
--
-- 2. TRANSCRIPT SEARCH
--    /calls could filter by intent and nothing else. "Which caller asked
--    about the Kukatpally branch?" meant opening calls one at a time.
--    transcript is jsonb, and PostgREST cannot filter on a cast
--    (`transcript::text=ilike.*x*` is parsed as a filter on `transcript`
--    itself and the request dies on `operator does not exist: jsonb ~~*`).
--    So the search lives behind a function, called with the service key by
--    api-server/src/search-export.ts.
--
-- NOTHING HERE IS REQUIRED. The dashboard probes for the follow-up columns
-- and hides the whole feature when they are absent, and the search route
-- falls back to reading the calls rows and matching in Node when the
-- function below does not exist. Applying this migration turns a feature on
-- and makes a query fast; it does not stop a 500.
-- ══════════════════════════════════════════════════════════════

-- ── 1. FOLLOW-UP REMINDERS ────────────────────────────────────
--
-- The data model, for the scheduler that will notify on these:
--
--   follow_up_at         when to nudge the business, as an absolute
--                        timestamptz. The UI collects an IST date + time
--                        and converts; never store a bare date, because a
--                        "9am" reminder that fires at 14:30 IST (09:00 UTC)
--                        is worse than no reminder.
--   follow_up_note       what to say / why — "quoted ₹8,000, wants to
--                        confirm with husband". Shown on the reminder.
--   follow_up_done_at    set when the business marks the follow-up done.
--                        Non-null means "finished" — do not notify.
--   follow_up_notified_at
--                        set by the scheduler once it has sent its nudge,
--                        so a reminder that stays due for three days is
--                        not sent three times. Cleared (set to null) by
--                        the dashboard whenever follow_up_at moves, which
--                        is what makes snooze re-arm the notification.
--
-- The query a notifier wants:
--   select * from leads
--    where follow_up_at <= now()
--      and follow_up_done_at is null
--      and follow_up_notified_at is null;
alter table leads add column if not exists follow_up_at         timestamptz;
alter table leads add column if not exists follow_up_note       text;
alter table leads add column if not exists follow_up_done_at    timestamptz;
alter table leads add column if not exists follow_up_notified_at timestamptz;

comment on column leads.follow_up_at is
  'When to remind the business about this lead (absolute time; the UI collects IST). Null = no reminder.';
comment on column leads.follow_up_note is
  'What the reminder should say. Free text written by the business.';
comment on column leads.follow_up_done_at is
  'Set when the follow-up is marked done. Non-null = do not remind.';
comment on column leads.follow_up_notified_at is
  'Set by the scheduler after it notifies, so one reminder is sent once. Reset to null whenever follow_up_at changes.';

-- Partial: the dashboard's "due today" chip and the scheduler's sweep both
-- ask only for live reminders, and on a tenant with 20,000 leads the handful
-- with a pending follow-up should not mean a sequential scan of all of them.
create index if not exists idx_leads_follow_up
  on leads (tenant_id, follow_up_at)
  where follow_up_at is not null and follow_up_done_at is null;

-- The scheduler sweeps across every tenant, so it needs a tenant-free entry
-- point into the same rows.
create index if not exists idx_leads_follow_up_due
  on leads (follow_up_at)
  where follow_up_at is not null and follow_up_done_at is null and follow_up_notified_at is null;

-- No RLS change: these are columns on `leads`, and 011's leads_select /
-- leads_update policies already scope every row to its tenant. A member can
-- set a reminder on a lead they can already edit, which is the intent.


-- ── 2. CALL TRANSCRIPT SEARCH ─────────────────────────────────

-- ILIKE '%needle%' cannot use a btree index. pg_trgm can, and it is the
-- extension Supabase ships for exactly this.
create extension if not exists pg_trgm;

-- The index is on the same expression the function filters on. Without it
-- the search still returns the right rows — it just reads every call row of
-- the tenant to do it, which is fine at a few thousand calls and is not fine
-- at a hundred thousand.
create index if not exists idx_calls_transcript_trgm
  on calls using gin ((transcript::text) gin_trgm_ops);

create index if not exists idx_calls_caller_number_trgm
  on calls using gin (caller_number gin_trgm_ops);

-- search_calls — one page of a tenant's calls matching a free-text needle.
--
-- Two-stage match on purpose:
--   * `transcript::text ilike …` is the stage the trigram index can serve,
--     but it also matches the JSON scaffolding — searching for "content" or
--     "user" would hit every call ever recorded.
--   * the `exists (… jsonb_array_elements …)` stage then checks that the
--     needle is really in something a person said. It only ever runs on the
--     rows stage one kept.
--
-- Returns the list columns /calls draws plus `snippet`, the first turn that
-- matched, so a result can show WHY it matched without shipping the whole
-- transcript of every hit to the browser.
--
-- p_q is escaped here rather than at the caller: it is interpolated into a
-- LIKE pattern, so a caller searching for "50%" or "pin_code" must not get
-- wildcards.
create or replace function public.search_calls(
  p_tenant uuid,
  p_q      text    default null,
  p_intent text    default null,
  p_status text    default null,
  p_from   timestamptz default null,
  p_to     timestamptz default null,
  p_limit  int     default 50,
  p_offset int     default 0
)
returns table (
  id                  uuid,
  caller_number       text,
  direction           text,
  status              text,
  duration_seconds    integer,
  intent              text,
  wa_sent             boolean,
  appointment_created boolean,
  created_at          timestamptz,
  snippet             text
)
language sql
stable
set search_path = public, pg_temp
as $$
  with needle as (
    select case
      when p_q is null or btrim(p_q) = '' then null
      else '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    end as pat
  )
  select c.id, c.caller_number, c.direction, c.status, c.duration_seconds,
         c.intent, c.wa_sent, c.appointment_created, c.created_at,
         (select t ->> 'content'
            from jsonb_array_elements(c.transcript) t
           where t ->> 'content' ilike n.pat
           limit 1) as snippet
    from calls c, needle n
   where c.tenant_id = p_tenant
     and (p_intent is null or c.intent = p_intent)
     and (p_status is null or c.status = p_status)
     and (p_from   is null or c.created_at >= p_from)
     and (p_to     is null or c.created_at <= p_to)
     and (
       n.pat is null
       or c.caller_number ilike n.pat
       or (
         c.transcript::text ilike n.pat
         and exists (
           select 1 from jsonb_array_elements(c.transcript) t
            where t ->> 'content' ilike n.pat
         )
       )
     )
   order by c.created_at desc
   limit  greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- The function takes the tenant as an ARGUMENT, so anything that can call it
-- can read any tenant's calls. Only the API may call it, and the API has
-- already proved the caller's tenant from their JWT before it does.
-- A browser holding an anon or user token must never reach this.
revoke all on function public.search_calls(uuid, text, text, text, timestamptz, timestamptz, int, int)
  from public, anon, authenticated;
grant execute on function public.search_calls(uuid, text, text, text, timestamptz, timestamptz, int, int)
  to service_role;

-- Exports page through calls / leads / appointments in created_at order for
-- one tenant. calls already has (tenant_id, status, created_at desc) from
-- 045; the other two had nothing but the plain tenant_id index, so a shop
-- with 30,000 appointments sorted all of them on every page of the download.
create index if not exists idx_appointments_tenant_created
  on appointments (tenant_id, created_at desc);
create index if not exists idx_leads_tenant_created
  on leads (tenant_id, created_at desc);
