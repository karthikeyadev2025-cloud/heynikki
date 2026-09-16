-- ══════════════════════════════════════════════════════════════
-- 050 — DND SCRUB LEDGER
--
-- Every DND decision this system makes, kept as a record.
--
-- Two reasons, and the compliance one is the reason it is a table rather
-- than a cache:
--
-- 1. TRAI expects a telemarketer to be able to show, for any number it
--    dialled, that the number was scrubbed and what the answer was. Until
--    now the only trace was outbound_recipients.metadata.scrub_reason,
--    which is overwritten on the next attempt and deleted with the
--    campaign. A record that disappears when the evidence is wanted is
--    not a record.
--
-- 2. A scrub costs money and a round trip to a provider that may be slow.
--    The same number is scrubbed again on every retry, and appears on
--    several campaigns for the same business. A short validity window
--    turns those into one call.
--
-- The window is deliberately conservative. A preference registered with
-- the NCPR takes effect quickly, and a cached "not on DND" that outlives
-- the customer's decision to register is exactly the failure that gets a
-- telemarketer fined. Seven days is the outer limit; DND_SCRUB_TTL_HOURS
-- can shorten it, and nothing lengthens it past the CHECK below.
--
-- A blocked result is NEVER served from cache on the permissive side:
-- expiry only ever causes a re-scrub, never an assumption that a number
-- is callable.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.dnd_scrub_results (
  id            uuid          primary key default uuid_generate_v4(),
  -- Scrub answers are a property of the NUMBER and the national registry,
  -- not of one business, so this is deliberately not tenant-scoped: two
  -- tenants dialling the same number ask the registry the same question.
  -- Consent is the tenant-scoped part, and it is decided before a scrub is
  -- ever requested (see scrubDnd) — so nothing tenant-specific is cached
  -- here, and one tenant can never widen what another is allowed to dial.
  phone         text          not null,
  blocked       boolean       not null,
  reason        text,
  -- 'provider' = a real answer from a scrub provider and the only kind
  -- worth reusing. 'unavailable' = no provider configured or it failed;
  -- recorded for the audit trail, never served from cache.
  source        text          not null default 'provider'
                              check (source in ('provider', 'unavailable')),
  provider      text,
  checked_at    timestamptz   not null default now(),
  expires_at    timestamptz   not null,
  created_at    timestamptz   not null default now(),
  -- Seven days, hard. A cached "callable" that outlives the customer's
  -- registration is the expensive mistake here.
  constraint dnd_scrub_window check (expires_at <= checked_at + interval '7 days')
);

-- The lookup the dispatcher makes on every pending recipient: newest
-- usable answer for this number.
create index if not exists idx_dnd_scrub_phone_fresh
  on public.dnd_scrub_results (phone, expires_at desc);

-- The compliance query: everything we decided about one number, in order.
create index if not exists idx_dnd_scrub_phone_time
  on public.dnd_scrub_results (phone, checked_at desc);

alter table public.dnd_scrub_results enable row level security;

-- Service-role only. This is a regulatory record written by the dispatcher
-- and read by the dispatcher; no browser session has any business reading
-- the national DND status of numbers belonging to other businesses, and
-- the table is not tenant-scoped so a tenant policy could not be written
-- correctly anyway. With RLS on and no policy, PostgREST returns nothing
-- to an anon or authenticated caller, which is the intent.
--
-- (Migration 032 is the precedent: a bucket with RLS and no policy was a
-- BUG there because the dashboard needed to read it. Here it is the
-- design, so it is stated rather than left to be rediscovered.)

-- ── Why a number was opted out, not just that it was ──────────────
-- outbound_opt_outs.reason already exists but is free text set by the
-- panel. A caller who tells Nikki on the phone to stop calling is the
-- most common real opt-out and had nowhere to be written from; these
-- columns let that path record itself distinctly from an operator's
-- manual entry, which matters when someone asks who removed a number.
alter table public.outbound_opt_outs
  add column if not exists source text not null default 'panel';

alter table public.outbound_opt_outs
  add column if not exists call_id uuid;

comment on column public.outbound_opt_outs.source is
  'panel | call | api | import — where the opt-out came from';
comment on column public.outbound_opt_outs.call_id is
  'the call on which the customer asked not to be called again, when source = call';
