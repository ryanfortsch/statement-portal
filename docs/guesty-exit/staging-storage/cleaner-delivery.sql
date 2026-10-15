-- ISOLATED STAGING ONLY: jgkblfozftcvymvwhhii. Fixed fictional fixture, no sender.
-- The trusted TS adapter replays the complete reducer before every append.
-- SQL enforces append-only history, identity and transactional compare-and-swap.
begin;
create schema if not exists helm_cleaner_rehearsal;
revoke all on schema helm_cleaner_rehearsal from public, anon, authenticated, service_role;
create table if not exists helm_cleaner_rehearsal.delivery (
 id integer primary key check (id = 1),
 version integer not null check (version between 0 and 10000),
 history jsonb not null,
 check ((history->>'version')::integer = version),
 check (jsonb_array_length(history->'records') = version)
);
alter table helm_cleaner_rehearsal.delivery enable row level security;
revoke all on helm_cleaner_rehearsal.delivery from public, anon, authenticated, service_role;
insert into helm_cleaner_rehearsal.delivery values (1,0,
 '{"format":1,"mode":"cleaner-delivery-synthetic","version":0,"messageId":"HELMTEST-cleaner-message","recipientIds":["HELMTEST-cleaner-a","HELMTEST-cleaner-b"],"records":[]}'::jsonb)
on conflict (id) do nothing;
create or replace function public.helm_pilot_cleaner_delivery_read()
returns jsonb language sql stable security definer set search_path='' as $$
 select history from helm_cleaner_rehearsal.delivery where id=1;
$$;
create or replace function public.helm_pilot_cleaner_delivery_append(expected_version integer,next_history jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare current_row helm_cleaner_rehearsal.delivery; added jsonb; event jsonb;
begin
 select * into current_row from helm_cleaner_rehearsal.delivery where id=1 for update;
 if not found or expected_version is null or current_row.version<>expected_version then return false; end if;
 if expected_version<0 or expected_version>=10000 then raise exception 'Invalid version'; end if;
 if jsonb_typeof(next_history) is distinct from 'object'
 or (next_history - 'version' - 'records') is distinct from (current_row.history - 'version' - 'records')
 or next_history->'version' is distinct from to_jsonb(expected_version+1)
 or jsonb_typeof(next_history->'records') is distinct from 'array'
 then raise exception 'Invalid history'; end if;
 if jsonb_array_length(next_history->'records')<>expected_version+1
 or ((next_history->'records') - expected_version) is distinct from (current_row.history->'records')
 then raise exception 'History must append exactly one event'; end if;
 added := next_history->'records'->expected_version; event := added->'event';
 if jsonb_typeof(added) is distinct from 'object' or (added - 'id' - 'event') <> '{}'::jsonb
 or jsonb_typeof(added->'id') is distinct from 'string' or length(btrim(added->>'id')) not between 1 and 200
 or jsonb_typeof(event) is distinct from 'object'
 or exists(select 1 from jsonb_array_elements(current_row.history->'records') r where r->>'id'=added->>'id')
 then raise exception 'Invalid event identity'; end if;
 if jsonb_typeof(event->'attemptId') is distinct from 'string' or length(btrim(event->>'attemptId')) not between 1 and 200
 or event->>'recipientId' is null or not (current_row.history->'recipientIds' ? (event->>'recipientId'))
 then raise exception 'Invalid event recipient or attempt'; end if;
 if event->>'type'='start' then
   if (event - 'type' - 'recipientId' - 'attemptId') <> '{}'::jsonb then raise exception 'Unexpected start fields'; end if;
 elsif event->>'type'='result' then
   if (event - 'type' - 'recipientId' - 'attemptId' - 'state' - 'providerId') <> '{}'::jsonb
   or event->>'state' is null or event->>'state' not in ('accepted','delivered','unknown','rejected')
   or (event ? 'providerId' and (jsonb_typeof(event->'providerId') is distinct from 'string' or length(btrim(event->>'providerId')) not between 1 and 200))
   then raise exception 'Invalid result fields'; end if;
 else raise exception 'Invalid event type'; end if;
 update helm_cleaner_rehearsal.delivery set history=next_history,version=expected_version+1 where id=1;
 return true;
end; $$;
revoke all on function public.helm_pilot_cleaner_delivery_read() from public, anon, authenticated;
revoke all on function public.helm_pilot_cleaner_delivery_append(integer,jsonb) from public, anon, authenticated;
grant execute on function public.helm_pilot_cleaner_delivery_read() to service_role;
grant execute on function public.helm_pilot_cleaner_delivery_append(integer,jsonb) to service_role;
commit;
