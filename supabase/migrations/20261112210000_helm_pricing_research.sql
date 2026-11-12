-- Imported comparison data only. Independent of the dormant rate publisher.
begin;
create table public.helm_pricing_research (
  property_id text primary key references public.properties(id),
  version integer not null check (version>0),
  data jsonb not null check (data->>'propertyId'=property_id),
  updated_at timestamptz not null,
  updated_by text not null
);
create table public.helm_pricing_research_versions (
  property_id text not null references public.properties(id),
  version integer not null check (version>0),
  request_id uuid not null unique,
  expected_version integer not null check (expected_version=version-1),
  data jsonb not null check (data->>'propertyId'=property_id),
  updated_at timestamptz not null,
  updated_by text not null,
  primary key(property_id,version)
);
alter table public.helm_pricing_research enable row level security;
alter table public.helm_pricing_research_versions enable row level security;
revoke all on public.helm_pricing_research,public.helm_pricing_research_versions from public,anon,authenticated,service_role;
grant select on public.helm_pricing_research,public.helm_pricing_research_versions to service_role;
create function public.helm_save_pricing_research(p_property text,p_data jsonb,p_expected integer,p_request uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare current_row public.helm_pricing_research%rowtype;
declare receipt public.helm_pricing_research_versions%rowtype;
begin
  if p_property is null or length(p_property) not between 1 and 100 or p_expected is null or p_expected<0
    or p_request is null or p_actor is null or length(trim(p_actor)) not between 3 and 254
    or p_data is null or jsonb_typeof(p_data)<>'object' or p_data->>'propertyId' is distinct from p_property
    or p_data->>'version' is distinct from '1' or p_data->>'currency' is distinct from 'USD'
    or jsonb_typeof(p_data->'market') is distinct from 'array' or jsonb_typeof(p_data->'history') is distinct from 'array'
    or octet_length(p_data::text)>950000 then
    raise exception 'Invalid research envelope' using errcode='22023';
  end if;
  if not exists(select 1 from public.properties where id=p_property and kind='managed' and is_active) then
    raise exception 'Unknown active managed property' using errcode='22023';
  end if;
  -- Serializes the first insert too; a missing row cannot be row-locked.
  perform pg_advisory_xact_lock(hashtextextended('helm-pricing-research:'||p_property,0));
  select * into receipt from public.helm_pricing_research_versions where request_id=p_request;
  if found then
    if receipt.property_id<>p_property or receipt.data<>p_data or receipt.expected_version<>p_expected or receipt.updated_by<>p_actor then
      raise exception 'Research request reused with different input' using errcode='22023';
    end if;
    return jsonb_build_object('version',receipt.version,'data',receipt.data,'updated_at',receipt.updated_at);
  end if;
  select * into current_row from public.helm_pricing_research where property_id=p_property for update;
  if coalesce(current_row.version,0)<>p_expected then raise exception 'Research changed' using errcode='40001';end if;
  insert into public.helm_pricing_research(property_id,version,data,updated_at,updated_by)
    values(p_property,p_expected+1,p_data,clock_timestamp(),p_actor)
    on conflict(property_id) do update set version=excluded.version,data=excluded.data,updated_at=excluded.updated_at,updated_by=excluded.updated_by
    returning * into current_row;
  insert into public.helm_pricing_research_versions values(p_property,current_row.version,p_request,p_expected,p_data,current_row.updated_at,p_actor);
  return jsonb_build_object('version',current_row.version,'data',current_row.data,'updated_at',current_row.updated_at);
end $$;
revoke all on function public.helm_save_pricing_research(text,jsonb,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.helm_save_pricing_research(text,jsonb,integer,uuid,text) to service_role;
comment on table public.helm_pricing_research is 'Source-stamped imported research for comparison drafts, never a rate writer.';
comment on table public.helm_pricing_research_versions is 'Immutable import receipts; observation time remains separate from save time.';
commit;
