import test from 'node:test';
import assert from 'node:assert/strict';
import { createChannexTimingBindingStore } from '../channex-messaging/timing-binding-store.ts';
import { syntheticScheduleSnapshot, syntheticTimingEvidence, scheduleFixtureId as id } from './fixtures/channex-schedule-snapshot.ts';

const now=Date.parse('2026-11-12T15:00:00.000Z');
const context={contextRevision:'a'.repeat(32),routeGeneration:id(50),sourceEvidenceId:id(51),sourceEvidenceAt:new Date(now-3600_000).toISOString()};
function fixture() {
  const s=syntheticScheduleSnapshot(now), evidence=syntheticTimingEvidence(s,context,now);
  const intent={bindingId:id(70),captureId:evidence.captureId,bookingId:s.booking.id,context,
    ...s.route,reviewStartedAt:new Date(now-1000).toISOString(),reviewCheckedAt:new Date(now).toISOString(),reviewedRow:evidence.row};
  const expected={bookingId:s.booking.id,sourceIdentity:s.sourceIdentity,clocks:s.clocks,observedAt:s.observedAt,route:s.route,context};
  return {s,evidence,intent,expected};
}
test('binding adapter stays disabled without calling persistence',async()=>{
  let calls=0; const store=createChannexTimingBindingStore(async()=>{calls++;throw Error();}); const f=fixture();
  assert.equal((await store.bind(f.intent,'owner@synthetic.test',()=>now)).state,'disabled');
  assert.equal(await store.load(id(70),f.expected,now),null); assert.equal(calls,0);
});
test('binding rejects unknown fields and mismatched booking before RPC',async()=>{
  let calls=0; const store=createChannexTimingBindingStore(async()=>{calls++;throw Error();},{enabled:true});const f=fixture();
  for(const input of [{...f.intent,secret:'private'},{...f.intent,bookingId:id(99)},null])
    assert.equal((await store.bind(input,'owner@synthetic.test',()=>now)).state,'invalid');
  assert.equal(calls,0);
});
test('binding loader validates exact stored evidence and never writes',async()=>{
  const f=fixture();const names:string[]=[];
  const store=createChannexTimingBindingStore(async(name)=>{names.push(name);return {data:{bindingId:id(70),evidence:f.evidence},error:null};},{enabled:true});
  assert.deepEqual(await store.load(id(70),f.expected,now),f.evidence);
  await assert.rejects(()=>store.load(id(70),{...f.expected,context:{...context,contextRevision:'f'.repeat(32)}},now),/Timing binding unavailable/);
  assert.deepEqual(names,['helm_channex_timing_binding_read','helm_channex_timing_binding_read']);
});
test('binding accepts a verified response without returning private evidence',async()=>{
  const f=fixture();let calls=0;
  const store=createChannexTimingBindingStore(async()=>{calls++;return {data:{state:'created',bindingId:id(70),evidence:f.evidence},error:null};},{enabled:true});
  assert.deepEqual(await store.bind(f.intent,'owner@synthetic.test',()=>now),{state:'created',bindingId:id(70),canSend:false});
  assert.equal(calls,1);
});
test('wrong response IDs, future review and raw evidence remain uncertain without retry',async()=>{
  for(const mutate of [
    (r:ReturnType<typeof fixture>)=>({bindingId:id(99),evidence:r.evidence}),
    (r:ReturnType<typeof fixture>)=>({bindingId:id(70),evidence:{...r.evidence,kind:'channex_raw_message'}}),
    (r:ReturnType<typeof fixture>)=>({bindingId:id(70),evidence:{...r.evidence,binding:{...r.evidence.binding,reviewedAt:new Date(now+1000).toISOString()}}}),
  ]) {
    let calls=0;const f=fixture();const store=createChannexTimingBindingStore(async()=>{calls++;return {data:{state:'created',...mutate(f)},error:null};},{enabled:true});
    assert.equal((await store.bind(f.intent,'owner@synthetic.test',()=>now)).state,'uncertain');assert.equal(calls,1);
  }
});
test('provider errors are redacted and never retried',async()=>{
  let calls=0;const f=fixture();const store=createChannexTimingBindingStore(async()=>{calls++;throw Error('private source data');},{enabled:true});
  assert.deepEqual(await store.bind(f.intent,'owner@synthetic.test',()=>now),{state:'uncertain',canSend:false});
  await assert.rejects(()=>store.load(id(70),f.expected,now),{message:'Timing binding unavailable'});assert.equal(calls,2);
});
