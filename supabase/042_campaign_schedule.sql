-- Campaigns get a calendar, not just a clock.
--
-- A campaign only ever had a daily calling window (window_start/window_end).
-- "Start" meant "dial today, inside the window, and again every day until
-- the list is done". There was no way to say "call these people on Saturday
-- morning" or "stop after the 10th" — the client had to remember to press
-- Start on the right day and Pause on the right day. Campaign 3501039c sat
-- with a 20:45–21:00 window because that was the only knob there was.
--
-- start_date / end_date are IST calendar days. The dispatcher dials only
-- when today (IST) is on or after start_date, on or before end_date, and the
-- time is inside the window. Both are optional: null start = as soon as the
-- campaign is started, null end = until the list is exhausted.
alter table public.outbound_campaigns
  add column if not exists start_date date,
  add column if not exists end_date   date,
  add constraint outbound_campaigns_dates_ordered
    check (start_date is null or end_date is null or end_date >= start_date);
