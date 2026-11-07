/** Actual Postgres + production adapter/worker, fake provider only. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createChannexJobStore } from '../src/lib/channex-messaging/store.ts';
import { ChannexMessageWorker } from '../src/lib/channex-messaging/worker.ts';
import { ChannexMessageTransport } from '../src/lib/channex-messaging/transport.ts';
if (process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='helm_synthetic_channex') throw Error('Synthetic loopback database required');
const psql=process.env.CHANNEX_TEST_PSQL||'psql';
function sql(query:string) {
 const r=spawnSync(psql,['-X','-Atq','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});
 if(r.status) throw Error(r.stderr); return r.stdout.trim();
}
const str=(s:string)=>"'"+s.replaceAll("'","''")+"'";
const read=(p:string)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
assert.equal(sql('select current_database();'),'helm_synthetic_channex');
const plumbing=read('supabase/migrations/20260926200000_helm_pms_plumbing.sql');
const table=(name:string)=>{
 const start=plumbing.indexOf(`create table if not exists public.${name} (`);
 const end=plumbing.indexOf('\n);',start);assert.ok(start>=0&&end>start);return plumbing.slice(start,end+3);
};
sql(read('scripts/tests/channex-messages-fixture.sql')+'\n'+table('message_automations')+'\n'+table('automation_sends')+'\n'
 +read('supabase/migrations/20261107090000_channex_message_queue.sql')+'\n'+read('scripts/tests/channex-messages.sql'));
const id=(n:number)=>`90000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const send=id(2), text='HELMTEST synthetic automated welcome';
const sha=createHash('sha256').update(text).digest('hex');
const attempt={environment:'production' as const,propertyId:'320c5cb5-91e0-46af-b9b3-a3fc20b4631e',
 channelId:id(4),provider:'Airbnb' as const,bookingId:id(5),threadId:id(6),bodySha256:sha};
const setup=()=>sql(`select channex_synthetic_message_setup(); update helm_channex_messages.jobs set body_sha256=${str(sha)};`);
let loseClaim=false,loseFinish=false;
const store=createChannexJobStore(async(name,args)=>{
 const a=name==='helm_channex_message_read'?`${str(String(args.p_send_id))}::uuid`:
 name==='helm_channex_message_claim'?`${str(String(args.p_send_id))}::uuid,${str(String(args.p_attempt_id))}::uuid,${str(JSON.stringify(args.p_attempt))}::jsonb`:
 name==='helm_channex_message_finish'?`${str(String(args.p_send_id))}::uuid,${str(String(args.p_attempt_id))}::uuid,${str(String(args.p_state))},${args.p_provider_id?str(String(args.p_provider_id))+'::uuid':'null'},${args.p_rejection_status??'null'}`:null;
 assert.ok(a);const data=JSON.parse(sql(`set role service_role; select to_jsonb(public.${name}(${a}));`));
 if(name==='helm_channex_message_claim'&&loseClaim)throw Error('Synthetic lost claim response');
 if(name==='helm_channex_message_finish'&&loseFinish)throw Error('Synthetic lost finish response');
 return {data,error:null};
});
const relation=(type:string,id:string)=>({data:{type,id}});
const messageId=randomUUID();let posts=0,timeout=false;
const message={id:messageId,type:'message',attributes:{message:text,sender:'property',attachments:[]},relationships:{message_thread:relation('message_thread',attempt.threadId)}};
const transport=new ChannexMessageTransport({scope:attempt,apiKey:'synthetic-only',sendEnabled:true,fetcher:async(_url,init)=>{
 if(init?.method==='POST'){
  posts++;assert.equal(sql(`select state from helm_channex_messages.jobs where send_id=${str(send)}::uuid;`),'attempting');
  if(timeout)throw Error('Synthetic timeout');return Response.json({data:message});
 }
 if(String(_url).includes('/messages?'))return Response.json({data:[message],meta:{total:1,page:1,limit:100}});
 return Response.json({data:{id:attempt.threadId,type:'message_thread',attributes:{provider:'Airbnb',is_closed:false},relationships:{property:relation('property',attempt.propertyId),channel:relation('channel',attempt.channelId),booking:relation('booking',attempt.bookingId)}}});
}});
const worker=()=>new ChannexMessageWorker({store,transport,enabled:true});
const render=async()=>({text,contextRevision:(await store.read(send))!.contextRevision});
setup();assert.equal((await worker().dispatch(send,render)).state,'accepted');assert.equal(posts,1);
assert.equal((await worker().dispatch(send,render)).state,'needs_reconciliation');assert.equal(posts,1);
assert.equal((await worker().reconcile(send)).state,'recorded');assert.equal(posts,1);
setup();loseClaim=true;assert.equal((await worker().dispatch(send,render)).state,'ledger_uncertain');loseClaim=false;
assert.equal((await worker().dispatch(send,render)).state,'needs_reconciliation');assert.equal(posts,1);
setup();timeout=true;assert.equal((await worker().dispatch(send,render)).state,'unknown');timeout=false;
assert.equal((await worker().dispatch(send,render)).state,'needs_reconciliation');assert.equal(posts,2);
setup();loseFinish=true;const lost=await worker().dispatch(send,render);assert.equal(lost.state,'ledger_uncertain');loseFinish=false;
assert.equal((await worker().dispatch(send,render)).state,'needs_reconciliation');assert.equal(posts,3);
assert.equal((await worker().reconcile(send)).state,'recorded');assert.equal(posts,3);
setup();sql(`update public.property_access set smart_lock_code='synthetic-changed';`);
assert.equal((await worker().dispatch(send,render)).state,'blocked');assert.equal(posts,3);
setup();sql(`select helm_channex_message_set_hold(${str(send)},1,true,'synthetic-operator');`);
assert.equal((await worker().dispatch(send,render)).state,'blocked');assert.equal(posts,3);
assert.equal(sql(`select helm_channex_message_set_hold(${str(send)},2,false,'synthetic-operator');`),'t');
assert.equal((await worker().dispatch(send,render)).state,'accepted');assert.equal(posts,4);
console.log('PASS: production SQL + adapter + worker + fake transport; acceptance/readback, restart, lost claims/receipts, unknown outcomes, context changes and hold/release');
