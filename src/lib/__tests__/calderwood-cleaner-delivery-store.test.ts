import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { initializeCleanerDelivery as init, appendCleanerDelivery as append, readCleanerDelivery as read, type DeliveryRecord } from '../calderwood-rehearsal/cleaner-delivery-store.ts';
import { cleanerDeliverySummary as summary } from '../calderwood-rehearsal/cleaner-delivery.ts';
const moduleUrl = new URL('../calderwood-rehearsal/cleaner-delivery-store.ts', import.meta.url).href;
const claim: DeliveryRecord = { id: 'event-claim-a', event: { type: 'start', recipientId: 'fictional-a', attemptId: 'attempt-a' } };
const delivered: DeliveryRecord = { id: 'event-delivered-a', event: { type: 'result', recipientId: 'fictional-a', attemptId: 'attempt-a', state: 'delivered', providerId: 'provider-a' } };
async function fixture(run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'cleaner-delivery-'));
  try { await run(join(directory, 'ledger.json')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
function runChild(code: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], { stdio: 'ignore' });
    child.once('error', reject); child.once('close', resolve);
  });
}
test('delivery survives a fresh process and duplicate event replay leaves one receipt', async () => fixture(async path => {
  await init(path, 'fictional-message', ['fictional-a', 'fictional-b']);
  await append(path, 0, claim);
  const saved = await append(path, 1, delivered);
  const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `import {readCleanerDelivery} from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(await readCleanerDelivery(${JSON.stringify(path)})));`], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), saved);
  assert.equal((await append(path, 2, delivered)).version, 2);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(summary(saved.ledger).allDelivered, false);
}));
test('death after a committed claim prevents blind retry on restart', async () => fixture(async path => {
  await init(path, 'fictional-message', ['fictional-a']);
  const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `import {appendCleanerDelivery} from ${JSON.stringify(moduleUrl)}; await appendCleanerDelivery(${JSON.stringify(path)},0,${JSON.stringify(claim)}); process.exit(23);`], { encoding: 'utf8' });
  assert.equal(child.status, 23, child.stderr);
  const restarted = await read(path);
  assert.equal(summary(restarted.ledger).recipients[0].disposition, 'reconcile');
  await assert.rejects(append(path, 1, { id: 'retry', event: { ...claim.event, attemptId: 'retry-a' } }), /Reconcile/);
  await append(path, 1, delivered);
  assert.equal(summary((await read(path)).ledger).allDelivered, true);
}));
test('competing worker processes cannot both claim the same version', async () => fixture(async path => {
  await init(path, 'fictional-message', ['fictional-a']);
  const worker = (n: number) => `import {appendCleanerDelivery} from ${JSON.stringify(moduleUrl)}; try { await appendCleanerDelivery(${JSON.stringify(path)},0,${JSON.stringify({ id: `event-${n}`, event: { ...claim.event, attemptId: `attempt-${n}` } })}); } catch { process.exit(42); }`;
  const results = await Promise.all([runChild(worker(1)), runChild(worker(2))]);
  assert.deepEqual(results.sort(), [0, 42]);
  assert.equal((await read(path)).ledger.recipients[0].attempts.length, 1);
}));
test('writer death with a lock blocks further writes without lock theft', async () => fixture(async path => {
  await init(path, 'fictional-message', ['fictional-a']);
  const lockModule = new URL('../channex-staging/journal.ts', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `import {withJournalLock} from ${JSON.stringify(lockModule)}; await withJournalLock(${JSON.stringify(path)},async()=>process.exit(24));`], { encoding: 'utf8' });
  assert.equal(child.status, 24, child.stderr);
  await assert.rejects(append(path, 0, claim), { code: 'EEXIST' });
  assert.equal((await read(path)).version, 0);
  assert.ok(await stat(path + '.lock'));
}));
test('missing, corrupt or invalid storage is never silently initialized', async () => fixture(async path => {
  await assert.rejects(read(path)); await assert.rejects(append(path, 0, claim));
  await init(path, 'fictional-message', ['fictional-a']);
  const good = JSON.parse(await readFile(path, 'utf8'));
  for (const bad of ['broken', JSON.stringify({ ...good, version: 3 }), JSON.stringify({ ...good, mode: 'production' }), JSON.stringify({ ...good, recipientIds: [] })]) {
    await writeFile(path, bad);
    await assert.rejects(read(path)); await assert.rejects(append(path, 0, claim));
    await assert.rejects(init(path, 'fictional-message', ['fictional-a']), { code: 'EEXIST' });
    assert.equal(await readFile(path, 'utf8'), bad);
  }
}));
test('stale, conflicting and malformed writes preserve committed data', async () => fixture(async path => {
  await init(path, 'fictional-message', ['fictional-a']); await append(path, 0, claim);
  const before = await readFile(path, 'utf8');
  await assert.rejects(append(path, 0, delivered), /version changed/);
  await assert.rejects(append(path, 1, { id: claim.id, event: delivered.event }), /Conflicting/);
  for (const event of [
    { ...delivered.event, state: 'typo' }, { ...delivered.event, providerId: null },
    { ...claim.event, content: 'must not persist message bodies' },
  ]) await assert.rejects(append(path, 1, { id: 'invalid', event } as DeliveryRecord));
  assert.equal(await readFile(path, 'utf8'), before);
}));
test('partial delivery remains recipient-specific after restart and rejection retry', async () => fixture(async path => {
  await init(path, 'fictional-message', ['fictional-a', 'fictional-b']);
  await append(path, 0, claim); await append(path, 1, delivered);
  await append(path, 2, { id: 'claim-b', event: { type: 'start', recipientId: 'fictional-b', attemptId: 'attempt-b' } });
  await append(path, 3, { id: 'reject-b', event: { type: 'result', recipientId: 'fictional-b', attemptId: 'attempt-b', state: 'rejected' } });
  assert.deepEqual(summary((await read(path)).ledger).recipients.map(r => r.disposition), ['delivered', 'retry-review']);
  await append(path, 4, { id: 'retry-b', event: { type: 'start', recipientId: 'fictional-b', attemptId: 'attempt-b2' } });
  assert.equal((await read(path)).ledger.recipients[0].attempts.length, 1);
}));
