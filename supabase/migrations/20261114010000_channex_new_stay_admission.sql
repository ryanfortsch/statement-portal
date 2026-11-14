-- Dormant admission of post-handover Airbnb stays. Installation creates no
-- epoch, admission, exception, schedule or message. Guesty ownership is untouched.
begin;
set local lock_timeout='5s';
create index if not exists channex_receipt_first_for_stay
 on helm_airbnb_bookings.receipts(canonical_id,committed_at,revision_id);

-- An epoch is a privileged, reviewed CUTOVER record, never something inferred
-- from an empty API response or status=new. Before installation of a real row:
-- reconcile the complete Airbnb/source/import baseline, finish initial imports,
-- stop competing senders, and retain the independent coverage/ownership evidence.
-- Reconnects/imports require stopping this lane and a new reviewed generation.
-- No public or service-role function may create/replace this evidence.
create table helm_channex_messages.new_stay_epochs (
 id uuid primary key,
 property_id text not null references helm_channex_messages.scope(property_id) check(property_id='65_calderwood'),
 route_generation uuid not null, source_evidence_id uuid not null,
 source_drained_at timestamptz not null check(isfinite(source_drained_at)),
 import_generation bigint not null check(import_generation=1),
 coverage_evidence_id uuid not null,
 baseline_remote_ids uuid[] not null,
 baseline_codes text[] not null,
 opened_at timestamptz not null default clock_timestamp() check(isfinite(opened_at)),
 actor text not null check(length(btrim(actor)) between 1 and 200),
 timing_policy text not null check(timing_policy='calderwood_new_airbnb_helm_clocks_v1'),
 confirmation_policy text not null check(confirmation_policy='calderwood_new_airbnb_first_receipt_30m_v1'),
 unique(property_id,route_generation),
 check(source_drained_at<=opened_at),
 check(cardinality(baseline_remote_ids)<=5000 and cardinality(baseline_codes)<=10000),
 check(array_position(baseline_remote_ids,null) is null and array_position(baseline_codes,null) is null)
);
create table helm_channex_messages.new_stay_admissions (
 booking_id uuid primary key references public.bookings(id),
 remote_booking uuid not null unique references helm_airbnb_bookings.bookings(remote_id),
 epoch_id uuid not null references helm_channex_messages.new_stay_epochs(id),
 first_revision uuid not null unique references helm_airbnb_bookings.receipts(revision_id),
 first_received_at timestamptz not null check(isfinite(first_received_at)),
 admitted_at timestamptz not null default clock_timestamp() check(isfinite(admitted_at)),
 check(first_received_at<=admitted_at)
);
create table helm_channex_messages.new_stay_clock_exceptions (
 id uuid primary key,
 booking_id uuid not null references helm_channex_messages.new_stay_admissions(booking_id),
 replaces uuid unique references helm_channex_messages.new_stay_clock_exceptions(id),
 check_in date not null, check_out date not null check(check_in<check_out),
 arrival text check(arrival ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 departure text check(departure ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 actor text not null check(length(btrim(actor)) between 1 and 200),
 recorded_at timestamptz not null default clock_timestamp()
);
create unique index new_stay_first_exception on helm_channex_messages.new_stay_clock_exceptions(booking_id) where replaces is null;
create index new_stay_exception_booking on helm_channex_messages.new_stay_clock_exceptions(booking_id,recorded_at);
alter table helm_channex_messages.new_stay_epochs enable row level security;
alter table helm_channex_messages.new_stay_admissions enable row level security;
alter table helm_channex_messages.new_stay_clock_exceptions enable row level security;
revoke all on helm_channex_messages.new_stay_epochs,helm_channex_messages.new_stay_admissions,
 helm_channex_messages.new_stay_clock_exceptions from public,anon,authenticated,service_role;
create trigger new_stay_epoch_immutable before update or delete on helm_channex_messages.new_stay_epochs
 for each row execute function helm_channex_messages.template_capture_immutable();
create trigger new_stay_admission_immutable before update or delete on helm_channex_messages.new_stay_admissions
 for each row execute function helm_channex_messages.template_capture_immutable();
create trigger new_stay_exception_immutable before update or delete on helm_channex_messages.new_stay_clock_exceptions
 for each row execute function helm_channex_messages.template_capture_immutable();

-- Independent live eligibility. Admissions survive later edits/cancellation as
-- audit history, but never authorize use against a revoked/changed source scope.
create function helm_channex_messages.new_stay_epoch_ready(p_epoch uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from helm_channex_messages.new_stay_epochs e
 join helm_channex_messages.scope s on s.property_id=e.property_id
 join helm_airbnb_bookings.scope i on i.property_id=e.property_id
 join public.properties p on p.id=e.property_id
 join public.helm_inventory_capture_scopes c on c.property_id=e.property_id
 where e.id=p_epoch and s.enabled and i.enabled and c.enabled
 and s.generation=e.route_generation and s.source_evidence_id=e.source_evidence_id
 and s.source_drained_at=e.source_drained_at
 and s.source_stopped_at<=s.source_drained_at and s.source_drained_at<=e.opened_at
 and e.opened_at<=statement_timestamp() and i.generation=e.import_generation
 and s.environment='production' and i.environment='production' and s.remote_property=i.remote_property
 and p.calendar_authority='helm' and p.is_active and p.kind='managed');
$$;

-- A persisted initial applied revision is required, not merely a latest "new"
-- payload. All existing/duplicate identities participate across every date/status.
create function helm_channex_messages.new_stay_candidate(p_booking uuid,p_epoch uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select first.revision_id from helm_channex_messages.new_stay_epochs e
 join helm_airbnb_bookings.bookings m on m.canonical_id=p_booking
 join public.bookings b on b.id=m.canonical_id
 cross join lateral (select r.* from helm_airbnb_bookings.receipts r where r.canonical_id=b.id
   order by r.committed_at,r.revision_id limit 1) first
 join helm_airbnb_bookings.receipts current on current.revision_id=m.latest_revision
 where e.id=p_epoch and helm_channex_messages.new_stay_epoch_ready(e.id)
 and b.property_id=e.property_id and b.status='confirmed' and b.duplicate_of is null and b.hold_kind is null
 and b.source='manual' and b.channel='airbnb' and b.external_confirmation_code=m.code
 and b.source_ref='channex-airbnb:production:'||m.remote_property::text||':'||m.remote_id::text
 and m.environment='production' and m.remote_property='320c5cb5-91e0-46af-b9b3-a3fc20b4631e'
 and m.generation=e.import_generation and m.status=b.status and m.check_in=b.check_in and m.check_out=b.check_out
 and b.check_in<b.check_out and b.check_out>(statement_timestamp() at time zone 'America/New_York')::date
 and first.outcome='applied' and first.revision->>'status'='new'
 and first.revision->>'bookingId'=m.remote_id::text and first.revision->>'reservationCode'=m.code
 and first.first_received_at=m.first_received_at and first.first_received_at>e.opened_at
 and first.committed_at>=first.first_received_at and first.committed_at<=statement_timestamp()
 and current.canonical_id=b.id and current.outcome='applied' and current.first_received_at=first.first_received_at
 and current.revision->>'status'<>'cancelled' and current.revision->>'bookingId'=m.remote_id::text
 and current.revision->>'reservationCode'=m.code and current.committed_at>=first.committed_at
 and current.committed_at<=statement_timestamp()
 and not m.remote_id=any(e.baseline_remote_ids)
 and not exists(select 1 from unnest(e.baseline_codes) code where upper(btrim(code))=upper(btrim(m.code)))
 and not exists(select 1 from public.bookings other where other.property_id=e.property_id and other.channel='airbnb'
   and other.id<>b.id and upper(btrim(other.external_confirmation_code))=upper(btrim(m.code)))
 and not helm_channex_messages.descendant_history(b.id);
$$;

-- Automatic, bounded admission after a reviewed epoch. No browser-supplied
-- identity, origin flag, timestamp, or clock is accepted. No message is queued.
create function public.helm_channex_new_stays_admit() returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare e helm_channex_messages.new_stay_epochs; candidate record; first uuid; n integer:=0;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'admission_isolation_required'; end if;
 -- Same importer order: import scope, message scope, canonical row. No provider IO.
 perform 1 from helm_airbnb_bookings.scope where singleton for update;
 perform 1 from helm_channex_messages.scope where property_id='65_calderwood' for share;
 select ep.* into e from helm_channex_messages.new_stay_epochs ep
 join helm_channex_messages.scope s on s.property_id=ep.property_id and s.generation=ep.route_generation
 where ep.property_id='65_calderwood';
 if not found or not helm_channex_messages.new_stay_epoch_ready(e.id) then
  return jsonb_build_object('state','disabled','admitted',0,'canSend',false); end if;
 for candidate in select m.canonical_id from helm_airbnb_bookings.bookings m
  where m.first_received_at>e.opened_at and not exists(select 1 from helm_channex_messages.new_stay_admissions a where a.booking_id=m.canonical_id)
  and not exists(select 1 from public.automation_sends where booking_id=m.canonical_id)
  and helm_channex_messages.new_stay_candidate(m.canonical_id,e.id) is not null
  order by m.first_received_at,m.canonical_id limit 5
 loop
  perform 1 from public.bookings where id=candidate.canonical_id for update;
  first:=helm_channex_messages.new_stay_candidate(candidate.canonical_id,e.id);
  if first is null then continue; end if;
  -- Existing message history must be deliberately reconciled, never relabelled
  -- as new. Once admitted, history is expected and retained by all later reads.
  if exists(select 1 from public.automation_sends where booking_id=candidate.canonical_id) then continue; end if;
  insert into helm_channex_messages.new_stay_admissions(booking_id,remote_booking,epoch_id,first_revision,first_received_at)
   select m.canonical_id,m.remote_id,e.id,first,m.first_received_at from helm_airbnb_bookings.bookings m where m.canonical_id=candidate.canonical_id;
  n:=n+1;
 end loop;
 return jsonb_build_object('state','complete','admitted',n,'canSend',false);
end$$;

-- Server-only provenance and clocks. It is intentionally NOT retained Guesty
-- evidence and cannot satisfy helm_channex_timing_binding_read.
create function public.helm_channex_new_stay_read(p_booking uuid) returns jsonb
language sql stable security definer set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('format',1,'observedAt',statement_timestamp(),'epochId',a.epoch_id,
 'bookingId',a.booking_id,'remoteBookingId',a.remote_booking,'routeGeneration',e.route_generation,
 'sourceEvidenceId',e.source_evidence_id,'firstReceipt',public.helm_airbnb_revision_receipt(a.first_revision),
 'currentReceipt',public.helm_airbnb_revision_receipt(m.latest_revision),
 'clocks',jsonb_build_object('policy',e.timing_policy,'bookingId',a.booking_id,'start',b.check_in,'end',b.check_out,
  'exception',case when x.id is null then null else jsonb_build_object('id',x.id,'start',x.check_in,'end',x.check_out,
   'arrival',x.arrival,'departure',x.departure) end,
  'checkoutAdjustment',case when adj.value is null then null else jsonb_build_object(
   'id',adj.value->>'id','start',adj.value->>'stay_check_in','originalEnd',adj.value->>'original_check_out',
   'end',adj.value->>'adjusted_check_out','departure',adj.value->>'adjusted_checkout_time') end))
 from helm_channex_messages.new_stay_admissions a
 join helm_channex_messages.new_stay_epochs e on e.id=a.epoch_id
 join public.bookings b on b.id=a.booking_id
 join helm_airbnb_bookings.bookings m on m.canonical_id=a.booking_id
 left join lateral (select h.* from helm_channex_messages.new_stay_clock_exceptions h where h.booking_id=b.id
   and not exists(select 1 from helm_channex_messages.new_stay_clock_exceptions next where next.replaces=h.id)) x on true
 left join lateral (select to_jsonb(c) value from public.checkout_adjustments c
   where c.property_id=b.property_id and c.stay_check_in=b.check_in and to_jsonb(c)->>'status'='active') adj on true
 where a.booking_id=p_booking and helm_channex_messages.new_stay_candidate(b.id,e.id)=a.first_revision
 and m.remote_id=a.remote_booking and m.first_received_at=a.first_received_at;
$$;

-- Explicit owner operation through a trusted server caller. CAS on the previous
-- exception prevents lost edits. Lost-response replay returns the same receipt.
-- Null/null deliberately resets to the approved defaults; history stays intact.
create function public.helm_channex_new_stay_clock_save(p_change jsonb,p_actor text) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='5s' as $$
declare x helm_channex_messages.new_stay_clock_exceptions; old helm_channex_messages.new_stay_clock_exceptions;
 b public.bookings; previous uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' or jsonb_typeof(p_change) is distinct from 'object'
 or (select count(*) from jsonb_object_keys(p_change))<>7
 or not p_change ?& array['id','bookingId','replaces','start','end','arrival','departure']
 or exists(select 1 from jsonb_each(p_change) q where jsonb_typeof(q.value) not in ('string','null'))
 or p_change->>'id' is null or p_change->>'bookingId' is null
 or coalesce(p_change->>'start','') !~ '^\d{4}-\d{2}-\d{2}$'
 or coalesce(p_change->>'end','') !~ '^\d{4}-\d{2}-\d{2}$'
 or p_actor is null or length(btrim(p_actor)) not between 1 and 200 then raise exception 'invalid_clock_change'; end if;
 x.id:=(p_change->>'id')::uuid; x.booking_id:=(p_change->>'bookingId')::uuid; x.replaces:=(p_change->>'replaces')::uuid;
 x.check_in:=(p_change->>'start')::date; x.check_out:=(p_change->>'end')::date;
 x.arrival:=p_change->>'arrival'; x.departure:=p_change->>'departure'; x.actor:=btrim(p_actor);
 if x.id=x.replaces or x.check_in>=x.check_out then raise exception 'invalid_clock_change'; end if;
 perform 1 from helm_airbnb_bookings.scope where singleton for update;
 perform 1 from helm_channex_messages.scope where property_id='65_calderwood' for share;
 select * into b from public.bookings where id=x.booking_id for update;
 select * into old from helm_channex_messages.new_stay_clock_exceptions where id=x.id;
 if found then
  if (old.booking_id,old.replaces,old.check_in,old.check_out,old.arrival,old.departure,old.actor) is distinct from
   (x.booking_id,x.replaces,x.check_in,x.check_out,x.arrival,x.departure,x.actor) then raise exception 'clock_change_conflict'; end if;
  return jsonb_build_object('state','existing','id',old.id); end if;
 if b.id is null or public.helm_channex_new_stay_read(b.id) is null
 or (b.check_in,b.check_out) is distinct from (x.check_in,x.check_out)
 or (x.arrival is not null and x.arrival !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
 or (x.departure is not null and x.departure !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'clock_change_unavailable'; end if;
 select h.id into previous from helm_channex_messages.new_stay_clock_exceptions h where h.booking_id=b.id
  and not exists(select 1 from helm_channex_messages.new_stay_clock_exceptions n where n.replaces=h.id);
 if previous is distinct from x.replaces then raise exception 'clock_change_stale'; end if;
 -- A queued/attempted/sent workflow needs explicit schedule reconciliation. This
 -- first writer never retimes or releases it, and never pretends a sent code can
 -- be recalled. A subsequent batch supplies that reviewed reconciliation path.
 if exists(select 1 from public.automation_sends where booking_id=b.id) then raise exception 'clock_schedule_reconciliation_required'; end if;
 insert into helm_channex_messages.new_stay_clock_exceptions(id,booking_id,replaces,check_in,check_out,arrival,departure,actor)
 values(x.id,x.booking_id,x.replaces,x.check_in,x.check_out,x.arrival,x.departure,x.actor);
 return jsonb_build_object('state','created','id',x.id);
end$$;
revoke all on function helm_channex_messages.new_stay_epoch_ready(uuid),helm_channex_messages.new_stay_candidate(uuid,uuid)
 from public,anon,authenticated,service_role;
revoke all on function public.helm_channex_new_stays_admit(),public.helm_channex_new_stay_read(uuid),public.helm_channex_new_stay_clock_save(jsonb,text)
 from public,anon,authenticated;
grant execute on function public.helm_channex_new_stays_admit(),public.helm_channex_new_stay_read(uuid),public.helm_channex_new_stay_clock_save(jsonb,text) to service_role;
commit;
