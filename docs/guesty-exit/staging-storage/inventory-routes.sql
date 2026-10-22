-- Candidate only. Install after booking-inventory-planning.sql in isolated staging.
-- No seeds, remote IO, enablement or browser write access. Owner registration only.
begin;
create table if not exists public.helm_staging_inventory_routes (
 property_id text primary key references public.helm_booking_inventory_consumers(property_id),
 connection text not null check(length(connection) between 1 and 160),
 generation bigint not null check(generation between 1 and 9007199254740991),
 provider_property_id uuid not null unique,
 room_type_id uuid not null unique,
 rate_plan_id uuid not null unique,
 property_title text not null check(length(property_title) between 1 and 200 and property_title like '%Isolated Staging'),
 rate_plan_title text not null check(length(rate_plan_title) between 1 and 200 and rate_plan_title like 'TEST ONLY - %'),
 adults integer not null check(adults between 1 and 50),
 children integer not null check(children between 0 and 50),
 infants integer not null check(infants between 0 and 50),
 reviewed_at timestamptz not null default clock_timestamp(),
 check(property_id ~ '^HELMTEST-[a-z0-9-]{1,100}$')
);
alter table public.helm_staging_inventory_routes enable row level security;
revoke all on public.helm_staging_inventory_routes from public,anon,authenticated,service_role;

create or replace function public.helm_staging_inventory_route_guard()
returns trigger language plpgsql set search_path='' as $$
declare c public.helm_booking_inventory_consumers;
begin
 if tg_op <> 'INSERT' then raise exception 'Reviewed route is immutable; rollover is not implemented'; end if;
 select * into c from public.helm_booking_inventory_consumers where property_id=new.property_id for update;
 if not found or c.configuration->>'environment' is distinct from 'staging'
   or c.configuration->>'topology' is distinct from 'single-unit'
   or c.configuration->>'timeZone' is distinct from 'America/New_York'
   or c.configuration->'publishEnabled' is distinct from 'false'::jsonb
   or c.configuration->>'connection' is distinct from new.connection
   or c.configuration->>'listing' is distinct from new.room_type_id::text
   or c.configuration->'generation' is distinct from to_jsonb(new.generation)
 then raise exception 'Paused matching staging consumer required for route review'; end if;
 new.reviewed_at := clock_timestamp();
 return new;
end $$;
drop trigger if exists helm_staging_inventory_route_guard on public.helm_staging_inventory_routes;
create trigger helm_staging_inventory_route_guard before insert or update or delete on public.helm_staging_inventory_routes
 for each row execute function public.helm_staging_inventory_route_guard();
drop trigger if exists helm_staging_inventory_route_no_truncate on public.helm_staging_inventory_routes;
create trigger helm_staging_inventory_route_no_truncate before truncate on public.helm_staging_inventory_routes
 for each statement execute function public.helm_staging_inventory_route_guard();

-- A stale caller receives no destination. The generation still travels through
-- the existing plan CAS, dispatch barrier, saved request and completion checks.
create or replace function public.helm_staging_inventory_route_read(p_property text,p_connection text,p_generation bigint)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('environment','staging','helmProperty',r.property_id,'connection',r.connection,'generation',r.generation,
   'propertyId',r.provider_property_id,'roomTypeId',r.room_type_id,'ratePlanId',r.rate_plan_id,
   'propertyTitle',r.property_title,'ratePlanTitle',r.rate_plan_title,
   'adults',r.adults,'children',r.children,'infants',r.infants,'reviewedAt',r.reviewed_at)
 from public.helm_staging_inventory_routes r join public.helm_booking_inventory_consumers c using(property_id)
 where r.property_id=p_property and r.connection=p_connection and r.generation=p_generation
   and c.configuration->>'connection'=r.connection and c.configuration->>'listing'=r.room_type_id::text
   and c.configuration->'generation'=to_jsonb(r.generation)
   and c.configuration->>'environment'='staging' and c.configuration->>'topology'='single-unit';
$$;
revoke all on function public.helm_staging_inventory_route_guard(),public.helm_staging_inventory_route_read(text,text,bigint)
 from public,anon,authenticated,service_role;
grant execute on function public.helm_staging_inventory_route_read(text,text,bigint) to service_role;
commit;
