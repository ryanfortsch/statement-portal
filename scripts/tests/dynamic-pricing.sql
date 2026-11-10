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
