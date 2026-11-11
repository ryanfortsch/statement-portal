import test from 'node:test';
import assert from 'node:assert/strict';
import { CALDERWOOD_PRODUCTION as m } from '../channex-production-preflight.ts';
import { PRODUCTION_DB_URL } from '../channex-production-runtime.ts';
import { projectRemoteBooking, parseCanonicalSnapshot, compareBookingCollections, type LocalBooking } from '../channex-bookings/reconciliation.ts';
import { createProductionBookingCollectionReader } from '../channex-bookings/collection.ts';
import { auditProductionBookings } from '../channex-bookings/audit.ts';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const window = { start:'2026-11-06',end:'2028-03-20' };
const now = Date.parse('2026-11-06T20:00:00Z');
function wire(n=1) { return {type:'booking',id:uuid(n),attributes:{id:uuid(n),revision_id:uuid(n+100),property_id:m.propertyId as string,
 ota_name:'Airbnb',ota_reservation_code:`CODE${n}`,status:'new',arrival_date:'2026-11-10',departure_date:'2026-11-12',
 rooms:[{room_type_id:m.roomTypeId as string,rate_plan_id:m.ratePlanId as string,checkin_date:'2026-11-10',checkout_date:'2026-11-12'}],
 customer:{name:'PRIVATE_SENTINEL'},guarantee:{card_number:'PRIVATE_SENTINEL'},amount:'PRIVATE_SENTINEL',inserted_at:'not revision time'}}; }
function local(n=1,patch:Partial<LocalBooking>={}):LocalBooking { return {id:uuid(n+1000),channel:'airbnb',source:'guesty_legacy',status:'confirmed',
 checkIn:'2026-11-10',checkOut:'2026-11-12',duplicateOf:null,holdKind:null,code:`CODE${n}`,...patch}; }
const snapshot=(rows:LocalBooking[]=[])=>({format:1 as const,propertyId:'65_calderwood' as const,authority:'guesty' as const,rows});
const compare=(rows:LocalBooking[], remote=[projectRemoteBooking(wire())])=>compareBookingCollections(snapshot(rows),remote,window);
const page=(rows:unknown[],total=rows.length,p=1,limit=100)=>({data:rows,meta:{page:p,total,limit}});

