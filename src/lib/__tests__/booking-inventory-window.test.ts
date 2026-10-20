import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollingInventoryWindow, inventoryWindowDecision, advanceInventoryWindow } from '../channex-staging/booking-inventory-window.ts';
import { bookingInventorySnapshot, type BookingInventoryState, type BookingInventoryConsumerStore } from '../channex-staging/booking-inventory-consumer.ts';
import { replayInventoryJournal, type InventoryJournal } from '../channex-staging/inventory-journal.ts';
import { projectInventory } from '../channex-staging/inventory-projection.ts';
import { shiftIsoDay } from '../sca-quotes-types.ts';
import { CALDERWOOD_STAGING as mapping } from '../calderwood-readonly/channex.ts';
const NOW = Date.parse('2027-03-14T05:00:01Z');
function fixture(): BookingInventoryState {
  const w=rollingInventoryWindow(NOW),start=shiftIsoDay(w.start,-1),end=shiftIsoDay(w.end,-1);
  return {property:'HELMTEST-calderwood',captureEnabled:true,captureVersion:1,configurationVersion:1,
    configuration:{environment:'staging',topology:'single-unit',connection:'calderwood-hosted-inventory',listing:mapping.roomTypeId,generation:1,
      publishEnabled:true,timeZone:'America/New_York',start,end,requiredSources:['synthetic-canonical'],
      coverage:[{source:'synthetic-canonical',start:shiftIsoDay(start,-2),end:shiftIsoDay(w.end,2),complete:true,observedAt:NOW-1000,freshUntil:NOW+1800000}]},
    plannedCaptureVersion:0,plannedConfigurationVersion:0,planVersion:0,journalVersion:0,journal:{format:1,commands:[]},
    lastDigest:null,plannedFreshUntil:0,inputsMatchPlan:false,
    inputs:{authority:'helm',plan:{advance_notice_hours:24,booking_window_days:365,turnover_buffer_days:0,checkin_time:'16:00'},bookings:[],rateDays:[],periods:[]}};
}
function pending(s:BookingInventoryState) {
  const j:InventoryJournal={format:1,commands:[{kind:'enqueue',now:NOW-100,intent:{id:'pending',environment:'staging',
    connection:s.configuration.connection,property:s.property,generation:1,version:1,
    days:[{date:s.configuration.start,available:1,stopSell:false}]}}]};
  s.journal=j;s.journalVersion=j.commands.length;s.planVersion=1;
  return j;
}
test('rolling year follows Eastern midnight across leap day, DST and calendar-year boundaries',()=>{
  for(const [stamp,start,end] of [
    ['2027-03-14T04:59:59Z','2027-03-13','2028-03-13'],
    ['2027-03-14T05:00:00Z','2027-03-14','2028-03-14'],
    ['2027-03-15T04:00:00Z','2027-03-15','2028-03-15'],
    ['2027-11-07T05:30:00Z','2027-11-07','2028-11-07'],
    ['2027-11-07T06:30:00Z','2027-11-07','2028-11-07'],
    ['2028-01-01T04:59:59Z','2027-12-31','2028-12-31'],
  ]) assert.deepEqual(rollingInventoryWindow(Date.parse(stamp)),{start,end});
  assert.throws(()=>rollingInventoryWindow(NaN));assert.throws(()=>rollingInventoryWindow(-1));
});
test('only yesterday’s reviewed year may advance; short fixtures, gaps and clock regression require review',()=>{
  for(const delta of [-5,1]){const s=fixture();s.configuration.start=shiftIsoDay(s.configuration.start,delta);
    s.configuration.end=shiftIsoDay(s.configuration.end,delta);
    s.configuration.coverage[0].start=shiftIsoDay(s.configuration.start,-2);
    s.configuration.coverage[0].end=shiftIsoDay(s.configuration.end,2);
    assert.equal(inventoryWindowDecision(s,NOW).status,delta===1?'current':'needs-review');}
  const s=fixture();s.configuration.end=shiftIsoDay(s.configuration.start,3);
  assert.equal(inventoryWindowDecision(s,NOW).status,'needs-review');
  Object.assign(s.configuration,rollingInventoryWindow(NOW+86400000));
  s.configuration.coverage[0].end=shiftIsoDay(s.configuration.end,2);
  assert.equal(inventoryWindowDecision(s,NOW).status,'needs-review');
});
test('empty, stale, short, disabled and incomplete source evidence cannot open a new edge',()=>{
  for(const mutate of [
    (s:BookingInventoryState)=>{s.configuration.coverage=[];},
    (s:BookingInventoryState)=>{s.configuration.coverage[0].complete=false;},
    (s:BookingInventoryState)=>{s.configuration.coverage[0].freshUntil=NOW;},
    (s:BookingInventoryState)=>{s.configuration.coverage[0].end=s.configuration.end;},
    (s:BookingInventoryState)=>{s.captureEnabled=false;},
    (s:BookingInventoryState)=>{s.configuration.publishEnabled=false;},
    (s:BookingInventoryState)=>{s.inputs.authority='guesty';},
    (s:BookingInventoryState)=>{s.inputs.plan!.booking_window_days=364;},
    (s:BookingInventoryState)=>{s.inputs.plan!.turnover_buffer_days=3;},
  ]){const s=fixture();mutate(s);assert.equal(inventoryWindowDecision(s,NOW).status,'blocked');}
  const s=fixture();s.configuration.coverage[0].observedAt=NOW+1;
  assert.throws(()=>inventoryWindowDecision(s,NOW),/freshness/);
});
test('pending work retires atomically but any outstanding attempt prevents rollover',()=>{
  const s=fixture(),j=pending(s),decision=inventoryWindowDecision(s,NOW);
  assert.equal(decision.status,'advance');
  if(decision.status!=='advance')assert.fail();
  assert.equal(replayInventoryJournal(decision.journal).queue.list()[0].status,'superseded');
  assert.equal(replayInventoryJournal(j).queue.list()[0].status,'pending'); // Pure decision.
  j.commands.push({kind:'claim',id:'pending',now:NOW,leaseMs:60000});s.journalVersion++;
  assert.deepEqual(inventoryWindowDecision(s,NOW),{status:'unsettled',id:'pending'});
  assert.throws(()=>replayInventoryJournal({...j,commands:[...j.commands,decision.journal.commands.at(-1)!]}),/settle/);
  const q=replayInventoryJournal(j).queue,jb=q.list()[0];
  j.commands.push({kind:'dispatch',id:jb.id,token:jb.token!,now:NOW,context:{environment:'staging',
    connection:jb.connection,property:jb.property,generation:1,version:1,digest:jb.digest,
    authority:'helm',enabled:true,complete:true,freshUntil:NOW+30000}});s.journalVersion++;
  assert.equal(inventoryWindowDecision(s,NOW).status,'unsettled');
  j.commands.push({kind:'ambiguous',id:jb.id,token:jb.token!});s.journalVersion++;
  assert.equal(inventoryWindowDecision(s,NOW).status,'unsettled');
});
test('rollover performs one CAS with all source versions and never retries an uncertain save',async()=>{
  const s=fixture();pending(s);let calls=0;
  const store={property:s.property,advanceWindow:async(e,start,end,j)=>{
    calls++;assert.equal(e.captureVersion,s.captureVersion);assert.equal(e.configurationVersion,1);
    assert.equal(e.planVersion,1);assert.equal(e.journalVersion,1);assert.deepEqual(e.inputs,s.inputs);
    assert.deepEqual({start,end},rollingInventoryWindow(NOW));
    assert.equal(j.commands.at(-1)?.kind,'retire-pending');return false;
  }} as BookingInventoryConsumerStore;
  assert.deepEqual(await advanceInventoryWindow(store,s,NOW),{status:'superseded'});assert.equal(calls,1);
  store.advanceWindow=async()=>{calls++;throw Error('uncertain');};
  await assert.rejects(()=>advanceInventoryWindow(store,s,NOW),/uncertain/);assert.equal(calls,2);
});
test('full-year plan preserves distant bookings, owner blocks, duplicate rules and the 365-day boundary',()=>{
  const s=fixture();Object.assign(s.configuration,rollingInventoryWindow(NOW));
  const start=s.configuration.start,last=shiftIsoDay(s.configuration.end,-1);
  const row=(id:string,from:number,to:number)=>({id,status:'confirmed' as const,check_in:shiftIsoDay(start,from),check_out:shiftIsoDay(start,to),
    duplicate_of:null,hold_kind:null,source:'manual',channel:'manual'});
  s.inputs.bookings=[row('middle',180,182),{...row('owner',300,301),status:'block',hold_kind:'owner'},
    {...row('duplicate',200,201),duplicate_of:'middle'},{...row('cancelled',250,251),status:'cancelled'}];
  s.inputs.rateDays=[{date:last,closed:true}];
  const snapshot=bookingInventorySnapshot(s,NOW)!;
  const projected=projectInventory(snapshot,s.configuration.listing,start,s.configuration.end,NOW);
  assert.equal(projected.complete,true);assert.equal(projected.days.length,366);
  const closed=projected.days.flatMap((d,i)=>d.available?[]:[i]);
  assert.deepEqual(closed,[0,180,181,300,365]);
  assert.deepEqual(Object.keys(projected.days[365]).sort(),['available','date','stopSell']);
});
