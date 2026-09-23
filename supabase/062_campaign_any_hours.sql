-- ══════════════════════════════════════════════════════════════
-- 062 — a campaign may call at any hour
--
-- 053 held every campaign window inside 09:00–21:00 IST (TRAI calling
-- hours), with window_end strictly after window_start. That limit has been
-- removed across the product: the dashboard, the API and the dispatcher now
-- accept any window. A window may cross midnight (22:00–06:00), and one
-- whose start equals its end (00:00–00:00) is open all day — the dispatcher's
-- withinWindow() reads it that way.
--
-- Until this is applied, the dashboard's create form still gets a 400 for
-- any window outside 09:00–21:00 or crossing midnight.
-- ══════════════════════════════════════════════════════════════

alter table outbound_campaigns
  drop constraint if exists outbound_campaigns_trai_window;