test('booking projection excludes PII, prices and invented revision ordering',()=>{
 const r=projectRemoteBooking(wire());assert.equal(r.id,uuid(1));assert.equal(r.revisionId,uuid(101));
 assert.equal(JSON.stringify(r).includes('PRIVATE_SENTINEL'),false);assert.equal('providerReceivedAt' in r,false);
});
test('wrong property, channel, room/rate, resource, identity, dates and synthetic records fail closed',()=>{
 const mutations:((r:ReturnType<typeof wire>)=>void)[]=[(r)=>{r.type='booking_revision';},r=>{r.attributes.property_id=uuid(7);},
  r=>{r.attributes.ota_name='Booking.com';},r=>{r.attributes.id=uuid(8);},r=>{r.attributes.rooms[0].room_type_id=uuid(8);},
  r=>{r.attributes.rooms[0].rate_plan_id=uuid(9);},r=>{r.attributes.rooms.push({...r.attributes.rooms[0]});},
  r=>{r.attributes.departure_date='2026-02-30';},r=>{r.attributes.rooms[0].checkout_date='2026-11-13';},
  r=>{r.attributes.ota_reservation_code='HELMTEST-123';}];
 for(const mutate of mutations){const r=wire();mutate(r);assert.throws(()=>projectRemoteBooking(r),/INVALID_BOOKING_COLLECTION/);}
});
test('canonical scope rejects malformed rows, duplicates, broken roots, chains, foreign fields and truncation',()=>{
 for(const rows of [[local(),local()],[local(1,{checkOut:'2026-11-09'})],[local(1,{duplicateOf:uuid(999)})],
  [local(1,{duplicateOf:uuid(1001)})],[local(1,{duplicateOf:uuid(1002)}),local(2,{duplicateOf:uuid(1003)}),local(3)],
  Array.from({length:5001},(_,i)=>local(i))]) assert.throws(()=>parseCanonicalSnapshot(snapshot(rows)),/CANONICAL_SNAPSHOT_INVALID/);
 assert.throws(()=>parseCanonicalSnapshot({...snapshot(),authority:'helm'}));
 assert.throws(()=>parseCanonicalSnapshot(snapshot([{...local(),guest_name:'PRIVATE_SENTINEL'} as LocalBooking])));
});
test('exact identity matches are diagnostic only, even with equal counts and no differences',()=>{
 const r=compare([local()]);assert.equal(r.matched,1);assert.equal(r.differences,0);assert.equal(r.completeCoverage,false);
 assert.equal(r.readyForCutover,false);assert.equal(r.bookingsChanged,0);assert.equal(r.providerWrites,0);
});
test('empty provider list never removes local stays or treats counts as coverage',()=>{
 const r=compare([local(),local(2,{channel:'vrbo'}),local(3,{status:'block',holdKind:'owner'})],[]);
 assert.equal(r.counts.missing_in_channex,1);assert.equal(r.activeCanonicalStays,2);assert.equal(r.otherChannelStays,1);
 assert.equal(r.preservedHolds,1);assert.equal(r.completeCoverage,false);
});
test('matching requires code and channel, never dates alone; output withholds codes',()=>{
 const r=compare([local(2),local(3,{code:null}),local(4,{channel:'direct',code:'CODE1'})]);
 assert.equal(r.counts.missing_in_helm,1);assert.equal(r.counts.missing_in_channex,1);
 assert.equal(r.counts.missing_confirmation_code,1);assert.equal(r.counts.stays_overlap,1);
 assert.equal(JSON.stringify(r).includes('CODE'),false);
});
test('changed dates outside the window and cancellations remain explicit differences',()=>{
 const r=compare([local(1,{checkIn:'2029-01-01',checkOut:'2029-01-03',status:'cancelled'})]);
 assert.equal(r.counts.dates_differ,1);assert.equal(r.counts.status_differs,1);
 const b=projectRemoteBooking(wire());b.status='cancelled';const cancelled=compare([local()], [b]);
 assert.equal(cancelled.counts.status_differs,1);assert.equal(cancelled.bookingsChanged,0);
});
test('canonical duplicates never become a second stay; OTA closure duplicates remain holds',()=>{
 const r=compare([local(),local(2,{duplicateOf:uuid(1001),code:'CODE1'}),
  local(3,{duplicateOf:uuid(1001),status:'block',holdKind:'ota',source:'ical_import'})]);
 assert.equal(r.matched,1);assert.equal(r.duplicateRows,2);assert.equal(r.activeCanonicalStays,1);
 assert.equal(r.preservedHolds,1);assert.equal(r.counts.held_nights_overlap,1);
});
test('duplicate codes are ambiguous and independent holds survive cancellation',()=>{
 assert.equal(compare([local(),local(2,{code:'CODE1'})]).counts.ambiguous_code,1);
 const b=projectRemoteBooking(wire(2));b.code='CODE1';assert.equal(compare([local()],[projectRemoteBooking(wire()),b]).counts.ambiguous_code,1);
 b.status='cancelled';const r=compare([local(1,{status:'cancelled'}),local(3,{status:'block',holdKind:'maintenance'})],[b]);
 assert.equal(r.preservedHolds,1);assert.equal(r.bookingsChanged,0);
});
test('collection reader traverses all pages, no date/status filter, fixed host GET only',async()=>{
 let calls=0;const scan=createProductionBookingCollectionReader('synthetic-key',async(url,init)=>{
  const u=new URL(String(url));calls++;assert.equal(u.origin,'https://app.channex.io');assert.equal(u.pathname,'/api/v1/bookings');
  assert.equal(u.searchParams.get('filter[property_id]'),m.propertyId);assert.equal(u.searchParams.get('pagination[page]'),String(calls));
  assert.equal([...u.searchParams.keys()].some(k=>/arrival|departure|status/.test(k)),false);
  assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');
  return Response.json(page(calls===1?[wire(1),wire(2)]:[wire(3)],3,calls,2));
 },()=>now);const r=await scan(now+1000);assert.equal(r.rows.length,3);assert.equal(r.pages,2);
});
test('missing/duplicate/drifting pagination, warnings and provider failures never yield partial success',async()=>{
 for(const second of [page([],3,2,2),page([wire(2)],3,2,2),page([wire(3)],4,2,2),page([wire(3)],3,1,2),
  {...page([wire(3)],3,2,2),errors:{detail:'PRIVATE_SENTINEL'}},
  {...page([wire(3)],3,2,2),meta:{page:2,total:3,limit:2,warnings:['PRIVATE_SENTINEL']}}]){
  let n=0;const scan=createProductionBookingCollectionReader('synthetic-key',async()=>Response.json(++n===1?page([wire(1),wire(2)],3,1,2):second),()=>now);
  await assert.rejects(scan(now+1000),e=>e instanceof Error&&!e.message.includes('PRIVATE_SENTINEL'));
 }
 for(const status of [302,401,429,500]) await assert.rejects(createProductionBookingCollectionReader('synthetic-key',async()=>new Response('PRIVATE_SENTINEL',{status}),()=>now)(now+1000));
});
test('time and count caps abort instead of reporting complete traversal',async()=>{
 await assert.rejects(createProductionBookingCollectionReader('synthetic-key',async()=>Response.json(page([],5001)),()=>now)(now+1000));
 await assert.rejects(createProductionBookingCollectionReader('synthetic-key',async()=>{throw Error('must not call');},()=>now)(now));
 let calls=0;await assert.rejects(createProductionBookingCollectionReader('synthetic-key',async()=>Response.json(page([wire(++calls)],51,calls,1)),()=>now)(now+1000),/AUDIT_LIMIT_REACHED/);
 assert.equal(calls,50);
});
const env={VERCEL_ENV:'production',CHANNEX_PRODUCTION_MODE:'inspect',NEXT_PUBLIC_SUPABASE_URL:PRODUCTION_DB_URL,
 SUPABASE_SERVICE_ROLE_KEY:'synthetic-db',CHANNEX_PRODUCTION_API_KEY:'synthetic-key'};
