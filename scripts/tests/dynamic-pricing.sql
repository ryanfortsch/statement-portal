\set ON_ERROR_STOP on
do $$begin
  if current_database() <> 'helm_synthetic_pricing' then raise exception 'Synthetic database required'; end if;
end$$;
do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end$$;
create table public.properties(id text primary key,calendar_authority text,is_active boolean,timezone text);
create table public.property_rate_plans(property_id text primary key,currency text,base_nightly_cents integer);
create table public.property_rate_days(property_id text,date date,nightly_cents integer,min_nights smallint,
  cta boolean default false,ctd boolean default false,closed boolean default false,source text default 'operator',note text,updated_by text,updated_at timestamptz default now(),primary key(property_id,date));
create table public.property_rental_periods(id uuid,property_id text,start_month integer,start_day integer,end_month integer,end_day integer);
create table public.bookings(id uuid,property_id text,status text,check_in date,check_out date,duplicate_of uuid,hold_kind text,source text,channel text,booked_at timestamptz);
create table public.property_calendar_days(property_id text,date date,status text,price numeric,currency text,min_nights integer,synced_at timestamptz);
grant all on all tables in schema public to service_role;
\ir ../../supabase/migrations/20261108110000_helm_dynamic_pricing.sql
\ir ../../supabase/migrations/20261110123000_helm_pricing_observations.sql
insert into properties values('pilot','helm',true,'America/New_York'),('guesty','guesty',true,'America/New_York');
insert into property_rate_plans values('pilot','USD',30000);
create function public.test_assert(ok boolean, message text) returns void language plpgsql as $$begin if ok is not true then raise exception '%',message; end if; end$$;
do $$declare
  profile public.property_pricing_profiles;
  run uuid; other uuid; start date := (now() at time zone 'America/New_York')::date+1;
  policy jsonb := '{"currency":"USD","baseCents":30000,"floorCents":20000,"ceilingCents":60000}';
  old_context jsonb;
begin
  perform test_assert(not has_function_privilege('anon','helm_apply_pricing_run(uuid,text)','execute'),'anon must not publish');
  perform test_assert(not has_function_privilege('authenticated','helm_pricing_context(text,date,date)','execute'),'staff must not read pricing context');
  perform test_assert(not has_table_privilege('authenticated','property_pricing_profiles','select'),'profiles must not be public');
  select * into profile from helm_save_pricing_profile('pilot',policy,'helm_direct',0,'owner@test.invalid');
  perform test_assert(profile.version=1,'create version');
  begin perform helm_save_pricing_profile('pilot',policy,'shadow',0,'owner@test.invalid');raise exception 'Expected version rejection';
  exception when others then if sqlerrm <> 'Settings changed; reload' then raise; end if; end;
  begin perform helm_save_pricing_profile('guesty',policy,'helm_direct',0,'owner@test.invalid');raise exception 'Expected authority rejection';
  exception when others then if sqlerrm <> 'Guesty homes support comparison only' then raise; end if; end;
  insert into property_rate_days(property_id,date,nightly_cents,min_nights,cta,ctd,source,note)
    values('pilot',start,30000,2,true,true,'seed','Original note');
  old_context:=helm_pricing_context('pilot',start,start+179);
  insert into property_pricing_runs(property_id,profile_version,model_version,start_date,end_date,context,recommendations,created_by)
    values('pilot',1,'helm-1',start,start+179,old_context,jsonb_build_array(
      jsonb_build_object('date',start,'state','open','eligible',true,'recommendedCents',32000,'minNights',3),
      jsonb_build_object('date',start+1,'state','open','eligible',true,'recommendedCents',33000,'minNights',2)), 'owner@test.invalid') returning id into run;
  perform test_assert(helm_apply_pricing_run(run,'owner@test.invalid')=2,'publishes two nights');
  perform test_assert(helm_apply_pricing_run(run,'owner@test.invalid')=2,'retry must be idempotent');
  perform test_assert((select cta and ctd and not closed and nightly_cents=32000 from property_rate_days where property_id='pilot' and date=start),'preserve arrival/departure controls');
  perform test_assert(helm_revert_pricing_run(run,'owner@test.invalid')=2,'undo count');
  perform test_assert((select nightly_cents=30000 and note='Original note' and source='seed' and cta and ctd from property_rate_days where property_id='pilot' and date=start),'restore preimage');
  perform test_assert(not exists(select 1 from property_rate_days where property_id='pilot' and date=start+1),'undo removes only newly inserted days');
  perform test_assert(helm_revert_pricing_run(run,'owner@test.invalid')=2,'undo idempotent');

  insert into property_pricing_runs(property_id,profile_version,model_version,start_date,end_date,context,recommendations,created_by)
    select property_id,profile_version,model_version,start_date,end_date,helm_pricing_context('pilot',start,start+179),recommendations,created_by from property_pricing_runs where id=run returning id into other;
  update property_rate_days set nightly_cents=31000 where property_id='pilot' and date=start;
  begin perform helm_apply_pricing_run(other,'owner@test.invalid');raise exception 'Expected stale rejection';
  exception when others then if sqlerrm <> 'Calendar changed; refresh the review' then raise; end if; end;
  update property_pricing_runs set context=helm_pricing_context('pilot',start,start+179) where id=other;
  perform helm_apply_pricing_run(other,'owner@test.invalid');
  -- Even an independent writer that fails to stamp updated_at must be detected.
  update property_rate_days set cta=true where property_id='pilot' and date=start+1;
  begin perform helm_revert_pricing_run(other,'owner@test.invalid');raise exception 'Expected undo conflict';
  exception when others then if sqlerrm <> 'A published night changed; automatic undo would overwrite newer work' then raise; end if; end;
  perform test_assert((select nightly_cents=32000 from property_rate_days where property_id='pilot' and date=start),'undo conflict is all-or-nothing');
  perform test_assert((select cta from property_rate_days where property_id='pilot' and date=start+1),'human edit preserved');
  update property_rate_days set source='operator',note='Human edit',updated_at=clock_timestamp() where property_id='pilot' and date=start+1;

  insert into property_pricing_runs(property_id,profile_version,model_version,start_date,end_date,context,recommendations,created_by,created_at)
    select property_id,profile_version,model_version,start_date,end_date,helm_pricing_context('pilot',start,start+179),recommendations,created_by,now()-interval '6 minutes' from property_pricing_runs where id=run returning id into other;
  begin perform helm_apply_pricing_run(other,'owner@test.invalid');raise exception 'Expected expired rejection';
  exception when others then if sqlerrm <> 'Review expired; refresh' then raise; end if; end;
  update property_pricing_runs set created_at=now() where id=other;
  begin perform helm_apply_pricing_run(other,'owner@test.invalid');raise exception 'Expected protected rejection';
  exception when others then if sqlerrm <> 'Protected night changed' then raise; end if; end;
  perform test_assert((select status='preview' from property_pricing_runs where id=other),'failed apply does not mark success');
