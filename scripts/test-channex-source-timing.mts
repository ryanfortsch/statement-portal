/** Real Postgres; synthetic loopback only. No .env loading or provider requests. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
if (process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'helm_synthetic_channex') throw Error('Synthetic loopback database required');
const psql = process.env.CHANNEX_TEST_PSQL || 'psql';
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
function sql(query: string) {
  const r = spawnSync(psql, ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
  if (r.status) throw Error(r.stderr); return r.stdout.trim();
}
assert.equal(sql('select current_database();'), 'helm_synthetic_channex');
// Mirror table is absent from the minimal Channex fixture. All values below are synthetic.
sql(`create table if not exists public.guesty_reservations(guesty_reservation_id text primary key,
 property_id text,listing_id text,status text,channel text,confirmation_code text,check_in date,check_out date);`);
const migration = read('supabase/migrations/20261111210000_channex_source_timing_capture.sql');
sql(migration); sql(migration);
sql(read('scripts/tests/channex-source-timing.sql'));
// Real concurrent cancellation: capture waits for the outstanding canonical
// write and then refuses the cancelled stay, without retaining partial evidence.
sql('select channex_synthetic_timing_setup();');
const writer = spawn(psql, ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], {
  env: { ...process.env, PGAPPNAME: 'channex_timing_cancel' }, stdio: ['pipe', 'pipe', 'pipe'],
});
const done = new Promise<void>((resolve, reject) => {
  let errors = ''; writer.stderr.on('data', s => { errors += s; });
  writer.on('error', reject); writer.on('exit', code => code ? reject(Error(errors)) : resolve());
});
writer.stdin.end(`begin; set local statement_timeout='12s';
 update public.bookings set status='cancelled' where id='90000000-0000-4000-8000-000000000901';
 select pg_sleep(2); commit;`);
let waiting = false;
for (let i = 0; i < 60; i++) {
  waiting = sql("select count(*) from pg_stat_activity where application_name='channex_timing_cancel' and wait_event='PgSleep'") === '1';
  if (waiting) break;
  await new Promise(resolve => setTimeout(resolve, 25));
}
assert.ok(waiting, 'cancellation must hold its lock before capture');
sql(`set statement_timeout='12s'; select channex_synthetic_timing_reject(channex_synthetic_timing_plan());`);
await done;
assert.equal(sql('select count(*) from helm_channex_messages.source_timing_captures;'), '0');
assert.equal(sql('select count(*) from automation_sends;'), '0');
sql(`select channex_synthetic_timing_setup();
 delete from public.bookings where id='90000000-0000-4000-8000-000000000901';
 delete from public.guesty_reservations;`);
console.log('PASS: source timing capture privacy, role boundaries, complete-batch validation, stale/missing source refusal, atomicity, and concurrent cancellation; no schedules or messages');
