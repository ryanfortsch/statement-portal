// Synthetic, loopback-only PostgreSQL race rehearsal. No app environment or hosted DB.
// Pass an absolute embedded-postgres dist/index.js path; dependency stays outside repo.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
assert.ok(process.argv[2] && isAbsolute(process.argv[2]));
const { default: EmbeddedPostgres } = await import(pathToFileURL(process.argv[2]).href);
const root = mkdtempSync(join(tmpdir(), 'helm-hold-races-'));
const pg = new EmbeddedPostgres({ databaseDir: join(root, 'data'), port: 55439,
 user: 'postgres', password: randomBytes(24).toString('hex'), persistent: true,
 postgresFlags: ['-h', '127.0.0.1', '-k', root], onLog: () => {}, onError: () => {} });
const clients = [];
const connect = async () => {
 const c = pg.getPgClient(); await c.connect(); clients.push(c);
 await c.query("set statement_timeout='8s'; set lock_timeout='6s'"); return c;
};
const booking = '00000000-0000-0000-0000-000000000001';
const send = '00000000-0000-0000-0000-000000000002';
const hold = (c, value, version) => c.query('select public.automation_set_hold($1,$2,$3,$4,$5) as ok',
 [send, 'home', 'test-operator', value, version]);
const claim = c => c.query("update automation_sends set status='sending', updated_at=clock_timestamp() where status='scheduled' and fire_at <= now() returning id");
const cancel = c => c.query('select public.helm_cancel_booking($1,$2,$3)', [booking, 'test cancellation', 'test-operator']);
let running = false;
try {
 await pg.initialise(); await pg.start(); running = true;
 const observer = await connect(), a = await connect(), b = await connect();
 await observer.query(`create role anon; create role authenticated; create role service_role;
 create table bookings(id uuid primary key, property_id text, status text, duplicate_of uuid,
 check_in date, check_out date, cancelled_at timestamptz, cancel_reason text, cancelled_by text, updated_at timestamptz);
 create table automation_sends(id uuid primary key, booking_id uuid, property_id text, status text,
 updated_at timestamptz, fire_at timestamptz, planned_check_in date, planned_check_out date, error text);
 create table booking_events(booking_id uuid, kind text, actor text, before jsonb, after jsonb, note text);`);
 await observer.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/automation-holds.sql', import.meta.url), 'utf8'));
 // Exercise the actual repository cancellation function, not a rewritten approximation.
 const plumbing = readFileSync(new URL('../supabase/migrations/20260926200000_helm_pms_plumbing.sql', import.meta.url), 'utf8');
 const cancelSql = plumbing.match(/create or replace function public\.helm_cancel_booking\([\s\S]*?end \$\$;/)?.[0];
 assert.ok(cancelSql); await observer.query(cancelSql);
 const reset = async status => {
  await observer.query('truncate automation_hold_events, automation_sends, booking_events, bookings');
  await observer.query(`insert into bookings(id,property_id,status,check_in,check_out) values($1,'home','confirmed','2027-01-01','2027-01-04')`, [booking]);
  await observer.query(`insert into automation_sends values($1,$2,'home',$3,'2026-10-08T12:00:00Z','2020-01-01T20:00:00Z','2027-01-01','2027-01-04',null)`, [send, booking, status]);
  return '2026-10-08T12:00:00Z';
 };
 const state = async () => (await observer.query('select status, updated_at::text as version from automation_sends')).rows[0];
 const auditCount = async () => (await observer.query('select count(*)::int as n from automation_hold_events')).rows[0].n;
 const aPid = (await a.query('select pg_backend_pid() as pid')).rows[0].pid;
 const bPid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
 const blocked = async () => {
  for (let i = 0; i < 200; i++) {
   const { rows } = await observer.query('select $1::int = any(pg_blocking_pids($2)) as blocked', [aPid, bPid]);
   if (rows[0].blocked) return;
   await delay(10);
  }
  assert.fail('Second session did not actually block on the first');
 };
 // Execute winner inside a transaction, prove loser is blocked, then release lock.
 const race = async (winner, loser) => {
  await a.query('begin');
  let pending;
  try {
   const won = await winner(); pending = loser(); pending.catch(() => {});
   await blocked(); await a.query('commit'); return [won, await pending];
  } catch (error) {
   await a.query('rollback'); if (pending) await pending.catch(() => {}); throw error;
  }
 };
 let version = await reset('scheduled');
 let results = await race(() => hold(a, true, version), () => claim(b));
 assert.equal(results[0].rows[0].ok, true); assert.equal(results[1].rowCount, 0);
 assert.equal((await state()).status, 'held'); assert.equal(await auditCount(), 1);
 console.log('PASS hold wins: waiting worker cannot claim held message');
 version = await reset('scheduled');
 results = await race(() => claim(a), () => hold(b, true, version));
 assert.equal(results[0].rowCount, 1); assert.equal(results[1].rows[0].ok, false);
 assert.equal((await state()).status, 'sending'); assert.equal(await auditCount(), 0);
 console.log('PASS claim wins: hold cannot recall in-flight message');
 version = await reset('held');
 results = await race(() => hold(a, false, version), () => cancel(b));
 assert.equal(results[0].rows[0].ok, true); assert.equal((await state()).status, 'cancelled');
 assert.equal(await auditCount(), 1);
 console.log('PASS release wins first: waiting cancellation still cancels scheduled message');
 version = await reset('held');
 results = await race(() => cancel(a), () => hold(b, false, version));
 assert.equal(results[1].rows[0].ok, false); assert.equal((await state()).status, 'held');
 assert.equal(await auditCount(), 0);
 console.log('PASS cancellation wins: release rejected; existing lifecycle leaves message held');
 version = await reset('held');
 results = await race(() => hold(a, false, version), () => hold(b, false, version));
 assert.equal(results[0].rows[0].ok, true); assert.equal(results[1].rows[0].ok, false);
 assert.equal(await auditCount(), 1);
 console.log('PASS duplicate releases: one succeeds, one audit event');
 version = await reset('scheduled');
 await a.query('begin'); await hold(a, true, version); await a.query('rollback');
 assert.equal((await state()).status, 'scheduled'); assert.equal(await auditCount(), 0);
 await hold(a, true, version);
 const beforeRestart = await state();
 await Promise.all(clients.splice(0).map(c => c.end()));
 await pg.stop(); running = false; await pg.start(); running = true;
 const restarted = await connect();
 const afterRestart = (await restarted.query('select status, updated_at::text as version from automation_sends')).rows[0];
 assert.deepEqual(afterRestart, beforeRestart);
 assert.equal((await claim(restarted)).rowCount, 0);
 assert.equal((await restarted.query('select count(*)::int as n from automation_hold_events')).rows[0].n, 1);
 console.log('PASS rollback is atomic; committed hold and audit survive database restart');
} finally {
 await Promise.all(clients.map(c => c.end().catch(() => {})));
 if (running) await pg.stop();
}
