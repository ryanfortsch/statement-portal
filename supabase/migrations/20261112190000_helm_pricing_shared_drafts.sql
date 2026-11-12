-- Draft settings only. Independent of the dormant pricing publisher migrations.
begin;
create table public.helm_pricing_drafts (
  id smallint primary key check (id=1),
  revision integer not null check (revision>=0),
  settings jsonb not null check (jsonb_typeof(settings)='object'),
  updated_at timestamptz,
  updated_by text
);
create table public.helm_pricing_draft_versions (
  revision integer primary key check (revision>0),
  request_id uuid not null unique,
  expected_revision integer not null check (expected_revision=revision-1),
  settings jsonb not null,
  updated_at timestamptz not null,
  updated_by text not null
);
alter table public.helm_pricing_drafts enable row level security;
alter table public.helm_pricing_draft_versions enable row level security;
revoke all on public.helm_pricing_drafts,public.helm_pricing_draft_versions from public,anon,authenticated,service_role;
grant select on public.helm_pricing_drafts,public.helm_pricing_draft_versions to service_role;

create function public.helm_save_pricing_drafts(p_settings jsonb,p_expected integer,p_request uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare current_row public.helm_pricing_drafts%rowtype;
declare receipt public.helm_pricing_draft_versions%rowtype;
begin
  if p_expected is null or p_expected<0 or p_request is null or p_actor is null
    or length(trim(p_actor))<3 or length(p_actor)>254
    or p_settings is null or jsonb_typeof(p_settings)<>'object'
    or p_settings->>'version' is distinct from '1'
    or jsonb_typeof(p_settings->'homes') is distinct from 'object'
    or jsonb_typeof(p_settings->'groups') is distinct from 'array'
    or octet_length(p_settings::text)>512000 then
    raise exception 'Invalid pricing draft envelope' using errcode='22023';
  end if;
  insert into public.helm_pricing_drafts(id,revision,settings)
    values(1,0,'{"version":1,"homes":{},"groups":[]}'::jsonb) on conflict(id) do nothing;
  select * into current_row from public.helm_pricing_drafts where id=1 for update;
  select * into receipt from public.helm_pricing_draft_versions where request_id=p_request;
  if found then
    if receipt.settings<>p_settings or receipt.expected_revision<>p_expected or receipt.updated_by<>p_actor then
      raise exception 'Pricing request was reused with different input' using errcode='22023';
    end if;
    return jsonb_build_object('revision',receipt.revision,'settings',receipt.settings,'updated_at',receipt.updated_at,'updated_by',receipt.updated_by);
  end if;
  if current_row.revision<>p_expected then
    raise exception 'Pricing settings changed' using errcode='40001';
  end if;
  update public.helm_pricing_drafts set revision=revision+1,settings=p_settings,updated_at=clock_timestamp(),updated_by=p_actor
    where id=1 returning * into current_row;
  insert into public.helm_pricing_draft_versions(revision,request_id,expected_revision,settings,updated_at,updated_by)
    values(current_row.revision,p_request,p_expected,p_settings,current_row.updated_at,p_actor);
  return jsonb_build_object('revision',current_row.revision,'settings',current_row.settings,'updated_at',current_row.updated_at,'updated_by',current_row.updated_by);
end $$;
revoke all on function public.helm_save_pricing_drafts(jsonb,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.helm_save_pricing_drafts(jsonb,integer,uuid,text) to service_role;
comment on table public.helm_pricing_drafts is 'Owner workspace draft settings; never consumed by booking or rate delivery writers.';
comment on table public.helm_pricing_draft_versions is 'Immutable save receipts and recovery snapshots for pricing drafts.';
commit;
