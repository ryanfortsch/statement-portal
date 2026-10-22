// Called by the existing disposable PostgreSQL harness. Synthetic HTTP responses
// exercise the actual source readers; no provider or hosted database is contacted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CALDERWOOD } from '../src/lib/calderwood-readonly/guesty-reader.ts';
import { captureCalderwoodTiming } from '../src/lib/calderwood-readonly/timing-capture.ts';
import { readCalderwoodLocalClocks } from '../src/lib/calderwood-readonly/local-clock-reader.ts';
import { readCalderwoodConfirmations } from '../src/lib/calderwood-readonly/confirmation-reader.ts';
import { ingestReviewedMessageTiming } from '../src/lib/channex-messaging/timing-ingestion.ts';
import { prepareReviewedMessageQueue, readMessagePreparationSnapshot } from '../src/lib/channex-messaging/queue-preparation.ts';
export async function verifyTimingCapture({ db, bundle, scalar }) {
 let count=0;const pass=label=>{count++;console.log('PASS timing capture: '+label);};
 const f=await bundle();
 const capturedAt=new Date();
 const source={id:'000000000000000000000001',listingId:CALDERWOOD.guestyListingId,start:f.obs.check_in,end:f.obs.check_out,status:'confirmed',source:'HELMTEST',timing:{arrivalAt:null,departureAt:null,issues:[],clockVerified:false}};
 const initial={mode:'read-only-snapshot',executable:false,inventoryAuthority:false,paginationComplete:true,baselineComplete:false,missingEvidence:['independent-blocks','authoritative-revisions','channex-mapping','cross-provider-comparison'],window:{from:source.start,to:source.end},reservations:[source]};
 const fetched=[];
 const fetcher=async(url,init)=>{
  assert.equal(init.method,'GET');fetched.push(url);
  if(new URL(url).pathname==='/v1/reservations-v3')return Response.json([{_id:source.id,status:'confirmed',confirmedAt:f.obs.confirmed_at,
   stay:[{unitId:source.listingId,unitTypeId:source.listingId,checkInDateLocalized:source.start,checkOutDateLocalized:source.end}]}]);
  assert.equal(new URL(url).pathname,`/v1/reservations/${source.id}`);
  return Response.json({_id:source.id,listingId:source.listingId,status:'confirmed',checkInDateLocalized:source.start,checkOutDateLocalized:source.end,
   plannedArrival:null,plannedDeparture:null,listing:{timezone:'America/New_York',defaultCheckInTime:'16:00',defaultCheckOutTime:'11:00'}});
 };
 const {capture}=await captureCalderwoodTiming('HELMTEST',initial,{clock:()=>capturedAt,read:async()=>initial,
  localClocks:(token,rows)=>readCalderwoodLocalClocks(token,rows,fetcher),confirmations:(token,rows,now)=>readCalderwoodConfirmations(token,rows,now,fetcher)});
 assert.equal(fetched.length,4);assert.equal(capture.candidates.length,1);
 let calls=0;
 const rpc=async(name,args)=>{
  calls++;
  if(name==='automation_message_observe_times')return {data:await scalar('select automation_message_observe_times($1,$2,$3,$4) data',
   [args.p_booking_id,args.p_canonical_revision,args.p_expected_revision,args.p_observation]),error:null};
  if(name==='automation_message_preparation_snapshot')return {data:await scalar('select automation_message_preparation_snapshot($1) data',[args.p_booking_id]),error:null};
  assert.equal(name,'automation_message_prepare_handoff');
  return {data:await scalar('select automation_message_prepare_handoff($1,$2,$3) data',[args.p_booking_id,args.p_canonical_revision,JSON.stringify(args.p_entries)]),error:null};
 };
 const packet={capture,binding:{bookingId:f.booking,sourceReservationId:source.id,canonicalRevision:f.canonical,expectedObservationRevision:f.observation},
  review:{id:randomUUID(),reviewedAt:capturedAt.toISOString(),source:'guesty-local-clock-review',fingerprint:capture.fingerprint}};
 const observed=await ingestReviewedMessageTiming(rpc,packet,new Date());
 assert.equal(observed.canSend,false);assert.notEqual(observed.observationRevision,f.observation);
 assert.deepEqual(await ingestReviewedMessageTiming(rpc,packet,new Date()),observed);
 assert.equal(await scalar('select count(*)::int data from automation_message_observation_history where booking_id=$1',[f.booking]),2);
 const stored=await scalar('select to_jsonb(t) data from automation_channex_stay_times t where booking_id=$1',[f.booking]);
 assert.equal(stored.arrival_time,'16:00:00');assert.equal(stored.departure_time,'11:00:00');
 assert.equal(Date.parse(stored.confirmed_at),Date.parse(f.obs.confirmed_at));
 pass('actual reader output imports through owner compare/swap once, retaining local clocks and original confirmation time');
 const before=await scalar('select to_jsonb(o) data from automation_message_observations o where booking_id=$1',[f.booking]);
 for(const binding of [{...packet.binding,canonicalRevision:'f'.repeat(32)}, {...packet.binding,expectedObservationRevision:randomUUID()}]) {
  // A new evidence ID distinguishes a conflicting new review from exact replay.
  await assert.rejects(ingestReviewedMessageTiming(rpc,{...packet,binding,review:{...packet.review,id:randomUUID()}},new Date()),/unconfirmed/);
  assert.deepEqual(await scalar('select to_jsonb(o) data from automation_message_observations o where booking_id=$1',[f.booking]),before);
 }
 pass('changed canonical identity and stale observation tokens cannot overwrite the imported timing');
 const snapshot=await readMessagePreparationSnapshot(rpc,f.booking);
 assert.equal(snapshot.observation_revision,observed.observationRevision);
 const rows=(await db.query('select id,automation_id,automation_key,fire_at from automation_sends where booking_id=$1',[f.booking])).rows;
 const entries=f.entries.map(e=>({automation_id:rows.find(r=>r.id===e.send_id).automation_id,
  fire_at:rows.find(r=>r.id===e.send_id).fire_at.toISOString(),review:{...e.review,
   context_revision:snapshot.context_revision,observation_revision:observed.observationRevision,observed_at:capturedAt.toISOString()}}));
 // Source message history remains separately supplied HELMTEST evidence. The
 // collector must never manufacture the already-sent/stopped/drained decisions.
 const result=await prepareReviewedMessageQueue(rpc,{bookingId:f.booking,snapshot,entries});
 assert.equal(result.results.length,6);assert.equal(result.canSend,false);
 assert.equal(await scalar('select status data from automation_sends where id=$1',[rows.find(r=>r.automation_key==='key_code').id]),'held');
 assert.equal(await scalar('select enabled data from automation_channex_routes where property_id=$1',[f.property]),false);
 assert.equal(await scalar('select count(*)::int data from automation_cleaner_batches where property_id=$1 and enabled',[f.property]),0);
 assert.equal(calls,6);
 pass('captured and reviewed times feed the real six-workflow queue; held code and disabled guest/cleaner senders persist');
 console.log(`PASS ${count} additional PostgreSQL timing-capture scenarios; synthetic source and history only`);
}
