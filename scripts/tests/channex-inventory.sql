-- Synthetic-only helpers shared with the cross-language and concurrency checks.
create function public.channex_synthetic_inventory_setup() returns void language plpgsql as $$
declare stamp bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 today date:=(clock_timestamp() at time zone 'America/New_York')::date;
begin
 if current_database()<>'helm_synthetic_channex' then raise exception 'synthetic_only'; end if;
 update helm_airbnb_bookings.inventory_scope set enabled=true,coverage=(select jsonb_agg(jsonb_build_object(
  'source',source,'start',(today-30)::text,'end',(today+530)::text,'complete',true,'observedAt',stamp,'freshUntil',stamp+1800000))
  from unnest(array['canonical-calendar','channex-bookings']) source) where singleton;
end$$;
create function public.channex_synthetic_inventory_request() returns jsonb language plpgsql as $$
declare s jsonb:=public.helm_channex_inventory_read(); payload jsonb; dig text; ident text; stamp bigint;
begin
 select jsonb_agg(jsonb_build_object('date',((s->>'start')::date+n)::text,'available',0) order by n),
  encode(sha256(convert_to(string_agg(((s->>'start')::date+n)::text||E':0\n','' order by n),'UTF8')),'hex')
 into payload,dig from generate_series(0,499) n;
 ident:=encode(sha256(convert_to(concat_ws('|',s->>'propertyId',s->>'remotePropertyId',s->>'roomTypeId',s->>'ratePlanId',s->>'generation',
  s->>'captureVersion',s->>'configurationVersion',s->>'start',s->>'end',dig),'UTF8')),'hex');
 stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 return jsonb_build_object('expected',jsonb_build_object('captureVersion',s->'captureVersion','configurationVersion',s->'configurationVersion',
  'headVersion',s->'headVersion','inputToken',s->'inputToken'),'plan',jsonb_build_object('id',ident,'digest',dig,
  'start',s->'start','end',s->'end','freshUntil',stamp+10000,'days',payload));
end$$;
create function public.channex_synthetic_inventory_save(r jsonb) returns jsonb language sql as $$
 select public.helm_channex_inventory_plan_commit(r->'expected',r->'plan');
$$;
begin;
select pg_temp.assert_true(helm_channex_inventory_read()='{"status":"disabled"}'::jsonb,'dormant read excludes canonical data');
select pg_temp.assert_true((helm_channex_inventory_status()->>'plans')::int=0,'no seeded plans');
select pg_temp.assert_true(not has_table_privilege('service_role','helm_airbnb_bookings.inventory_plans','INSERT'),'no direct plan writes');
select pg_temp.assert_true(not has_function_privilege('authenticated','helm_channex_inventory_read()','EXECUTE'),'staff cannot read source snapshot');
select pg_temp.assert_true(not has_function_privilege('anon','helm_channex_inventory_plan_commit(jsonb,jsonb)','EXECUTE'),'anonymous cannot plan');
select channex_synthetic_inventory_setup();
select pg_temp.assert_true(helm_channex_inventory_read()->'inputs'->'plan'->>'checkin_time'='16:00','database time normalized');
select pg_temp.assert_true(not ((helm_channex_inventory_read()->'inputs')::text ~ 'guest_name|notes|nightly_cents|min_nights|PRIVATE_SENTINEL'),'private/pricing fields excluded');
create temporary table inventory_request as select channex_synthetic_inventory_request() r;
grant select on inventory_request to service_role;
set role service_role;
select channex_synthetic_inventory_save(r) from inventory_request;
reset role;
select pg_temp.assert_true((select count(*) from helm_airbnb_bookings.inventory_plans)=1,'first plan durably stored');
select pg_temp.assert_true((select channex_synthetic_inventory_save(r)->>'status' from inventory_request)='unchanged','identical lost-response retry is idempotent');
select pg_temp.assert_true((select count(*) from helm_airbnb_bookings.inventory_plans)=1,'retry cannot duplicate');
-- Full shape and digest validation, no rate/minimum-stay payload or missing dates.
do $$declare r jsonb:=(select inventory_request.r from inventory_request); candidate jsonb;begin
 for candidate in select x from unnest(array[
  jsonb_set(r,'{plan,days,0}',(r->'plan'->'days'->0)||'{"price":100}'::jsonb),
  jsonb_set(r,'{plan,days}',(r->'plan'->'days')-499),
  jsonb_set(r,'{plan,digest}',to_jsonb(repeat('b',64))),
  jsonb_set(r,'{plan,days,0,available}','2'::jsonb),
  jsonb_set(r,'{plan,days,0,date}','"2026-02-30"'::jsonb)
 ]) x loop
  begin perform channex_synthetic_inventory_save(candidate);raise exception 'expected_invalid_payload';
  exception when others then if sqlerrm='expected_invalid_payload' then raise;end if;end;
 end loop;
 perform pg_temp.assert_true((select count(*) from helm_airbnb_bookings.inventory_plans)=1,'invalid plan mutations rolled back');
