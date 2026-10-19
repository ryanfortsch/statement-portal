import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALDERWOOD_STAGING } from '../calderwood-readonly/channex.ts';
import { normalizeCanonicalRevision, ingestCanonicalRevisions, exactCanonicalReceipt, parseCanonicalRevision,
  type CanonicalRevision, type CanonicalRevisionStore, type CanonicalRevisionClient } from '../channex-staging/canonical-revisions.ts';
import { createCanonicalRevisionClient } from '../channex-staging/canonical-revision-client.ts';
import { createCanonicalRevisionStore } from '../channex-staging/canonical-revision-store.ts';
const ID='11111111-1111-4111-8111-111111111111', BOOKING='22222222-2222-4222-8222-222222222222';
function raw() { return { id:ID, attributes:{ property_id:CALDERWOOD_STAGING.propertyId, booking_id:BOOKING, ota_name:'Offline',
  ota_reservation_code:'HELMTEST-canonical', status:'new', arrival_date:'2027-01-10', departure_date:'2027-01-12',
  inserted_at:'2026-10-19T14:00:00.123456', rooms:[{room_type_id:CALDERWOOD_STAGING.roomTypeId,rate_plan_id:CALDERWOOD_STAGING.ratePlanId}] } }; }
function fixture() {
  const r=normalizeCanonicalRevision(raw()), order:string[]=[];
  const receipts=new Map<string,unknown>();
  const receipt={revision:r,canonicalBookingId:BOOKING,outcome:'applied',committed:true};
  const store:CanonicalRevisionStore={commit:async v=>{order.push('commit');receipts.set(v.id,receipt);return receipt;},
    receipt:async id=>{order.push('read');return receipts.get(id);}};
  const client:CanonicalRevisionClient={inspect:async()=>{order.push('inspect');},feed:async()=>[r],revision:async()=>r,
    acknowledge:async()=>{order.push('ack');}};
  return {r,order,receipt,store,client};
}
test('normalization drops guest/financial/guarantee data and keeps microsecond ordering',()=>{
  const input=raw();
  const r=normalizeCanonicalRevision({...input,attributes:{...input.attributes,customer:{name:'PRIVATE'},guarantee:{card:'PRIVATE'},amount:'999'}});
  assert.equal(r.receivedAt,'2026-10-19T14:00:00.123456Z'); assert.doesNotMatch(JSON.stringify(r),/PRIVATE|999/);
});
test('real channels, unmapped rooms, different property, bad dates and ambiguous room dates are refused',()=>{
  for (const change of [
    {ota_name:'Airbnb'}, {property_id:BOOKING}, {ota_reservation_code:'REAL'},
    {rooms:[]}, {rooms:[{room_type_id:BOOKING,rate_plan_id:CALDERWOOD_STAGING.ratePlanId}]},
    {rooms:[{room_type_id:CALDERWOOD_STAGING.roomTypeId,rate_plan_id:BOOKING}]},
    {arrival_date:'2027-02-30'}, {departure_date:'2027-01-09'},
    {rooms:[{room_type_id:CALDERWOOD_STAGING.roomTypeId,rate_plan_id:CALDERWOOD_STAGING.ratePlanId,checkin_date:'2027-01-11'}]},
  ]) assert.throws(()=>normalizeCanonicalRevision({...raw(),attributes:{...raw().attributes,...change}}));
});
test('commit and independent durable read precede acknowledgement; no send or completeness claim',async()=>{
  const f=fixture(); const result=await ingestCanonicalRevisions(f.client,f.store);
  assert.deepEqual(f.order,['inspect','commit','read','ack']);
  assert.deepEqual(result,{received:1,applied:1,stale:0,acknowledged:1,completeCoverage:false,canSend:false});
});
test('save failure, lost save response and missing read-back do not ACK',async()=>{
  for(const failure of ['commit','receipt'] as const) {
    const f=fixture(); f.store[failure]=async()=>{throw Error('unavailable');};
    await assert.rejects(()=>ingestCanonicalRevisions(f.client,f.store));
    assert.ok(!f.order.includes('ack'));
  }
});
test('mismatched saved data or canonical identity is rejected before ACK',async()=>{
  const f=fixture();
  assert.throws(()=>exactCanonicalReceipt({...f.receipt,revision:{...f.r,checkOut:'2027-01-13'}},f.r));
  f.store.receipt=async()=>({...f.receipt,canonicalBookingId:ID});
  await assert.rejects(()=>ingestCanonicalRevisions(f.client,f.store));assert.ok(!f.order.includes('ack'));
});
test('duplicate revision IDs in a batch are refused before saving',async()=>{
  const f=fixture();f.client.feed=async()=>[f.r,f.r];
  await assert.rejects(()=>ingestCanonicalRevisions(f.client,f.store));assert.deepEqual(f.order,['inspect']);
});
test('single revision webhook-style pull shares the same durable path',async()=>{
  const f=fixture();f.client.feed=async()=>{throw Error('not used');};
  assert.equal((await ingestCanonicalRevisions(f.client,f.store,ID)).acknowledged,1);
});
test('batch processing orders by full provider timestamp and stops before ACK on first failure',async()=>{
  const f=fixture(); const second=parseCanonicalRevision({...f.r,id:BOOKING,receivedAt:'2026-10-19T14:00:00.123457Z'});
  f.client.feed=async()=>[second,f.r];const seen:CanonicalRevision[]=[];
  f.store.commit=async r=>{seen.push(r);throw Error('save failed');};
  await assert.rejects(()=>ingestCanonicalRevisions(f.client,f.store));assert.equal(seen[0].id,ID);
});
test('ACK rereads exact revision and sends only to fixed staging endpoint',async()=>{
  const calls:string[]=[];
  const client=createCanonicalRevisionClient('fixture',async(url,init)=>{
    calls.push(String(url)+' '+init?.method);
    return Response.json(init?.method==='POST'?{meta:{message:'Success'}}:{data:raw()});
  });
  await client.acknowledge(normalizeCanonicalRevision(raw()));
  assert.deepEqual(calls,[
    'https://staging.channex.io/api/v1/booking_revisions/'+ID+' GET',
    'https://staging.channex.io/api/v1/booking_revisions/'+ID+'/ack POST',
  ]);
});
test('changed remote revision, unexpected ACK and transport error are not accepted',async()=>{
  for(const mode of ['changed','response','network']) {
    let posts=0;
    const client=createCanonicalRevisionClient('fixture',async(_url,init)=>{
      if(init?.method==='POST'){posts++; if(mode==='network')throw Error('private failure');return Response.json({data:{}});}
      return Response.json({data:{...raw(),attributes:{...raw().attributes,...(mode==='changed'?{departure_date:'2027-01-13'}:{})}}});
    });
    await assert.rejects(()=>client.acknowledge(normalizeCanonicalRevision(raw())));
    assert.equal(posts,mode==='changed'?0:1);
  }
});
test('feed drains a bounded first page, preserving later unacknowledged pages',async()=>{
  let requested='';
  const client=createCanonicalRevisionClient('fixture',async url=>{requested=String(url);return Response.json({data:[raw()],meta:{page:1,limit:1,total:2}});});
  assert.equal((await client.feed()).length,1);assert.match(requested,/pagination%5Bpage%5D=1/);
});
test('invalid feed pagination and ignored property filter are refused',async()=>{
  for(const body of [{data:[],meta:{page:1,limit:100,total:2}},
    {data:[{...raw(),attributes:{...raw().attributes,property_id:BOOKING}}],meta:{page:1,limit:100,total:1}}]) {
    const client=createCanonicalRevisionClient('fixture',async()=>Response.json(body));
    await assert.rejects(()=>client.feed());
  }
});
test('database adapter rejects other projects before any IO',()=>{
  assert.throws(()=>createCanonicalRevisionStore('https://other.supabase.co','fixture'));
  assert.throws(()=>createCanonicalRevisionClient('bad\nkey'));
});

test('webhook hint cannot substitute a different booking identity',async()=>{
  const f=fixture();
  await assert.rejects(()=>ingestCanonicalRevisions(f.client,f.store,ID,ID),/identity mismatch/);
  assert.deepEqual(f.order,['inspect']);
});
