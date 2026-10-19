-- Candidate canonical availability-input capture. NOT an automatic migration.
-- Requires canonical bookings, properties, rate plans/days and rental periods.
-- Empty/disabled scopes by default; shadow capture only, no provider transport.
-- Events invalidate a property's FULL mapped window, including turnover buffers.
-- They are not availability counts, delivery commands, or publishing authority.
begin;

create table if not exists public.helm_inventory_capture_scopes (
  property_id text primary key references public.properties(id),
  enabled boolean not null default false,
  version bigint not null default 0 check (version between 0 and 9007199254740991)
);
create table if not exists public.helm_booking_inventory_events (
  property_id text not null references public.helm_inventory_capture_scopes(property_id),
  version bigint not null check (version between 1 and 9007199254740991),
  -- No FK: a removed hold must remain represented in this durable journal.
  booking_id uuid,
  reason text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (property_id, version)
);
-- Replace the original candidate's named constraints too: CREATE IF NOT EXISTS
-- alone would leave an earlier installation unable to accept input events.
alter table public.helm_booking_inventory_events drop constraint if exists helm_booking_inventory_events_reason_check;
alter table public.helm_booking_inventory_events add constraint helm_booking_inventory_events_reason_check
  check (reason in ('booking_insert', 'booking_update', 'booking_delete', 'capture_enabled', 'capture_disabled',
    'authority_update', 'availability_rules_insert', 'availability_rules_update', 'availability_rules_delete',
    'closed_date_insert', 'closed_date_update', 'closed_date_delete',
    'rental_period_insert', 'rental_period_update', 'rental_period_delete'));
alter table public.helm_booking_inventory_events drop constraint if exists helm_booking_inventory_events_check;
alter table public.helm_booking_inventory_events add constraint helm_booking_inventory_events_check
  check ((booking_id is not null) = (reason in ('booking_insert', 'booking_update', 'booking_delete')));
comment on table public.helm_booking_inventory_events is
  'Shadow invalidations, not publishable inventory. Re-read current scope, authority, mapping and complete canonical inputs before planning. Full-window recomputation is required; PriceLabs rates and minimum stays are not stored here.';

alter table public.helm_inventory_capture_scopes enable row level security;
alter table public.helm_booking_inventory_events enable row level security;
revoke all on public.helm_inventory_capture_scopes, public.helm_booking_inventory_events
  from public, anon, authenticated, service_role;
grant select on public.helm_inventory_capture_scopes, public.helm_booking_inventory_events to service_role;
drop policy if exists service_read on public.helm_inventory_capture_scopes;
create policy service_read on public.helm_inventory_capture_scopes for select to service_role using (true);
drop policy if exists service_read on public.helm_booking_inventory_events;
create policy service_read on public.helm_booking_inventory_events for select to service_role using (true);

create or replace function public.helm_inventory_event_immutable()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'Inventory event history is append-only';
end $$;
drop trigger if exists helm_inventory_event_immutable on public.helm_booking_inventory_events;
create trigger helm_inventory_event_immutable before update or delete
  on public.helm_booking_inventory_events for each row execute function public.helm_inventory_event_immutable();
drop trigger if exists helm_inventory_event_no_truncate on public.helm_booking_inventory_events;
create trigger helm_inventory_event_no_truncate before truncate
  on public.helm_booking_inventory_events for each statement execute function public.helm_inventory_event_immutable();

create or replace function public.helm_inventory_scope_identity()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.property_id is distinct from old.property_id then
    raise exception 'Inventory capture scope identity is immutable';
  end if;
  return new;
end $$;
drop trigger if exists helm_inventory_scope_identity on public.helm_inventory_capture_scopes;
create trigger helm_inventory_scope_identity before update of property_id
  on public.helm_inventory_capture_scopes for each row execute function public.helm_inventory_scope_identity();

-- Configuration is rare and owner-only. Drain all captured source writes BEFORE
-- taking scope row locks; otherwise a disabled writer could commit after the
-- enable checkpoint without an event. Scope insertion needs the same barrier.
-- Keep configuration transactions short: SHARE permits reads but holds source
-- writes across all properties until configuration commits. Ordinary capture
-- updates only version and never takes this configuration lock.
create or replace function public.helm_inventory_scope_config_barrier()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  lock table public.bookings, public.properties, public.property_rate_plans,
    public.property_rate_days, public.property_rental_periods in share mode;
  return null;
