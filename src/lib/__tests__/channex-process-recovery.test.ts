import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { emptyOwnershipJournal } from '../channex-staging/ownership-journal.ts';

// Separate processes share only synthetic disk fixtures, never credentials or network clients.
const syncUrl = new URL('../channex-staging/shared-sync.ts', import.meta.url).href;
const child = `
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { syncSharedRevisions } from ${JSON.stringify(syncUrl)};
const [statePath, ackPath, mode] = process.argv.slice(1);
const revision = {id:'process-revision',bookingId:'synthetic-process-booking',member:'back',status:'new',checkIn:'2027-03-01',checkOut:'2027-03-22',receivedAt:'2026-10-02T12:00:00Z'};
const read = () => JSON.parse(readFileSync(statePath,'utf8'));
const store = {
 read: async () => read(),
 replace: async (version,journal) => {
  if(read().version!==version)return false;
  const temporary=statePath+'.next';
  const fd=openSync(temporary,'w',0o600);
  writeFileSync(fd,JSON.stringify({version:version+1,journal}));fsyncSync(fd);closeSync(fd);
  renameSync(temporary,statePath);
  if(mode==='after-save')process.exit(73);
  return true;
 }
};
const client = {
 inspect:async()=>[],readRevisions:async()=>[revision],
 acknowledge:async()=>{
  const state=read();
  if(state.version!==1||state.journal.events.length!==1)throw Error('ACK without durable revision');
  writeFileSync(ackPath,'acknowledged',{mode:0o600});
  if(mode==='after-ack')process.exit(74);
 }
};
console.log(JSON.stringify(await syncSharedRevisions(store,client)));
`;

for (const mode of ['after-save', 'after-ack'] as const) {
 test(`process restart recovers ${mode} without duplicate history`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'helm-process-recovery-'));
  try {
   const statePath=join(directory,'state.json'), ackPath=join(directory,'ack');
   await writeFile(statePath,JSON.stringify({version:0,journal:emptyOwnershipJournal()}),{mode:0o600});
   const run=(phase:string)=>spawnSync(process.execPath,['--input-type=module','--eval',child,statePath,ackPath,phase],{encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,NODE_ENV:'test'}});
   const interrupted=run(mode);
   assert.equal(interrupted.error,undefined);
   assert.equal(interrupted.status,mode==='after-save'?73:74,interrupted.stderr);
   const durable=JSON.parse(await readFile(statePath,'utf8'));
   assert.equal(durable.version,1);
   assert.equal(durable.journal.events.length,1);
   if(mode==='after-save')await assert.rejects(readFile(ackPath),{code:'ENOENT'});
   const recovered=run('recover');
   assert.equal(recovered.status,0,recovered.stderr);
   const result=JSON.parse(recovered.stdout);
   assert.equal(result.saved,0);
   assert.equal(result.duplicates,1);
   assert.equal(result.acknowledged,1);
   assert.equal(result.published,0);
   assert.equal(await readFile(ackPath,'utf8'),'acknowledged');
   assert.deepEqual(JSON.parse(await readFile(statePath,'utf8')),durable);
  } finally { await rm(directory,{recursive:true,force:true}); }
 });
}
