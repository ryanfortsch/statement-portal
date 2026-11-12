-- Independent pricing. Dormant until an owner explicitly connects a home.
-- No vendor calls, no migration of existing rates, no scheduled publishing.
create table public.property_pricing_profiles (
  property_id text primary key references public.properties(id),
  policy jsonb not null check (jsonb_typeof(policy) = 'object'),
  mode text not null default 'shadow' check (mode in ('shadow','helm_direct')),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(), updated_by text not null
);
create table public.property_pricing_runs (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id),
  profile_version integer not null, model_version text not null,
  start_date date not null, end_date date not null,
  context jsonb not null, recommendations jsonb not null,
  status text not null default 'preview' check (status in ('preview','applied','reverted')),
  before_days jsonb, after_days jsonb, applied_dates jsonb,
  created_at timestamptz not null default now(), created_by text not null,
  applied_at timestamptz, reverted_at timestamptz, reverted_by text,
  check (end_date >= start_date and end_date - start_date < 500)
);
create index on public.property_pricing_runs(property_id, created_at desc);
alter table public.property_pricing_profiles enable row level security;
alter table public.property_pricing_runs enable row level security;
revoke all on public.property_pricing_profiles, public.property_pricing_runs from anon, authenticated;
grant all on public.property_pricing_profiles, public.property_pricing_runs to service_role;

-- Imported evidence is versioned separately; it never changes live rates itself.
create table public.property_pricing_evidence (
  property_id text primary key references public.properties(id), data jsonb not null,
  version integer not null default 1, updated_at timestamptz not null default now(), updated_by text not null,
  check (data->>'propertyId'=property_id), check (data->>'currency'='USD'), check(version>0)
);
alter table public.property_pricing_evidence enable row level security;
revoke all on public.property_pricing_evidence from public, anon, authenticated;
grant all on public.property_pricing_evidence to service_role;
create function public.helm_save_pricing_evidence(p_property text,p_data jsonb,p_expected integer,p_actor text)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare v integer;
begin
  perform pg_advisory_xact_lock(hashtext('helm_pricing:'||p_property));
  if not exists(select 1 from properties where id=p_property and is_active) then raise exception 'Active property required'; end if;
  if p_data->>'propertyId' is distinct from p_property or p_data->>'currency' is distinct from 'USD' then raise exception 'Evidence identity mismatch';end if;
  select version into v from property_pricing_evidence where property_id=p_property for update;
  if coalesce(v,0)<>p_expected then raise exception 'Evidence changed; reload';end if;
  insert into property_pricing_evidence(property_id,data,version,updated_by) values(p_property,p_data,coalesce(v,0)+1,p_actor)
    on conflict(property_id) do update set data=excluded.data,version=excluded.version,updated_by=excluded.updated_by,updated_at=clock_timestamp();
  return coalesce(v,0)+1;
end $$;
revoke all on function public.helm_save_pricing_evidence(text,jsonb,integer,text) from public, anon, authenticated;
grant execute on function public.helm_save_pricing_evidence(text,jsonb,integer,text) to service_role;

-- A repeatable snapshot, also compared inside the apply transaction. No guest PII.
create function public.helm_pricing_context(p_property text, p_start date, p_end date)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if p_end < p_start or p_end - p_start > 499 then raise exception 'Invalid pricing window'; end if;
  select jsonb_build_object(
    'property', (select jsonb_build_object('id',id,'calendar_authority',calendar_authority,'is_active',is_active,'timezone',timezone)
      from properties where id=p_property),
    'evidence', (select jsonb_build_object('data',data,'version',version) from property_pricing_evidence where property_id=p_property),
    'plan', (select to_jsonb(p) from property_rate_plans p where property_id=p_property),
    'rateDays', coalesce((select jsonb_agg(to_jsonb(d) order by date) from property_rate_days d
      where property_id=p_property and date between p_start and p_end),'[]'::jsonb),
    'periods', coalesce((select jsonb_agg(jsonb_build_object('start_month',start_month,'start_day',start_day,
      'end_month',end_month,'end_day',end_day) order by id) from property_rental_periods where property_id=p_property),'[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(jsonb_build_object('status',status,'check_in',check_in,'check_out',check_out,
      'duplicate_of',duplicate_of,'hold_kind',hold_kind,'source',source,'channel',channel,'booked_at',booked_at) order by id)
      from bookings where property_id=p_property and check_in <= p_end+30 and check_out > p_start-30
      and status in ('confirmed','completed','block')),'[]'::jsonb),
    'mirror', coalesce((select jsonb_agg(jsonb_build_object('date',date,'status',status,'price',price,'currency',currency,
      'min_nights',min_nights,'synced_at',synced_at) order by date) from property_calendar_days
      where property_id=p_property and date between p_start and p_end
      and exists(select 1 from properties where id=p_property and calendar_authority='guesty')),'[]'::jsonb)
  ) into result;
  if result->'property' = 'null'::jsonb then raise exception 'Unknown property'; end if;
  return result;
