import { shiftIsoDay, todayInEastern } from '../src/lib/sca-quotes-types.ts';
import { consumeBookingInventory } from '../src/lib/channex-staging/booking-inventory-consumer.ts';
import { verifyBookingInventoryArchive } from './verify-booking-inventory-archive.mjs';
import { verifyBookingInventoryCapacity } from './verify-booking-inventory-capacity.mjs';
import { verifyCanonicalSourceDatabase } from './verify-canonical-source.mjs';
import { verifyBookingInventoryRefresh } from './verify-booking-inventory-refresh.mjs';
import { verifyBookingInventoryWindow } from './verify-booking-inventory-window.mjs';
import { verifyCanonicalRevisions } from './verify-canonical-revisions.mjs';
// Local PostgreSQL integration checks, no network or hosted database access.
// Pass the installed @electric-sql/pglite/dist/index.js path as the sole argument.
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { installBookingInventoryFixture } from './booking-inventory-fixture.mjs';
import { verifyBookingInventorySchema } from './verify-booking-inventory-schema.mjs';
import { verifyAvailabilityInputCapture } from './verify-availability-input-capture.mjs';
import { verifyBookingInventoryConsumer } from './verify-booking-inventory-consumer.mjs';
if (!process.argv[2]) throw new Error('Pass the absolute PGlite module path');
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const dataDir = mkdtempSync(join(tmpdir(), 'helm-inventory-capture-'));
let db = new PGlite(dataDir);
try {
  const { capture } = await installBookingInventoryFixture(db);
  let passed = 0;
  async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
  async function query(sql, args = []) { return (await db.query(sql, args)).rows; }
  async function version(p = 'home') { return Number((await query('select version from helm_inventory_capture_scopes where property_id=$1', [p]))[0].version); }
  async function events(p = 'home') { return query('select * from helm_booking_inventory_events where property_id=$1 order by version', [p]); }
  async function booking(id) { return (await query('select * from bookings where id=$1', [id]))[0]; }
  async function create(p = 'home', status = 'block', from = '2027-01-10', to = '2027-01-12') {
    return (await query("select * from helm_create_booking($1,'manual','manual',$2,$3,$4,$5,'fixture',false)",
      [p, status, from, to, { hold_kind: 'owner', guest_name: 'Fictional Test', guest_email: 'example@example.invalid' }]))[0];
  }
  async function move(id, from, to, status = 'block') {
    return (await query("select * from helm_move_booking($1,$2,$3,$4,'fixture',false)", [id, from, to, status]))[0];
  }
  async function cancel(id) { return query("select * from helm_cancel_booking($1,'fixture','fixture')", [id]); }
  await db.exec("insert into properties(id,name,address,city,owner_last,owner_full,owner_greeting,management_fee_pct) select id,'Fictional home','Fictional address','Fictional city','Fixture','Fixture','Fixture',0 from (values('home'),('other'),('unscoped'),('broken')) as fixtures(id); insert into helm_inventory_capture_scopes(property_id) values ('home'),('other'),('broken');");
  let hold;
  await check('disabled and missing scopes preserve ordinary booking writes', async () => {
    hold = await create(); await create('unscoped');
    assert.equal(await version(), 0); assert.equal((await events()).length, 0);
  });
  await check('enable captures an initial full-property checkpoint', async () => {
    await db.exec("update helm_inventory_capture_scopes set enabled=true where property_id='home'");
    assert.equal(await version(), 1);
    assert.equal((await events())[0].reason, 'capture_enabled');
    assert.equal((await events())[0].booking_id, null);
  });
  await check('scope configuration drains every captured source until commit', async () => {
    for (const sql of [
      "update helm_inventory_capture_scopes set enabled=true where property_id='home'",
      "insert into helm_inventory_capture_scopes(property_id) values ('unscoped')"
    ]) {
      await db.exec('begin');
      try {
        await db.exec(sql);
        for (const table of ['bookings','properties','property_rate_plans','property_rate_days','property_rental_periods']) {
          const locks = await query('select mode from pg_locks where relation=$1::regclass and pid=pg_backend_pid() and granted',[`public.${table}`]);
          assert.ok(locks.some(l => l.mode === 'ShareLock'),table);
        }
      } finally { await db.exec('rollback'); }
    }
  });
  await check('ordinary booking capture does not acquire the global configuration lock', async () => {
    await db.exec('begin');
    try {
      await create();
      const locks = await query("select mode from pg_locks where relation='public.bookings'::regclass and pid=pg_backend_pid() and granted");
      assert.ok(locks.some(l => l.mode === 'RowExclusiveLock'));
      assert.ok(!locks.some(l => l.mode === 'ShareLock'));
    } finally { await db.exec('rollback'); }
  });
  await check('canonical create RPC commits booking, audit and event as service role', async () => {
    await db.exec('set role service_role'); hold = await create(); await db.exec('reset role');
    assert.equal(await version(), 2);
    assert.equal((await events()).at(-1).booking_id, hold.id);
    assert.equal((await query('select count(*)::int n from booking_events where booking_id=$1', [hold.id]))[0].n, 1);
  });
  await check('move and cancel RPCs capture changes and retain automation cancellation', async () => {
    await move(hold.id, '2027-01-13', '2027-01-15'); assert.equal(await version(), 3);
    await query("insert into automation_sends(booking_id,property_id,fire_at,planned_check_in,planned_check_out) select id,property_id,now(),check_in,check_out from bookings where id=$1", [hold.id]);
    await cancel(hold.id); assert.equal(await version(), 4);
    assert.equal((await booking(hold.id)).status, 'cancelled');
    assert.equal((await query('select status from automation_sends where booking_id=$1', [hold.id]))[0].status, 'cancelled');
  });
  await check('repeated cancel and guest/money/last-seen-only edits do not enqueue', async () => {
    await cancel(hold.id);
    await query("update bookings set guest_name='Another Fictional Name',gross_amount=123,notes='fixture',last_seen_at=now() where id=$1", [hold.id]);
    assert.equal(await version(), 4);
  });
  await check('inquiry confirmation and dedupe changes invalidate inventory', async () => {
    const inquiry = await create('home','inquiry','2027-02-01','2027-02-03');
    await move(inquiry.id,'2027-02-01','2027-02-03','confirmed');
    await query('update bookings set duplicate_of=$1 where id=$2', [hold.id, inquiry.id]);
    assert.equal(await version(), 7);
  });
  await check('existing overlap refusal still leaves all event counts unchanged', async () => {
    await create('home','confirmed','2027-03-01','2027-03-04');
    const v = await version();
    await assert.rejects(() => create('home','confirmed','2027-03-02','2027-03-05'), /booking_overlap/);
    assert.equal(await version(), v);
  });
  let imported;
  await check('import upserts capture real changes but not identical feed replays', async () => {
    const sql = `insert into bookings(property_id,channel,source,status,check_in,check_out,ical_uid,hold_kind)
      values('home','booking_com','ical_import','block',$1,$2,'fixture-closure','ota')
      on conflict(channel,ical_uid) do update set check_in=excluded.check_in,check_out=excluded.check_out,last_seen_at=now() returning id`;
    imported = (await query(sql,['2027-04-01','2027-04-04']))[0].id;
    const v = await version(); await query(sql,['2027-04-01','2027-04-04']); assert.equal(await version(), v);
    await query(sql,['2027-04-02','2027-04-06']); assert.equal(await version(), v + 1);
  });
  await check('closure identity changes are captured even for duplicate OTA blocks', async () => {
    const v = await version();
    await query('update bookings set duplicate_of=$1 where id=$2', [hold.id, imported]);
    await query("update bookings set hold_kind='other' where id=$1", [imported]);
    await query("update bookings set live_since=now(),held_ages='[]',echo_confirmed='fixture' where id=$1", [imported]);
    assert.equal(await version(), v + 3);
  });
  await check('property transfer invalidates both old and new properties', async () => {
    await db.exec("update helm_inventory_capture_scopes set enabled=true where property_id='other'");
    const v = await version(), other = await version('other');
    await query("update bookings set property_id='other' where id=$1", [imported]);
    assert.equal(await version(), v + 1); assert.equal(await version('other'), other + 1);
  });
  await check('a failed transfer rolls back both property versions and the booking move', async () => {
    const home = await version(), other = await version('other');
    await db.exec("alter table helm_booking_inventory_events add constraint test_transfer_failure check(property_id <> 'other' or reason <> 'booking_update') not valid");
    await assert.rejects(() => query("update bookings set property_id='other' where id=$1", [hold.id]), /test_transfer_failure/);
    assert.equal((await booking(hold.id)).property_id, 'home');
    assert.equal(await version(), home); assert.equal(await version('other'), other);
    await db.exec('alter table helm_booking_inventory_events drop constraint test_transfer_failure');
  });
  await check('hard-delete capture survives removal of a hold', async () => {
    const v = await version('other'); await query('delete from bookings where id=$1', [imported]);
    assert.equal(await version('other'), v + 1);
    assert.equal((await events('other')).at(-1).reason, 'booking_delete');
    assert.equal((await events('other')).at(-1).booking_id, imported);
  });
  await check('disable and re-enable checkpoint missed changes without switching authority', async () => {
    const v = await version();
    await db.exec("update helm_inventory_capture_scopes set enabled=false where property_id='home'");
    assert.equal(await version(), v + 1); await create(); assert.equal(await version(), v + 1);
    await db.exec("update helm_inventory_capture_scopes set enabled=true where property_id='home'");
    assert.equal(await version(), v + 2);
    assert.equal((await query("select calendar_authority from properties where id='home'"))[0].calendar_authority, 'guesty');
  });
  await db.exec("update helm_inventory_capture_scopes set enabled=true where property_id='broken'");
  await check('enqueue failure rolls back canonical booking, audit and version together', async () => {
    await db.exec("alter table helm_booking_inventory_events add constraint test_reject_event check(property_id <> 'broken' or reason='capture_enabled')");
    const v = await version('broken');
    await assert.rejects(() => create('broken'), /test_reject_event/);
    assert.equal(await version('broken'), v);
    assert.equal((await query("select count(*)::int n from bookings where property_id='broken'"))[0].n, 0);
    assert.equal((await query("select count(*)::int n from booking_events where after->>'property_id'='broken'"))[0].n, 0);
    await db.exec('alter table helm_booking_inventory_events drop constraint test_reject_event');
  });
  await check('failure after capture also rolls back its durable event and version', async () => {
    await db.exec("alter table booking_events add constraint test_reject_audit check(after->>'property_id' <> 'broken')");
    const v = await version('broken'); await assert.rejects(() => create('broken'), /test_reject_audit/);
    assert.equal(await version('broken'), v);
    assert.equal((await query("select count(*)::int n from bookings where property_id='broken'"))[0].n, 0);
    await db.exec('alter table booking_events drop constraint test_reject_audit');
  });
  await check('cancel enqueue failure restores booking and pending automation', async () => {
    const row = await create('broken'); const v = await version('broken');
    await query("insert into automation_sends(booking_id,property_id,fire_at,planned_check_in,planned_check_out) select id,property_id,now(),check_in,check_out from bookings where id=$1", [row.id]);
    await db.exec("alter table helm_booking_inventory_events add constraint test_cancel_failure check(property_id <> 'broken' or reason <> 'booking_update')");
    await assert.rejects(() => cancel(row.id), /test_cancel_failure/);
    assert.equal((await booking(row.id)).status, 'block'); assert.equal(await version('broken'), v);
    assert.equal((await query('select status from automation_sends where booking_id=$1', [row.id]))[0].status, 'scheduled');
    await db.exec('alter table helm_booking_inventory_events drop constraint test_cancel_failure');
  });
  await check('multi-row update receives distinct monotonic property versions', async () => {
    const v = await version();
    const rows = await query("update bookings set check_in=check_in+1,check_out=check_out+1 where property_id='home' returning id");
    const added = (await events()).filter(e => Number(e.version) > v);
    assert.equal(added.length, rows.length);
    assert.deepEqual(added.map(e => Number(e.version)), rows.map((_, i) => v+i+1));
  });
  await check('events contain only internal identity, reason, version and timestamp', async () => {
    const all = await query('select * from helm_booking_inventory_events');
    assert.ok(all.length > 10);
    assert.deepEqual(Object.keys(all[0]).sort(), ['booking_id','created_at','property_id','reason','version']);
    assert.doesNotMatch(JSON.stringify(all), /Fictional|example@|gross_amount|min_stay|nightly|rate_plan/);
  });
  await check('service role can read but cannot forge, erase or activate capture', async () => {
    await db.exec('set role service_role'); assert.ok((await events()).length);
    for (const sql of [
      "insert into helm_booking_inventory_events(property_id,version,reason) values('home',999,'capture_enabled')",
      "update helm_booking_inventory_events set reason='capture_disabled'",
      'delete from helm_booking_inventory_events', 'truncate helm_booking_inventory_events',
      "update helm_inventory_capture_scopes set enabled=true", 'select helm_capture_booking_inventory_change()'
    ]) await assert.rejects(() => db.exec(sql), /permission denied/);
    await db.exec('reset role');
  });
  await check('anonymous and authenticated callers cannot read capture records', async () => {
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(() => events(), /permission denied/);
      await assert.rejects(() => version(), /permission denied/);
      await db.exec('reset role');
    }
    assert.ok((await query("select relrowsecurity from pg_class where relname in ('helm_inventory_capture_scopes','helm_booking_inventory_events')")).every(r => r.relrowsecurity));
  });
  await check('history is append-only and scope identity cannot be moved', async () => {
    await assert.rejects(() => db.exec('delete from helm_booking_inventory_events'), /append-only/);
    await assert.rejects(() => db.exec('truncate helm_booking_inventory_events'), /append-only/);
    await assert.rejects(() => db.exec("update helm_inventory_capture_scopes set property_id='unscoped' where property_id='other'"), /immutable/);
  });
  await check('reapplying candidate SQL preserves history and installs one trigger', async () => {
    const before = await events(); await db.exec(capture); assert.deepEqual(await events(), before);
    const v = await version(); await create(); assert.equal(await version(), v + 1);
  });
  await check('repeated enable is a no-op and disabled scope insert does not seed history', async () => {
    const v = await version();
    await db.exec("update helm_inventory_capture_scopes set enabled=true where property_id='home'");
    assert.equal(await version(), v);
    await db.exec("insert into helm_inventory_capture_scopes(property_id) values ('unscoped')");
    assert.equal(await version('unscoped'), 0); assert.equal((await events('unscoped')).length, 0);
  });
  await check('committed capture and canonical state survive database restart', async () => {
    const before = await events(), v = await version();
    const beforeBooking = await booking(hold.id);
    await db.close(); db = new PGlite(dataDir);
    assert.deepEqual(await events(), before); assert.equal(await version(), v);
    assert.deepEqual(await booking(hold.id), beforeBooking);
    await create(); assert.equal(await version(), v + 1);
  });
  await verifyAvailabilityInputCapture(db, check, capture);
  await verifyBookingInventoryConsumer(db, check);
  await verifyBookingInventoryRefresh(db, check);
  await check('consumer cursor and verified task evidence survive database restart', async () => {
    const snapshot = () => query("select id,helm_booking_inventory_read(id) as state from (values('home'),('refresh-home')) x(id) order by id");
    const before = await snapshot();
    await db.close(); db = new PGlite(dataDir);
    assert.deepEqual(await snapshot(), before);
  });
  // Independent fixture: canonical revision tests use the same fixed pilot ID.
  const windowDb = new PGlite();
  try {
    await installBookingInventoryFixture(windowDb);
    await windowDb.exec(readFileSync(new URL('../docs/guesty-exit/staging-storage/booking-inventory-planning.sql',import.meta.url),'utf8'));
    await verifyBookingInventoryWindow(windowDb, check);
  } finally { await windowDb.close(); }
  await verifyBookingInventorySchema(db, check);
  const canonical = await verifyCanonicalRevisions(db, check);
  await verifyCanonicalSourceDatabase(db, check);
  await verifyBookingInventoryCapacity(db, check);
  await canonical.verifyConflicts();
  const archived=await verifyBookingInventoryArchive(db, check);
  await check('500-day planner upgrade preserves grants and queues the complete availability span', async()=>{
    const signature='public.helm_booking_inventory_plan_commit(text,bigint,bigint,bigint,bigint,jsonb,jsonb,bigint,text)';
    const acl=async()=>(await db.query('select proacl::text acl from pg_proc where oid=$1::regprocedure',[signature])).rows[0].acl;
    const beforeAcl=await acl();
    await db.exec(readFileSync(new URL('../docs/guesty-exit/staging-storage/booking-inventory-500-day.sql',import.meta.url),'utf8'));
    assert.equal(await acl(),beforeAcl);
    const state=await archived.read(),cfg=state.configuration;
    cfg.start=shiftIsoDay(todayInEastern(new Date()),2);cfg.end=shiftIsoDay(cfg.start,500);cfg.publishEnabled=true;
    for(const c of cfg.coverage) Object.assign(c,{start:cfg.start,end:cfg.end,complete:true,observedAt:Date.now(),freshUntil:Date.now()+1800000});
    await db.query('update helm_booking_inventory_consumers set configuration=$2,configuration_version=configuration_version+1 where property_id=$1',[archived.property,cfg]);
    assert.equal((await consumeBookingInventory(archived.store,Date.now)).status,'queued');
    const updated=await archived.read(),intent=updated.journal.commands.at(-1).intent;
    assert.equal(intent.days.length,500);
    assert.ok(intent.days.slice(366).every(d=>d.available===0));
    assert.equal(updated.inputs.plan.booking_window_days,365);
    cfg.end=shiftIsoDay(cfg.end,1);
    await db.query('update helm_booking_inventory_consumers set configuration=$2,configuration_version=configuration_version+1 where property_id=$1',[archived.property,cfg]);
    const over=await archived.read(),next=structuredClone(over.journal);
    const extra=structuredClone(next.commands.at(-1));extra.intent.version=over.planVersion+1;
    extra.intent.days.push({date:shiftIsoDay(cfg.end,-1),available:0,stopSell:true});next.commands.push(extra);
    await assert.rejects(()=>archived.store.commit({captureVersion:over.captureVersion,configurationVersion:over.configurationVersion,
      planVersion:over.planVersion,journalVersion:over.journalVersion,inputs:over.inputs},next,Date.now()+30000,'0'.repeat(64)),/Incomplete inventory window/);
  });
  await check('archive: immutable evidence and active checkpoint survive a database restart',async()=>{
    const state=await archived.read(),id=state.journal.archiveId,receipt=await archived.store.readArchive(id);
    await db.close();db=new PGlite(dataDir);
    const after=(await db.query('select helm_booking_inventory_read($1) state',[archived.property])).rows[0].state;
    const saved=(await db.query('select helm_booking_inventory_archive_read($1,$2) a',[archived.property,id])).rows[0].a;
    assert.deepEqual(after,state);assert.deepEqual(saved,receipt);
  });
  console.log(`PASS: ${passed} local PostgreSQL integration checks; canonical RPC bodies exercised; no external connections.`);
} catch (error) {
  console.error('FAIL:', error.message);
  process.exitCode = 1;
} finally { await db.close(); rmSync(dataDir, { recursive: true, force: true }); }
