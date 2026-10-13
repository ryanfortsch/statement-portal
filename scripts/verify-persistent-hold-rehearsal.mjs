import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { holdRehearsalSql } from './hold-rehearsal-sql.mjs';
const {PGlite} = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role;');
await db.exec(holdRehearsalSql());
const read = async () => (await db.query('select public.helm_pilot_hold_read() as state')).rows[0].state;
const change = async (hold,version) => (await db.query('select public.helm_pilot_hold_change($1,$2,$3) as ok',[hold,version,'test-operator'])).rows[0].ok;
await db.exec('set role service_role');
const before = await read();
assert.equal(before.status,'held');
assert.equal(await change(false,before.updatedAt),true);
assert.equal(await change(false,before.updatedAt),false);
const released = await read();
assert.equal(released.status,'scheduled');
assert.equal(released.events.length,1);
assert.equal(released.fireAt,before.fireAt);
assert.equal(await change(true,released.updatedAt),true);
await db.exec('reset role');
await db.exec(holdRehearsalSql());
assert.equal((await read()).events.length,2,'reapplying setup must preserve history');
const version = (await read()).updatedAt;
await db.exec("update helm_hold_rehearsal.bookings set status='cancelled'");
assert.equal(await change(false,version),false);
await db.exec("update helm_hold_rehearsal.bookings set status='confirmed',check_in='2027-01-02'");
assert.equal(await change(false,version),false);
const perms = (await db.query(`select has_function_privilege('anon','public.helm_pilot_hold_read()','execute') as anon,
 has_function_privilege('authenticated','public.helm_pilot_hold_change(boolean,timestamptz,text)','execute') as auth,
 has_schema_privilege('service_role','helm_hold_rehearsal','usage') as direct_access,
 to_regclass('public.automation_sends') is not null as live_queue`)).rows[0];
assert.deepEqual(perms,{anon:false,auth:false,direct_access:false,live_queue:false});
await db.close();
console.log('PASS: persistent fixture, stale CAS, audit, idempotent setup, cancelled/moved blocking, isolation and privileges');
