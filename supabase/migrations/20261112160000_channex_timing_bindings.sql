-- Retained timing review only. No scope activation, template release, jobs or sends.
begin;
set local lock_timeout='5s';
create table helm_channex_messages.timing_bindings (
 id uuid primary key,
 capture_id uuid not null references helm_channex_messages.source_timing_captures(id),
 booking_id uuid not null references public.bookings(id),
 intent jsonb not null,
 actor text not null,
 reviewed_at timestamptz not null default clock_timestamp()
);
alter table helm_channex_messages.timing_bindings enable row level security;
revoke all on helm_channex_messages.timing_bindings from public,anon,authenticated,service_role;

-- Read the stored binding verbatim. Never manufacture a binding from today's
-- context. A context/route/identity change makes the existing record unusable.
create function public.helm_channex_timing_binding_read(p_binding_id uuid) returns jsonb
language sql stable security definer set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('bindingId',v.id,'evidence',jsonb_build_object(
  'kind','reviewed_guesty_capture','captureId',c.id,'sourceContract',c.source_contract,
  'checkedAt',to_char(c.checked_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'row',item,
  'binding',(v.intent->'context') || jsonb_build_object(
   'remoteBookingId',v.intent->>'remoteBookingId','threadId',v.intent->>'threadId',
   'reviewedAt',to_char(v.reviewed_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
 from helm_channex_messages.timing_bindings v
 join helm_channex_messages.source_timing_captures c on c.id=v.capture_id
 cross join lateral jsonb_array_elements(c.rows) item
 join public.bookings b on b.id=v.booking_id
 join helm_channex_messages.scope s on s.property_id=b.property_id
 join public.guesty_reservations g on g.guesty_reservation_id=item->>'guestyId'
 join helm_airbnb_bookings.bookings remote on remote.canonical_id=b.id
 where v.id=p_binding_id and item->>'bookingId'=b.id::text
 and v.intent->'reviewedRow'=item
 and public.helm_channex_message_schedule_context(b.id) is not null
 and helm_channex_messages.booking_context(b.id)=v.intent->'context'->>'contextRevision'
 and s.generation=(v.intent->'context'->>'routeGeneration')::uuid
 and s.source_evidence_id=(v.intent->'context'->>'sourceEvidenceId')::uuid
 and s.source_drained_at=(v.intent->'context'->>'sourceEvidenceAt')::timestamptz
 and b.property_id='65_calderwood' and b.channel='airbnb' and b.hold_kind is null
 and b.check_in=(item->>'start')::date and b.check_out=(item->>'end')::date
 and b.check_out>(statement_timestamp() at time zone 'America/New_York')::date
 and b.external_confirmation_code=item->>'code'
 and (select count(*) from public.bookings x where x.property_id=b.property_id
  and x.duplicate_of is null and x.status<>'block'
  and upper(btrim(x.external_confirmation_code))=upper(item->>'code'))=1
 and g.property_id=b.property_id and g.listing_id='66797ba7f51d72001388bc29'
 and g.status='confirmed' and lower(g.channel)='airbnb' and g.confirmation_code=item->>'code'
 and g.check_in=b.check_in and g.check_out=b.check_out
 and (select count(*) from public.guesty_reservations x where x.property_id=b.property_id
  and upper(btrim(x.confirmation_code))=upper(item->>'code'))=1
 and remote.remote_id::text=v.intent->>'remoteBookingId'
 and remote.environment=s.environment and remote.remote_property=s.remote_property
 and remote.code=b.external_confirmation_code and remote.status=b.status
 and remote.check_in=b.check_in and remote.check_out=b.check_out
 and s.source_stopped_at is not null and s.source_stopped_at<=s.source_drained_at
 and s.source_drained_at<=v.reviewed_at and c.checked_at<=v.reviewed_at
 and c.saved_at<=v.reviewed_at;
$$;

-- The trusted review caller must freshly double-read Guesty clocks/identity and
-- verify the Channex booking/thread relation before supplying this intent. SQL
-- checks those assertions against retained/current database evidence; it does not
-- independently contact either provider. No browser or runtime caller ships here.
create function public.helm_channex_timing_binding_review(p_intent jsonb,p_actor text) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' set lock_timeout='5s' as $$
declare
 vid uuid; cid uuid; bid uuid; started timestamptz; checked timestamptz; stamp timestamptz;
 previous helm_channex_messages.timing_bindings; capture helm_channex_messages.source_timing_captures;
 item jsonb; context jsonb; evidence jsonb; outcome text:='created';
begin
 if jsonb_typeof(p_intent) is distinct from 'object' or length(p_intent::text)>4000
 or (select count(*) from jsonb_object_keys(p_intent))<>9
 or not p_intent ?& array['bindingId','captureId','bookingId','context','remoteBookingId','threadId','reviewStartedAt','reviewCheckedAt','reviewedRow']
 or exists(select 1 from unnest(array['bindingId','captureId','bookingId','remoteBookingId','threadId','reviewStartedAt','reviewCheckedAt']) k
  where jsonb_typeof(p_intent->k) is distinct from 'string')
 or p_actor is null or length(btrim(p_actor)) not between 3 and 320
 then raise exception 'timing_binding_invalid'; end if;
 vid:=(p_intent->>'bindingId')::uuid; cid:=(p_intent->>'captureId')::uuid; bid:=(p_intent->>'bookingId')::uuid;
 perform (p_intent->>'remoteBookingId')::uuid; perform (p_intent->>'threadId')::uuid;
 context:=p_intent->'context';
 if jsonb_typeof(context) is distinct from 'object' or (select count(*) from jsonb_object_keys(context))<>4
 or not context ?& array['contextRevision','routeGeneration','sourceEvidenceId','sourceEvidenceAt']
 or exists(select 1 from jsonb_each(context) e where jsonb_typeof(e.value)<>'string')
 or context->>'contextRevision' !~ '^[a-f0-9]{32}$'
 or context->>'sourceEvidenceAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
 or exists(select 1 from unnest(array['reviewStartedAt','reviewCheckedAt']) k
  where p_intent->>k !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$')
 then raise exception 'timing_binding_invalid'; end if;
 perform (context->>'routeGeneration')::uuid; perform (context->>'sourceEvidenceId')::uuid;
 started:=(p_intent->>'reviewStartedAt')::timestamptz; checked:=(p_intent->>'reviewCheckedAt')::timestamptz;

 -- Match dispatch lock order; briefly fence all booking-context dependencies and
 -- source/mapping identities so an explicit review cannot race their updates.
 lock table helm_channex_messages.scope in share mode;
 lock table public.bookings,public.properties,public.message_automations,public.property_rate_plans,
  public.checkout_adjustments,public.property_access,public.guest_access_codes,public.lock_devices,
  public.guests,public.guesty_reservations,helm_airbnb_bookings.bookings in share mode;
 perform 1 from public.bookings where id=bid and property_id='65_calderwood' for update;
 if not found then raise exception 'timing_binding_unavailable'; end if;
 select * into previous from helm_channex_messages.timing_bindings where id=vid;
 if found then
  if previous.intent is distinct from p_intent or previous.actor is distinct from btrim(p_actor)
  then raise exception 'timing_binding_conflict'; end if;
  -- Identical lost-response recovery retains the original review instant.
  outcome:='existing';
 else
  stamp:=clock_timestamp();
  if not isfinite(started) or not isfinite(checked) or started>checked or checked>stamp
  or checked<stamp-interval '60 seconds' or checked-started>interval '80 seconds'
  then raise exception 'timing_binding_review_expired'; end if;
  select * into capture from helm_channex_messages.source_timing_captures where id=cid;
  if not found or capture.checked_at>started or capture.saved_at>started
  then raise exception 'timing_binding_capture_unavailable'; end if;
  select value into item from jsonb_array_elements(capture.rows) where value->>'bookingId'=bid::text;
  if item is null or item is distinct from p_intent->'reviewedRow'
  then raise exception 'timing_binding_capture_changed'; end if;
  insert into helm_channex_messages.timing_bindings(id,capture_id,booking_id,intent,actor)
   values(vid,cid,bid,p_intent,btrim(p_actor));
 end if;
 evidence:=public.helm_channex_timing_binding_read(vid);
 if evidence is null then raise exception 'timing_binding_context_changed'; end if;
 return jsonb_build_object('state',outcome)||evidence;
end$$;
revoke all on function public.helm_channex_timing_binding_read(uuid),public.helm_channex_timing_binding_review(jsonb,text)
 from public,anon,authenticated;
grant execute on function public.helm_channex_timing_binding_read(uuid),public.helm_channex_timing_binding_review(jsonb,text) to service_role;
comment on table helm_channex_messages.timing_bindings is
 'Append-only reviewed association of a retained Guesty timing capture to exact handover/context/route. No live-clock guarantee, activation or message authorization.';
commit;
