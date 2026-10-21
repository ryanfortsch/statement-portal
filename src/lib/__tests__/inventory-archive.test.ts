import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { prepareInventoryArchive, verifyInventoryArchive, archiveBookingInventory } from '../channex-staging/inventory-archive.ts';
import { inventoryJournalVersion, inventoryResumeAfter, recordInventoryCommand, type InventoryJournal } from '../channex-staging/inventory-journal.ts';
import { createAvailabilityRequest } from '../channex-staging/availability-request.ts';
import { inventoryDigest } from '../channex-staging/inventory-outbox.ts';
import type { BookingInventoryState } from '../channex-staging/booking-inventory-consumer.ts';
const property='HELMTEST-calderwood', connection='calderwood-hosted-inventory';
const listing='f795ae2c-f47d-4751-86ff-e883b6d30800';
const intent={id:'fixture-1',environment:'staging' as const,property,connection,generation:1,version:1,
  days:[{date:'2027-01-01',available:0 as const,stopSell:true}]};
const request=createAvailabilityRequest([{property_id:'30584a9a-8784-4eb1-a387-e26bd43aec1c',room_type_id:listing,
  date:'2027-01-01',availability:0}],100);
const token='fixture-1:1', task='11111111-1111-4111-8111-111111111111';
const context={environment:'staging' as const,property,connection,generation:1,version:1,digest:inventoryDigest(intent.days),
  authority:'helm' as const,enabled:true,complete:true,freshUntil:10000};
