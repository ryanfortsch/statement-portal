-- INACTIVE candidate after provider timing, before queue SQL. Reads the existing
-- Guesty mirror; never treats absence, status=new or booked_at as new-origin proof.
begin;
create table helm_airbnb_bookings.origin_source_policy (
 singleton boolean primary key default true check(singleton),
 generation bigint not null check(generation>0),
 guesty_listing_id text not null check(btrim(guesty_listing_id)<>''),
 enabled boolean not null default false
);
create table helm_airbnb_bookings.origin_matches (
 booking_id uuid primary key references public.bookings(id),
 source_ids text[] not null check(cardinality(source_ids)>0),
 observed_at timestamptz not null default clock_timestamp(),
 outcome text not null check(outcome in ('migrated','conflict'))
);
alter table helm_airbnb_bookings.origin_source_policy enable row level security;
alter table helm_airbnb_bookings.origin_matches enable row level security;
revoke all on helm_airbnb_bookings.origin_source_policy,helm_airbnb_bookings.origin_matches from public,anon,authenticated,service_role;
-- Owner-reviewed cutover evidence only. No worker/browser write privilege.
-- Complete means ALL pre-cutover reservation codes, not just future stays. Sales
-- paused throughout capture/import reconciliation; opened_at is the actual reopen.
create table helm_airbnb_bookings.origin_cutover_baseline (
 singleton boolean primary key default true check(singleton),
 generation bigint not null check(generation>0), environment text not null,
 remote_property uuid not null, reservation_codes text[] not null,
 evidence_id text not null check(evidence_id ~ '^[A-Za-z0-9_.:-]{1,160}$'),
 sales_paused_at timestamptz not null, captured_at timestamptz not null,
 import_reconciled_at timestamptz not null, opened_at timestamptz not null,
 expires_at timestamptz not null, complete boolean not null default false,
 enabled boolean not null default false,
 check(isfinite(sales_paused_at) and sales_paused_at<=captured_at and captured_at<=import_reconciled_at
  and import_reconciled_at<=opened_at and opened_at<expires_at and isfinite(expires_at))
);
alter table helm_airbnb_bookings.origin_cutover_baseline enable row level security;
revoke all on helm_airbnb_bookings.origin_cutover_baseline from public,anon,authenticated,service_role;
create function helm_airbnb_bookings.classify_cutover(p_booking uuid)
returns text language plpgsql security definer set search_path='' as $$
declare cfg helm_airbnb_bookings.origin_cutover_baseline; sc helm_airbnb_bookings.scope;
 m helm_airbnb_bookings.bookings; first_receipt helm_airbnb_bookings.receipts; kind text;
begin
 select * into cfg from helm_airbnb_bookings.origin_cutover_baseline where singleton for share;
 select * into sc from helm_airbnb_bookings.scope where singleton;
 if cfg.singleton is null or not cfg.enabled or not cfg.complete
  or (cfg.generation,cfg.environment,cfg.remote_property) is distinct from (sc.generation,sc.environment,sc.remote_property)
  or clock_timestamp()<cfg.opened_at or clock_timestamp()>=cfg.expires_at
  or cardinality(cfg.reservation_codes)<>(select count(distinct x) from unnest(cfg.reservation_codes) x)
  or exists(select 1 from unnest(cfg.reservation_codes) x where x is null or x !~ '^[A-Za-z0-9_-]{1,160}$')
 then return 'unknown'; end if;
 -- Existing assertions, including disabled/conflicted ones, are never revived.
 if exists(select 1 from helm_airbnb_bookings.message_origins where booking_id=p_booking) then return 'unchanged'; end if;
 select * into m from helm_airbnb_bookings.bookings where canonical_id=p_booking;
 select * into first_receipt from helm_airbnb_bookings.receipts where canonical_id=p_booking order by committed_at,revision_id limit 1;
 if first_receipt.revision_id is null or first_receipt.outcome<>'applied' then return 'unknown'; end if;
 if m.code=any(cfg.reservation_codes) then kind:='migrated';
 elsif first_receipt.revision->>'status'='new' and first_receipt.committed_at>=cfg.opened_at
  and (first_receipt.revision->>'providerReceivedAt')::timestamptz>=cfg.opened_at
  and (first_receipt.revision->>'providerReceivedAt')::timestamptz<=first_receipt.committed_at then kind:='new';
 else return 'unknown'; end if;
 insert into helm_airbnb_bookings.message_origins(booking_id,first_revision,generation,origin,original_confirmed_at,evidence_id,enabled,basis)
 values(p_booking,first_receipt.revision_id,sc.generation,kind,null,cfg.evidence_id,true,'cutover-baseline');
 return kind;
