// Build a staging-only fixture around the actual reviewed hold RPC.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function holdRehearsalSql() {
 const rpc = readFileSync(new URL('../docs/guesty-exit/staging-storage/automation-holds.sql', import.meta.url), 'utf8')
  .replace(/^begin;$/m, '').replace(/^commit;$/m, '').replaceAll('public.', 'helm_hold_rehearsal.');
 return `begin;
create schema if not exists helm_hold_rehearsal;
revoke all on schema helm_hold_rehearsal from public, anon, authenticated, service_role;
create table if not exists helm_hold_rehearsal.bookings (
 id uuid primary key, property_id text not null check(property_id='synthetic-home'),
 status text not null, duplicate_of uuid, check_in date not null, check_out date not null
);
create table if not exists helm_hold_rehearsal.automation_sends (
 id uuid primary key, booking_id uuid not null references helm_hold_rehearsal.bookings(id),
 property_id text not null check(property_id='synthetic-home'), status text not null,
 updated_at timestamptz not null, fire_at timestamptz not null,
 planned_check_in date not null, planned_check_out date not null
);
alter table helm_hold_rehearsal.bookings enable row level security;
alter table helm_hold_rehearsal.automation_sends enable row level security;
revoke all on all tables in schema helm_hold_rehearsal from public,anon,authenticated,service_role;
${rpc}
insert into helm_hold_rehearsal.bookings values
 ('00000000-0000-0000-0000-000000000001','synthetic-home','confirmed',null,'2027-01-01','2027-01-04') on conflict do nothing;
insert into helm_hold_rehearsal.automation_sends values
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','synthetic-home','held',clock_timestamp(),'2027-01-01T20:00:00Z','2027-01-01','2027-01-04') on conflict do nothing;
create or replace function public.helm_pilot_hold_read() returns jsonb
 language sql security definer set search_path='' as $$
 select jsonb_build_object('status',s.status,'updatedAt',s.updated_at::text,'fireAt',s.fire_at::text,
 'events', (select coalesce(jsonb_agg(e order by e.id desc),'[]'::jsonb) from
 (select id,action,happened_at from helm_hold_rehearsal.automation_hold_events order by id desc limit 20) e))
 from helm_hold_rehearsal.automation_sends s where s.id='00000000-0000-0000-0000-000000000002';
$$;
create or replace function public.helm_pilot_hold_change(p_hold boolean,p_expected_updated_at timestamptz,p_actor text)
 returns boolean language sql security definer set search_path='' as $$
 select helm_hold_rehearsal.automation_set_hold('00000000-0000-0000-0000-000000000002','synthetic-home',p_actor,p_hold,p_expected_updated_at);
$$;
revoke all on function public.helm_pilot_hold_read() from public,anon,authenticated;
revoke all on function public.helm_pilot_hold_change(boolean,timestamptz,text) from public,anon,authenticated;
grant execute on function public.helm_pilot_hold_read() to service_role;
grant execute on function public.helm_pilot_hold_change(boolean,timestamptz,text) to service_role;
commit;`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.stdout.write(holdRehearsalSql());
