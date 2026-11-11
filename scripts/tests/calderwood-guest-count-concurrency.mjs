// Only the disposable database created by calderwood-guest-count-save.sql.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';

const args = ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'];
const sql = query => spawnSync('psql', [...args, '-c', query], { encoding: 'utf8' });
assert.equal(sql('select current_database()').stdout.trim(), 'helm_synthetic_cleaner_counts');
const plan = sql(`select jsonb_build_array(jsonb_build_object(
  'booking_id','00000000-0000-4000-8000-000000000001','guesty_reservation_id','aaaaaaaaaaaaaaaaaaaaaaaa',
  'confirmation_code','SYNTHETIC-A','check_in',current_date+10,'check_out',current_date+14,
  'source','ical_import','status','confirmed','last_seen_at','2030-01-01T12:00:00Z','num_guests',5))`).stdout.trim();
const save = `select helm_save_calderwood_guest_counts('${plan}'::jsonb,clock_timestamp(),'owner@synthetic.test');`;

for (const mode of ['count-edit', 'authority-change', 'duplicate-save']) {
  assert.equal(sql(`truncate booking_events; update bookings set num_guests=null;
    update properties set calendar_authority='guesty';`).status, 0);
  const mutation = mode === 'count-edit' ? 'update bookings set num_guests=9;'
    : mode === 'authority-change' ? "update properties set calendar_authority='helm' where id='65_calderwood';" : save;
  const first = spawn('psql', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  first.stderr.on('data', data => { err += data; });
  const finished = new Promise((resolve, reject) => { first.once('error', reject); first.once('close', resolve); });
  const locked = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Synthetic lock not acquired')), 5000);
    first.stdout.on('data', data => { out += data; if (out.includes('LOCKED')) { clearTimeout(timer); resolve(); } });
  });
  first.stdin.end(`begin; ${mutation}\n\\echo LOCKED\nselect pg_sleep(1); commit;`);
  await locked;
  const second = sql(save);
  assert.equal(await finished, 0, err);
  assert.notEqual(second.status, 0, 'concurrent stale writer must fail');
  assert.match(second.stderr, /cleaner_count_booking_changed|cleaner_count_source_changed/);
  const actual = sql('select num_guests from bookings; select count(*) from booking_events;').stdout.trim();
  assert.equal(actual, mode === 'count-edit' ? '9\n0' : mode === 'duplicate-save' ? '5\n1' : '0');
}
console.log('Concurrent count edit, authority change and duplicate save preserved the winning transaction.');
