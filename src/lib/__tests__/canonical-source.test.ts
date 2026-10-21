import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALDERWOOD_STAGING as m } from '../calderwood-readonly/channex.ts';
import { CANONICAL_BOOKING_SOURCE, normalizeSourceBooking, parseSourceBookings, verifyCanonicalSource, renewCanonicalSourceCoverage,
  type CanonicalSourceClient, type CanonicalSourceStore, type CanonicalSourceSnapshot } from '../channex-staging/canonical-source.ts';
import { createCanonicalSourceClient } from '../channex-staging/canonical-source-client.ts';
import { createCanonicalSourceStore } from '../channex-staging/canonical-source-store.ts';
const id='11111111-1111-4111-8111-111111111111',rev='22222222-2222-4222-8222-222222222222';
const stamp=Date.parse('2026-10-21T12:00:00Z');
function raw() { return {type:'booking',id,attributes:{id,revision_id:rev,property_id:m.propertyId,ota_name:'Offline',
  ota_reservation_code:'HELMTEST-source',status:'cancelled',arrival_date:'2027-02-10',departure_date:'2027-02-12',
  rooms:[{room_type_id:m.roomTypeId,rate_plan_id:m.ratePlanId,checkin_date:'2027-02-10',checkout_date:'2027-02-12'}],
  customer:{name:'PRIVATE'},guarantee:{card:'PRIVATE'},amount:'PRIVATE'}}; }