end $$;

create function public.helm_save_pricing_profile(p_property text, p_policy jsonb, p_mode text, p_expected integer, p_actor text)
returns public.property_pricing_profiles language plpgsql security invoker set search_path = public, pg_temp as $$
declare result public.property_pricing_profiles;
begin
  perform pg_advisory_xact_lock(hashtext('helm_pricing:' || p_property));
  if not exists(select 1 from properties where id=p_property and is_active=true) then raise exception 'Active property required'; end if;
  if p_mode='helm_direct' and not exists(select 1 from properties where id=p_property and calendar_authority='helm') then
    raise exception 'Guesty homes support comparison only'; end if;
  if p_policy->>'currency' <> 'USD' or (p_policy->>'floorCents')::integer < 100
    or (p_policy->>'floorCents')::integer > (p_policy->>'baseCents')::integer
    or (p_policy->>'baseCents')::integer > (p_policy->>'ceilingCents')::integer then raise exception 'Invalid pricing bounds'; end if;
  select * into result from property_pricing_profiles where property_id=p_property for update;
  if found then
    if result.version <> p_expected then raise exception 'Settings changed; reload'; end if;
    update property_pricing_profiles set policy=p_policy,mode=p_mode,version=version+1,updated_at=clock_timestamp(),updated_by=p_actor
      where property_id=p_property returning * into result;
  else
    if p_expected <> 0 then raise exception 'Settings changed; reload'; end if;
    insert into property_pricing_profiles(property_id,policy,mode,updated_by) values(p_property,p_policy,p_mode,p_actor) returning * into result;
  end if;
  return result;
end $$;

create function public.helm_apply_pricing_run(p_run uuid, p_actor text)
returns integer language plpgsql security invoker set search_path = public, pg_temp as $$
declare r public.property_pricing_runs; p public.property_pricing_profiles; row jsonb; n integer:=0; before jsonb;
begin
  -- Small, explicit owner batches. Serialize against all existing calendar writers,
  -- which do not share a pricing advisory lock. No network IO inside these locks.
  set local lock_timeout = '3s';
  set local statement_timeout = '10s';
  lock table public.properties, public.property_rate_plans, public.property_rate_days,
    public.property_rental_periods, public.bookings, public.property_pricing_evidence in share row exclusive mode;
  select * into r from property_pricing_runs where id=p_run for update;
  if not found then raise exception 'Unknown review'; end if;
  if r.status='applied' then return jsonb_array_length(r.applied_dates); end if;
  if r.status <> 'preview' or r.created_at < clock_timestamp()-interval '5 minutes' then raise exception 'Review expired; refresh'; end if;
  select * into p from property_pricing_profiles where property_id=r.property_id for update;
  if not found or p.mode <> 'helm_direct' or p.version <> r.profile_version then raise exception 'Connection or settings changed'; end if;
  if not exists(select 1 from properties where id=r.property_id and calendar_authority='helm' and is_active=true) then raise exception 'Helm authority required'; end if;
  if r.context <> helm_pricing_context(r.property_id,r.start_date,r.end_date) then raise exception 'Calendar changed; refresh the review'; end if;
  before := coalesce((select jsonb_agg(to_jsonb(d) order by d.date) from property_rate_days d where d.property_id=r.property_id
    and d.date in (select (x->>'date')::date from jsonb_array_elements(r.recommendations) x where (x->>'eligible')::boolean)), '[]'::jsonb);
  for row in select x from jsonb_array_elements(r.recommendations) x where (x->>'eligible')::boolean loop
    if (row->>'date')::date not between r.start_date and r.end_date
      or (row->>'date')::date < (clock_timestamp() at time zone coalesce(r.context->'property'->>'timezone','America/New_York'))::date
      or row->>'state' <> 'open'
      or (row->>'recommendedCents')::integer not between (p.policy->>'floorCents')::integer and (p.policy->>'ceilingCents')::integer
      or (row->>'minNights')::integer not between 1 and 30 then raise exception 'Invalid recommendation'; end if;
    if exists(select 1 from property_rate_days where property_id=r.property_id and date=(row->>'date')::date
      and (source='operator' or closed)) then raise exception 'Protected night changed'; end if;
    insert into property_rate_days(property_id,date,nightly_cents,min_nights,source,note,updated_by,updated_at)
      values(r.property_id,(row->>'date')::date,(row->>'recommendedCents')::integer,(row->>'minNights')::integer,
        'rule','Helm pricing ' || r.id,p_actor,transaction_timestamp())
      on conflict(property_id,date) do update set nightly_cents=excluded.nightly_cents,min_nights=excluded.min_nights,
        source=excluded.source,note=excluded.note,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
    -- cta, ctd and closed are deliberately never overwritten.
    n:=n+1;
  end loop;
  if n=0 then raise exception 'No eligible nights'; end if;
  update property_pricing_runs set status='applied',before_days=before,applied_at=transaction_timestamp(),
    after_days=(select jsonb_agg(to_jsonb(d) order by d.date) from property_rate_days d where d.property_id=r.property_id
      and d.date in (select (x->>'date')::date from jsonb_array_elements(r.recommendations) x where (x->>'eligible')::boolean)),
    applied_dates=(select jsonb_agg(x->>'date') from jsonb_array_elements(r.recommendations) x where (x->>'eligible')::boolean) where id=r.id;
  return n;