end $$;
drop trigger if exists helm_inventory_scope_config_barrier on public.helm_inventory_capture_scopes;
create trigger helm_inventory_scope_config_barrier before insert or update of enabled or delete
  on public.helm_inventory_capture_scopes for each statement execute function public.helm_inventory_scope_config_barrier();

-- An enable/re-enable is a full-window checkpoint, so changes made while capture
-- was disabled are not silently skipped. Disabling also advances the version.
-- Only the database owner can configure scopes; no app activation RPC is exposed.
create or replace function public.helm_inventory_scope_checkpoint()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_version bigint;
begin
  if tg_op = 'INSERT' then
    if not new.enabled then return new; end if;
  elsif new.enabled is not distinct from old.enabled then
    return new;
  end if;
  update public.helm_inventory_capture_scopes set version = version + 1
    where property_id = new.property_id returning version into v_version;
  insert into public.helm_booking_inventory_events (property_id, version, reason)
    values (new.property_id, v_version, case when new.enabled then 'capture_enabled' else 'capture_disabled' end);
  return new;
end $$;
drop trigger if exists helm_inventory_scope_checkpoint on public.helm_inventory_capture_scopes;
create trigger helm_inventory_scope_checkpoint after insert or update of enabled
  on public.helm_inventory_capture_scopes for each row execute function public.helm_inventory_scope_checkpoint();

create or replace function public.helm_capture_booking_inventory_change()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_old_property text;
  v_new_property text;
  v_booking uuid;
  v_property text;
  v_version bigint;
begin
  if tg_op <> 'INSERT' then v_old_property := old.property_id; v_booking := old.id; end if;
  if tg_op <> 'DELETE' then v_new_property := new.property_id; v_booking := new.id; end if;
  if tg_op = 'UPDATE' then
    -- Availability inputs and imported closure/echo identity. No payload, guest,
    -- payment, notes or last-seen timestamps enter the persisted event.
    if row(new.property_id, new.check_in, new.check_out, new.status, new.duplicate_of,
        new.hold_kind, new.source, new.channel, new.channel_listing_id, new.ical_uid,
        new.live_since, new.held_ages, new.echo_confirmed, new.cancelled_at)
      is not distinct from
       row(old.property_id, old.check_in, old.check_out, old.status, old.duplicate_of,
        old.hold_kind, old.source, old.channel, old.channel_listing_id, old.ical_uid,
        old.live_since, old.held_ages, old.echo_confirmed, old.cancelled_at) then
      return new;
    end if;
  end if;
  -- A property transfer invalidates BOTH properties. Ordered row locks serialize
  -- each property's version; failure aborts the caller's booking transaction.
  for v_property in
    select property_id from public.helm_inventory_capture_scopes
      where enabled and property_id in (v_old_property, v_new_property)
      order by property_id for update
  loop
    update public.helm_inventory_capture_scopes set version = version + 1
      where property_id = v_property returning version into v_version;
    insert into public.helm_booking_inventory_events (property_id, version, booking_id, reason)
      values (v_property, v_version, v_booking, 'booking_' || lower(tg_op));
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
-- AFTER row changes, inside the same transaction as the canonical RPC and audit
-- event. Also covers iCal upserts/dedupe and permitted hard deletes of holds.
drop trigger if exists helm_capture_booking_inventory_change on public.bookings;
create trigger helm_capture_booking_inventory_change after insert or update or delete
  on public.bookings for each row execute function public.helm_capture_booking_inventory_change();