function fixture() {
  const booking=normalizeSourceBooking(raw());let calls=0;
  const snapshot:CanonicalSourceSnapshot={property:'HELMTEST-calderwood',captureEnabled:true,importEnabled:true,authority:'helm',captureVersion:3,
    configurationVersion:2,connection:'calderwood-hosted-inventory',listing:m.roomTypeId,generation:1,requiredSources:[CANONICAL_BOOKING_SOURCE],
    bindings:[{booking,valid:true}],unmappedRemoteRows:0};
  const order:string[]=[];
  const client:CanonicalSourceClient={inspect:async()=>{order.push('inspect');},bookings:async()=>{order.push('list');return [booking];},
    pending:async()=>{order.push('feed');return false;}};
  const store:CanonicalSourceStore={read:async()=>{order.push('db');return structuredClone(snapshot);},certify:async()=>{calls++;return true;}};
  return {booking,snapshot,client,store,order,calls:()=>calls};
}
test('complete source verifies two lists and durable snapshots, retaining cancellations but no private fields',async()=>{
  const f=fixture(),result=await verifyCanonicalSource(f.client,f.store,()=>stamp);
  assert.equal(result.complete,true);assert.deepEqual(f.order,['inspect','list','feed','db','list','feed','db']);
  assert.equal(f.calls(),0);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|customer|guarantee|amount/);
});
test('complete-source comparison exposes missing, extra, changed and invalid canonical records',async()=>{
  for(const change of [(f:ReturnType<typeof fixture>)=>{f.snapshot.bindings=[];},
    (f:ReturnType<typeof fixture>)=>{f.client.bookings=async()=>[];f.snapshot.bindings[0].booking={...f.booking,status:'new'};},
    (f:ReturnType<typeof fixture>)=>{f.snapshot.bindings[0].booking={...f.booking,revisionId:id};},
    (f:ReturnType<typeof fixture>)=>{f.snapshot.bindings[0].valid=false;},
    (f:ReturnType<typeof fixture>)=>{f.snapshot.unmappedRemoteRows=1;}]) {
    const f=fixture();change(f);const r=await renewCanonicalSourceCoverage(f.client,f.store,{start:'2027-01-01',end:'2028-01-01'},()=>stamp);
    assert.equal(r.status,'mismatch');assert.equal(r.complete,false);assert.equal(f.calls(),0);
  }
});
test('pending changes in either feed read prevent certification even when the full lists match',async()=>{
  for(const n of [1,2]) {const f=fixture();let calls=0;f.client.pending=async()=>++calls===n;
    assert.equal((await verifyCanonicalSource(f.client,f.store,()=>stamp)).status,'pending-revisions');assert.equal(f.calls(),0);}
});
test('list, database, authority and source-version changes during proof cannot renew coverage',async()=>{
  for(const mode of ['remote','capture','configuration','disabled']) {
    const f=fixture();let calls=0;
    if(mode==='remote')f.client.bookings=async()=>++calls===1?[f.booking]:[];
    else f.store.read=async()=>{const s=structuredClone(f.snapshot);if(++calls===2){if(mode==='capture')s.captureVersion++;if(mode==='configuration')s.configurationVersion++;if(mode==='disabled')s.captureEnabled=false;}return s;};
    assert.equal((await verifyCanonicalSource(f.client,f.store,()=>stamp)).status,'changed');assert.equal(f.calls(),0);
  }
});
test('withdrawn authority, capture or importer and zero capture checkpoint reject completeness',async()=>{
  for(const patch of [{authority:'guesty'},{captureEnabled:false},{importEnabled:false},{captureVersion:0}]) {
    const f=fixture();Object.assign(f.snapshot,patch);assert.equal((await verifyCanonicalSource(f.client,f.store,()=>stamp)).status,'disabled');
  }
});
test('a genuinely complete empty list is distinct from an empty delta feed',async()=>{
  const f=fixture();f.client.bookings=async()=>[];f.snapshot.bindings=[];
  assert.equal((await verifyCanonicalSource(f.client,f.store,()=>stamp)).complete,true);
  f.client.bookings=async()=>{throw Error('full source unavailable');};
  await assert.rejects(()=>verifyCanonicalSource(f.client,f.store,()=>stamp));assert.equal(f.calls(),0);
});
test('proof deadline, backwards clock and provider failure fail closed without renewal',async()=>{
  for(const offset of [-1,60001]) {const f=fixture();let calls=0;assert.equal((await verifyCanonicalSource(f.client,f.store,()=>calls++?stamp+offset:stamp)).status,'expired');}
  for(const method of ['inspect','bookings','pending'] as const){const f=fixture();f.client[method]=async()=>{throw Error('outage');};await assert.rejects(()=>verifyCanonicalSource(f.client,f.store,()=>stamp));assert.equal(f.calls(),0);}
});
test('certification requires the reviewed source and carries exact original observation time and coverage window',async()=>{
  const f=fixture();f.snapshot.requiredSources=['synthetic-canonical'];
  assert.equal((await renewCanonicalSourceCoverage(f.client,f.store,{start:'2027-01-01',end:'2028-01-01'},()=>stamp)).status,'source-not-configured');
  f.snapshot.requiredSources=[CANONICAL_BOOKING_SOURCE];let args:unknown[]=[];
  f.store.certify=async(...v)=>{args=v;return false;};
  assert.equal((await renewCanonicalSourceCoverage(f.client,f.store,{start:'2027-01-01',end:'2028-01-01'},()=>stamp)).status,'superseded');
  assert.deepEqual(args,[f.snapshot,[f.booking],stamp,'2027-01-01','2028-01-01']);
  f.store.certify=async()=>{throw Error('lost reply');};await assert.rejects(()=>renewCanonicalSourceCoverage(f.client,f.store,{start:'2027-01-01',end:'2028-01-01'},()=>stamp),/lost reply/);
});
test('source normalization refuses wrong mapping, room dates, real listings, duplicates and unknown fields',()=>{
  const f=fixture();assert.throws(()=>parseSourceBookings([f.booking,f.booking]));assert.throws(()=>parseSourceBookings([{...f.booking,customer:'private'}]));
  for(const fields of [{id:rev},{property_id:rev},{ota_name:'Airbnb'},{revision_id:null},{status:'unknown'},{rooms:[]},
    {rooms:[{...raw().attributes.rooms[0],checkout_date:'2027-02-13'}]},{arrival_date:'2027-02-30'}]){
    assert.throws(()=>normalizeSourceBooking({...raw(),attributes:{...raw().attributes,...fields}}));
  }
});
test('source transport requests only an all-status fixed-property GET and requires exact complete pagination',async()=>{
  let url='';const client=createCanonicalSourceClient('fixture',async(input,init)=>{url=String(input);assert.equal(init?.method,'GET');return Response.json({data:[raw()],meta:{page:1,limit:100,total:1}});});
  assert.equal((await client.bookings()).length,1);const q=new URL(url);assert.equal(q.hostname,'staging.channex.io');
  assert.deepEqual([...q.searchParams.keys()].sort(),['filter[property_id]','pagination[limit]','pagination[page]']);
  for(const body of [{data:[raw()],meta:{page:1,limit:100,total:101}},{data:[],meta:{page:1,limit:100,total:1}},
    {data:[raw()],meta:{page:2,limit:100,total:1}},{data:[raw()],meta:{page:1,limit:1,total:1}},
    {data:[raw()],meta:{page:1,limit:100,total:1,warnings:['private']}},{data:[raw(),raw()],meta:{page:1,limit:100,total:2}}]) {
    await assert.rejects(()=>createCanonicalSourceClient('fixture',async()=>Response.json(body)).bookings(),/response withheld/);
  }
});
test('source store is fixed to isolated RPCs and treats missing or lost responses as failures',async()=>{
  const f=fixture();assert.throws(()=>createCanonicalSourceStore('https://other.supabase.co','fixture'));
  const urls:string[]=[],bodies:unknown[]=[];
  const store=createCanonicalSourceStore('https://jgkblfozftcvymvwhhii.supabase.co','fixture',async(input,init)=>{
    urls.push(String(input));bodies.push(JSON.parse(String(init?.body??'{}')));return Response.json(urls.length===1?f.snapshot:true);
  });
  assert.deepEqual(await store.read(),f.snapshot);assert.equal(await store.certify(f.snapshot,[f.booking],stamp,'2027-01-01','2028-01-01'),true);
  assert.match(urls[0],/rpc\/helm_pilot_source_read$/);assert.match(urls[1],/rpc\/helm_pilot_source_certify$/);assert.doesNotMatch(JSON.stringify(bodies),/PRIVATE/);
  await assert.rejects(()=>createCanonicalSourceStore('https://jgkblfozftcvymvwhhii.supabase.co','fixture',async()=>Response.json(null)).read());
});

test('valid cancelled local history can remain; an absent active or invalid cancelled stay blocks',async()=>{
  const f=fixture();f.client.bookings=async()=>[];
  const r=await verifyCanonicalSource(f.client,f.store,()=>stamp);assert.equal(r.complete,true);assert.equal(r.counts?.retainedCancelled,1);
  f.snapshot.bindings[0].valid=false;assert.equal((await verifyCanonicalSource(f.client,f.store,()=>stamp)).status,'mismatch');
});
