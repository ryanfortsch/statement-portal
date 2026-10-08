-- Draft only. Apply after review to an isolated database with the existing
-- automation schema. No production application is authorized by this file.
begin;
alter table public.automation_sends drop constraint if exists automation_sends_status_check;
alter table public.automation_sends add constraint automation_sends_status_check check (status in
 ('scheduled','held','sending','awaiting_approval','sent','skipped_no_contact','skipped_channel',
  'skipped_cancelled','skipped_dates_moved','configured_in_ota','failed','cancelled'));

create table if not exists public.automation_hold_events (
 id bigint generated always as identity primary key,
 send_id uuid not null references public.automation_sends(id),
 action text not null check (action in ('hold','release')),
 actor text not null,
 happened_at timestamptz not null default clock_timestamp()
);
alter table public.automation_hold_events enable row level security;
revoke all on public.automation_hold_events from public, anon, authenticated, service_role;
grant select on public.automation_hold_events to service_role;

-- Authenticated server caller supplies the actor, never a client-provided name.
-- This function returns false on a lost compare-and-swap; callers must refresh.
create or replace function public.automation_set_hold(
 p_send_id uuid, p_property_id text, p_actor text, p_hold boolean,
 p_expected_updated_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
 row_send public.automation_sends%rowtype;
 row_booking public.bookings%rowtype;
 booking_uuid uuid;
 stamp timestamptz;
begin
 if p_hold is null or p_expected_updated_at is null or nullif(btrim(p_actor),'') is null then
   raise exception 'Missing hold operation context';
 end if;
 select booking_id into booking_uuid from public.automation_sends
 where id=p_send_id and property_id=p_property_id;
 if not found then return false; end if;
 -- Booking first matches reservation writers that subsequently touch sends.
 select * into row_booking from public.bookings where id=booking_uuid for update;
 if not found then return false; end if;
 select * into row_send from public.automation_sends
 where id=p_send_id and property_id=p_property_id for update;
 if not found or row_send.booking_id <> booking_uuid
   or row_send.updated_at <> p_expected_updated_at then return false; end if;
 stamp := clock_timestamp();
 if p_hold then
   -- In-flight or parked-for-other-reasons messages cannot become a hold.
   if row_send.status <> 'scheduled' then return false; end if;
   update public.automation_sends set status='held', updated_at=stamp where id=p_send_id;
 else
   if row_send.status <> 'held' then return false; end if;
   if row_booking.status <> 'confirmed' or row_booking.duplicate_of is not null
      or row_booking.property_id <> p_property_id
      or row_booking.check_in is distinct from row_send.planned_check_in
      or row_booking.check_out is distinct from row_send.planned_check_out then
     return false;
   end if;
   -- Preserve fire_at: never advance a future message. An overdue release is
   -- explicitly requested here, but dispatch still rechecks the stay and rules.
   update public.automation_sends set status='scheduled', updated_at=stamp where id=p_send_id;
 end if;
 insert into public.automation_hold_events(send_id,action,actor)
 values(p_send_id,case when p_hold then 'hold' else 'release' end,p_actor);
 return true;
end;
$$;
revoke all on function public.automation_set_hold(uuid,text,text,boolean,timestamptz) from public, anon, authenticated;
grant execute on function public.automation_set_hold(uuid,text,text,boolean,timestamptz) to service_role;
commit;
