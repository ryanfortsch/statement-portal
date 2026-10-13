// Local SQL rehearsal only: synthetic tables, no credentials or external IO.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isAbsolute } from 'node:path';
assert.ok(process.argv[2] && isAbsolute(process.argv[2]));
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
create table bookings(id uuid primary key, property_id text, status text, duplicate_of uuid, check_in date, check_out date);
create table automation_sends(id uuid primary key, booking_id uuid, property_id text, status text,
 updated_at timestamptz, fire_at timestamptz, planned_check_in date, planned_check_out date);
insert into bookings values('00000000-0000-0000-0000-000000000001','home','confirmed',null,'2027-01-01','2027-01-04');
insert into automation_sends values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',
'home','scheduled','2026-10-08T12:00:00Z','2027-01-01T20:00:00Z','2027-01-01','2027-01-04');`);
await db.exec(readFileSync(new URL('../docs/guesty-exit/staging-storage/automation-holds.sql', import.meta.url), 'utf8'));
const read = async () => (await db.query('select status, updated_at::text as version, fire_at::text as fire from automation_sends')).rows[0];
const change = async (hold, version, property = 'home') => {
 await db.exec('set role service_role');
 try {
  return (await db.query(`select public.automation_set_hold('00000000-0000-0000-0000-000000000002',$1,'operator',$2,$3) as ok`,
   [property, hold, version])).rows[0].ok;
 } finally { await db.exec('reset role'); }
};
const start = await read();
assert.equal(await change(true, start.version, 'other-home'), false);
assert.equal(await change(true, start.version), true);
assert.equal(await change(false, start.version), false, 'stale request must not release newer hold');
const held = await read();
assert.equal(held.status, 'held');
const claims = await db.query("update automation_sends set status='sending' where status='scheduled' returning id");
assert.equal(claims.rows.length, 0, 'worker cannot claim held message');
await db.exec("update bookings set check_in='2027-01-02'");
assert.equal(await change(false, held.version), false, 'moved stay needs review');
await db.exec("update bookings set check_in='2027-01-01',status='cancelled'");
assert.equal(await change(false, held.version), false, 'cancelled stay cannot release');
await db.exec("update bookings set status='confirmed'");
assert.equal(await change(false, held.version), true);
const released = await read();
assert.equal(released.status, 'scheduled');
assert.equal(released.fire, start.fire, 'release must not advance a future message');
assert.equal(await change(false, held.version), false);
await db.exec("update automation_sends set status='sending'");
assert.equal(await change(true, released.version), false, 'in-flight send cannot be recalled');
assert.equal((await db.query('select count(*)::int as n from automation_hold_events')).rows[0].n, 2);
const privileges = (await db.query(`select has_function_privilege('anon','public.automation_set_hold(uuid,text,text,boolean,timestamptz)','execute') as anon,
has_function_privilege('authenticated','public.automation_set_hold(uuid,text,text,boolean,timestamptz)','execute') as auth,
has_table_privilege('service_role','automation_hold_events','insert') as insert_allowed`)).rows[0];
assert.deepEqual(privileges, { anon: false, auth: false, insert_allowed: false });
await db.close();
console.log('PASS: hold/release CAS, worker exclusion, moved/cancelled rejection, audit and roles');
