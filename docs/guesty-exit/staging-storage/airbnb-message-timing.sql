-- Inactive candidate after airbnb-booking-storage.sql. No queue/sender writes.
-- Origin evidence must be supplied by a reviewed cutover process, never inferred
-- solely from Channex inserted_at or status=new. Unknown origin returns no plan.
begin;
create table helm_airbnb_bookings.message_clock_policy (
 singleton boolean primary key default true check(singleton),
 generation bigint not null, environment text not null, remote_property uuid not null,
 arrival_time time not null check(arrival_time<time '24:00' and extract(second from arrival_time)=0),
 departure_time time not null check(departure_time<time '24:00' and extract(second from departure_time)=0),
 timezone text not null,
 starts_at timestamptz not null check(isfinite(starts_at)),
 expires_at timestamptz not null check(isfinite(expires_at) and expires_at>starts_at),
 enabled boolean not null default false
);
create table helm_airbnb_bookings.message_origins (
 booking_id uuid primary key references public.bookings(id),
 first_revision uuid not null unique references helm_airbnb_bookings.receipts(revision_id),
 generation bigint not null,
 origin text not null check(origin in ('new','migrated')),
 original_confirmed_at timestamptz,
 evidence_id text not null check(evidence_id ~ '^[A-Za-z0-9_.:-]{1,160}$'),
 enabled boolean not null default false,
 check((origin='new' and original_confirmed_at is null) or
       (origin='migrated' and original_confirmed_at is not null and isfinite(original_confirmed_at)))
);
alter table helm_airbnb_bookings.message_clock_policy enable row level security;
alter table helm_airbnb_bookings.message_origins enable row level security;
revoke all on helm_airbnb_bookings.message_clock_policy,helm_airbnb_bookings.message_origins from public,anon,authenticated,service_role;

create function public.helm_airbnb_message_schedule(p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 b public.bookings; m helm_airbnb_bookings.bookings; s helm_airbnb_bookings.scope;
 p helm_airbnb_bookings.message_clock_policy; o helm_airbnb_bookings.message_origins;
 first_receipt helm_airbnb_bookings.receipts; latest helm_airbnb_bookings.receipts;
 flow text; wall timestamp; anchor timestamp; at_time timestamptz; elapsed timestamptz;
 confirm_at timestamptz; days_before integer; reason text; plans jsonb:='[]'::jsonb;
begin
 select * into s from helm_airbnb_bookings.scope where singleton;
 select * into p from helm_airbnb_bookings.message_clock_policy where singleton;
 select * into b from public.bookings where id=p_booking_id;
 select * into m from helm_airbnb_bookings.bookings where canonical_id=p_booking_id;
 select * into o from helm_airbnb_bookings.message_origins where booking_id=p_booking_id;
 if s.singleton is null or p.singleton is null or not s.enabled or not p.enabled or o.booking_id is null or not o.enabled
 or (p.generation,p.environment,p.remote_property) is distinct from (s.generation,s.environment,s.remote_property)
 or o.generation<>s.generation or statement_timestamp()<p.starts_at or statement_timestamp()>=p.expires_at
 or not exists(select 1 from pg_catalog.pg_timezone_names where name=p.timezone)
 or b.id is null or m.remote_id is null or b.property_id is distinct from s.property_id
 or b.channel::text is distinct from 'airbnb' or b.source::text is distinct from 'manual'
 or b.status::text is distinct from 'confirmed' or b.duplicate_of is not null
 or b.source_ref is distinct from 'channex-airbnb:'||s.environment||':'||s.remote_property||':'||m.remote_id
 or (m.environment,m.remote_property,m.generation) is distinct from (s.environment,s.remote_property,s.generation)
 or (b.check_in,b.check_out,b.status) is distinct from (m.check_in,m.check_out,m.status)
 or not exists(select 1 from public.properties where id=b.property_id and calendar_authority='helm')
 or not exists(select 1 from public.helm_inventory_capture_scopes where property_id=b.property_id and enabled)
 then return null; end if;
 select * into first_receipt from helm_airbnb_bookings.receipts where revision_id=o.first_revision and canonical_id=b.id;
 select * into latest from helm_airbnb_bookings.receipts where revision_id=m.latest_revision and canonical_id=b.id;
 if first_receipt.revision_id is null or first_receipt.outcome<>'applied'
 or exists(select 1 from helm_airbnb_bookings.receipts where canonical_id=b.id and committed_at<first_receipt.committed_at)
 or latest.outcome is distinct from 'applied' or latest.revision->>'checkIn' is distinct from b.check_in::text
 or latest.revision->>'checkOut' is distinct from b.check_out::text
 or latest.revision->>'status' not in ('new','modified') then return null; end if;
 if o.origin='new' then
  if first_receipt.revision->>'status'<>'new' or first_receipt.committed_at<p.starts_at
    or (first_receipt.revision->>'providerReceivedAt')::timestamptz<p.starts_at
    or (first_receipt.revision->>'providerReceivedAt')::timestamptz>first_receipt.committed_at
  then return null; end if;
  confirm_at:=first_receipt.committed_at;
 else
  if o.original_confirmed_at>first_receipt.committed_at then return null; end if;
  confirm_at:=o.original_confirmed_at;
 end if;
 foreach flow in array array['confirmation','pre_arrival','key_code','pre_checkout','cleaner_advance','cleaner_arrival'] loop
  reason:=null;at_time:=null;
  if flow='confirmation' then at_time:=confirm_at+interval '30 minutes';
  else
   anchor:=case when flow='pre_checkout' then b.check_out+p.departure_time else b.check_in+p.arrival_time end;
   elapsed:=anchor at time zone p.timezone;
   if elapsed at time zone p.timezone is distinct from anchor
     or (elapsed-interval '1 hour') at time zone p.timezone=anchor
     or (elapsed+interval '1 hour') at time zone p.timezone=anchor then reason:='ambiguous-local-clock'; end if;
   days_before:=case flow when 'pre_arrival' then 1 when 'pre_checkout' then 1 when 'cleaner_advance' then 10 else 0 end;
   if days_before>0 then
    wall:=anchor-days_before*interval '1 day'; at_time:=wall at time zone p.timezone;
    if at_time at time zone p.timezone is distinct from wall
      or (at_time-interval '1 hour') at time zone p.timezone=wall
      or (at_time+interval '1 hour') at time zone p.timezone=wall then reason:='ambiguous-local-clock';
    elsif at_time is distinct from elapsed-days_before*interval '24 hours' then reason:='day-offset-review-required'; end if;
   else
    at_time:=elapsed-case when flow='key_code' then interval '1 hour' else interval '7 hours' end;
   end if;
  end if;
  if o.origin='migrated' then reason:='source-message-history-required';
  elsif reason is null and at_time<=statement_timestamp() then reason:='past-due-policy-required';
  elsif reason is null and at_time>=p.expires_at then reason:='outside-policy-window'; end if;
  plans:=plans||jsonb_build_array(jsonb_build_object('workflow',flow,
   'fireAt',to_char(at_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'blockedReason',reason));
 end loop;
 return jsonb_build_object('bookingId',b.id,'latestRevision',m.latest_revision,'firstRevision',o.first_revision,
  'origin',o.origin,'evidenceId',o.evidence_id,'confirmationBasis',case when o.origin='new' then 'helm-first-durable-receipt' else 'original-confirmation' end,
  'plans',plans,'canSend',false);
end $$;
revoke all on function public.helm_airbnb_message_schedule(uuid) from public,anon,authenticated;
grant execute on function public.helm_airbnb_message_schedule(uuid) to service_role;
commit;