end $$;
-- Comparison capture is append-only and cannot modify prices or publish runs.
create function public.test_capture_rejected(data jsonb,context jsonb,message text,key text default null,tracking integer default null)
returns void language plpgsql as $$begin
  begin
    perform helm_record_pricing_observation('pilot',coalesce(key,'manual:'||gen_random_uuid()::text),data,context,tracking,'owner@test.invalid');
    raise exception 'Expected capture rejection: %',message;
  exception when others then if sqlerrm <> message then raise;end if;end;
end $$;
do $$declare
  start date := (clock_timestamp() at time zone 'America/New_York')::date;
  data jsonb; context jsonb; rate_before jsonb; runs_before bigint; id uuid; same uuid;
  key text := 'manual:'||gen_random_uuid()::text; tracking property_pricing_tracking;
begin
  perform test_assert(not exists(select 1 from property_pricing_tracking),'migration does not opt in homes');
  perform test_assert(not has_function_privilege('authenticated','helm_record_pricing_observation(text,text,jsonb,jsonb,integer,text)','execute'),'staff cannot capture');
  perform test_assert(not has_function_privilege('anon','helm_set_pricing_tracking(text,boolean,integer,text)','execute'),'anon cannot enable tracking');
  perform test_assert(not has_table_privilege('authenticated','property_pricing_observations','select'),'history stays private');
  perform test_assert(has_table_privilege('service_role','property_pricing_observations','insert'),'app can append observations');
  perform test_assert(not has_table_privilege('service_role','property_pricing_observations','update'),'app cannot rewrite history');
  perform test_assert(not has_table_privilege('service_role','property_pricing_observations','delete'),'app cannot remove history');
  begin perform helm_set_pricing_tracking('guesty',true,0,'owner@test.invalid');raise exception 'Expected saved-policy rejection';
  exception when others then if sqlerrm <> 'Save a policy for an active property first' then raise;end if;end;
  context:=helm_pricing_context('pilot',start,start+179);
  data:=jsonb_build_object('version',1,'propertyId','pilot','authority','helm','capturedAt',clock_timestamp(),
    'asOf',start,'modelVersion','helm-3','policyVersion',1,'evidenceVersion',coalesce((context->'evidence'->>'version')::integer,0),
    'days',(select jsonb_agg(jsonb_build_object('date',start+i,'state','open','currentCents',30000,'recommendedCents',31000,
      'minNights',2,'eligible',true,'saleProbability',0.5,'forecastBasis','Synthetic','sourceObservedAt',clock_timestamp()) order by i) from generate_series(0,179) i));
  select jsonb_agg(to_jsonb(d) order by property_id,date) into rate_before from property_rate_days d;
  select count(*) into runs_before from property_pricing_runs;
  id:=helm_record_pricing_observation('pilot',key,data,context,null,'owner@test.invalid');
  same:=helm_record_pricing_observation('pilot',key,data,context,null,'owner@test.invalid');
  perform test_assert(id=same and (select count(*)=1 from property_pricing_observations),'capture retry is idempotent');
  perform test_assert((select o.data from property_pricing_observations o where o.capture_key=key)=data,'original forecast preserved');
  perform test_capture_rejected(data||'{"policyVersion":2}',context,'Policy changed; capture again');
  perform test_capture_rejected(data||'{"evidenceVersion":999}',context,'Evidence version mismatch');
  perform test_capture_rejected(data||'{"authority":"guesty"}',context,'Observation authority or date changed');
  perform test_capture_rejected(data||jsonb_build_object('capturedAt',clock_timestamp()-interval '3 minutes'),context,'Observation expired; capture again');
  perform test_capture_rejected(data||jsonb_build_object('capturedAt',clock_timestamp()+interval '2 minutes'),context,'Observation expired; capture again');
  perform test_capture_rejected(data||jsonb_build_object('asOf',start-1),context,'Observation authority or date changed');
  perform test_capture_rejected(data||jsonb_build_object('days',(data->'days')-0),context,'Complete 180-night observation required');
  perform test_capture_rejected(jsonb_set(data,'{days,1,date}',to_jsonb(start)),context,'Complete 180-night observation required');
  perform test_capture_rejected(jsonb_set(data,'{days,1,date}',to_jsonb(start+180)),context,'Complete 180-night observation required');
  update property_rate_days set nightly_cents=nightly_cents+100 where property_id='pilot';
  perform test_capture_rejected(data,context,'Calendar changed; capture again');
  update property_rate_days set nightly_cents=nightly_cents-100 where property_id='pilot';
  update properties set is_active=false where properties.id='pilot';
  perform test_capture_rejected(data,context,'Observation authority or date changed');
  update properties set is_active=true where properties.id='pilot';
  perform test_capture_rejected(data,context,'Daily tracking version required','daily:'||start::text);
  perform test_capture_rejected(data,context,'Daily tracking changed','daily:'||start::text,1);
  select * into tracking from helm_set_pricing_tracking('pilot',true,0,'owner@test.invalid');
  perform test_assert(tracking.enabled and tracking.version=1,'explicit opt in records a version');
  begin perform helm_set_pricing_tracking('pilot',false,0,'owner@test.invalid');raise exception 'Expected tracking conflict';
  exception when others then if sqlerrm <> 'Tracking changed; reload' then raise;end if;end;
  select * into tracking from helm_set_pricing_tracking('pilot',false,1,'owner@test.invalid');
  perform test_capture_rejected(data,context,'Daily tracking changed','daily:'||start::text,1);
  perform test_capture_rejected(data,context,'Daily tracking changed','daily:'||start::text,2);
  select * into tracking from helm_set_pricing_tracking('pilot',true,2,'owner@test.invalid');
  id:=helm_record_pricing_observation('pilot','daily:'||start::text,data,context,3,'scheduled-pricing-comparison');
  same:=helm_record_pricing_observation('pilot','daily:'||start::text,data,context,3,'scheduled-pricing-comparison');
  perform test_assert(id=same and (select count(*)=2 from property_pricing_observations),'daily capture is once per property date');
  perform test_assert((select jsonb_agg(to_jsonb(d) order by property_id,date) from property_rate_days d)=rate_before,'capture never changes rates');
  perform test_assert((select count(*) from property_pricing_runs)=runs_before,'capture never creates a publishing review');
