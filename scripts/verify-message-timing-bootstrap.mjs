// Runs only inside the disposable local PostgreSQL messaging harness.
import assert from 'node:assert/strict';
import { verifyReceiptTiming } from './verify-message-receipt-timing.mjs';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ingestReviewedMessageTiming } from '../src/lib/channex-messaging/timing-ingestion.ts';
import { timingCaptureFingerprint } from '../src/lib/calderwood-readonly/timing-capture.ts';
import { CALDERWOOD } from '../src/lib/calderwood-readonly/guesty-reader.ts';
import { CALDERWOOD_STAGING as mapping } from '../src/lib/calderwood-readonly/channex.ts';
export async function verifyTimingBootstrap({db,a,b,scalar,connection,generation}) {
 let count=0;const pass=s=>{count++;console.log('PASS timing bootstrap: '+s);};
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/message-timing-bootstrap.sql',import.meta.url),'utf8'));
 const fixture=async()=>{
  const booking=randomUUID(),remote=randomUUID(),revision=randomUUID(),now=new Date();
  await db.query("insert into bookings(id,property_id,status,check_in,check_out,channel,guest_name,source_ref,source) values($1,'HELMTEST-calderwood','confirmed','2027-02-01','2027-02-04','other','HELMTEST',$2,'manual')",[booking,'channex-staging:'+remote]);
  const code='HELMTEST-bootstrap-'+remote;
  await db.query('insert into helm_channex_revisions.bookings values($1,$2,$3,$4,$5)',[remote,booking,code,now,revision]);
  await db.query("insert into helm_channex_revisions.receipts(revision_id,canonical_id,revision,outcome) values($1,$2,$3,'applied')",[revision,booking,
   {id:revision,bookingId:remote,...mapping,code,status:'new',checkIn:'2027-02-01',checkOut:'2027-02-04',receivedAt:now.toISOString()}]);
  const candidate={reservationId:'000000000000000000000001',listingId:CALDERWOOD.guestyListingId,checkIn:'2027-02-01',checkOut:'2027-02-04',
   arrivalAt:'2027-02-01T21:00:00Z',departureAt:'2027-02-04T16:00:00Z',confirmedAt:new Date(now.getTime()-86400000).toISOString(),
   arrivalBasis:'listing.defaultCheckInTime',departureBasis:'listing.defaultCheckOutTime'};
  const fingerprint=timingCaptureFingerprint([candidate],[]);
  const packet={capture:{mode:'review-only-timing-capture',canSend:false,automaticImport:false,startedAt:now.toISOString(),finishedAt:now.toISOString(),fingerprint,candidates:[candidate],incompleteReservationIds:[]},
   binding:{bookingId:booking,sourceReservationId:candidate.reservationId,canonicalRevision:await scalar('select automation_message_stay_revision($1) data',[booking]),expectedObservationRevision:null},
   review:{id:randomUUID(),reviewedAt:now.toISOString(),source:'guesty-local-clock-review',fingerprint},
   dateFeed:{remoteBookingId:remote,connection,generation,expiresAt:new Date(now.getTime()+86400000).toISOString(),enabled:false}};
  return {booking,remote,revision,packet};
 };
 const rpc=(client=db,lose=false)=>async(name,p)=>{
  assert.equal(name,'helm_pilot_message_times_bootstrap');
  const data=await scalar('select helm_pilot_message_times_bootstrap($1,$2,$3,$4,$5,$6,$7,$8,$9) data',
   [p.p_booking_id,p.p_remote_id,p.p_canonical_revision,p.p_expected_revision,p.p_observation,p.p_connection,p.p_generation,p.p_expires_at,p.p_enabled],client);
  if(lose)throw Error('HELMTEST lost response');return {data,error:null};
 };
 const stored=booking=>scalar(`select jsonb_build_object('observation',(select to_jsonb(o) from automation_message_observations o where booking_id=$1),
  'timing',(select to_jsonb(t) from automation_channex_stay_times t where booking_id=$1),
  'history',(select count(*) from automation_message_observation_history where booking_id=$1),
  'policy',(select to_jsonb(p) from helm_channex_revisions.message_timing_policies p where booking_id=$1)) data`,[booking]);
 let f=await fixture();const receipt=await ingestReviewedMessageTiming(rpc(),f.packet);
 assert.equal(receipt.state,'registered');assert.equal(receipt.enabled,false);assert.equal(receipt.canSend,false);
 let saved=await stored(f.booking);assert.equal(saved.history,1);assert.equal(saved.policy.latest_observation,receipt.observationRevision);
 assert.equal(saved.timing.arrival_time,'16:00:00');assert.equal(saved.timing.departure_time,'11:00:00');
 assert.equal(Date.parse(saved.timing.confirmed_at),Date.parse(f.packet.capture.candidates[0].confirmedAt));
 assert.deepEqual(await ingestReviewedMessageTiming(rpc(),f.packet),receipt);assert.deepEqual(await stored(f.booking),saved);
 pass('actual adapter atomically records verified clocks and policy; exact replay retains both identities');
 f=await fixture();const before=await stored(f.booking);
 for(const change of [p=>{p.dateFeed.remoteBookingId=randomUUID();},p=>{p.dateFeed.generation=2;},p=>{p.binding.canonicalRevision='f'.repeat(32);},p=>{p.binding.expectedObservationRevision=randomUUID();}]){
  const packet=structuredClone(f.packet);change(packet);await assert.rejects(ingestReviewedMessageTiming(rpc(),packet),/unconfirmed/);
  assert.deepEqual(await stored(f.booking),before);
 }
 pass('wrong remote binding, route, canonical revision or observation token leaves no partial import');
 // Force a downstream registration refusal, after observation would have written.
 await db.query("update helm_channex_revisions.receipts set outcome='stale' where revision_id=$1",[f.revision]);
 await assert.rejects(ingestReviewedMessageTiming(rpc(),f.packet),/unconfirmed/);assert.deepEqual(await stored(f.booking),before);
 await db.query("update helm_channex_revisions.receipts set outcome='applied' where revision_id=$1",[f.revision]);
 pass('registration rejection rolls back timing rows and audit history, not merely the policy');
 f=await fixture();f.packet.dateFeed.enabled=true;
 const paired=await Promise.all([ingestReviewedMessageTiming(rpc(a),f.packet),ingestReviewedMessageTiming(rpc(b),f.packet)]);
 assert.deepEqual(paired[0],paired[1]);saved=await stored(f.booking);assert.equal(saved.history,1);assert.equal(saved.policy.enabled,true);
 pass('concurrent bootstrap attempts converge on one observation and one date-refresh policy');
 // A new reviewed clock cannot overwrite the immutable policy or its observation.
 const conflict=structuredClone(f.packet);conflict.binding.expectedObservationRevision=paired[0].observationRevision;
 const clock=new Date();conflict.capture.startedAt=conflict.capture.finishedAt=conflict.review.reviewedAt=clock.toISOString();
 conflict.capture.candidates[0].arrivalAt='2027-02-01T22:00:00Z';conflict.review.id=randomUUID();
 conflict.capture.fingerprint=conflict.review.fingerprint=timingCaptureFingerprint(conflict.capture.candidates,[]);
 await assert.rejects(ingestReviewedMessageTiming(rpc(),conflict),/unconfirmed/);assert.deepEqual(await stored(f.booking),saved);
 pass('conflicting re-review rolls back a proposed new clock and preserves the registered policy');
 // Feed the registered policy into the existing worker RPC after a durable move.
 const moved=randomUUID(),at=new Date().toISOString();
 const oldReceipt=await scalar('select revision data from helm_channex_revisions.receipts where revision_id=$1',[f.revision]);
 await db.query('update bookings set check_in=check_in+2,check_out=check_out+2 where id=$1',[f.booking]);
 await db.query("insert into helm_channex_revisions.receipts(revision_id,canonical_id,revision,outcome) values($1,$2,$3,'applied')",[moved,f.booking,
  {...oldReceipt,id:moved,status:'modified',checkIn:'2027-02-03',checkOut:'2027-02-06',receivedAt:at}]);
 await db.query('update helm_channex_revisions.bookings set latest_revision=$1,latest_at=$2 where canonical_id=$3',[moved,at,f.booking]);
 await db.query('set role service_role');let refreshed;
 try{refreshed=await scalar('select helm_pilot_message_times_refresh($1,$2,100) data',[connection,generation]);}finally{await db.query('reset role');}
 assert.equal(refreshed.refreshed,1);assert.equal(refreshed.canSend,false);
 const advanced=await stored(f.booking);assert.equal(advanced.history,2);assert.equal(advanced.timing.check_in,'2027-02-03');
 assert.equal(advanced.timing.arrival_time,saved.timing.arrival_time);assert.equal(advanced.timing.departure_time,saved.timing.departure_time);
 assert.equal(advanced.timing.confirmed_at,saved.timing.confirmed_at);assert.equal(advanced.policy.latest_provider_revision,moved);
 pass('bootstrapped policy follows a durable date move through the real service worker RPC without changing clocks or confirmation');
 f=await fixture();await assert.rejects(ingestReviewedMessageTiming(rpc(db,true),f.packet),/unconfirmed/);
 saved=await stored(f.booking);assert.equal(saved.history,1);
 const recovered=await ingestReviewedMessageTiming(rpc(),f.packet);assert.equal(recovered.policyId,saved.policy.policy_id);
 assert.deepEqual(await stored(f.booking),saved);
 pass('lost committed reply is unconfirmed; explicit reconciliation of exact packet produces no duplicate');
 for(const role of ['anon','authenticated','service_role']){
  await db.query('set role '+role);try{await assert.rejects(ingestReviewedMessageTiming(rpc(),f.packet),/unconfirmed/);}finally{await db.query('reset role');}
 }
 assert.deepEqual(await stored(f.booking),saved);
 pass('browser and worker roles cannot bootstrap or enable timing policies');
 const guarded=await scalar("select jsonb_build_object('jobs',(select count(*) from automation_sends s join bookings b on b.id=s.booking_id where b.property_id='HELMTEST-calderwood'),'enabled',(select automations_enabled from properties where id='HELMTEST-calderwood'),'routes',(select count(*) from automation_channex_routes where property_id='HELMTEST-calderwood'),'cleaners',(select count(*) from automation_cleaner_batches where property_id='HELMTEST-calderwood')) data");
 assert.deepEqual(guarded,{jobs:0,enabled:false,routes:0,cleaners:0});
 pass('bootstrap creates no send jobs, recipients or sender activation');
 console.log(`PASS ${count} additional timing-bootstrap PostgreSQL scenarios; synthetic source only`);
 await verifyReceiptTiming({db,scalar,connection,generation});
}
