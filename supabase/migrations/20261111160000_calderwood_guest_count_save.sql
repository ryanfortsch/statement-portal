-- Install a dormant, service-only save primitive. This migration changes no
-- booking, message, recipient, schedule, or channel-authority row.
begin;
set local lock_timeout = '5s';
create or replace function public.helm_save_calderwood_guest_counts(
  p_rows jsonb, p_checked_at timestamptz, p_actor text
) returns integer language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $$
declare
  item jsonb; r record; b public.bookings; m public.guesty_reservations;
  n integer; saved integer := 0; today date := (clock_timestamp() at time zone 'America/New_York')::date;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) not between 1 and 12
    or p_actor is null or length(btrim(p_actor)) not between 3 and 320
    or p_checked_at is null or p_checked_at < clock_timestamp() - interval '60 seconds'
    or p_checked_at > clock_timestamp() + interval '5 seconds'
  then raise exception 'cleaner_count_save_invalid'; end if;
  if (select count(distinct value->>'booking_id') from jsonb_array_elements(p_rows)) <> jsonb_array_length(p_rows)
    or (select count(distinct value->>'guesty_reservation_id') from jsonb_array_elements(p_rows)) <> jsonb_array_length(p_rows)
  then raise exception 'cleaner_count_save_invalid'; end if;

  -- Same property lock as canonical stay writers. Row locks also serialize
  -- concurrent feed/count edits, and keep the authority/mirror stable at commit.
  perform pg_advisory_xact_lock(hashtext('helm_bookings:65_calderwood'));
  perform 1 from public.properties where id = '65_calderwood' and calendar_authority = 'guesty' for share;
  if not found then raise exception 'cleaner_count_source_changed'; end if;

  for item in select value from jsonb_array_elements(p_rows) order by value->>'booking_id' loop
    if jsonb_typeof(item) <> 'object' or (select count(*) from jsonb_object_keys(item)) <> 9
      or not item ?& array['booking_id','guesty_reservation_id','confirmation_code','check_in','check_out','source','status','last_seen_at','num_guests']
      or jsonb_typeof(item->'num_guests') <> 'number' or (item->>'num_guests') !~ '^[0-9]+$'
      or exists(select 1 from unnest(array['booking_id','guesty_reservation_id','confirmation_code','check_in','check_out','source','status']) k
        where jsonb_typeof(item->k) <> 'string')
      or jsonb_typeof(item->'last_seen_at') not in ('string','null')
    then raise exception 'cleaner_count_save_invalid'; end if;
    select * into r from jsonb_to_record(item) as x(
      booking_id uuid, guesty_reservation_id text, confirmation_code text,
      check_in date, check_out date, source text, status text, last_seen_at timestamptz, num_guests integer);
    if r.num_guests not between 1 and 100 or r.check_in >= r.check_out
      or r.check_out < today or r.check_in > today + 365
      or r.source not in ('ical_import','guesty_legacy') or r.status not in ('confirmed','completed')
      or r.guesty_reservation_id !~ '^[a-f0-9]{24}$'
      or r.confirmation_code !~ '^[A-Za-z0-9_-]{1,160}$'
    then raise exception 'cleaner_count_save_invalid'; end if;

    select * into b from public.bookings where id = r.booking_id for update;
    if not found or b.property_id is distinct from '65_calderwood' or b.duplicate_of is not null
      or b.num_guests is not null or b.status::text is distinct from r.status or b.source::text is distinct from r.source
      or b.check_in is distinct from r.check_in or b.check_out is distinct from r.check_out
      or b.last_seen_at is distinct from r.last_seen_at
      or b.external_confirmation_code is distinct from r.confirmation_code
    then raise exception 'cleaner_count_booking_changed'; end if;
    select count(*) into n from public.bookings where property_id = '65_calderwood'
      and duplicate_of is null and status in ('confirmed','completed')
      and (upper(btrim(external_confirmation_code)) = upper(r.confirmation_code) or check_in = r.check_in);
    if n <> 1 then raise exception 'cleaner_count_identity_ambiguous'; end if;

    select * into m from public.guesty_reservations where guesty_reservation_id = r.guesty_reservation_id for share;
    if not found or m.property_id is distinct from '65_calderwood' or m.listing_id is distinct from '66797ba7f51d72001388bc29'
      or m.status is distinct from 'confirmed' or m.confirmation_code is distinct from r.confirmation_code
      or m.check_in is distinct from r.check_in or m.check_out is distinct from r.check_out
    then raise exception 'cleaner_count_source_changed'; end if;
    select count(*) into n from public.guesty_reservations where property_id = '65_calderwood'
      and upper(btrim(confirmation_code)) = upper(r.confirmation_code);
    if n <> 1 then raise exception 'cleaner_count_identity_ambiguous'; end if;

    if p_checked_at < clock_timestamp() - interval '60 seconds' then raise exception 'cleaner_count_save_expired'; end if;
    update public.bookings set num_guests = r.num_guests where id = r.booking_id;
    insert into public.booking_events(booking_id, kind, actor, before, after, note)
    values(r.booking_id, 'guest_changed', btrim(p_actor), jsonb_build_object('num_guests', null),
      jsonb_build_object('num_guests', r.num_guests), 'Missing guest count verified against Guesty twice at ' || p_checked_at::text);
    saved := saved + 1;
  end loop;
  return saved;
end $$;
revoke all on function public.helm_save_calderwood_guest_counts(jsonb,timestamptz,text) from public, anon, authenticated;
grant execute on function public.helm_save_calderwood_guest_counts(jsonb,timestamptz,text) to service_role;
comment on function public.helm_save_calderwood_guest_counts(jsonb,timestamptz,text) is
  'Owner action only: save freshly verified missing Calderwood counts and audit atomically. Existing counts are never overwritten. No scheduler or messaging.';
commit;