-- Match the non-booking fields read by helm_booking_inventory_inputs. Updates
-- to rates, minimum stays, notes and timestamps alone do not invalidate the
-- availability queue. Inserts/deletes invalidate even when defaults are open:
-- the canonical input set changed, so its previous snapshot is no longer current.
create or replace function public.helm_capture_availability_input_change()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_old_property text; v_new_property text; v_property text; v_version bigint; v_reason text;
begin
  if tg_table_name = 'properties' then
    if new.calendar_authority is not distinct from old.calendar_authority then return new; end if;
    v_old_property := old.id; v_new_property := new.id; v_reason := 'authority_update';
  else
    if tg_op <> 'INSERT' then v_old_property := old.property_id; end if;
    if tg_op <> 'DELETE' then v_new_property := new.property_id; end if;
    case tg_table_name
      when 'property_rate_plans' then
        v_reason := 'availability_rules_' || lower(tg_op);
        if tg_op = 'UPDATE' then
          if row(new.property_id,new.advance_notice_hours,new.booking_window_days,new.turnover_buffer_days,new.checkin_time)
            is not distinct from row(old.property_id,old.advance_notice_hours,old.booking_window_days,old.turnover_buffer_days,old.checkin_time)
          then return new; end if;
        end if;
      when 'property_rate_days' then
        v_reason := 'closed_date_' || lower(tg_op);
        if tg_op = 'UPDATE' then
          if row(new.property_id,new.date,new.closed) is not distinct from row(old.property_id,old.date,old.closed)
          then return new; end if;
        end if;
      when 'property_rental_periods' then
        v_reason := 'rental_period_' || lower(tg_op);
        if tg_op = 'UPDATE' then
          if row(new.property_id,new.start_month,new.start_day,new.end_month,new.end_day)
            is not distinct from row(old.property_id,old.start_month,old.start_day,old.end_month,old.end_day)
          then return new; end if;
        end if;
      else raise exception 'Unsupported inventory source';
    end case;
  end if;
  -- Identical lock order and version fence as booking capture. The AFTER trigger
  -- is part of the source transaction; a rejected event also rolls back its edit.
  -- A planner/dispatcher holding FOR SHARE either sees the committed new version
  -- or finishes its boundary before this source transaction can commit.
  for v_property in select property_id from public.helm_inventory_capture_scopes
    where enabled and property_id in (v_old_property,v_new_property) order by property_id for update
  loop
    update public.helm_inventory_capture_scopes set version=version+1
      where property_id=v_property returning version into v_version;
    insert into public.helm_booking_inventory_events(property_id,version,reason)
      values(v_property,v_version,v_reason);
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists helm_capture_availability_input_change on public.properties;
create trigger helm_capture_availability_input_change after update of calendar_authority on public.properties
  for each row execute function public.helm_capture_availability_input_change();
drop trigger if exists helm_capture_availability_input_change on public.property_rate_plans;
create trigger helm_capture_availability_input_change after insert or update or delete on public.property_rate_plans
  for each row execute function public.helm_capture_availability_input_change();
drop trigger if exists helm_capture_availability_input_change on public.property_rate_days;
create trigger helm_capture_availability_input_change after insert or update or delete on public.property_rate_days
  for each row execute function public.helm_capture_availability_input_change();
drop trigger if exists helm_capture_availability_input_change on public.property_rental_periods;
create trigger helm_capture_availability_input_change after insert or update or delete on public.property_rental_periods
  for each row execute function public.helm_capture_availability_input_change();

-- TRUNCATE bypasses row capture. Require a separately reviewed maintenance plan
-- with capture disabled; never silently erase source rows behind an enabled lane.
create or replace function public.helm_inventory_source_no_truncate()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if exists(select 1 from public.helm_inventory_capture_scopes where enabled) then
    raise exception 'Cannot truncate inventory sources while capture is enabled';
  end if;
  return null;
end $$;
drop trigger if exists helm_inventory_source_no_truncate on public.bookings;
create trigger helm_inventory_source_no_truncate before truncate on public.bookings
  for each statement execute function public.helm_inventory_source_no_truncate();
drop trigger if exists helm_inventory_source_no_truncate on public.properties;
create trigger helm_inventory_source_no_truncate before truncate on public.properties
  for each statement execute function public.helm_inventory_source_no_truncate();
drop trigger if exists helm_inventory_source_no_truncate on public.property_rate_plans;
create trigger helm_inventory_source_no_truncate before truncate on public.property_rate_plans
  for each statement execute function public.helm_inventory_source_no_truncate();
drop trigger if exists helm_inventory_source_no_truncate on public.property_rate_days;
create trigger helm_inventory_source_no_truncate before truncate on public.property_rate_days
  for each statement execute function public.helm_inventory_source_no_truncate();
drop trigger if exists helm_inventory_source_no_truncate on public.property_rental_periods;
create trigger helm_inventory_source_no_truncate before truncate on public.property_rental_periods
  for each statement execute function public.helm_inventory_source_no_truncate();

revoke all on function public.helm_inventory_event_immutable(),
  public.helm_inventory_scope_identity(), public.helm_inventory_scope_config_barrier(),
  public.helm_inventory_scope_checkpoint(),
  public.helm_capture_booking_inventory_change(), public.helm_capture_availability_input_change(),
  public.helm_inventory_source_no_truncate() from public, anon, authenticated, service_role;
commit;
