import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumeBookingInventory, bookingInventorySnapshot, parseBookingInventoryState,
  type BookingInventoryState, type BookingInventoryConsumerStore } from '../channex-staging/booking-inventory-consumer.ts';
import { emptyInventoryJournal, replayInventoryJournal } from '../channex-staging/inventory-journal.ts';
import { projectInventory } from '../channex-staging/inventory-projection.ts';
import { createBookingInventoryConsumerStore } from '../channex-staging/booking-inventory-consumer-store.ts';
const NOW = Date.parse('2027-01-01T15:00:00Z');
function fixture() {
  let now = NOW, writes = 0;
  let plannedInputs: unknown = null;
  const state: BookingInventoryState = { property: 'home', captureEnabled: true, captureVersion: 1,
    configurationVersion: 1, configuration: { environment: 'staging', topology: 'single-unit',
      connection: 'fixture', listing: 'room', generation: 1, publishEnabled: false, timeZone: 'America/New_York',
      start: '2027-01-02', end: '2027-01-09', requiredSources: ['canonical', 'channels'], coverage: ['canonical', 'channels'].map(source =>
        ({ source, start: '2027-01-02', end: '2027-01-09', complete: true, observedAt: now - 1000, freshUntil: now + 1800000 })) },
    plannedCaptureVersion: 0, plannedConfigurationVersion: 0, planVersion: 0, journalVersion: 0,
    journal: emptyInventoryJournal(), lastDigest: null, plannedFreshUntil: 0, inputsMatchPlan: false,
    inputs: { authority: 'guesty', plan: { advance_notice_hours: 24, booking_window_days: 365, turnover_buffer_days: 0, checkin_time: '16:00' },
      bookings: [], rateDays: [], periods: [] } };
  let beforeCommit = () => {};
  const store: BookingInventoryConsumerStore = { property: 'home', read: async () => structuredClone({ ...state, inputsMatchPlan: JSON.stringify(plannedInputs) === JSON.stringify(state.inputs) }),
    commit: async (expected, journal, freshUntil, digest) => {
      beforeCommit(); writes++;
      if (state.captureVersion !== expected.captureVersion || state.configurationVersion !== expected.configurationVersion ||
          state.planVersion !== expected.planVersion || state.journalVersion !== expected.journalVersion || now >= freshUntil ||
          JSON.stringify(state.inputs) !== JSON.stringify(expected.inputs)) return false;
      state.journal = structuredClone(journal); state.journalVersion++; state.planVersion++;
      state.plannedCaptureVersion = expected.captureVersion; state.plannedConfigurationVersion = expected.configurationVersion;
      state.lastDigest = digest; state.plannedFreshUntil = freshUntil; plannedInputs = structuredClone(state.inputs); state.inputsMatchPlan = true;
      return true;
    }, journal: { read: async () => ({version: state.journalVersion,journal:state.journal}), append: async () => { throw new Error('No dispatch in planner test'); } } };
  return { state, store, clock: () => now, writes: () => writes, setNow: (v: number) => { now = v; }, before: (fn: () => void) => { beforeCommit = fn; } };
}
const row = (id: string, status = 'confirmed' as 'confirmed' | 'block') => ({ id, status,
  check_in: '2027-01-03', check_out: '2027-01-05', duplicate_of: null as string | null,
  hold_kind: null as string | null, source: 'manual', channel: 'manual' });
