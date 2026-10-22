-- Incremental compatibility for the ordinary Helm calendar in the isolated pilot.
-- OWNER ONLY. Verify dashboard project jgkblfozftcvymvwhhii before execution.
-- Not an application migration. Does not enable publishing, messages or channels.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Hold these checks stable until the transaction commits.
lock table public.properties, public.channel_listings, public.message_automations,
  public.helm_booking_inventory_consumers in share mode;
do $$ begin
  if to_regclass('helm_pilot_installation.manifest') is null then
    raise exception 'Reviewed isolated installation required'; end if;
  if not exists(select 1 from helm_pilot_installation.manifest
    where project_ref='jgkblfozftcvymvwhhii'
      and bundle_digest='79762c13691b7285d76bcac51f4c45e30a41f29f6fd90e1bc02812fb324fa441') then
    raise exception 'Reviewed isolated installation required'; end if;
  if not exists(select 1 from public.properties where id='HELMTEST-calderwood' and calendar_authority='helm')
    or exists(select 1 from public.properties where id<>'HELMTEST-calderwood' or automations_enabled)
    or exists(select 1 from public.channel_listings)
    or exists(select 1 from public.message_automations where enabled)
    or exists(select 1 from public.helm_booking_inventory_consumers
      where property_id<>'HELMTEST-calderwood' or configuration->>'publishEnabled' is distinct from 'false') then
    raise exception 'Paused fictional-only calendar required'; end if;
end $$;
-- Same names/types as 20260503_properties_operational, 20260714_property_kind_hq,
-- 20260824d_cleaner_checkout_schedule and 20260926_property_policy_columns.
-- Do not replay those migrations: they include unrelated objects/customer seeds.
alter table public.properties
  add column if not exists kind text not null default 'managed',
  add column if not exists bedrooms integer,
  add column if not exists bathrooms numeric,
  add column if not exists default_checkin_time text,
  add column if not exists default_checkout_time text,
  add column if not exists quiet_hours text,
  add column if not exists max_occupancy integer,
  add column if not exists pet_policy text,
  add column if not exists smoking_policy text,
  add column if not exists cancellation_policy text,
  add column if not exists house_rules text,
  add column if not exists discount_stance text;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.properties'::regclass
    and conname='properties_kind_check') then
    alter table public.properties add constraint properties_kind_check
      check(kind in ('managed','prospect','hq'));
  end if;
end $$;
-- Local clusters do not inherit Supabase's default service grants. Explicitly
-- provide the same server reads and mirror writes; browser access stays closed.
grant select on public.properties, public.bookings, public.property_rental_periods to service_role;
grant select, insert, update, delete on public.property_calendar_days, public.property_calendar_blocks to service_role;
notify pgrst, 'reload schema';
commit;
