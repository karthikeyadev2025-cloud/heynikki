-- ══════════════════════════════════════════════════════════════
-- 036 — inbound WhatsApp, and importing leads
--
-- Until now the WhatsApp webhook did this with a customer's reply:
--     console.log(`[WhatsApp] in from ${m.from}: ${text}`)
-- It was received, printed, and dropped. A business could send a missed-call
-- follow-up, a brochure or an appointment confirmation and never learn that
-- the customer answered "yes, interested" — the reply existed only in a
-- container log nobody reads. For a product whose point is capturing leads,
-- that was the leakiest hole in it.
-- ══════════════════════════════════════════════════════════════

create table if not exists wa_inbound (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  lead_id      uuid references leads(id) on delete set null,
  from_number  text not null,
  body         text,
  msg_type     text default 'text',
  provider_msg_id text unique,        -- Meta redelivers; this makes it idempotent
  received_at  timestamptz not null default now(),
  read_at      timestamptz,
  created_at   timestamptz default now()
);

create index if not exists idx_wa_inbound_tenant  on wa_inbound(tenant_id, received_at desc);
create index if not exists idx_wa_inbound_from    on wa_inbound(tenant_id, from_number);
create index if not exists idx_wa_inbound_lead    on wa_inbound(lead_id);
create index if not exists idx_wa_inbound_unread  on wa_inbound(tenant_id) where read_at is null;

alter table wa_inbound enable row level security;

drop policy if exists wa_inbound_tenant on wa_inbound;
create policy wa_inbound_tenant on wa_inbound for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());

-- Marking a message read is the only write a customer makes; the rows
-- themselves are written by the webhook on the service key.
drop policy if exists wa_inbound_mark_read on wa_inbound;
create policy wa_inbound_mark_read on wa_inbound for update
  using (tenant_id = get_my_tenant_id())
  with check (tenant_id = get_my_tenant_id());

-- ── Importing leads ────────────────────────────────────────────────
-- leads.source is CHECK-constrained, and 'import' was never one of the
-- allowed values — so a bulk import would have failed on its first row.
alter table leads drop constraint if exists leads_source_check;
alter table leads add constraint leads_source_check
  check (source in ('inbound_call','outbound_campaign','manual','widget',
                    'web_form','ad_lead','import','whatsapp'));

comment on table wa_inbound is
  'Customer replies received from Meta. Threaded to a lead by phone number.';
