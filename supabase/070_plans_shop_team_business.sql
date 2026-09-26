-- ══════════════════════════════════════════════════════════════
-- 070 — Shop / Team / Business plans, and a separate telecaller allowance
--
-- desk_minutes_per_month
--   Minutes people spend on calls: telecaller Desk calls, and calls a line
--   hands straight to the team (calls rows with intent 'transfer'). They
--   were counted against the same allowance as Nikki's own minutes, so a
--   busy telecaller could use up the minutes that keep Nikki answering —
--   on 25 Sep telecalling was 170 of 213 calls on one account. The two cost
--   very differently (trunk alone vs speech, voice, model and trunk), so
--   each has its own allowance. usage.ts meters them separately; before
--   this column exists it keeps the old single pool.
--
-- The plans
--   Priced as a receptionist and telecaller replacement, profitable even
--   when every minute and number is used (AI ₹3.28/min, Desk ~₹1/min,
--   a number ~₹500/month). Annual = 10 × monthly (2 months free).
--   Plan ids stay starter/growth/scale — code and existing tenants key on
--   them; customers see Shop / Team / Business.
--
--                 Shop       Team       Business
--   Monthly       ₹3,999     ₹9,999     ₹24,999
--   Annual        ₹39,990    ₹99,990    ₹2,49,990
--   Nikki (AI)    400 min    1,000 min  2,500 min
--   Desk          300 min    1,500 min  3,500 min
--   Seats         1          3          8
--   Numbers       1          2          5
--   At once       2          4          6   (trunk carries 10 in total)
--   Profiles      1          3          10
--   Recordings    90 days    1 year     2 years
--   Campaigns     —          yes        yes
--   API           —          —          yes
-- ══════════════════════════════════════════════════════════════

alter table plans
  add column if not exists desk_minutes_per_month integer;

comment on column plans.desk_minutes_per_month is
  'Monthly minutes for calls handled by people (Desk, lines routed to the team). NULL = shares minutes_per_month.';

update plans set
  display_name = 'Shop',
  price_monthly_paise = 399900, price_annual_paise = 3999000,
  minutes_per_month = 400, desk_minutes_per_month = 300,
  max_seats = 1, max_phone_numbers = 1, max_concurrent_calls = 2, max_voice_profiles = 1,
  recording_days = 90, outbound_campaigns = false, api_access = false
where id = 'starter';

update plans set
  display_name = 'Team',
  price_monthly_paise = 999900, price_annual_paise = 9999000,
  minutes_per_month = 1000, desk_minutes_per_month = 1500,
  max_seats = 3, max_phone_numbers = 2, max_concurrent_calls = 4, max_voice_profiles = 3,
  recording_days = 365, outbound_campaigns = true, api_access = false
where id = 'growth';

update plans set
  display_name = 'Business',
  price_monthly_paise = 2499900, price_annual_paise = 24999000,
  minutes_per_month = 2500, desk_minutes_per_month = 3500,
  max_seats = 8, max_phone_numbers = 5, max_concurrent_calls = 6, max_voice_profiles = 10,
  recording_days = 730, outbound_campaigns = true, api_access = true
where id = 'scale';

-- The free start: 100 minutes once (credit_minutes), shared by Nikki and the
-- Desk, one seat, one number.
update plans set
  display_name = 'Free — 100 minutes', desk_minutes_per_month = null
where id = 'trial';

-- platform_config still carries the old plan_tier_* rows. Nothing reads them
-- for limits any more (the plans table is the source), but they are kept in
-- step so no screen that still shows them can quote a retired price.
update platform_config set value = '{"id":"starter","name":"Shop","monthly_paise":399900,"minutes":400,"numbers":1,"seats":1,"profiles":1,"concurrent":2}'
  where key = 'plan_tier_1';
update platform_config set value = '{"id":"growth","name":"Team","monthly_paise":999900,"minutes":1000,"numbers":2,"seats":3,"profiles":3,"concurrent":4}'
  where key = 'plan_tier_2';
update platform_config set value = '{"id":"scale","name":"Business","monthly_paise":2499900,"minutes":2500,"numbers":5,"seats":8,"profiles":10,"concurrent":6}'
  where key = 'plan_tier_3';
