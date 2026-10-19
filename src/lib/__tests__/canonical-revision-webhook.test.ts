import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { canonicalRehearsalEnabled, handleCanonicalRevisionWebhook, verifyCanonicalSignature } from '../channex-staging/canonical-revision-webhook.ts';
import { CALDERWOOD_STAGING } from '../calderwood-readonly/channex.ts';
const now=1792418400000,ts=String(now/1000),secret='synthetic-fixture-only';
const id='11111111-1111-4111-8111-111111111111',booking='22222222-2222-4222-8222-222222222222';
const notice={event:'booking',property_id:CALDERWOOD_STAGING.propertyId,
  payload:{property_id:CALDERWOOD_STAGING.propertyId,booking_id:booking,revision_id:id}};
const sign=(body:string,stamp=ts,key=secret)=>createHmac('sha256',key).update(stamp+'.'+body).digest('hex');
function request(body=JSON.stringify(notice),signature=sign(body),stamp=ts) {
  return new Request('https://example.invalid/api/webhooks/channex-staging',{method:'POST',body,headers:{
    'content-type':'application/json','x-hmac-timestamp':stamp,'x-hmac-signature-256':signature}});
}
test('only explicitly enabled pilot preview can run the webhook',()=>{
  const good={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/channex-staging-pilot',CHANNEX_STAGING_ENABLED:'true',CHANNEX_CANONICAL_REHEARSAL_ENABLED:'true'};
  assert.equal(canonicalRehearsalEnabled(good),true);
  for(const key of Object.keys(good))assert.equal(canonicalRehearsalEnabled({...good,[key]:'other'}),false);
});
test('signed notice pulls authoritative ID and only returns 200 after successful durable processing',async()=>{
  let calls=0;
  const response=await handleCanonicalRevisionWebhook(request(),{enabled:true,secret,now:()=>now,run:async(r,b)=>{
    assert.equal(r,id);assert.equal(b,booking);calls++;
  }});
  assert.equal(response.status,200);assert.equal(calls,1);
});
test('bad signature, expired/future timestamp, missing signature and altered bytes never reach ingestion',async()=>{
  const body=JSON.stringify(notice);
  for(const req of [request(body,'0'.repeat(64)),request(body,sign(body,String(now/1000-301)),String(now/1000-301)),
    request(body,sign(body,String(now/1000+301)),String(now/1000+301)),request(body,''),request(body+' ',sign(body))]) {
    const response=await handleCanonicalRevisionWebhook(req,{enabled:true,secret,now:()=>now,run:async()=>{assert.fail('must not run');}});
    assert.equal(response.status,401);
  }
});
test('rotation accepts either of the two documented signatures, but malformed/trailing signatures fail',()=>{
  const body=JSON.stringify(notice),base=new Headers({'x-hmac-timestamp':ts});
  for(const value of [sign(body),sign(body,ts,'old')+','+sign(body)]) {
    base.set('x-hmac-signature-256',value);assert.equal(verifyCanonicalSignature(Buffer.from(body),base,secret,now),true);
  }
  for(const value of [sign(body)+',',sign(body)+',00',sign(body)+','+sign(body)+','+sign(body)]) {
    base.set('x-hmac-signature-256',value);assert.equal(verifyCanonicalSignature(Buffer.from(body),base,secret,now),false);
  }
});
test('wrong property/event/booking ID and oversized notices are refused',async()=>{
  for(const value of [{...notice,property_id:booking},{...notice,event:'message'},{...notice,payload:{...notice.payload,property_id:booking}},
    {...notice,payload:{...notice.payload,booking_id:'bad'}}]) {
    const body=JSON.stringify(value),r=await handleCanonicalRevisionWebhook(request(body),{enabled:true,secret,now:()=>now,run:async()=>{assert.fail('must not run');}});
    assert.equal(r.status,400);
  }
  const response=await handleCanonicalRevisionWebhook(request('x'.repeat(16385)),{enabled:true,secret,now:()=>now,run:async()=>{assert.fail('must not run');}});
  assert.equal(response.status,413);
});
test('disabled/missing-key path and a failed database/provider path cannot claim success',async()=>{
  for(const options of [{enabled:false,secret},{enabled:true,secret:''}])
    assert.equal((await handleCanonicalRevisionWebhook(request(),{...options,now:()=>now,run:async()=>{assert.fail('must not run');}})).status,404);
  const response=await handleCanonicalRevisionWebhook(request(),{enabled:true,secret,now:()=>now,run:async()=>{throw Error('private details');}});
  assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private details/);
});
