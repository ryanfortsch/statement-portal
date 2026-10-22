import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALDERWOOD_STAGING } from '../calderwood-readonly/channex.ts';
import { createMappedCanonicalRevisionAccess, parseCanonicalPilotRoute, runMappedCanonicalRevisions } from '../channex-staging/canonical-revision-mapped.ts';
import { ingestCanonicalRevisions, parseCanonicalRevision } from '../channex-staging/canonical-revisions.ts';
const url = 'https://jgkblfozftcvymvwhhii.supabase.co';
const route = { ...CALDERWOOD_STAGING, environment: 'staging' as const, helmProperty: 'HELMTEST-calderwood',
  propertyTitle:'65 Calderwood - Isolated Staging',ratePlanTitle:'TEST ONLY - Calderwood - CLOSED - $100 placeholder',
  adults:6,children:0,infants:0,connection: 'fixture', generation: 7, reviewedAt: '2026-10-22T14:00:00Z' };
const revision = parseCanonicalRevision({ id:'11111111-1111-4111-8111-111111111111',bookingId:'22222222-2222-4222-8222-222222222222',
  propertyId:route.propertyId,roomTypeId:route.roomTypeId,ratePlanId:route.ratePlanId,code:'HELMTEST-mapped',
  status:'new',checkIn:'2027-03-01',checkOut:'2027-03-04',receivedAt:'2026-10-22T14:00:00Z' });
const receipt = {revision,canonicalBookingId:'33333333-3333-4333-8333-333333333333',outcome:'applied',committed:true};
test('mapped importer refuses missing, nonpilot and wrong-provider destinations', () => {
  assert.equal(parseCanonicalPilotRoute(route).generation,7);
  for (const raw of [null,{...route,helmProperty:'HELMTEST-other'},{...route,propertyId:revision.bookingId},
    {...route,roomTypeId:revision.bookingId},{...route,ratePlanId:revision.bookingId},{...route,environment:'production'}]) {
    assert.throws(()=>parseCanonicalPilotRoute(raw));
  }
  assert.throws(()=>createMappedCanonicalRevisionAccess('https://other.supabase.co','fixture'));
});
test('missing mapping or unavailable RPC never falls back to legacy import or provider calls', async () => {
  for(const body of [null, {code:'P0001',message:'private database details'}]) {
    const calls:string[]=[];
    await assert.rejects(runMappedCanonicalRevisions({url,storageKey:'fixture',providerKey:'fixture'},async input=>{
      calls.push(String(input));return Response.json(body,{status:body?400:200});
    }),/Mapped canonical/);
    assert.deepEqual(calls,[url+'/rest/v1/rpc/helm_pilot_revision_route']);
  }
});
test('commit and independent receipt carry the reviewed generation; a changed binding prevents ACK', async () => {
  let denyReceipt=false,acks=0;const calls:string[]=[];
  const access=createMappedCanonicalRevisionAccess(url,'fixture',async(input,init)=>{
    const name=String(input).split('/').at(-1)!,args=JSON.parse(String(init?.body));calls.push(name);
    assert.deepEqual({p_connection:args.p_connection,p_generation:args.p_generation},{p_connection:'fixture',p_generation:7});
    if(name==='helm_pilot_revision_observe_mapped') {assert.deepEqual(args.p_revision,revision);return Response.json(receipt);}
    assert.equal(name,'helm_pilot_revision_receipt_mapped');assert.equal(args.p_id,revision.id);
    return denyReceipt?Response.json({message:'route changed'},{status:400}):Response.json(receipt);
  });
  const store=access.store(route),client={inspect:async()=>{},feed:async()=>[revision],revision:async()=>revision,acknowledge:async()=>{acks++;}};
  assert.equal((await ingestCanonicalRevisions(client,store)).acknowledged,1);
  denyReceipt=true;await assert.rejects(ingestCanonicalRevisions(client,store),/no ACK/);
  assert.equal(acks,1);assert.equal(calls.length,4);
});
test('mapped store keeps durable conflict classification and does not read a success receipt',async()=>{
  let calls=0;
  const access=createMappedCanonicalRevisionAccess(url,'fixture',async()=>{
    calls++;return Response.json({committed:false,conflict:{revisionId:revision.id,bookingId:revision.bookingId,reason:'booking_overlap'}});
  });
  await assert.rejects(access.store(route).commit(revision),error => (error as {reason:string}).reason==='booking_overlap');assert.equal(calls,1);
});
