-- Canonical, disabled rules with explicit source timing. No planner, ledger,
-- sender, source-stop proof or activation is introduced here.
begin;
set local lock_timeout='5s';
alter table public.message_automations add column migration_policy jsonb;

create function helm_channex_messages.prepared_template_valid(r public.message_automations) returns boolean
language plpgsql immutable set search_path='' as $$
declare p jsonb:=r.migration_policy; timing jsonb; stamp timestamptz;
begin
 timing:=case r.key
  when 'booking_confirmed' then '{"anchor":"confirmed_at","minutes":30}'::jsonb
  when 'pre_arrival' then '{"anchor":"arrival","days":-1,"dayMode":"verify_source_queue"}'::jsonb
  when 'checkin_day' then '{"anchor":"arrival","minutes":-60}'::jsonb
  when 'pre_checkout' then '{"anchor":"departure","days":-1,"dayMode":"verify_source_queue"}'::jsonb
  when 'cleaner_reminder' then '{"anchor":"arrival","days":-10,"dayMode":"verify_source_queue"}'::jsonb
  when 'cleaner_arrival' then '{"anchor":"arrival","minutes":-420}'::jsonb end;
 if p is null or timing is null then return false; end if;
 stamp:=(p->>'capturedAt')::timestamptz;
 return coalesce(r.property_id='65_calderwood' and not r.enabled and r.send_mode='approve'
  and r.configured_in_ota and r.timezone='America/New_York' and r.at_local is null
  and r.offset_days=0 and r.subject is null and r.min_nights is null and r.channel_exclusions='{}'::text[]
  and r.audience=case when r.key like 'cleaner_%' then 'cleaner' else 'guest' end
  and r.delivery=case when r.key like 'cleaner_%' then 'sms' else 'ota_manual' end
  and r.trigger=case when r.key like 'cleaner_%' then 'pre_arrival' else r.key end
  and length(btrim(r.body)) between 1 and 16000 and isfinite(stamp)
  and p->>'capturedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
  and p->>'sourceSha256' ~ '^[a-f0-9]{64}$'
  and p=jsonb_build_object('version',1,'state','prepared','source','guesty',
   'capturedAt',p->>'capturedAt','sourceSha256',p->>'sourceSha256',
   'bodySha256',encode(sha256(convert_to(r.body,'UTF8')),'hex'),
   'fieldMappingVersion',1,'timing',timing),false);
exception when others then return false;
end$$;

-- Prepared rules are immutable through all legacy editors, including old bundles.
-- Releasing them requires a later reviewed migration with the finished sender.
create function helm_channex_messages.prepared_rule_guard() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if tg_op<>'INSERT' and old.migration_policy is not null then
  if tg_op='DELETE' then raise exception 'prepared_template_frozen'; end if;
  if (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at')
   then raise exception 'prepared_template_frozen'; end if;
 end if;
 if tg_op<>'DELETE' and new.migration_policy is not null then
  if not helm_channex_messages.prepared_template_valid(new)
   then raise exception 'invalid_prepared_template'; end if;
  if (new.migration_policy->>'capturedAt')::timestamptz>clock_timestamp()
   then raise exception 'invalid_prepared_template'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end$$;
create trigger channex_prepared_rule_guard before insert or update or delete on public.message_automations
 for each row execute function helm_channex_messages.prepared_rule_guard();

-- Protect against a legacy planner selecting the fleet rule, or an old manual
-- dispatcher trying to resurrect a row. Existing unrelated automations are untouched.
create function helm_channex_messages.prepared_send_guard() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.message_automations r where r.migration_policy is not null
  and (r.id=new.automation_id or (r.property_id=new.property_id and r.key=new.automation_key)))
 then raise exception 'prepared_template_not_dispatchable'; end if;
 return new;
end$$;
create trigger channex_prepared_send_guard before insert or update on public.automation_sends
 for each row execute function helm_channex_messages.prepared_send_guard();

-- Only accepts the complete six-row prepared bundle. A retry returns the existing
-- result if identical; it never replaces a rule, its history, or a changed source.
create function public.helm_channex_prepare_templates(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb; r public.message_automations; existing integer; reused boolean;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<>6
  or length(p_rows::text)>110000 then raise exception 'invalid_template_bundle'; end if;
 perform 1 from public.properties where id='65_calderwood' and calendar_authority='guesty'
  and automations_enabled=false for update;
 if not found then raise exception 'template_preparation_not_dormant'; end if;
 -- Serializes duplicate installers and ordinary rule writes, not merely this RPC.
 lock table public.message_automations in share row exclusive mode;
 lock table public.automation_sends in share row exclusive mode;
 if exists(select 1 from public.automation_sends where property_id='65_calderwood')
  or exists(select 1 from helm_channex_messages.scope where property_id='65_calderwood')
  then raise exception 'template_preparation_not_dormant'; end if;
 if (select count(distinct x->>'key') from jsonb_array_elements(p_rows) x)<>6
  then raise exception 'invalid_template_bundle'; end if;
 select count(*) into existing from public.message_automations where property_id='65_calderwood';
 if existing not in (0,6) then raise exception 'template_conflict'; end if;
 reused:=existing=6;
 for item in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(item) is distinct from 'object'
   or item is distinct from jsonb_build_object('key',item->'key','body',item->'body','migration_policy',item->'migration_policy')
   or jsonb_typeof(item->'key') is distinct from 'string' or jsonb_typeof(item->'body') is distinct from 'string'
   then raise exception 'invalid_template_bundle'; end if;
  r:=null;
  r.key:=item->>'key'; r.body:=item->>'body'; r.migration_policy:=item->'migration_policy';
  r.property_id:='65_calderwood'; r.enabled:=false; r.send_mode:='approve'; r.configured_in_ota:=true;
  r.timezone:='America/New_York'; r.offset_days:=0; r.channel_exclusions:='{}';
  r.audience:=case when r.key like 'cleaner_%' then 'cleaner' else 'guest' end;
  r.delivery:=case when r.audience='cleaner' then 'sms' else 'ota_manual' end;
  r.trigger:=case when r.audience='cleaner' then 'pre_arrival' else r.key end;
  if not helm_channex_messages.prepared_template_valid(r)
   or (r.migration_policy->>'capturedAt')::timestamptz>clock_timestamp()
   then raise exception 'invalid_template_bundle'; end if;
  if reused then
   if not exists(select 1 from public.message_automations a where a.property_id=r.property_id
    and a.key=r.key and a.body=r.body and a.migration_policy=r.migration_policy
    and helm_channex_messages.prepared_template_valid(a)) then raise exception 'template_conflict'; end if;
  else
   insert into public.message_automations(key,property_id,audience,trigger,offset_days,at_local,timezone,
    channel_exclusions,delivery,send_mode,min_nights,subject,body,enabled,configured_in_ota,migration_policy,created_by)
   values(r.key,r.property_id,r.audience,r.trigger,0,null,r.timezone,'{}',r.delivery,'approve',null,null,r.body,
    false,true,r.migration_policy,'channex-template-migration');
  end if;
 end loop;
 return jsonb_build_object('prepared',6,'reused',reused,'enabled',false,'jobsCreated',0);
end$$;
revoke all on function helm_channex_messages.prepared_template_valid(public.message_automations),
 helm_channex_messages.prepared_rule_guard(),helm_channex_messages.prepared_send_guard() from public,anon,authenticated,service_role;
revoke all on function public.helm_channex_prepare_templates(jsonb) from public,anon,authenticated;
grant execute on function public.helm_channex_prepare_templates(jsonb) to service_role;
commit;
