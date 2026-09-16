-- ══════════════════════════════════════════════════════════════
-- 051 — a campaign cannot be told to ring people at night
--
-- window_start / window_end were free `time` columns. The dashboard inserts
-- campaigns straight into the table (RLS, no API in between) and the
-- schedule route accepted any HH:MM, so a campaign could be saved to dial
-- from 06:00 or until 23:30 and the dispatcher would do exactly that. TRAI
-- permits these calls between 09:00 and 21:00.
--
-- The API now validates (campaign-import.ts, outbound.ts) and refuses to
-- start a campaign whose stored window is outside those hours. This is the
-- guarantee for every other writer.
--
-- NOT VALID: existing rows are not checked, so applying this cannot fail on
-- an old campaign. But Postgres checks the constraint on EVERY update of a
-- row, including ones that never touch the window — so an old out-of-hours
-- campaign would then refuse the dispatcher's own status updates (pause,
-- completed). Run the select below FIRST and fix what it returns (clamp to
-- 09:00–21:00, or cancel the campaign), then apply, then VALIDATE.
--
--   select id, tenant_id, name, status, window_start, window_end
--     from outbound_campaigns
--    where window_start < '09:00' or window_end > '21:00' or window_end <= window_start;
-- ══════════════════════════════════════════════════════════════

alter table outbound_campaigns
  drop constraint if exists outbound_campaigns_trai_window;

alter table outbound_campaigns
  add constraint outbound_campaigns_trai_window
  check (window_start >= time '09:00' and window_end <= time '21:00' and window_end > window_start)
  not valid;

-- After fixing any rows the select above returns:
-- alter table outbound_campaigns validate constraint outbound_campaigns_trai_window;
