import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { emptyInventoryJournal, replayInventoryJournal } from '../channex-staging/inventory-journal.ts';
const moduleUrl = new URL('../channex-staging/inventory-rehearsal.ts', import.meta.url).href;
// Each child has a clean environment and real disk-backed journal/provider receipts.
// The file fixture is intentionally single-writer, not a production storage adapter.
const child = `
import {readFileSync,writeFileSync,openSync,fsyncSync,closeSync,renameSync} from 'node:fs';
import {runInventoryRehearsal} from ${JSON.stringify(moduleUrl)};
const [statePath,receiptPath,phase,fault] = process.argv.slice(1);
const read=()=>JSON.parse(readFileSync(statePath,'utf8'));
function save(path,value){const fd=openSync(path+'.next','w',0o600);writeFileSync(fd,JSON.stringify(value));fsyncSync(fd);closeSync(fd);renameSync(path+'.next',path);}
const store={read:async()=>read(),append:async(v,journal)=>{
 if(read().version!==v)return false;
 save(statePath,{version:v+1,journal});
 const last=journal.commands.at(-1);
 if(fault==='barrier'&&last.kind==='dispatch')process.exit(71);
 if(fault==='receipt-save'&&last.kind==='accepted')process.exit(73);
 return true;
}};
const provider={kind:'synthetic',submit:async(job)=>{
 const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
 receipt.calls++;receipt.digest=job.digest;receipt.generation=job.generation;
 save(receiptPath,receipt);
 return 'synthetic-task';
},inspect:async(job)=>{
 const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
 return {settled:receipt.calls===1,complete:receipt.calls===1&&fault!=='partial',digest:receipt.digest??'unknown',generation:job.generation};
}};
const result=await runInventoryRehearsal(store,provider,'rehearsal-worker',phase,()=>phase==='dispatch'?0:101,
 fault==='after-submit'?()=>process.exit(72):undefined,100);
console.log(JSON.stringify(result));
`;
for (const fault of ['barrier', 'after-submit', 'receipt-save']) {
  test(`worker restart after ${fault} never repeats a synthetic submission`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'helm-inventory-worker-'));
    try {
      const state = join(dir, 'state.json'), receipt = join(dir, 'receipt.json');
      writeFileSync(state, JSON.stringify({ version: 0, journal: emptyInventoryJournal() }));
      writeFileSync(receipt, JSON.stringify({ calls: 0 }));
      const run = (phase: string, mode: string) => spawnSync(process.execPath,
        ['--input-type=module', '-e', child, state, receipt, phase, mode],
        { encoding: 'utf8', timeout: 10_000, env: { PATH: process.env.PATH, NODE_ENV: 'test' } });
      const interrupted = run('dispatch', fault);
      assert.equal(interrupted.error, undefined);
      assert.equal(interrupted.status, fault === 'barrier' ? 71 : fault === 'after-submit' ? 72 : 73, interrupted.stderr);
      const partial = run('recover', 'partial');
      assert.equal(partial.status, 0, partial.stderr);
      assert.equal(JSON.parse(partial.stdout).result, 'unresolved');
      const recovered = run('recover', '');
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(JSON.parse(recovered.stdout).result, fault === 'barrier' ? 'unresolved' : 'verified');
      // Repeated recovery and a repeated dispatch command also must not send again.
      assert.equal(run('recover', '').status, 0);
      const repeated = run('dispatch', '');
      assert.equal(repeated.status, 0, repeated.stderr);
      assert.equal(JSON.parse(repeated.stdout).submissions, 0);
      assert.equal(JSON.parse(readFileSync(receipt, 'utf8')).calls, fault === 'barrier' ? 0 : 1);
      const saved = JSON.parse(readFileSync(state, 'utf8'));
      const jobs = replayInventoryJournal(saved.journal).queue.list();
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].status, fault === 'barrier' ? 'uncertain' : 'verified');
      assert.equal(saved.version, saved.journal.commands.length);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