function days(f: ReturnType<typeof fixture>) {
  const s = bookingInventorySnapshot(parseBookingInventoryState(f.state, 'home'), f.clock());
  assert.ok(s);
  return projectInventory(s, 'room', f.state.configuration.start, f.state.configuration.end, f.clock()).days;
}
test('canonical stays, owner holds, cancelled rows and duplicate OTA closures retain their availability semantics', () => {
  const f = fixture();
  f.state.inputs.bookings = [row('stay'), {...row('duplicate'), check_in:'2027-01-06',check_out:'2027-01-07',duplicate_of:'stay'},
    {...row('ota','block'),check_in:'2027-01-07',check_out:'2027-01-08',duplicate_of:'stay',hold_kind:'ota',source:'ical_import',channel:'booking_com'},
    {...row('owner','block'),check_in:'2027-01-08',check_out:'2027-01-09',hold_kind:'owner'},
    {...row('cancelled'),status:'cancelled',check_in:'2027-01-02',check_out:'2027-01-03'}];
  assert.deepEqual(days(f).map(d => d.available), [1,0,0,1,1,0,0]);
});
test('neighbouring stay buffer, rate-day closure and recurring season are included', () => {
  const f=fixture(); f.state.inputs.plan!.turnover_buffer_days=2;
  for(const c of f.state.configuration.coverage){c.start='2026-12-31';c.end='2027-01-11';}
  f.state.inputs.bookings=[{...row('neighbour'),check_in:'2026-12-30',check_out:'2027-01-01'}];
  f.state.inputs.rateDays=[{date:'2027-01-05',closed:true}];
  f.state.inputs.periods=[{startMonth:1,startDay:1,endMonth:1,endDay:6}];
  assert.deepEqual(days(f).map(d=>d.available),[0,1,1,0,1,0,0]);
});
test('incomplete, missing, expired or short source coverage and missing rules never queue or advance a checkpoint',async()=>{
  for(const change of [
    (s:BookingInventoryState)=>{s.captureEnabled=false;},
    (s:BookingInventoryState)=>{s.inputs.plan=null;},
    (s:BookingInventoryState)=>{s.configuration.coverage.pop();},
    (s:BookingInventoryState)=>{s.configuration.coverage[0].complete=false;},
    (s:BookingInventoryState)=>{s.configuration.coverage[0].freshUntil=NOW;},
    (s:BookingInventoryState)=>{s.configuration.coverage[0].end='2027-01-08';},
  ]) { const f=fixture();change(f.state);assert.equal((await consumeBookingInventory(f.store,f.clock)).status,'blocked');assert.equal(f.writes(),0); }
});
test('turnover buffers require source coverage outside the publishing window',async()=>{
  const f=fixture();f.state.inputs.plan!.turnover_buffer_days=2;
  assert.equal((await consumeBookingInventory(f.store,f.clock)).status,'blocked');assert.equal(f.writes(),0);
});
test('future observations, duplicate identities, oversized buffer and malformed dates fail closed',async()=>{
  for(const change of [
    (s:BookingInventoryState)=>{s.configuration.coverage[0].observedAt=NOW+1;},
    (s:BookingInventoryState)=>{s.configuration.coverage.push(s.configuration.coverage[0]);},
    (s:BookingInventoryState)=>{s.inputs.bookings=[row('same'),row('same')];},
    (s:BookingInventoryState)=>{s.inputs.plan!.turnover_buffer_days=31;},
    (s:BookingInventoryState)=>{s.configuration.start='2027-02-30';},
  ]) {const f=fixture();change(f.state);await assert.rejects(()=>consumeBookingInventory(f.store,f.clock));assert.equal(f.writes(),0);}
});
test('only availability enters the journal, with once-only processing of an unchanged capture version',async()=>{
  const f=fixture();f.state.inputs.bookings=[row('private-internal-id')];
  assert.equal((await consumeBookingInventory(f.store,f.clock)).status,'queued');
  assert.equal((await consumeBookingInventory(f.store,f.clock)).status,'unchanged');
  assert.equal(f.state.plannedCaptureVersion,1);assert.equal(f.writes(),1);
  const jobs=replayInventoryJournal(f.state.journal).queue.list(); assert.equal(jobs[0].status,'pending');
  assert.deepEqual(Object.keys(jobs[0].days[0]).sort(),['available','date','stopSell']);
  assert.doesNotMatch(JSON.stringify(f.state.journal),/private-internal-id|price|min_nights|minStay|rate_plan|nightly/);
});
test('booking changes supersede pending work but cannot be lost by a competing planner',async()=>{
  const f=fixture();await consumeBookingInventory(f.store,f.clock);
  f.state.inputs.bookings=[row('new')];f.state.captureVersion++;
  const results=await Promise.all([consumeBookingInventory(f.store,f.clock),consumeBookingInventory(f.store,f.clock)]);
  assert.deepEqual(results.map(r=>r.status).sort(),['queued','superseded']);
  assert.deepEqual(replayInventoryJournal(f.state.journal).queue.list().map(j=>j.status),['superseded','pending']);
});
test('booking, configuration or non-booking input changes during calculation refuse stale commit',async()=>{
  for(const change of [
    (s:BookingInventoryState)=>{s.captureVersion++;},
    (s:BookingInventoryState)=>{s.configurationVersion++;},
    (s:BookingInventoryState)=>{s.inputs.rateDays.push({date:'2027-01-06',closed:true});},
  ]) {const f=fixture();f.before(()=>change(f.state));assert.equal((await consumeBookingInventory(f.store,f.clock)).status,'superseded');assert.equal(f.state.planVersion,0);}
});
test('changed availability rules refresh the stored basis even when the resulting days are identical',async()=>{
  const f=fixture();await consumeBookingInventory(f.store,f.clock);const digest=f.state.lastDigest;
  f.state.inputs.plan!.booking_window_days=364;
  assert.equal((await consumeBookingInventory(f.store,f.clock)).status,'queued');
  assert.equal(f.state.lastDigest,digest);assert.equal(f.state.planVersion,2);
});
test('lost response after committed plan is recovered by reread without duplicate enqueue',async()=>{
  const f=fixture(), commit=f.store.commit;let first=true;
  f.store.commit=async(...args)=>{const saved=await commit(...args);if(first){first=false;throw new Error('lost response');}return saved;};
  await assert.rejects(()=>consumeBookingInventory(f.store,f.clock),/lost response/);
  assert.equal((await consumeBookingInventory(f.store,f.clock)).status,'unchanged');assert.equal(f.writes(),1);
});
test('expiry requires a fresh plan even without another booking event',async()=>{
  const f=fixture();await consumeBookingInventory(f.store,f.clock);f.setNow(NOW+60000);
  assert.equal((await consumeBookingInventory(f.store,f.clock)).status,'queued');assert.equal(f.state.planVersion,2);
});
test('notice and midnight deadlines expire the plan before clock-only availability changes',()=>{
  const f=fixture();f.setNow(Date.parse('2027-01-01T20:59:59.500Z'));
  for(const c of f.state.configuration.coverage){c.observedAt=f.clock()-1000;c.freshUntil=f.clock()+1800000;}
  const snapshot=bookingInventorySnapshot(f.state,f.clock())!;
  assert.equal(snapshot.coverage[0].freshUntil,Date.parse('2027-01-01T21:00:00.001Z'));
  f.setNow(Date.parse('2027-01-02T04:59:59.500Z'));
  for(const c of f.state.configuration.coverage){c.observedAt=f.clock()-1000;c.freshUntil=f.clock()+1800000;}
  assert.equal(bookingInventorySnapshot(f.state,f.clock())!.coverage[0].freshUntil,Date.parse('2027-01-02T05:00:00Z'));
});
test('store rejects production URLs and missing configuration without any request',()=>{
  for(const url of ['https://example.supabase.co','https://jgkblfozftcvymvwhhii.supabase.co.evil.test']){
    assert.throws(()=>createBookingInventoryConsumerStore(url,'key','home'),/isolated/);
  }
  assert.throws(()=>createBookingInventoryConsumerStore('https://jgkblfozftcvymvwhhii.supabase.co','','home'),/isolated/);
});
test('staging adapter binds reads to the requested property and refuses malformed responses',async()=>{
  const f=fixture();let calls=0;
  const fetcher:typeof fetch=async(input,init)=>{calls++;assert.match(String(input),/\/rpc\/helm_booking_inventory_read$/);
    assert.deepEqual(JSON.parse(String(init?.body)),{p_property:'home'});return new Response(JSON.stringify(f.state),{headers:{'content-type':'application/json'}});};
  const store=createBookingInventoryConsumerStore('https://jgkblfozftcvymvwhhii.supabase.co','fixture-key','home',fetcher);
  assert.equal((await store.read() as BookingInventoryState).property,'home');assert.equal(calls,1);
  f.state.property='other';await assert.rejects(()=>store.read(),/property mismatch/);
});
