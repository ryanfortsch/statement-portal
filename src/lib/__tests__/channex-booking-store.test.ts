import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAirbnbBookingStore } from '../channex-bookings/store.ts';
import type { AirbnbBookingRevision } from '../channex-bookings/revision.ts';
const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const revision: AirbnbBookingRevision = {revisionId:id(1),bookingId:id(2),propertyId:id(3),
 roomTypeId:id(4),ratePlanId:id(5),reservationCode:'SYNTHETIC',status:'new',
 checkIn:'2027-01-01',checkOut:'2027-01-04',providerReceivedAt:'2026-11-06T15:00:00.000001Z',
 environment:'production',mappingGeneration:1,channel:'airbnb',guestDetails:{name:'Synthetic',surname:null,mail:null,phone:null,address:null,city:null,country:null,zip:null,notes:null}};
test('booking storage validates the narrow revision before calling the database',async()=>{
 const calls:unknown[]=[];
 const store=createAirbnbBookingStore(async(name,args)=>{calls.push({name,args});return {data:{saved:true},error:null};});
 await store.commit(revision);
 await store.receipt(revision.revisionId);
 assert.deepEqual(calls,[{name:'helm_airbnb_revision_commit',args:{p_revision:revision}},
  {name:'helm_airbnb_revision_receipt',args:{p_id:revision.revisionId}}]);
 assert.throws(()=>store.commit({...revision,customer:'PRIVATE_SENTINEL'} as AirbnbBookingRevision));
 assert.throws(()=>store.receipt('invalid'));
 assert.equal(calls.length,2);
});
test('failed, missing and interrupted storage responses cannot count as persistence and redact details',async()=>{
 for(const response of [{data:null,error:null},{data:null,error:{message:'PRIVATE_SENTINEL'}}]){
  const store=createAirbnbBookingStore(async()=>response);
  await assert.rejects(store.commit(revision),e=>e instanceof Error&&!String(e).includes('PRIVATE_SENTINEL'));
  await assert.rejects(store.receipt(revision.revisionId));
 }
 const store=createAirbnbBookingStore(async()=>{throw Error('PRIVATE_SENTINEL');});
 await assert.rejects(store.commit(revision),e=>e instanceof Error&&!String(e).includes('PRIVATE_SENTINEL'));
});
