-- Read-only market connector. No live-rate authority. Empty/disabled until an
-- authorized operator enrolls an authenticated, encrypted read-only credential.
begin;
create table public.helm_pricing_market_connection (
  id boolean primary key default true check(id),
  enabled boolean not null default false,
  ciphertext text not null check(length(ciphertext) between 64 and 131072 and ciphertext ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
  lease_id uuid,
  lease_until timestamptz,
  cursor_property_id text,
  updated_at timestamptz not null default clock_timestamp(),
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_report jsonb,
  check((lease_id is null)=(lease_until is null))
);
alter table public.helm_pricing_market_connection enable row level security;
revoke all on public.helm_pricing_market_connection from public,anon,authenticated,service_role;
grant select on public.helm_pricing_market_connection to service_role;

create function public.helm_configure_pricing_market(p_ciphertext text,p_enabled boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_enabled is null then raise exception 'Invalid enabled flag' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('helm-pricing-market-connection',0));
  if exists(select 1 from public.helm_pricing_market_connection where lease_until>clock_timestamp()) then
    raise exception 'Market refresh is running; retry after lease expiry' using errcode='40001';
  end if;
  if p_ciphertext is null then
    update public.helm_pricing_market_connection set enabled=p_enabled,lease_id=null,lease_until=null,updated_at=clock_timestamp() where id;
    if not found then raise exception 'Connection is not enrolled' using errcode='22023';end if;
  else
    insert into public.helm_pricing_market_connection(id,ciphertext,enabled) values(true,p_ciphertext,p_enabled)
    on conflict(id) do update set ciphertext=excluded.ciphertext,enabled=excluded.enabled,lease_id=null,lease_until=null,updated_at=clock_timestamp();
  end if;
end $$;

create function public.helm_claim_pricing_market(p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.helm_pricing_market_connection%rowtype;
begin
  if p_lease is null then raise exception 'Lease required' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('helm-pricing-market-connection',0));
  update public.helm_pricing_market_connection set lease_id=p_lease,lease_until=clock_timestamp()+interval '10 minutes',last_started_at=clock_timestamp()
    where id and enabled and (lease_until is null or lease_until<=clock_timestamp()) returning * into r;
  if not found then return null;end if;
  return jsonb_build_object('ciphertext',r.ciphertext,'cursor',r.cursor_property_id);
end $$;

create function public.helm_rotate_pricing_market(p_lease uuid,p_ciphertext text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.helm_pricing_market_connection set ciphertext=p_ciphertext,updated_at=clock_timestamp()
    where id and enabled and lease_id=p_lease and lease_until>clock_timestamp();
  if not found then raise exception 'Market refresh lease lost' using errcode='40001';end if;
end $$;

create function public.helm_finish_pricing_market(p_lease uuid,p_report jsonb,p_cursor text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- Aggregate counts and fixed status codes only; no tokens, names or payloads.
  if p_report is null or jsonb_typeof(p_report)<>'object' or octet_length(p_report::text)>2048
    or (p_report - array['status','matched','unmatched','missing','fresh','saved','unavailable','failed','conflicts','deferred','nights'])<>'{}'::jsonb
    or p_report->>'status' is null or p_report->>'status' not in ('complete','partial','failed')
    or exists(select 1 from jsonb_each(p_report - 'status') e where jsonb_typeof(e.value)<>'number' or e.value::text !~ '^[0-9]{1,7}$')
    or length(p_cursor)>100 then raise exception 'Invalid market report' using errcode='22023';end if;
  update public.helm_pricing_market_connection set lease_id=null,lease_until=null,last_report=p_report,
    cursor_property_id=p_cursor,last_finished_at=clock_timestamp()
    where id and lease_id=p_lease and lease_until>clock_timestamp();
  if not found then raise exception 'Market refresh lease lost' using errcode='40001';end if;
end $$;

revoke all on function public.helm_configure_pricing_market(text,boolean),public.helm_claim_pricing_market(uuid),public.helm_rotate_pricing_market(uuid,text),public.helm_finish_pricing_market(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.helm_configure_pricing_market(text,boolean),public.helm_claim_pricing_market(uuid),public.helm_rotate_pricing_market(uuid,text),public.helm_finish_pricing_market(uuid,jsonb,text) to service_role;
comment on table public.helm_pricing_market_connection is 'Server-only encrypted read-only OAuth credentials and a fenced refresh lease; never pricing authority.';
commit;
