import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { emptyInventoryJournal, replayInventoryJournal, recordInventoryCommand } from '../channex-staging/inventory-journal.ts';
import type { InventoryJournal, InventoryJournalStore } from '../channex-staging/inventory-journal.ts';
import { prepareInventoryDispatch } from '../channex-staging/inventory-worker.ts';
import { createInventoryJournalStore } from '../channex-staging/inventory-journal-store.ts';
import type { InventoryJob, DispatchContext } from '../channex-staging/inventory-outbox.ts';
class FakeStore implements InventoryJournalStore {
  version = 0;
  journal = emptyInventoryJournal();
  loseReply = false;
  async read() { return structuredClone({ version: this.version, journal: this.journal }); }
  async append(version: number, journal: InventoryJournal) {
    if (version !== this.version) return false;
    this.journal = structuredClone(journal); this.version++;
    if (this.loseReply) throw new Error('Synthetic lost response after commit');
    return true;
  }
}
const intent = { id: 'synthetic-command', environment: 'staging' as const, connection: 'test-connection',
  property: 'test-home', generation: 1, version: 1,
  days: [{ date: '2027-02-01', available: 0 as const, stopSell: true }] };
const context = (j: InventoryJob): DispatchContext => ({ environment: j.environment, connection: j.connection,
  property: j.property, generation: j.generation, version: j.version, digest: j.digest,
  authority: 'helm', enabled: true, complete: true, freshUntil: 10000 });
async function seed() {
  const store = new FakeStore();
  await recordInventoryCommand(store, { kind: 'enqueue', intent, now: 0 });
  return store;
}
test('concurrent durable claims return one winner only', async () => {
  const store = await seed();
  const command = { kind: 'claim' as const, id: intent.id, now: 0, leaseMs: 100 };
  const results = await Promise.all([recordInventoryCommand(store, command), recordInventoryCommand(store, command)]);
  assert.equal(results.filter(r => r.saved).length, 1);
  assert.equal(results.filter(r => r.result !== undefined).length, 1);
  assert.equal(store.version, 2);
});
test('worker returns only a persisted submitting command', async () => {
  const store = await seed();
  const job = await prepareInventoryDispatch(store, intent.id, () => 0, 100, async j => context(j));
  assert.equal(job?.status, 'submitting');
  assert.equal(replayInventoryJournal(store.journal).queue.list()[0].status, 'submitting');
  assert.equal(await prepareInventoryDispatch(store, intent.id, () => 1, 100, async j => context(j)), null);
});
test('lost save response prevents dispatch even though the barrier committed', async () => {
  const store = await seed();
  await assert.rejects(prepareInventoryDispatch(store, intent.id, () => 0, 100, async j => {
    store.loseReply = true; return context(j);
  }));
  store.loseReply = false;
  assert.equal(replayInventoryJournal(store.journal).queue.list()[0].status, 'submitting');
  assert.equal(await prepareInventoryDispatch(store, intent.id, () => 101, 100, async j => context(j)), null);
  assert.equal(replayInventoryJournal(store.journal).queue.list()[0].status, 'uncertain');
});
test('failed context refresh leaves recoverable lease and never a dispatch barrier', async () => {
  const store = await seed();
  await assert.rejects(prepareInventoryDispatch(store, intent.id, () => 0, 100, async () => { throw new Error('Unavailable'); }));
  assert.equal(replayInventoryJournal(store.journal).queue.list()[0].status, 'leased');
  const next = await prepareInventoryDispatch(store, intent.id, () => 101, 100, async j => context(j));
  assert.equal(next?.token, `${intent.id}:2`);
});
test('slow context refresh cannot dispatch an expired lease', async () => {
  const store = await seed(); let now = 0;
  await assert.rejects(prepareInventoryDispatch(store, intent.id, () => now, 100, async j => {
    now = 101; return context(j);
  }));
  assert.equal(replayInventoryJournal(store.journal).queue.list()[0].status, 'leased');
});
test('restart in a new OS process preserves uncertainty and fences previous attempt', async () => {
  const store = await seed();
  await prepareInventoryDispatch(store, intent.id, () => 0, 100, async j => context(j));
  const dir = mkdtempSync(join(tmpdir(), 'helm-outbox-'));
  try {
    const path = join(dir, 'journal.json'); writeFileSync(path, JSON.stringify(store.journal));
    const moduleUrl = new URL('../channex-staging/inventory-journal.ts', import.meta.url).href;
    const code = `import {readFileSync} from 'node:fs';
      import {replayInventoryJournal} from ${JSON.stringify(moduleUrl)};
      const {queue}=replayInventoryJournal(JSON.parse(readFileSync(process.argv[1],'utf8')));
      queue.expire(101);
      if(queue.list()[0].status!=='uncertain'||queue.claim('synthetic-command',102,100)!==null)process.exit(2);
      console.log('recovered-without-resend');`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code, path], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /recovered-without-resend/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('replay keeps claim sequence so old tokens remain invalid after recovery', async () => {
  const store = await seed();
  await recordInventoryCommand(store, { kind: 'claim', id: intent.id, now: 0, leaseMs: 100 });
  await recordInventoryCommand(store, { kind: 'expire', now: 101 });
  const next = await recordInventoryCommand(store, { kind: 'claim', id: intent.id, now: 102, leaseMs: 100 });
  assert.ok(next.result && typeof next.result === 'object');
  assert.equal(next.result.token, `${intent.id}:2`);
  await assert.rejects(recordInventoryCommand(store, { kind: 'dispatch', id: intent.id,
    token: `${intent.id}:1`, context: context(next.result), now: 103 }));
});
test('corrupt history, extra fields and unsafe environment fail closed', async () => {
  assert.throws(() => replayInventoryJournal({ format: 2, commands: [] }));
  assert.throws(() => replayInventoryJournal({ format: 1, commands: [{ kind: 'erase' }] }));
  const store = await seed(); store.version = 999;
  await assert.rejects(recordInventoryCommand(store, { kind: 'expire', now: 100 }));
  assert.throws(() => createInventoryJournalStore('https://production.supabase.co', 'synthetic-key'));
  assert.throws(() => createInventoryJournalStore('https://jgkblfozftcvymvwhhii.supabase.co', ''));
});
test('invalid saved transition is not silently replaced by empty state', () => {
  assert.throws(() => replayInventoryJournal({ format: 1, commands: [
    { kind: 'accepted', id: intent.id, token: 'fake', task: 'fake' },
  ] }));
});