end $$;
revoke all on function helm_airbnb_bookings.classify_cutover(uuid) from public,anon,authenticated,service_role;
create function public.helm_airbnb_origin_reconcile(p_booking uuid)
returns text language plpgsql security definer set search_path='' as $$
declare sc helm_airbnb_bookings.scope; cfg helm_airbnb_bookings.origin_source_policy;
 b public.bookings; m helm_airbnb_bookings.bookings; existing helm_airbnb_bookings.message_origins;
 first_id uuid; matches text[]; outcome text;
begin
 select * into sc from helm_airbnb_bookings.scope where singleton for update;
 select * into cfg from helm_airbnb_bookings.origin_source_policy where singleton for share;
 if not coalesce(sc.enabled and cfg.enabled,false) or cfg.generation is distinct from sc.generation then return 'inactive'; end if;
 select * into b from public.bookings where id=p_booking for update;
 select * into m from helm_airbnb_bookings.bookings where canonical_id=p_booking;
 if b.id is null or b.property_id is distinct from sc.property_id or b.channel::text is distinct from 'airbnb'
  or b.source is distinct from 'manual' or b.duplicate_of is not null
  or b.source_ref is distinct from 'channex-airbnb:'||sc.environment||':'||sc.remote_property||':'||m.remote_id
  or (m.environment,m.remote_property,m.generation) is distinct from (sc.environment,sc.remote_property,sc.generation)
 then return 'blocked'; end if;
 select array_agg(distinct g.guesty_reservation_id order by g.guesty_reservation_id) into matches
  from public.guesty_reservations g where g.property_id=sc.property_id and g.listing_id=cfg.guesty_listing_id
   and g.channel='Airbnb' and g.confirmation_code=m.code and nullif(btrim(g.guesty_reservation_id),'') is not null;
 if matches is null then return helm_airbnb_bookings.classify_cutover(b.id); end if;
 select * into existing from helm_airbnb_bookings.message_origins where booking_id=b.id for update;
 if existing.booking_id is not null then
  outcome:=case when existing.origin='migrated' then 'migrated' else 'conflict' end;
  if existing.origin='new' then
   -- Preserve prior classification/history for review; revoke send eligibility.
   update helm_airbnb_bookings.message_origins set enabled=false where booking_id=b.id;
  end if;
 else
  select rc.revision_id into first_id from helm_airbnb_bookings.receipts rc where rc.canonical_id=b.id and rc.outcome='applied'
   order by rc.committed_at,rc.revision_id limit 1;
  if first_id is null then return 'blocked'; end if;
  -- booked_at may be a createdAt fallback. Do not manufacture confirmed_at.
  insert into helm_airbnb_bookings.message_origins(booking_id,first_revision,generation,origin,original_confirmed_at,evidence_id,enabled)
   values(b.id,first_id,sc.generation,'migrated',null,'guesty-match:'||b.id,true);
  outcome:='migrated';
 end if;
 insert into helm_airbnb_bookings.origin_matches(booking_id,source_ids,outcome) values(b.id,matches,outcome)
  on conflict(booking_id) do nothing;
 return outcome;
end $$;
revoke all on function public.helm_airbnb_origin_reconcile(uuid) from public,anon,authenticated;
grant execute on function public.helm_airbnb_origin_reconcile(uuid) to service_role;
commit;