function state(commands?:InventoryJournal['commands']):BookingInventoryState {
  const journal:InventoryJournal={format:1,commands:commands??[
    {kind:'enqueue',intent,now:0},{kind:'claim',id:intent.id,now:100,leaseMs:1000},
    {kind:'dispatch',id:intent.id,token,context,now:100,request},
    {kind:'accepted',id:intent.id,token,task,receipt:{requestDigest:request.digest,receivedAt:101}},
    {kind:'reconcile',id:intent.id,token,evidence:{settled:true,complete:true,generation:1,digest:context.digest,
      task,requestDigest:request.digest,completion:{receivedAt:101,executedAt:102,finishedAt:103,observedAt:104}}}
  ]};
  return {property,captureEnabled:true,captureVersion:3,configurationVersion:2,
    configuration:{environment:'staging',topology:'single-unit',connection,listing,generation:1,publishEnabled:false,
      timeZone:'America/New_York',start:'2027-01-01',end:'2027-01-02',requiredSources:['synthetic-canonical'],coverage:[]},
    plannedCaptureVersion:3,plannedConfigurationVersion:1,planVersion:1,journalVersion:journal.commands.length,journal,
    lastDigest:context.digest,plannedFreshUntil:0,inputsMatchPlan:false,
    inputs:{authority:'helm',plan:null,bookings:[],rateDays:[],periods:[]}};
}
test('archive preserves exact request/receipt/completion and fences old desired versions',async()=>{
  const s=state(),before=structuredClone(s),a=prepareInventoryArchive(s),verified=verifyInventoryArchive(a);
  assert.deepEqual(s,before);assert.deepEqual(verified.journal,s.journal);assert.equal(verified.previous,null);
  assert.equal(inventoryJournalVersion(a.next),6);assert.equal(a.next.commands.length,0);assert.equal(inventoryResumeAfter(a.next),6100);
  const store={read:async()=>({version:6,journal:a.next}),append:async()=>{throw Error('must not persist');}};
  for(const change of [{version:1},{version:2,generation:2},{version:2,connection:'wrong'},{version:2,property:'wrong'}]) {
    await assert.rejects(()=>recordInventoryCommand(store,{kind:'enqueue',intent:{...intent,...change},now:6100}),/Archived inventory version/);
  }
});
test('every unresolved status and a pending retry refuses archival; untouched pending can retire',()=>{
  const full=(state().journal as InventoryJournal).commands;
  for(const end of [2,3,4])assert.throws(()=>prepareInventoryArchive(state(full.slice(0,end))),/Outstanding/);
  const ambiguous=[...full.slice(0,3),{kind:'ambiguous' as const,id:intent.id,token}];
  assert.throws(()=>prepareInventoryArchive(state(ambiguous)),/Outstanding/);
  const retry=[...full.slice(0,3),{kind:'rejected' as const,id:intent.id,token,failure:'retryable' as const,now:200,retryAfterMs:90000,jitter:0}];
  assert.throws(()=>prepareInventoryArchive(state(retry)),/Outstanding/);
  const failed=structuredClone(full);const last=failed.at(-1)!;if(last.kind==='reconcile')last.evidence.digest='wrong';
  assert.throws(()=>prepareInventoryArchive(state(failed)),/Outstanding/);
  assert.equal(verifyInventoryArchive(prepareInventoryArchive(state(full.slice(0,1)))).jobs[0].status,'pending');
});
test('paused route, legacy unbound evidence, corrupt bytes and changed checkpoint fail closed',()=>{
  for(const change of [{publishEnabled:true},{connection:'wrong'},{generation:2},{listing:'wrong'}]) {
    const s=state();Object.assign(s.configuration,change);assert.throws(()=>prepareInventoryArchive(s));
  }
  const s=state(),j=s.journal as InventoryJournal;
  for(const cmd of j.commands){if(cmd.kind==='dispatch')delete cmd.request;if(cmd.kind==='accepted')delete cmd.receipt;}
  assert.throws(()=>prepareInventoryArchive(s),/Unbound/);
  const a=prepareInventoryArchive(state());assert.throws(()=>verifyInventoryArchive({...a,text:a.text+' '}),/fingerprint/);
  assert.throws(()=>verifyInventoryArchive({...a,next:{...a.next,commands:[{kind:'expire',now:0}]}}),/checkpoint/);
  const raw=JSON.parse(a.text);raw.resumeAfter=0;const text=JSON.stringify(raw),id=createHash('sha256').update(text).digest('hex');
  assert.throws(()=>verifyInventoryArchive({id,text,next:{...a.next,archiveId:id,resumeAfter:0} as InventoryJournal}),/checkpoint/);
});
test('new-process replay carries pacing and cannot resurrect archived job tokens',()=>{
  const a=prepareInventoryArchive(state());
  const url=new URL('../channex-staging/inventory-journal.ts',import.meta.url).href;
  const code=`import {replayInventoryJournal,inventoryJournalVersion,inventoryResumeAfter} from ${JSON.stringify(url)};
    const j=JSON.parse(process.argv[1]); const r=replayInventoryJournal(j);
    if(r.queue.list().length||inventoryJournalVersion(j)!==6||inventoryResumeAfter(j)!==6100)process.exit(2);
    try {r.queue.accepted('fixture-1','fixture-1:1','old');process.exit(3);}catch{}
    console.log('old-attempt-fenced');`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code,JSON.stringify(a.next)],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/old-attempt-fenced/);
});
test('fresh work after archive has a higher version and cannot dispatch before retained pacing',async()=>{
  let journal=prepareInventoryArchive(state()).next;
  const store={read:async()=>({version:inventoryJournalVersion(journal),journal:structuredClone(journal)}),
    append:async(v:number,j:InventoryJournal)=>{if(v!==inventoryJournalVersion(journal))return false;journal=structuredClone(j);return true;}};
  const next={...intent,id:'fixture-2',version:2};
  await recordInventoryCommand(store,{kind:'enqueue',intent:next,now:200});
  await recordInventoryCommand(store,{kind:'claim',id:next.id,now:200,leaseMs:10000});
  const command={kind:'dispatch' as const,id:next.id,token:'fixture-2:1',context:{...context,version:2},now:200};
  await assert.rejects(()=>recordInventoryCommand(store,command),/pacing/);
  assert.equal((await recordInventoryCommand(store,{...command,now:6100})).saved,true);
  assert.equal(inventoryJournalVersion(journal),9);
});
test('consecutive archives chain exact checkpoints and preserve a longer retry deadline',()=>{
  const full=(state().journal as InventoryJournal).commands;
  const retried=[...full.slice(0,3),{kind:'rejected' as const,id:intent.id,token,failure:'retryable' as const,now:200,retryAfterMs:120000,jitter:0},
    {kind:'enqueue' as const,intent:{...intent,id:'replacement',version:2},now:201}];
  const s=state(retried);s.planVersion=2;const a=prepareInventoryArchive(s);
  assert.equal(inventoryResumeAfter(a.next),120200);
  const s2=state([{kind:'enqueue',intent:{...intent,id:'third',version:3},now:202}]);
  s2.journal={...a.next,commands:(s2.journal as InventoryJournal).commands};s2.journalVersion=inventoryJournalVersion(s2.journal as InventoryJournal);s2.planVersion=3;
  const b=prepareInventoryArchive(s2);assert.equal(verifyInventoryArchive(b).previous,a.id);assert.equal(inventoryResumeAfter(b.next),120200);
});
test('lost archive save/read-back never retries, and changed state is reported separately',async()=>{
  const s=state(),a=prepareInventoryArchive(s);let calls=0;
  const base={read:async()=>s,readArchive:async()=>a};
  await assert.rejects(()=>archiveBookingInventory({...base,commitArchive:async()=>{calls++;throw Error('lost reply');}}),/lost reply/);
  assert.equal(calls,1);
  assert.deepEqual(await archiveBookingInventory({...base,commitArchive:async()=>false}),{status:'changed'});
  await assert.rejects(()=>archiveBookingInventory({...base,commitArchive:async()=>true,readArchive:async()=>null}),/read-back uncertain/);
  assert.equal((await archiveBookingInventory({...base,commitArchive:async()=>true})).status,'archived');
});
