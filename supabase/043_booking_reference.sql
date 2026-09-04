-- Booking numbers a receptionist would actually use.
--
-- An appointment was identified by a uuid, which nobody at a clinic front
-- desk reads out. The businesses asked for an OP number / booking number:
-- short, sequential, in their own format ("OP-001", "BC1042"), set by them.
--
-- The tenant owns the prefix and the counter. A trigger stamps the next
-- number on an appointment the moment it becomes CONFIRMED — not when the
-- row is opened, because the phone path opens a pending row as soon as
-- booking intent appears and most of those never get a slot; numbering
-- them would leave the diary full of gaps. Doing it in the database means
-- every writer (the voice pipeline, the dashboard, the public API) gets a
-- number without knowing the rule, and two calls confirming at the same
-- second cannot collide: the counter row is locked by the UPDATE.
alter table public.tenants
  add column if not exists booking_ref_prefix text    not null default '',
  add column if not exists booking_ref_next   integer not null default 1
    check (booking_ref_next >= 1);

alter table public.appointments
  add column if not exists booking_ref text;

create unique index if not exists idx_appointments_booking_ref
  on public.appointments (tenant_id, booking_ref) where booking_ref is not null;

create or replace function public.assign_booking_ref()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
  v_n      integer;
begin
  if new.booking_ref is not null or new.status <> 'confirmed' or new.tenant_id is null then
    return new;
  end if;
  update public.tenants
     set booking_ref_next = booking_ref_next + 1
   where id = new.tenant_id
   returning booking_ref_prefix, booking_ref_next - 1 into v_prefix, v_n;
  if v_n is null then
    return new;
  end if;
  -- Three digits minimum so the list sorts the way it reads: 001 … 999, 1000.
  new.booking_ref := coalesce(v_prefix, '') || lpad(v_n::text, 3, '0');
  return new;
end;
$$;

drop trigger if exists trg_assign_booking_ref on public.appointments;
create trigger trg_assign_booking_ref
  before insert or update of status on public.appointments
  for each row execute function public.assign_booking_ref();