end $$;

create function public.helm_revert_pricing_run(p_run uuid, p_actor text)
returns integer language plpgsql security invoker set search_path = public, pg_temp as $$
declare r public.property_pricing_runs; d text; old jsonb; n integer:=0;
begin
  set local lock_timeout = '3s';
  lock table public.property_rate_days in share row exclusive mode;
  select * into r from property_pricing_runs where id=p_run for update;
  if not found then raise exception 'Unknown run'; end if;
  if r.status='reverted' then return jsonb_array_length(r.applied_dates); end if;
  if r.status <> 'applied' then raise exception 'Run has not been published'; end if;
  for d in select jsonb_array_elements_text(r.applied_dates) loop
    if not exists(select 1 from property_rate_days current_day where property_id=r.property_id and date=d::date
      and note='Helm pricing ' || r.id and source='rule' and updated_at=r.applied_at
      and to_jsonb(current_day)=(select x from jsonb_array_elements(r.after_days) x where x->>'date'=d)) then
      raise exception 'A published night changed; automatic undo would overwrite newer work'; end if;
    select x into old from jsonb_array_elements(r.before_days) x where x->>'date'=d;
    if old is null then delete from property_rate_days where property_id=r.property_id and date=d::date;
    else update property_rate_days set nightly_cents=(old->>'nightly_cents')::integer,min_nights=(old->>'min_nights')::smallint,
      cta=(old->>'cta')::boolean,ctd=(old->>'ctd')::boolean,closed=(old->>'closed')::boolean,
      source=old->>'source',note=old->>'note',updated_by=p_actor,updated_at=clock_timestamp()
      where property_id=r.property_id and date=d::date;
    end if;
    n:=n+1;
  end loop;
  update property_pricing_runs set status='reverted',reverted_at=clock_timestamp(),reverted_by=p_actor where id=r.id;
  return n;
end $$;
revoke all on function public.helm_pricing_context(text,date,date), public.helm_save_pricing_profile(text,jsonb,text,integer,text),
  public.helm_apply_pricing_run(uuid,text), public.helm_revert_pricing_run(uuid,text) from public, anon, authenticated;
grant execute on function public.helm_pricing_context(text,date,date), public.helm_save_pricing_profile(text,jsonb,text,integer,text),
  public.helm_apply_pricing_run(uuid,text), public.helm_revert_pricing_run(uuid,text) to service_role;
