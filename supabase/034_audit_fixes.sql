-- ══════════════════════════════════════════════════════════════
-- 034 — the database half of the new-customer journey audit
--
-- An 82-agent audit of the signup-to-first-call path confirmed 38 defects,
-- ten of them blockers. Most were code and are fixed in this same commit.
-- These three need SQL.
-- ══════════════════════════════════════════════════════════════

-- ── 1. Platform WhatsApp templates are invisible to every customer ──
-- Migration 016 seeds the only three templates that exist with
-- tenant_id = NULL, and the sole non-admin policy reads
-- `using (tenant_id = get_my_tenant_id())`. In SQL, NULL = <uuid> is NULL,
-- not TRUE, so RLS filters all three out for every ordinary user and
-- /whatsapp renders an empty Template Library for everyone.
--
-- Read is widened to include platform rows; WRITE deliberately is not, so a
-- tenant still cannot edit or delete a template they do not own.
drop policy if exists tenant_own_wa_templates on wa_templates;

create policy wa_templates_read on wa_templates for select
  using (tenant_id is null
         or tenant_id = get_my_tenant_id()
         or is_super_admin());

create policy wa_templates_write on wa_templates for all
  using (tenant_id = get_my_tenant_id())
  with check (tenant_id = get_my_tenant_id());

-- ── 2. Onboarding steps that failed can be retried ──────────────────
-- sendStep claims a step by INSERT before sending so a crash cannot double
-- send. The cost was that a step which FAILED — a Meta outage, a transient
-- 500 — held its claim forever and the customer silently never received
-- their welcome message. The code now re-claims a failed step up to three
-- times; this is the counter it reads.
alter table onboarding_events
  add column if not exists attempts integer not null default 1;

-- ── 3. ivr_menus: an arbiter PostgREST can actually name ────────────
-- The only unique index was the expression index
-- (tenant_id, coalesce(did_number,'')). Postgres cannot infer an arbiter
-- from ON CONFLICT (tenant_id), so every save of a call menu failed. The
-- client no longer upserts (it reads then writes), but the expression index
-- also silently permits two tenant-wide rows if did_number is NULL in one
-- and '' in the other, so normalise and constrain properly.
update ivr_menus set did_number = null where did_number = '';

-- Keep the expression index: it is what actually enforces one row per
-- (tenant, did) including the NULL case, which a plain unique index cannot.
create unique index if not exists ivr_menus_tenant_did_key
  on ivr_menus(tenant_id, coalesce(did_number, ''));
