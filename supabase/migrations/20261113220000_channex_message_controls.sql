-- Owner controls for existing schedules only. Installs no schedules, releases,
-- holds or source evidence, and changes no sender configuration.
begin;
set local lock_timeout='5s';
create function public.helm_channex_message_control_read(p_send_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' set timezone='UTC' as $$
declare s public.automation_sends; b public.bookings; p public.properties;
 j helm_channex_messages.jobs; c helm_channex_messages.cleaner_jobs;
 lane text; held boolean; prepared boolean; expiry timestamptz; revision text; token text; resumable boolean;
begin
 select * into s from public.automation_sends where id=p_send_id and property_id='65_calderwood';
 if not found then return null; end if;
 select * into b from public.bookings where id=s.booking_id and property_id='65_calderwood';
 if not found then return null; end if;
 select * into p from public.properties where id='65_calderwood';
 select * into j from helm_channex_messages.jobs where send_id=p_send_id and booking_id=b.id;
 select * into c from helm_channex_messages.cleaner_jobs where send_id=p_send_id and booking_id=b.id;
 -- Never choose between ambiguous ledgers or expose an unrelated generic job.
 if (j.send_id is null)=(c.send_id is null) then return null; end if;
 revision:=helm_channex_messages.context(s.id);
 if j.send_id is not null then
  lane:='guest'; held:=j.held; prepared:=j.state='prepared'; expiry:=j.expires_at;
  token:=md5(jsonb_build_array(j.send_id,j.version,j.state,j.held,j.attempt_id,j.fire_at,j.expires_at,s.status,b.status,b.duplicate_of,
   b.check_in,b.check_out,s.planned_check_in,s.planned_check_out,revision)::text);
  resumable:=revision=j.context_revision and exists(select 1 from helm_channex_messages.scope where property_id=p.id and enabled);
 else
  lane:='cleaner'; held:=c.held; prepared:=c.state='prepared'; expiry:=c.expires_at;
  token:=md5(jsonb_build_array(c.send_id,c.state,c.held,c.attempt_id,c.fire_at,c.expires_at,
   (select coalesce(max(id),0) from helm_channex_messages.cleaner_hold_events where send_id=c.send_id),
   s.status,b.status,b.duplicate_of,b.check_in,b.check_out,s.planned_check_in,s.planned_check_out,revision)::text);
  resumable:=revision=c.context_revision and helm_channex_messages.cleaner_ready(c.release_id,b.id,c.automation_id,c.binding_id,c.context_revision);
 end if;
 return jsonb_build_object('sendId',s.id,'bookingId',b.id,'lane',lane,'held',held,'token',token,
  'expiresAt',to_char(expiry,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'canHold',prepared and s.status='scheduled' and not held,
  'canResume',coalesce(prepared and held and s.status='scheduled' and b.status='confirmed' and b.duplicate_of is null
   and b.check_in=s.planned_check_in and b.check_out=s.planned_check_out and expiry>statement_timestamp()
   and p.calendar_authority='helm' and p.automations_enabled and p.is_active and resumable,false));
end$$;

create function public.helm_channex_message_control(p_send_id uuid,p_expected text,p_hold boolean,p_actor text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare v jsonb; bid uuid; version bigint; changed boolean;
begin
 if current_setting('transaction_isolation')<>'read committed' or p_hold is null
  or p_expected is null or p_expected !~ '^[a-f0-9]{32}$'
  or p_actor is null or length(btrim(p_actor)) not between 1 and 200 then
  return jsonb_build_object('state','conflict','control',null); end if;
 select booking_id into bid from public.automation_sends where id=p_send_id and property_id='65_calderwood';
 if not found then return jsonb_build_object('state','unavailable','control',null); end if;
 -- Same booking -> send -> job order as claim and cancellation. A successful
 -- hold wins before claim, or loses visibly if dispatch already claimed it.
 perform 1 from public.bookings where id=bid for update;
 perform 1 from public.automation_sends where id=p_send_id for update;
 perform 1 from helm_channex_messages.jobs where send_id=p_send_id for update;
 perform 1 from helm_channex_messages.cleaner_jobs where send_id=p_send_id for update;
 v:=public.helm_channex_message_control_read(p_send_id);
 if v is null then return jsonb_build_object('state','unavailable','control',null); end if;
 if v->>'token'<>p_expected or not (v->>(case when p_hold then 'canHold' else 'canResume' end))::boolean then
  return jsonb_build_object('state','conflict','control',v); end if;
 if v->>'lane'='guest' then
  select j.version into version from helm_channex_messages.jobs j where send_id=p_send_id;
  changed:=public.helm_channex_message_set_hold(p_send_id,version,p_hold,p_actor);
 else
  changed:=public.helm_channex_cleaner_hold(p_send_id,p_hold,p_actor);
 end if;
 return jsonb_build_object('state',case when changed then 'changed' else 'conflict' end,
  'control',public.helm_channex_message_control_read(p_send_id));
end$$;
revoke all on function public.helm_channex_message_control_read(uuid),public.helm_channex_message_control(uuid,text,boolean,text)
 from public,anon,authenticated;
grant execute on function public.helm_channex_message_control_read(uuid),public.helm_channex_message_control(uuid,text,boolean,text) to service_role;
commit;
