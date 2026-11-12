-- Preserve the installed frozen source bundle separately from future active rules.
-- This migration creates no capture, releases no rule and schedules/sends nothing.
begin;
set local lock_timeout='5s';
create table helm_channex_messages.template_captures (
 id uuid primary key default gen_random_uuid(),
 property_id text not null unique references public.properties(id) check(property_id='65_calderwood'),
 format integer not null default 1 check(format=1),
 captured_at timestamptz not null default clock_timestamp() check(isfinite(captured_at)),
 actor text not null check(length(btrim(actor)) between 1 and 200),
 rules jsonb not null check(jsonb_typeof(rules)='array' and jsonb_array_length(rules)=6 and length(rules::text)<=140000),
 rules_sha256 text not null check(rules_sha256=encode(sha256(convert_to(rules::text,'UTF8')),'hex'))
);
alter table helm_channex_messages.template_captures enable row level security;
revoke all on helm_channex_messages.template_captures from public,anon,authenticated,service_role;
create function helm_channex_messages.template_capture_immutable() returns trigger
language plpgsql set search_path='' as $$begin raise exception 'template_capture_immutable'; end$$;
create trigger channex_template_capture_immutable before update or delete on helm_channex_messages.template_captures
 for each row execute function helm_channex_messages.template_capture_immutable();

-- Snapshot real immutable rows; never reconstruct an original from released flags.
-- Exact retries reuse the same capture; disagreement requires review, not replacement.
create function public.helm_channex_capture_templates(p_actor text) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare bundle jsonb; previous helm_channex_messages.template_captures; capture_id uuid; digest text;
begin
 if p_actor is null or length(btrim(p_actor)) not between 1 and 200 then raise exception 'invalid_template_capture'; end if;
 perform 1 from public.properties where id='65_calderwood' and calendar_authority='guesty'
  and automations_enabled=false for update;
 if not found then raise exception 'template_capture_not_dormant'; end if;
 if exists(select 1 from helm_channex_messages.scope where property_id='65_calderwood')
  or exists(select 1 from public.automation_sends where property_id='65_calderwood')
 then raise exception 'template_capture_not_dormant'; end if;
 perform 1 from public.message_automations where property_id='65_calderwood' order by id for share;
 if (select count(*) from public.message_automations where property_id='65_calderwood')<>6
  or exists(select 1 from public.message_automations r where r.property_id='65_calderwood'
   and not helm_channex_messages.prepared_template_valid(r))
 then raise exception 'template_capture_invalid_rules'; end if;
 select jsonb_agg(to_jsonb(r)-array['created_at','updated_at','created_by'] order by r.id)
 into bundle from public.message_automations r where r.property_id='65_calderwood';
 digest:=encode(sha256(convert_to(bundle::text,'UTF8')),'hex');
 select * into previous from helm_channex_messages.template_captures where property_id='65_calderwood';
 if found then
  if previous.rules is distinct from bundle then raise exception 'template_capture_conflict'; end if;
  return jsonb_build_object('captureId',previous.id,'rulesSha256',previous.rules_sha256,'count',6,'reused',true);
 end if;
 insert into helm_channex_messages.template_captures(property_id,actor,rules,rules_sha256)
 values('65_calderwood',btrim(p_actor),bundle,digest) returning id into capture_id;
 return jsonb_build_object('captureId',capture_id,'rulesSha256',digest,'count',6,'reused',false);
end$$;

-- Private server input only: the renderer needs bodies, but no browser endpoint
-- exposes this RPC. Require the reviewed identity and digest; never pick "latest".
create function public.helm_channex_read_template_capture(p_capture_id uuid,p_rules_sha256 text) returns jsonb
language sql stable security definer set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('format',format,'captureId',id,'propertyId',property_id,
  'capturedAt',captured_at,'rulesSha256',rules_sha256,'rules',rules)
 from helm_channex_messages.template_captures
 where id=p_capture_id and rules_sha256=p_rules_sha256;
$$;
revoke all on function helm_channex_messages.template_capture_immutable() from public,anon,authenticated,service_role;
revoke all on function public.helm_channex_capture_templates(text),public.helm_channex_read_template_capture(uuid,text)
 from public,anon,authenticated;
grant execute on function public.helm_channex_capture_templates(text),public.helm_channex_read_template_capture(uuid,text)
 to service_role;
commit;
