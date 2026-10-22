import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { prepareReviewedMessageQueue, readMessagePreparationSnapshot } from '../channex-messaging/queue-preparation.ts';
const fixture = () => {
 const snapshot = { canonical_revision: 'a'.repeat(32), context_revision: 'b'.repeat(32), observation_revision: randomUUID() };
 const entries = ['confirmation','pre_arrival','key_code','pre_checkout','cleaner_advance','cleaner_arrival'].map(workflow => ({
  automation_id: randomUUID(), fire_at: '2027-02-01T15:00:00Z', review: {
   review_id: randomUUID(), context_revision: snapshot.context_revision, observation_revision: snapshot.observation_revision,
   workflow, complete: true, queued: false, uncertain: false, evidence_id: 'HELMTEST-proof', observed_at: '2027-01-01T10:00:00Z',
   ...(workflow === 'confirmation' ? { sent: true, source_account_id: 'HELMTEST-account', source_reservation_id: 'HELMTEST-stay',
    recipient_refs: ['guest'], messages: [{ id: 'HELMTEST-message', recipient_ref: 'guest', sent_at: '2027-01-01T09:00:00Z' }] } :
    { sent: false, stopped_at: '2027-01-01T09:00:00Z', drained_at: '2027-01-01T09:30:00Z', expires_at: '2027-02-03T00:00:00Z',
     ...(workflow.startsWith('cleaner') ? { from_number: '+12025550140', recipient_phones: ['+12025550141'] } : {}) }),
  },
 }));
 const input = { bookingId: randomUUID(), snapshot, entries };
 const output = entries.map(e => ({ send_id: randomUUID(), workflow: e.review.workflow, result: e.review.sent ? 'source_sent' : 'future_registered' }));
 return { input, output };
};
test('all six workflows are submitted in one owner transaction; returned IDs are verified and no sends are enabled', async () => {
 const {input,output} = fixture(); let calls=0;
 const result = await prepareReviewedMessageQueue(async (name,args) => { calls++; assert.equal(name,'automation_message_prepare_handoff');
  assert.deepEqual(args,{p_booking_id:input.bookingId,p_canonical_revision:input.snapshot.canonical_revision,p_entries:input.entries});
  return {data:output,error:null}; }, input);
 assert.equal(calls,1);assert.equal(result.state,'prepared');assert.equal(result.canSend,false);assert.equal(result.results.length,6);
});
test('partial, repeated, unreviewed and changed-context packets never reach storage', async () => {
 const {input}=fixture(); let calls=0;const rpc=async()=>{calls++;return {data:null,error:null};};
 for (const invalid of [{...input,entries:input.entries.slice(0,5)}, {...input,entries:[...input.entries.slice(0,5),input.entries[0]]},
  {...input,snapshot:{...input.snapshot,context_revision:'c'.repeat(32)}},
  {...input,entries:input.entries.map((e,i)=>i===5?{...e,review:{...e.review,uncertain:true}}:e)},
  {...input,entries:input.entries.map((e,i)=>i===5?{...e,review:{...e.review,body:'HELMTEST-sensitive'}}:e)}]) {
  await assert.rejects(prepareReviewedMessageQueue(rpc,invalid));
 }
 assert.equal(calls,0);
});
test('lost acknowledgement is unconfirmed with one call, sanitized error and no automatic retry', async () => {
 const {input}=fixture();let calls=0;
 await assert.rejects(prepareReviewedMessageQueue(async()=>{calls++;throw Error('HELMTEST-private-provider-detail');},input),e=>
  e instanceof Error && e.message.includes('unconfirmed') && !e.message.includes('private-provider'));
 assert.equal(calls,1);
});
test('partial, duplicated, inconsistent and errored receipts never claim queue preparation succeeded', async()=>{
 const {input,output}=fixture();
 for(const response of [{data:output.slice(0,5),error:null},{data:[...output.slice(0,5),output[0]],error:null},
  {data:output.map((r,i)=>i===0?{...r,result:'future_registered'}:r),error:null},{data:output,error:{message:'HELMTEST-detail'}}]) {
  await assert.rejects(prepareReviewedMessageQueue(async()=>response,input),/unconfirmed/);
 }
});
test('snapshot is explicit about missing verified timing and rejects malformed context without leaking raw errors', async()=>{
 const {input}=fixture();
 assert.deepEqual(await readMessagePreparationSnapshot(async(name,args)=>{assert.equal(name,'automation_message_preparation_snapshot');
  assert.deepEqual(args,{p_booking_id:input.bookingId});return {data:input.snapshot,error:null};},input.bookingId),input.snapshot);
 assert.equal(await readMessagePreparationSnapshot(async()=>({data:null,error:null}),input.bookingId),null);
 await assert.rejects(readMessagePreparationSnapshot(async()=>({data:{raw:'HELMTEST-private'},error:null}),input.bookingId),/context unavailable/);
 let calls=0;await assert.rejects(readMessagePreparationSnapshot(async()=>{calls++;return {data:null,error:null};},'invalid'),/identity/);assert.equal(calls,0);
});
