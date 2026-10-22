// Read-only SQL artifact from the actual application's column contracts.
// No credentials, environment loading or database connection. Run separately
// after calendar-app.sql, against the isolated project only.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function calendarAppQueries() {
  const cols = (file, name) => {
    const source = readFileSync(new URL('../src/lib/' + file, import.meta.url), 'utf8');
    const match = source.match(new RegExp(`export const ${name} =\\s*'([^']+)'`));
    assert.ok(match, `Missing application column contract: ${name}`);
    assert.match(match[1], /^[a-z_, ]+$/);
    return match[1];
  };
  return [
    ['fleet', `select ${cols('fleet.ts', 'FLEET_COLS')} from public.properties where is_active and kind='managed' order by id limit 2`],
    ['calendar bookings', "select * from public.bookings where property_id='HELMTEST-calderwood' and duplicate_of is null and status<>'cancelled' order by check_in,id limit 1"],
    ['mirror bookings', `select ${cols('helm-calendar-mirror.ts', 'MIRROR_BOOKING_COLS')} from public.bookings limit 0`],
    ['house policy', `select ${cols('house-policy.ts', 'HOUSE_POLICY_COLS')} from public.properties limit 0`],
    ['rate plan', `select ${cols('property-rates.ts', 'RATE_PLAN_COLS')} from public.property_rate_plans limit 0`],
    ['rate days', `select ${cols('property-rates.ts', 'RATE_DAY_COLS')} from public.property_rate_days limit 0`],
    ['rental seasons', 'select property_id,start_month,start_day,end_month,end_day,note from public.property_rental_periods limit 0'],
    ['tax configuration', 'select * from public.property_tax_config limit 0'],
    ['channel listings', 'select * from public.channel_listings limit 0'],
    ['feed pull history', 'select property_id,channel_guess,pulled_at,user_agent,requested_for,ua_guess from public.ical_export_pulls limit 0'],
    ['calendar days', 'select * from public.property_calendar_days limit 0'],
    ['calendar blocks', 'select * from public.property_calendar_blocks limit 0'],
    ['booking events', 'select id,booking_id,kind,actor,at,before,after,note from public.booking_events limit 0'],
    ['message history', 'select * from public.automation_sends limit 0'],
  ];
}

export function buildCalendarAppPreflight() {
  return `-- Isolated calendar database preflight only; not a browser or provider acceptance.
begin read only;
do $$ begin
  if not exists(select 1 from helm_pilot_installation.manifest where project_ref='jgkblfozftcvymvwhhii')
    or exists(select 1 from public.properties where id<>'HELMTEST-calderwood') then
    raise exception 'Isolated fictional database required'; end if;
end $$;
set local role service_role;
` + calendarAppQueries().map(([label, sql]) => `-- ${label}\n${sql};`).join('\n') + '\nrollback;\n';
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw Error('Usage: node scripts/calendar-app-preflight.mjs /absolute/output.sql');
  writeFileSync(process.argv[2], buildCalendarAppPreflight(), { mode: 0o600 });
  console.log('Saved read-only calendar schema preflight. No database connection made.');
}
