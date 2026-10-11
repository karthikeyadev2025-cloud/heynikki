-- ══════════════════════════════════════════════════════════════
-- 075 — remarks a telecaller writes while talking to a customer
--
-- The Desk had one notes box, and it appeared only AFTER the call, tied to
-- the outcome. What a customer says in the second minute was typed from
-- memory in the fifth, or not at all; an incoming call answered from the
-- Desk had nowhere to write anything; and each save replaced the last, so
-- "who said what, when" was lost.
--
-- A remark is one line, by one person, at one time, about one number. They
-- are only ever added — the history of a customer is not something a later
-- call should be able to overwrite.
--
--   phone         ten digits; the customer's history is read by number, so
--                 a remark written before a lead existed still shows
--   lead_id       the lead, once there is one
--   ctc_log_id    the Desk call it was written on, when it was a Desk call
--   during_call   written while the line was open, not afterwards
--
-- Until this is applied the Desk still saves remarks — onto the lead's
-- notes, stamped with the time and the name — so nothing typed is lost.
-- ══════════════════════════════════════════════════════════════

create table if not exists lead_remarks (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  lead_id        uuid references leads(id) on delete cascade,
  phone          text not null check (phone ~ '^[0-9]{10}$'),
  author_user_id uuid references auth.users(id) on delete set null,
  author_name    text,
  body           text not null check (char_length(body) between 1 and 2000),
  ctc_log_id     uuid references click_to_call_log(id) on delete set null,
  during_call    boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists idx_lead_remarks_phone
  on lead_remarks (tenant_id, phone, created_at desc);

alter table lead_remarks enable row level security;

-- The whole team reads a customer's remarks; they are written through the
-- API, which stamps the author — nobody writes one as somebody else.
drop policy if exists lead_remarks_read on lead_remarks;
create policy lead_remarks_read on lead_remarks for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