end $$;
select 'pricing observation SQL checks passed' as result;
select 'dynamic pricing SQL checks passed' as result;

-- Evidence is part of the atomic context, so a newer import invalidates review.
do $$declare
  data jsonb := '{"version":1,"propertyId":"pilot","currency":"USD","history":[],"market":[]}';
  review uuid; begin_date date := (now() at time zone 'America/New_York')::date+4;
begin
  perform test_assert(not has_function_privilege('authenticated','helm_save_pricing_evidence(text,jsonb,integer,text)','execute'),'staff cannot import evidence');
  perform test_assert(not has_table_privilege('anon','property_pricing_evidence','select'),'evidence must remain private');
  perform test_assert(helm_save_pricing_evidence('pilot',data,0,'owner@test.invalid')=1,'initial evidence version');
  begin perform helm_save_pricing_evidence('pilot',data,0,'owner@test.invalid');raise exception 'Expected evidence version rejection';
  exception when others then if sqlerrm <> 'Evidence changed; reload' then raise;end if;end;
  begin perform helm_save_pricing_evidence('guesty',data,0,'owner@test.invalid');raise exception 'Expected identity rejection';
  exception when others then if sqlerrm <> 'Evidence identity mismatch' then raise;end if;end;
  insert into property_pricing_runs(property_id,profile_version,model_version,start_date,end_date,context,recommendations,created_by)
    select 'pilot',version,'helm-2',begin_date,begin_date+179,helm_pricing_context('pilot',begin_date,begin_date+179),'[]','owner@test.invalid'
    from property_pricing_profiles where property_id='pilot' returning id into review;
  perform helm_save_pricing_evidence('pilot',data,1,'owner@test.invalid');
  begin perform helm_apply_pricing_run(review,'owner@test.invalid');raise exception 'Expected changed evidence rejection';
  exception when others then if sqlerrm <> 'Calendar changed; refresh the review' then raise;end if;end;
end $$;
