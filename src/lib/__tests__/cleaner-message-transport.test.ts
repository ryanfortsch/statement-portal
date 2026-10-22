import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCleanerTransport, messageHash } from '../cleaner-messaging/transport.ts';
import { quoFromNumber } from '../quo-lines.ts';
const text = 'HELMTEST arrival tomorrow at 4 PM.';
const target = { from: quoFromNumber('ops'), to: '+12025550101', bodySha256: messageHash(text) };
const row = () => ({ id: 'AC_HELMTEST_1', from: target.from, to: [target.to], direction: 'outgoing', text, status: 'queued', media: [] });
function fixture(overrides: { enabled?: boolean; status?: number; response?: unknown; error?: boolean } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = createCleanerTransport({ apiKey: 'HELMTEST-key', enabled: overrides.enabled ?? true, fetcher: async (url, init) => {
    calls.push({ url: String(url), init: init! });
    if (overrides.error) throw Error('HELMTEST-sensitive-provider-error');
    return Response.json(overrides.response ?? { data: row() }, { status: overrides.status ?? 202 });
  } });
  return { client, calls };
}
test('cleaner sends one private SMS after durable authorization with bounded transport', async () => {
  const f = fixture(); let claimed = 0;
  assert.deepEqual(await f.client.send(target,text,async()=>{claimed++;assert.equal(f.calls.length,0);return true;}), { state:'accepted',providerMessageId:'AC_HELMTEST_1' });
  assert.equal(claimed,1); assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].url,'https://api.quo.com/v1/messages');
  assert.deepEqual(JSON.parse(f.calls[0].init.body as string),{from:target.from,to:[target.to],content:text});
  assert.equal(f.calls[0].init.redirect,'error'); assert.equal(f.calls[0].init.cache,'no-store');
  assert.ok(f.calls[0].init.signal);
});
test('disabled, wrong audience, invalid target, placeholder and oversized body never claim or send', async () => {
  for (const [changes,body,enabled] of [ [{},text,false], [{from:quoFromNumber('guests')},text,true],
    [{to:'555'},text,true], [{to:target.from},text,true], [{},'{{guest_first}}',true], [{},'x'.repeat(1601),true],
    [{bodySha256:'0'.repeat(64)},text,true] ] as const) {
    const f=fixture({enabled});let claimed=0;
    assert.deepEqual(await f.client.send({...target,...changes},body,async()=>{claimed++;return true;}),{state:'blocked'});
    assert.equal(claimed,0);assert.equal(f.calls.length,0);
  }
});
test('lost or refused claim response never reaches provider',async()=>{
 for(const claim of [async()=>false,async()=>{throw Error('HELMTEST lost claim ack');}]){
  const f=fixture();assert.deepEqual(await f.client.send(target,text,claim),{state:'blocked'});assert.equal(f.calls.length,0);
 }
});
test('one request for every HTTP refusal/ambiguous result, with no raw error disclosure',async()=>{
 for(const status of [400,401,402,403,404,429,500,302,200]){
  const f=fixture({status,response:{error:'HELMTEST-private'}});
  assert.deepEqual(await f.client.send(target,text,async()=>true),{state:[400,401,402,403,404].includes(status)?'rejected':'unknown'});
  assert.equal(f.calls.length,1);
 }
 const f=fixture({error:true});assert.deepEqual(await f.client.send(target,text,async()=>true),{state:'unknown'});assert.equal(f.calls.length,1);
});
test('mismatched response target, body, direction, media or ID is unknown',async()=>{
 for(const change of [{to:[target.to,'+12025550102']},{from:'+12025550103'},{text:'other'},{direction:'incoming'},{media:[{}]},{id:'../other'}]){
  const f=fixture({response:{data:{...row(),...change}}});assert.deepEqual(await f.client.send(target,text,async()=>true),{state:'unknown'});
 }
});
test('API acceptance is distinct from authenticated delivered receipt',async()=>{
 for(const status of ['queued','sent','delivered','undelivered','received','new_status']){
  const f=fixture({status:200,response:{data:{...row(),status}}});
  assert.equal(await f.client.receipt(target,'AC_HELMTEST_1'),['delivered','undelivered'].includes(status)?status:'unconfirmed');
  assert.equal(f.calls[0].init.method,'GET');
 }
});
test('readback requires the exact message and historical target and body',async()=>{
 for(const change of [{id:'AC_OTHER'},{to:['+12025550109']},{from:'+12025550103'},{text:'other'},{direction:'incoming'}]){
  const f=fixture({status:200,response:{data:{...row(),status:'delivered',...change}}});assert.equal(await f.client.receipt(target,'AC_HELMTEST_1'),'unconfirmed');
 }
 const f=fixture({status:200});assert.equal(await f.client.receipt(target,'../messages'),'unconfirmed');assert.equal(f.calls.length,0);
});
test('response size cap cannot create acceptance',async()=>{
 const f=fixture({response:{data:{...row(),extra:'x'.repeat(70_000)}}});assert.deepEqual(await f.client.send(target,text,async()=>true),{state:'unknown'});
});