function harness(){
 const calls:string[]=[];let scans=0,reads=0;
 const storage={propertyId:m.helmPropertyId,environment:'production',remotePropertyId:m.propertyId,roomTypeId:m.roomTypeId,ratePlanId:m.ratePlanId,
  generation:1,importEnabled:false,captureEnabled:false,calendarAuthority:'guesty',receipts:0,inventoryEvents:0};
 const inventory={format:1,planningEnabled:false,publishingEnabled:false,headVersion:0,plans:0,coverageSources:0,maxDays:500};
 const delivery={format:1,enabled:false,attempts:0,unresolved:0,settlementEnabled:false};
 const relation=(id:string)=>({data:{id}});
 const providers=[{data:{id:m.propertyId,attributes:{title:m.propertyTitle,currency:'USD',timezone:'America/New_York',property_type:'holiday_home'}}},
  {data:{id:m.roomTypeId,attributes:{title:m.roomTitle,count_of_rooms:1,occ_adults:6,occ_children:0,occ_infants:0},relationships:{property:relation(m.propertyId)}}},
  {data:{id:m.ratePlanId,attributes:{title:m.rateTitle,currency:'USD',sell_mode:'per_room',rate_mode:'manual',stop_sell:Array(7).fill(true)},relationships:{property:relation(m.propertyId),room_type:relation(m.roomTypeId)}}},
  {data:[],meta:{total:0,page:1}}];
 const h={storage,inventory,delivery,changedLocal:false,changedRemote:false,calls,
  rpc:async(name:string)=>{calls.push(name);return{error:null,data:name==='helm_channex_storage_status'?storage:name==='helm_channex_inventory_status'?inventory:
   name==='helm_channex_delivery_status'?delivery:name==='helm_channex_booking_audit_snapshot'?snapshot(++reads===2&&h.changedLocal?[local(2)]:[local()]):null};},
  fetcher:(async(url,init)=>{assert.equal(init?.method,'GET');calls.push(new URL(String(url)).pathname);
   if(String(url).includes('/bookings?'))return Response.json(page(++scans===2&&h.changedRemote?[wire(2)]:[wire()]));
   return Response.json(providers.shift());}) as typeof fetch};return h;
}
test('owner audit uses two matching observations, sanitized fingerprints, and only read RPCs',async()=>{
 const h=harness(),r=await auditProductionBookings(env,h.rpc,h.fetcher,()=>now);
 assert.equal(r.matched,1);assert.equal(r.scans,2);assert.equal(r.completeCoverage,false);assert.equal(r.readyForCutover,false);
 assert.match(r.canonicalFingerprint,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(r).includes('PRIVATE_SENTINEL'),false);
 assert.equal(h.calls.some(c=>/commit|checkpoint|ack|claim|begin|record/.test(c)),false);
});
test('local or provider changes discard the comparison; no retry or mutation',async()=>{
 for(const key of ['changedLocal','changedRemote'] as const){const h=harness();h[key]=true;
  await assert.rejects(auditProductionBookings(env,h.rpc,h.fetcher,()=>now),/SOURCES_CHANGED/);}
});
test('preview or active scopes stop before any provider reads',async()=>{
 const h=harness();await assert.rejects(auditProductionBookings({...env,VERCEL_ENV:'preview'},h.rpc,h.fetcher,()=>now));assert.equal(h.calls.length,0);
 h.delivery.enabled=true;await assert.rejects(auditProductionBookings(env,h.rpc,h.fetcher,()=>now));
 assert.equal(h.calls.some(c=>c.startsWith('/')),false);
});
