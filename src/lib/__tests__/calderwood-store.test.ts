import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initializeRehearsal, appendRehearsal, readRehearsal } from '../calderwood-rehearsal/store.ts';
import { rehearseCoordination, type Event } from '../calderwood-rehearsal/coordination.ts';
const event: Event = { mode: 'synthetic', source: 'guesty', id: 'HELMTEST-book', resourceId: 'HELMTEST-stay', revision: 1, kind: 'reservation', status: 'active', start: '2027-02-01', end: '2027-02-04' };
const cancel: Event = { ...event, id: 'HELMTEST-cancel', revision: 2, status: 'cancelled' };
async function fixture(run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'calderwood-store-'));
  try { await run(join(directory, 'history.json')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
test('durable append reloads with restrictive file permissions and duplicate retries do not advance version', async () => fixture(async path => {
  await initializeRehearsal(path);
  const first = await appendRehearsal(path, 0, [event]);
  assert.deepEqual(await readRehearsal(path), first);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await appendRehearsal(path, 1, [event])).version, 1);
  await appendRehearsal(path, 1, [cancel]);
  const history = await readRehearsal(path);
  assert.equal(history.events.length, 2);
  assert.equal(history.version, 2);
  // A restart does not inherit a previous source-health verdict.
  const plan = rehearseCoordination({ events: history.events, coverage: [], start: '2027-02-01', end: '2027-02-05', now: 100, maxAgeMs: 10 });
  assert.ok(plan.nights.every(n => n.decision === 'withhold'));
}));
test('stale writers and conflicting events leave committed bytes intact', async () => fixture(async path => {
  await initializeRehearsal(path);
  await appendRehearsal(path, 0, [event]);
  const saved = await readFile(path, 'utf8');
  await assert.rejects(appendRehearsal(path, 0, [cancel]), /version changed/);
  await assert.rejects(appendRehearsal(path, 1, [{ ...event, end: '2027-02-05' }]), /Conflicting/);
  assert.equal(await readFile(path, 'utf8'), saved);
}));
test('missing or corrupt storage is not silently recreated', async () => fixture(async path => {
  await assert.rejects(readRehearsal(path));
  await assert.rejects(appendRehearsal(path, 0, [event]));
  await initializeRehearsal(path);
  await writeFile(path, 'broken');
  await assert.rejects(readRehearsal(path));
  await assert.rejects(initializeRehearsal(path), { code: 'EEXIST' });
  await assert.rejects(appendRehearsal(path, 0, [event]));
  assert.equal(await readFile(path, 'utf8'), 'broken');
}));
test('process exit after completed durable append allows idempotent replay', async () => fixture(async path => {
  await initializeRehearsal(path);
  const moduleUrl = new URL('../calderwood-rehearsal/store.ts', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {appendRehearsal} from ${JSON.stringify(moduleUrl)}; await appendRehearsal(${JSON.stringify(path)},0,${JSON.stringify([event])}); process.exit(23);`], { encoding: 'utf8' });
  assert.equal(child.status, 23, child.stderr);
  const saved = await readRehearsal(path);
  assert.equal(saved.version, 1);
  assert.equal((await appendRehearsal(path, saved.version, [event])).events.length, 1);
}));
test('death while holding writer lock requires explicit recovery, never automatic lock theft', async () => fixture(async path => {
  await initializeRehearsal(path);
  const moduleUrl = new URL('../channex-staging/journal.ts', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {withJournalLock} from ${JSON.stringify(moduleUrl)}; await withJournalLock(${JSON.stringify(path)},async()=>process.exit(24));`], { encoding: 'utf8' });
  assert.equal(child.status, 24, child.stderr);
  await assert.rejects(appendRehearsal(path, 0, [event]), { code: 'EEXIST' });
  assert.equal((await readRehearsal(path)).events.length, 0);
  assert.ok(await stat(path + '.lock'));
}));
test('invalid persisted envelope fails before append', async () => fixture(async path => {
  await initializeRehearsal(path);
  for (const value of [
    { format: 1, mode: 'live', version: 0, events: [] },
    { format: 1, mode: 'calderwood-synthetic', version: 0, events: [event] },
    { format: 1, mode: 'calderwood-synthetic', version: 1, events: [event, event] },
  ]) {
    await writeFile(path, JSON.stringify(value));
    await assert.rejects(readRehearsal(path));
    await assert.rejects(appendRehearsal(path, 0, [event]));
  }
}));
