-- ══════════════════════════════════════════════════════════════
-- 063 — a backwards calling window must really be overnight
--
-- 062 let a window cross midnight: one that ends before it starts is read
-- as overnight. That turned a slip of the finger into a near-24-hour
-- window — 02:15–02:10 was saved at 02:09 IST and the dispatcher dialled
-- immediately. The API and the dashboard now refuse it (windowProblem() in
-- campaign-import.ts and campaigns/page.tsx); this is the guarantee for the
-- dashboard's direct insert and every other writer.
--
-- Allowed: end after start (10:00–19:00), start == end (all day), and a
-- real overnight window that starts at or after 12:00 and ends by 12:00
-- (22:00–06:00).
--
-- NOT VALID, like 053: existing rows are not checked. Run this first and fix
-- whatever it returns, then apply, then VALIDATE.
--
--   select id, tenant_id, name, status, window_start, window_end
--     from outbound_campaigns
--    where window_end < window_start
--      and not (window_start >= time '12:00' and window_end <= time '12:00');
-- ══════════════════════════════════════════════════════════════

alter table outbound_campaigns
  drop constraint if exists outbound_campaigns_window_sane;

alter table outbound_campaigns
  add constraint outbound_campaigns_window_sane
  check (window_end >= window_start
         or (window_start >= time '12:00' and window_end <= time '12:00'))
  not valid;

-- After fixing any rows the select above returns:
-- alter table outbound_campaigns validate constraint outbound_campaigns_window_sane;
