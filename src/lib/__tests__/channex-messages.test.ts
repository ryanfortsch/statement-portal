import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PILOTS} from '../channex-staging/core.ts';
import {normalizePilotThread,normalizePilotMessage} from '../channex-staging/messages.ts';
import {ChannexStagingClient} from '../channex-staging/client.ts';
const threadId='10000000-0000-0000-0000-000000000001';
const messageId='20000000-0000-0000-0000-000000000001';
const thread=()=>({id:threadId,type:'message_thread',attributes:{title:'Synthetic inquiry',provider:'Airbnb',is_closed:false,message_count:1},relationships:{property:{data:{id:PILOTS.front.propertyId}},booking:{data:null}}});
const message=()=>({id:messageId,type:'message',attributes:{message:'<script>synthetic</script>',sender:'guest',attachments:[],inserted_at:'2026-10-02T12:00:00.123456',updated_at:'2026-10-02T12:00:00.123456'},relationships:{message_thread:{data:{id:threadId}}}});
test('inquiries retain null booking; property isolation rejects sibling data',()=>{
 assert.equal(normalizePilotThread(thread(),'front').bookingId,null);
 assert.throws(()=>normalizePilotThread(thread(),'back'),/outside/);
});
test('message text remains inert text; attachment content is excluded',()=>{
 const raw=message();raw.attributes.attachments=['https://example.invalid/private'] as never[];
 const normalized=normalizePilotMessage(raw,threadId);
 assert.equal(normalized.text,'<script>synthetic</script>');assert.equal(normalized.attachmentCount,1);
 assert.equal(JSON.stringify(normalized).includes('private'),false);
 assert.throws(()=>normalizePilotMessage(raw,messageId),/outside/);
});
class FixtureClient extends ChannexStagingClient{async inspectReadSource(){return [];}}
function fixture(data:unknown[],total=data.length,page=1){return Response.json({data,meta:{total,page,limit:100}});}
test('message reads use GET only and reject foreign IDs before content request',async()=>{
 const calls:string[]=[];
 const client=new FixtureClient('synthetic',async(input,init)=>{
  assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');
  const url=new URL(String(input));calls.push(url.pathname);assert.equal(url.searchParams.get('filter[property_id]'),PILOTS.front.propertyId);
  return fixture(url.pathname.endsWith('/messages')?[message()]:[thread()]);
 });
 const result=await client.readMessages('front',threadId);assert.equal(result.messages.length,1);
 await assert.rejects(()=>client.readMessages('front',messageId),/not found/);
 assert.equal(calls.filter(p=>p.endsWith('/messages')).length,1);
});
test('incomplete and duplicate pages fail instead of showing partial history',async()=>{
 let page=0;
 const client=new FixtureClient('synthetic',async()=>fixture([thread()],2,++page));
 await assert.rejects(()=>client.readMessages('front'),/changed during pagination/);
 const empty=new FixtureClient('synthetic',async()=>fixture([],1));
 await assert.rejects(()=>empty.readMessages('front'),/Incomplete/);
});
test('provider errors cannot disclose body content',async()=>{
 const client=new FixtureClient('synthetic',async()=>new Response('private provider details',{status:403}));
 await assert.rejects(()=>client.readMessages('front'),e=>e instanceof Error&&!e.message.includes('private provider details'));
});
