import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalRevisionConflict, parseCanonicalConflictReport } from '../channex-staging/canonical-conflicts.ts';
import { createCanonicalRevisionStore } from '../channex-staging/canonical-revision-store.ts';
import { ingestCanonicalRevisions, parseCanonicalRevision } from '../channex-staging/canonical-revisions.ts';
import { runCanonicalRevisionScheduler } from '../channex-staging/canonical-revision-scheduler.ts';
import { CALDERWOOD_STAGING as m } from '../calderwood-readonly/channex.ts';
const r = parseCanonicalRevision({ id:'11111111-1111-4111-8111-111111111111', bookingId:'22222222-2222-4222-8222-222222222222',
  propertyId:m.propertyId,roomTypeId:m.roomTypeId,ratePlanId:m.ratePlanId,code:'HELMTEST-conflict',status:'new',
  checkIn:'2027-02-01',checkOut:'2027-02-03',receivedAt:'2026-10-21T15:00:00.000001Z' });
const refusal = { committed:false, conflict:{revisionId:r.id,bookingId:r.bookingId,reason:'booking_overlap'} };
const row={...refusal.conflict,checkIn:r.checkIn,checkOut:r.checkOut,observations:2,firstSeenAt:1,lastSeenAt:2};
const url='https://jgkblfozftcvymvwhhii.supabase.co';
test('durable conflict stops ACK and emits only a fixed classification through the real adapter',async()=>{
  const requests:string[]=[];
  const store=createCanonicalRevisionStore(url,'synthetic',async(input,init)=>{
    requests.push(String(input));assert.deepEqual(JSON.parse(String(init?.body)),{p_revision:r});return Response.json(refusal);
  });
  await assert.rejects(()=>ingestCanonicalRevisions({inspect:async()=>{},feed:async()=>[r],revision:async()=>r,
    acknowledge:async()=>assert.fail('Conflicted revision must stay unacknowledged')},store),
    (e:unknown)=>e instanceof CanonicalRevisionConflict && e.reason==='booking_overlap');
  assert.deepEqual(requests,[url+'/rest/v1/rpc/helm_pilot_revision_observe']);
});
test('malformed and mismatched conflict identities are generic failures, never trusted classifications',async()=>{
  for(const body of [{...refusal,committed:true},{...refusal,conflict:{...refusal.conflict,revisionId:r.bookingId}},
    {...refusal,conflict:{...refusal.conflict,reason:'SECRET'}},{...refusal,customer:'SECRET'}]){
    const store=createCanonicalRevisionStore(url,'synthetic',async()=>Response.json(body));
    await assert.rejects(()=>store.commit(r),(e:unknown)=>!(e instanceof CanonicalRevisionConflict));
  }
});
test('lost conflict-save response remains unknown and cannot ACK or fall back to the old importer',async()=>{
  let calls=0;
  const store=createCanonicalRevisionStore(url,'synthetic',async()=>{calls++;throw Error('SECRET');});
  await assert.rejects(()=>store.commit(r));assert.equal(calls,1);
});
test('conflict reads use only the private bounded RPC; incomplete and extra-field reports fail',async()=>{
  const report={openCount:1,resolvedCount:2,open:[row]};
  const store=createCanonicalRevisionStore(url,'synthetic',async(input)=>{
    assert.equal(String(input),url+'/rest/v1/rpc/helm_pilot_revision_conflicts');return Response.json(report);
  });
  assert.deepEqual(await store.conflicts(),{...report,truncated:false});
  for(const bad of [{...report,openCount:2},{...report,open:[{...row,guest:'SECRET'}]},
    {...report,open:[{...row,lastSeenAt:0}]},{...report,open:[{...row,checkOut:'2027-02-30'}]},
    {...report,openCount:2,open:[row,row]}])assert.throws(()=>parseCanonicalConflictReport(bad));
  const rows=Array.from({length:100},(_,i)=>({...row,revisionId:'11111111-1111-4111-8111-'+String(i).padStart(12,'0')}));
  assert.equal(parseCanonicalConflictReport({openCount:101,resolvedCount:0,open:rows}).truncated,true);
});
test('restart-style retry logs a conflict reason with backoff, without raw error text or booking identities',async()=>{
  const controller=new AbortController(),logs:unknown[]=[],delays:number[]=[];
  const result=await runCanonicalRevisionScheduler({signal:controller.signal,drainPage:async()=>{
    const error=new CanonicalRevisionConflict('booking_overlap');error.message='SECRET';throw error;
  },log:e=>logs.push(e),wait:async ms=>{delays.push(ms);if(delays.length===2)controller.abort();}});
  assert.equal(result.failed,true);assert.deepEqual(delays,[60000,120000]);
  assert.equal((logs[0] as {conflict:string}).conflict,'booking_overlap');
  assert.doesNotMatch(JSON.stringify(logs),/SECRET|11111111|22222222/);
});
