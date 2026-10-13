import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ChannexPilotReader,normalizeAirbnbBooking} from '../channex-staging/pilot-reader.ts';
import {PILOTS} from '../channex-staging/core.ts';
const id='10000000-0000-0000-0000-000000000001';
const booking=()=>({type:'booking',id,attributes:{revision_id:id,property_id:PILOTS.front.propertyId,ota_name:'Airbnb',status:'new',arrival_date:'2027-02-01',departure_date:'2027-02-22',inserted_at:'2026-10-03T12:00:00Z',rooms:[{room_type_id:String(PILOTS.front.roomTypeId)}],customer:{email:'synthetic@example.invalid'},guarantee:{card_number:'sensitive-fixture'}}});
const thread=()=>({id,type:'message_thread',attributes:{title:'Synthetic inquiry',provider:'Airbnb',is_closed:false,message_count:0},relationships:{property:{data:{id:PILOTS.front.propertyId}},booking:{data:null}}});
function fixture(collection:unknown[],calls:string[]){return async(input:string|URL|Request,init?:RequestInit)=>{
 const url=new URL(String(input));calls.push(url.pathname);
 assert.equal(url.origin,'https://staging.channex.io');assert.equal(init?.method,'GET');assert.equal(init?.body,undefined);assert.equal(init?.redirect,'error');
 if(url.pathname.includes('/properties/'))return Response.json({data:{id:PILOTS.front.propertyId,attributes:{currency:'USD',timezone:'America/New_York'}}});
 if(url.pathname.includes('/room_types/'))return Response.json({data:{id:PILOTS.front.roomTypeId,attributes:{count_of_rooms:1,occ_adults:12},relationships:{property:{data:{id:PILOTS.front.propertyId}}}}});
 assert.equal(url.searchParams.get('filter[property_id]'),PILOTS.front.propertyId);
 return Response.json({data:collection,meta:{total:collection.length,page:1,limit:100}});
};}
test('Airbnb normalization excludes contact/payment payloads and rejects foreign properties and rooms',()=>{
 const raw=booking();assert.equal(normalizeAirbnbBooking(raw,'front').bookingId,id);
 assert.equal(JSON.stringify(normalizeAirbnbBooking(raw,'front')).includes('sensitive'),false);
 assert.throws(()=>normalizeAirbnbBooking(raw,'back'),/outside/);
 raw.attributes.rooms[0].room_type_id=PILOTS.back.roomTypeId;assert.throws(()=>normalizeAirbnbBooking(raw,'front'),/room/);
});
test('pilot reader reads approved bookings with no channel or write endpoint',async()=>{
 const calls:string[]=[];const reader=new ChannexPilotReader('synthetic',fixture([booking()],calls));
 const result=await reader.readBookings('front');assert.equal(result.bookings.length,1);assert.equal(result.inventoryAuthority,false);
 assert.deepEqual(calls,[`/api/v1/properties/${PILOTS.front.propertyId}`,`/api/v1/room_types/${PILOTS.front.roomTypeId}`,'/api/v1/bookings']);
 assert.equal('acknowledge' in reader,false);assert.equal('publish' in reader,false);
});
test('reader accepts Airbnb inquiry but rejects unowned thread before content request',async()=>{
 const calls:string[]=[];const reader=new ChannexPilotReader('synthetic',fixture([thread()],calls));
 assert.equal((await reader.readMessages('front')).threads[0].bookingId,null);
 await assert.rejects(()=>reader.readMessages('front','20000000-0000-0000-0000-000000000002'),/outside/);
 assert.equal(calls.some(path=>path.endsWith('/messages')),false);
});
test('unknown units fail before network; errors omit provider response',async()=>{
 let calls=0;const reader=new ChannexPilotReader('synthetic',async()=>{calls++;return new Response('private details',{status:403});});
 await assert.rejects(()=>reader.readBookings('whole' as 'front'),/Unknown/);assert.equal(calls,0);
 await assert.rejects(()=>reader.readBookings('front'),e=>e instanceof Error&&!e.message.includes('private details'));
});
test('duplicate pages and unsupported booking sources fail closed',async()=>{
 const raw=booking();raw.attributes.ota_name='Offline';assert.throws(()=>normalizeAirbnbBooking(raw,'front'),/outside/);
 const calls:string[]=[];const base=fixture([],calls);let page=0;
 const reader=new ChannexPilotReader('synthetic',async(input,init)=>String(input).includes('/message_threads')?Response.json({data:[thread()],meta:{total:2,page:++page,limit:100}}):base(input,init));
 await assert.rejects(()=>reader.readMessages('front'),/changed during pagination/);
});