end$$;
-- Live booking writes advance the capture version; old computations lose the CAS.
select helm_create_booking('65_calderwood','direct','manual','block','2028-04-01','2028-04-03','{"hold_kind":"owner"}');
select pg_temp.assert_true((select channex_synthetic_inventory_save(r)->>'status' from inventory_request)='superseded','booking change fences previous plan');
update inventory_request set r=channex_synthetic_inventory_request();
select pg_temp.assert_true((select channex_synthetic_inventory_save(r)->>'status' from inventory_request)='stored','recomputed plan advances once');
-- Note/price changes do not alter availability tokens or checkpoints.
update bookings set notes='PRIVATE_SENTINEL' where property_id='65_calderwood';
update property_rate_plans set base_nightly_cents=999999,min_nights_default=7 where property_id='65_calderwood';
select pg_temp.assert_true((select channex_synthetic_inventory_save(r)->>'status' from inventory_request)='unchanged','notes and prices have no availability effect');
-- Independent input token also catches a missed capture, without accepting a stale plan.
alter table property_rate_days disable trigger helm_capture_availability_input_change;
update property_rate_days set closed=not closed where property_id='65_calderwood';
select pg_temp.assert_true((select channex_synthetic_inventory_save(r)->>'status' from inventory_request)='superseded','raw source comparison catches missed invalidation');
alter table property_rate_days enable trigger helm_capture_availability_input_change;
-- Completeness and source freshness are rechecked at commit even for a trusted caller.
update helm_airbnb_bookings.inventory_scope set coverage='[]';
update inventory_request set r=channex_synthetic_inventory_request();
select pg_temp.assert_true((select channex_synthetic_inventory_save(r)->>'status' from inventory_request)='superseded','empty coverage blocks plan');
select channex_synthetic_inventory_setup();
update helm_airbnb_bookings.inventory_scope set coverage=jsonb_set(coverage,'{1,complete}','false');
update inventory_request set r=channex_synthetic_inventory_request();
select pg_temp.assert_true((select channex_synthetic_inventory_save(r)->>'status' from inventory_request)='superseded','partial coverage blocks plan');
select channex_synthetic_inventory_setup();
update helm_airbnb_bookings.inventory_scope set coverage=jsonb_set(coverage,'{0,start}',to_jsonb((clock_timestamp() at time zone 'America/New_York')::date::text));
update inventory_request set r=channex_synthetic_inventory_request();
select pg_temp.assert_true((select channex_synthetic_inventory_save(r)->>'status' from inventory_request)='superseded','missing buffer-neighbour coverage blocks plan');
select channex_synthetic_inventory_setup();
update inventory_request set r=channex_synthetic_inventory_request();
update helm_airbnb_bookings.inventory_scope set enabled=false;
select pg_temp.assert_true((select channex_synthetic_inventory_save(r)->>'status' from inventory_request)='superseded','disable fences previously prepared plan');
rollback;
select channex_synthetic_inventory_setup();
select 'PASS: durable inventory plans, idempotency, version fences, coverage, data boundaries and service permissions' as result;
