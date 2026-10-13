import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyRevision, emptyLedger, type Ledger } from '../channex-staging/core.ts';
import { initializeOwnershipJournal, appendOwnershipEvent, readOwnershipJournal, replayOwnership, emptyOwnershipJournal, type OwnershipEvent } from '../channex-staging/ownership-journal.ts';
const ledger = (before = emptyLedger(), cancelled = false) => applyRevision(before, {id: cancelled ? 'cancel' : 'book', bookingId:'stay', member:'back', status:cancelled ? 'cancelled' : 'new', checkIn:'2027-02-01', checkOut:'2027-02-03', receivedAt: cancelled ? '2026-10-02T12:00:02Z' : '2026-10-02T12:00:01Z'}).ledger;
const snapshot = (id: string, l: Ledger, complete = true): OwnershipEvent => ({id,kind:'snapshot',ledger:l,holds:[],complete});
async function fixture(run: (path:string) => Promise<void>) { const dir=await mkdtemp(join(tmpdir(),'ownership-')); try { await run(join(dir,'journal.json')); } finally { await rm(dir,{recursive:true,force:true}); } }
test('journal survives reload with exact claims, permissions, duplicate retry and evidence remaining unverified', async () => fixture(async (path) => {
 await initializeOwnershipJournal(path);
 const event=snapshot('first',ledger());
 const first=await appendOwnershipEvent(path,event);
 assert.deepEqual((await readOwnershipJournal(path)).plan,first.plan);
 await appendOwnershipEvent(path,event);
 assert.equal((await readOwnershipJournal(path)).journal.events.length,1);
 const receipt:OwnershipEvent={id:'receipt',kind:'receipt',snapshotId:'first',claimId:first.plan.claims[0].id,providerBlockId:'test-block',evidence:'synthetic'};
 await appendOwnershipEvent(path,receipt);
 assert.equal((await readOwnershipJournal(path)).receipts[0].verified,false);
 assert.equal((await stat(path)).mode & 0o777,0o600);
 await appendOwnershipEvent(path,snapshot('cancelled',ledger(ledger(),true)));
 assert.equal((await readOwnershipJournal(path)).plan.claims.length,0);
 assert.equal((await readOwnershipJournal(path)).receipts.length,1);
 await appendOwnershipEvent(path,event); // Old retry does not regress state.
 assert.equal((await readOwnershipJournal(path)).plan.claims.length,0);
}));
test('consecutive incomplete snapshots retain even a booking first seen during outage', () => {
 const b=ledger();
 const p=replayOwnership({...emptyOwnershipJournal(),events:[snapshot('empty',emptyLedger()),snapshot('new',b,false),snapshot('cancel',ledger(b,true),false),snapshot('repeat',ledger(b,true),false)]});
 assert.equal(p.plan.claims.length,4);
 assert.ok(p.plan.nights.every((n)=>n.decision==='blocked'));
 const recovered=replayOwnership({...p.journal,events:[...p.journal.events,snapshot('recovered',ledger(b,true))]});
 assert.equal(recovered.plan.releasedClaims.length,4);
 assert.equal(recovered.plan.claims.length,0);
});
test('independent hold identity and changed ranges survive outage', () => {
 const first={...snapshot('a',emptyLedger()),holds:[{id:'owner',member:'back',checkIn:'2027-02-01',checkOut:'2027-02-03'}]};
 const next={...snapshot('b',emptyLedger(),false),holds:[{id:'owner',member:'back',checkIn:'2027-02-04',checkOut:'2027-02-05'}]};
 const p=replayOwnership({...emptyOwnershipJournal(),events:[first,next]});
 for(const date of ['2027-02-01','2027-02-04']) assert.deepEqual(p.plan.nights.find(n=>n.target==='back'&&n.date===date)!.independentHolds,['back:owner']);
});
test('missing, corrupt, conflicting or unmatched evidence cannot silently replace journal', async () => fixture(async(path)=>{
 await assert.rejects(readOwnershipJournal(path));
 await initializeOwnershipJournal(path);
 await appendOwnershipEvent(path,snapshot('a',ledger()));
 const original=await readFile(path,'utf8');
 await assert.rejects(appendOwnershipEvent(path,snapshot('a',emptyLedger())));
 await assert.rejects(appendOwnershipEvent(path,{id:'r',kind:'receipt',snapshotId:'missing',claimId:'fake',providerBlockId:'block',evidence:'synthetic'}));
 assert.equal(await readFile(path,'utf8'),original);
 await writeFile(path,'broken');
 await assert.rejects(readOwnershipJournal(path));
 await assert.rejects(initializeOwnershipJournal(path));
 assert.equal(await readFile(path,'utf8'),'broken');
}));
test('writer lock refuses concurrent writer without modifying journal', async()=>fixture(async(path)=>{
 await initializeOwnershipJournal(path); await writeFile(path+'.lock','test owner',{flag:'wx'});
 await assert.rejects(appendOwnershipEvent(path,snapshot('a',ledger())),{code:'EEXIST'});
 assert.equal((await readOwnershipJournal(path)).journal.events.length,0);
}));
test('actual process exit after durable append permits idempotent replay on restart', async()=>fixture(async(path)=>{
 await initializeOwnershipJournal(path);
 const moduleUrl=new URL('../channex-staging/ownership-journal.ts',import.meta.url).href;
 const event=snapshot('a',ledger());
 const result=spawnSync(process.execPath,['--input-type=module','-e',`import {appendOwnershipEvent} from ${JSON.stringify(moduleUrl)}; await appendOwnershipEvent(${JSON.stringify(path)},${JSON.stringify(event)}); process.exit(23);`],{encoding:'utf8'});
 assert.equal(result.status,23,result.stderr);
 assert.equal((await readOwnershipJournal(path)).plan.claims.length,4);
 await appendOwnershipEvent(path,event);
 assert.equal((await readOwnershipJournal(path)).journal.events.length,1);
}));

test('process death while locked leaves journal intact and requires explicit recovery', async()=>fixture(async(path)=>{
 await initializeOwnershipJournal(path);
 const moduleUrl=new URL('../channex-staging/journal.ts',import.meta.url).href;
 const result=spawnSync(process.execPath,['--input-type=module','-e',`import {withJournalLock} from ${JSON.stringify(moduleUrl)}; await withJournalLock(${JSON.stringify(path)},async()=>{process.exit(24)});`],{encoding:'utf8'});
 assert.equal(result.status,24,result.stderr);
 await assert.rejects(appendOwnershipEvent(path,snapshot('a',ledger())),{code:'EEXIST'});
 assert.equal((await readOwnershipJournal(path)).journal.events.length,0);
}));
