-- ══════════════════════════════════════════════════════════════
-- 047 — the voice API grows two write paths: outbound reminder calls
--       placed by a customer's own software, and Telugu order-taking.
--
-- OUTBOUND CALLS (POST /api/v1/calls/outbound)
--   No new table. A call requested over the API is an instant
--   outbound_recipients row (is_instant, campaign_id null) with
--   metadata.source = 'api_reminder', so the dispatcher, the hangup hook
--   and the admin stall detector all keep working unchanged. The three
--   columns below are what the API needs on top:
--     consent_declared  — added in 048. 019 put the same three columns on
--                         outbound_campaigns, where consent is a property
--                         of an uploaded list; an API-placed call has no
--                         list, so the attestation belongs on the row.
--     api_key_id        — which key placed the call, for the key's own
--                         usage view and for revoking a key's pending work.
--     reference         — the caller's own id for this call (their booking
--                         number), indexed so GET ?reference= is cheap.
--
-- ORDERS (Telugu order-taking)
--   A business that sells things by phone — a mess, a sweet shop, a
--   pharmacy — switches on order_taking and types its catalogue. Nikki
--   takes the order on the call, reads it back with the total, and the
--   pipeline files it here after the call, the same way an appointment is
--   filled in after the call. Read over GET /api/v1/orders, pushed to the
--   tenant's automation webhook as order-created, confirmed on WhatsApp.
-- ══════════════════════════════════════════════════════════════

-- ── outbound_recipients: the API's columns ───────────────────
alter table public.outbound_recipients
  add column if not exists api_key_id uuid references public.api_keys(id) on delete set null,
  add column if not exists reference  text;

create index if not exists outbound_recipients_reference_idx
  on public.outbound_recipients(tenant_id, reference)
  where reference is not null;

-- The public list endpoint pages a tenant's API-placed calls newest first.
create index if not exists outbound_recipients_api_idx
  on public.outbound_recipients(tenant_id, created_at desc)
  where api_key_id is not null;

-- ── voice_profiles: order taking ─────────────────────────────
-- catalogue: [{ "name": "Chicken Biryani", "price": 250, "unit": "plate",
--               "available": true }]. Prices in rupees. `unit` and
-- `available` are optional; an unavailable item is still listed so Nikki
-- can say "not today" instead of "never heard of it".
alter table public.voice_profiles
  add column if not exists order_taking boolean not null default false,
  add column if not exists catalogue    jsonb   not null default '[]'::jsonb;

-- ── orders ───────────────────────────────────────────────────
create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  voice_profile_id uuid references public.voice_profiles(id) on delete set null,
  call_id          uuid references public.calls(id) on delete set null,
  reference        text not null,                 -- "ORD-7K3Q", read out on the call
  customer_phone   text not null,
  customer_name    text,
  -- [{ "name": "Chicken Biryani", "qty": 2, "unit_price": 250, "notes": "less spicy" }]
  items            jsonb not null default '[]'::jsonb,
  total            numeric(12,2),                 -- null when a price was unknown
  currency         text not null default 'INR',
  fulfilment       text not null default 'unknown'
                   check (fulfilment in ('pickup','delivery','dine_in','unknown')),
  address          text,
  requested_time   text,                          -- as said: "7 PM", "ఇప్పుడే"
  notes            text,
  status           text not null default 'new'
                   check (status in ('new','confirmed','preparing','ready','delivered','cancelled')),
  source           text not null default 'phone_call',
  wa_confirmed     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists orders_reference_idx on public.orders(tenant_id, reference);
create index if not exists orders_tenant_created_idx on public.orders(tenant_id, created_at desc);
create index if not exists orders_status_idx on public.orders(tenant_id, status)
  where status not in ('delivered','cancelled');

alter table public.orders enable row level security;

drop policy if exists "orders_select" on public.orders;
drop policy if exists "orders_insert" on public.orders;
drop policy if exists "orders_update" on public.orders;

create policy "orders_select" on public.orders for select
  using (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "orders_insert" on public.orders for insert
  with check (tenant_id = get_my_tenant_id() or is_super_admin());
create policy "orders_update" on public.orders for update
  using (tenant_id = get_my_tenant_id() or is_super_admin());

-- updated_at, kept by the database so the dashboard's status buttons and
-- the API's filters agree on when something last changed.
create or replace function public.orders_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function public.orders_touch_updated_at();

-- The dashboard's orders page listens for new rows the way calls does.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
exception when others then
  raise notice 'realtime publication not updated: %', sqlerrm;
end $$;
