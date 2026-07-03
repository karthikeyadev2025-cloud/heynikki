-- ============================================================
-- NIKKI — onboarding_emails_sent (idempotent tracking)
-- ============================================================
-- The onboarding sequence runs as a daily cron job (via pg_cron or
-- Railway/EC2 cron). To prevent double-sending, we record each email
-- in this table BEFORE sending. Unique constraint on (user_id, step)
-- means re-running is safe.

create table if not exists public.onboarding_emails_sent (
  id          uuid          primary key default uuid_generate_v4(),
  user_id     uuid          not null references auth.users(id) on delete cascade,
  step        text          not null,                  -- 'welcome' | 'day3_check_in' | 'day10_trial_ending' | 'day14_trial_ended'
  sent_at     timestamptz   not null default now(),
  resend_id   text,                                    -- ID returned by Resend for delivery tracking
  unique (user_id, step)
);

create index if not exists idx_onboarding_user on public.onboarding_emails_sent(user_id);
create index if not exists idx_onboarding_step on public.onboarding_emails_sent(step, sent_at);

alter table public.onboarding_emails_sent enable row level security;

-- Users can see what's been sent to them (transparency under DPDP)
drop policy if exists "onboarding: self read" on public.onboarding_emails_sent;
create policy "onboarding: self read"
  on public.onboarding_emails_sent for select
  using (user_id = auth.uid());

-- Server-side only writes — no client policy
