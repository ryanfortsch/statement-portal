import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryInventoryOutbox } from '../channex-staging/inventory-outbox.ts';
import type { InventoryIntent, InventoryJob, DispatchContext } from '../channex-staging/inventory-outbox.ts';
const intent = (id = 'one', version = 1): InventoryIntent => ({ id, version, generation: 1,
  environment: 'staging', connection: 'synthetic-connection', property: 'synthetic-home',
  days: [{ date: '2027-02-01', available: 0, stopSell: true }] });
const context = (j: InventoryJob): DispatchContext => ({ environment: j.environment,
  connection: j.connection, property: j.property, generation: j.generation, version: j.version,
  digest: j.digest, authority: 'helm', enabled: true, complete: true, freshUntil: 100_000 });
function setup() {
  const q = new MemoryInventoryOutbox(); q.enqueue(intent(), 0);
  const j = q.claim('one', 0, 100)!;
  return { q, j };
}
test('duplicate command is idempotent, conflicting reuse rejected, snapshots detached', () => {
  const { q } = setup();
  assert.equal(q.enqueue(intent(), 1).status, 'leased');
  assert.throws(() => q.enqueue({ ...intent(), version: 2 }, 0));
  q.list()[0].days[0].available = 1;
  assert.equal(q.list()[0].days[0].available, 0);
});
test('reject pricing/restriction fields at runtime, invalid dates, duplicate dates, production', () => {
  const q = new MemoryInventoryOutbox();
  for (const field of ['price', 'minStay', 'rate', 'min_stay_arrival']) {
    assert.throws(() => q.enqueue({ ...intent(), [field]: 20 }, 0));
    assert.throws(() => q.enqueue({ ...intent(), days: [{ ...intent().days[0], [field]: 20 }] }, 0));
  }
  assert.throws(() => q.enqueue({ ...intent(), environment: 'production' } as unknown as InventoryIntent, 0));
  assert.throws(() => q.enqueue({ ...intent(), days: [{ ...intent().days[0], date: '2027-02-30' }] }, 0));
  assert.throws(() => q.enqueue({ ...intent(), days: [...intent().days, ...intent().days] }, 0));
});
test('coalesces only undispatched exact date coverage and enforces increasing versions', () => {
  const q = new MemoryInventoryOutbox(); q.enqueue(intent(), 0);
  q.enqueue(intent('two', 2), 0);
  assert.equal(q.list()[0].status, 'superseded');
  q.enqueue({ ...intent('three', 3), days: [{ ...intent().days[0], date: '2027-02-02' }] }, 0);
  assert.equal(q.list()[1].status, 'pending');
  assert.throws(() => q.enqueue(intent('old', 1), 0));
});
test('concurrent claims serialize per lane but independent properties proceed', () => {
  const { q } = setup(); q.enqueue(intent('two', 2), 0);
  assert.equal(q.claim('one', 1, 100), null);
  assert.equal(q.claim('two', 1, 100), null);
  q.enqueue({ ...intent('other'), property: 'other-home' }, 0);
  assert.ok(q.claim('other', 1, 100));
});
test('crash before dispatch permits reclaim, fences old worker', () => {
  const { q, j } = setup(); q.expire(100);
  const next = q.claim('one', 100, 100)!;
  assert.notEqual(j.token, next.token);
  assert.throws(() => q.beginDispatch('one', j.token!, context(j), 101));
  assert.equal(q.beginDispatch('one', next.token!, context(next), 101).status, 'submitting');
});
test('crash after dispatch blocks newer update and rejects late acceptance', () => {
  const { q, j } = setup(); q.beginDispatch('one', j.token!, context(j), 0);
  q.enqueue(intent('two', 2), 1); q.expire(100);
  assert.equal(q.list()[0].status, 'uncertain');
  assert.equal(q.claim('two', 101, 100), null);
  assert.throws(() => q.accepted('one', j.token!, 'late-task'));
});
test('acceptance is not verification; pending task and partial readback cannot unblock', () => {
  const { q, j } = setup(); q.beginDispatch('one', j.token!, context(j), 0);
  q.accepted('one', j.token!, 'synthetic-task'); q.enqueue(intent('two', 2), 1);
  const evidence = { settled: true, complete: true, digest: j.digest, generation: 1 };
  assert.equal(q.reconcile('one', j.token!, { ...evidence, settled: false }), false);
  assert.equal(q.reconcile('one', j.token!, { ...evidence, complete: false }), false);
  assert.equal(q.claim('two', 2, 100), null);
  assert.equal(q.reconcile('one', j.token!, evidence), true);
  assert.ok(q.claim('two', 3, 100));
  assert.throws(() => q.ambiguous('one', j.token!));
});
test('uncertain delivery never auto retries and mismatched readback requires review', () => {
  const { q, j } = setup(); q.beginDispatch('one', j.token!, context(j), 0);
  q.ambiguous('one', j.token!);
  assert.throws(() => q.rejected('one', j.token!, 'retryable', 1));
  assert.equal(q.reconcile('one', j.token!, { settled: true, complete: true, digest: 'different', generation: 1 }), false);
  q.enqueue(intent('two', 2), 1);
  assert.equal(q.claim('two', 1000, 100), null);
});
test('definite rejection honors backoff and retry-after, then exhausts budget', () => {
  const { q, j } = setup(); q.beginDispatch('one', j.token!, context(j), 0);
  q.rejected('one', j.token!, 'retryable', 0, 4000, 0.5);
  assert.equal(q.claim('one', 3999, 100), null);
  let now = 4000;
  for (let attempt = 2; attempt <= 5; attempt++) {
    const job = q.claim('one', now, 100)!;
    q.beginDispatch('one', job.token!, { ...context(job), freshUntil: now + 100 }, now);
    q.rejected('one', job.token!, 'retryable', now);
    now = q.list()[0].nextAttemptAt;
  }
  assert.equal(q.list()[0].status, 'needs-review');
  assert.equal(q.list()[0].attempts, 5);
});
test('auth/permanent rejection does not retry', () => {
  const { q, j } = setup(); q.beginDispatch('one', j.token!, context(j), 0);
  q.rejected('one', j.token!, 'permanent', 0);
  assert.equal(q.claim('one', 1000, 100), null);
});
for (const override of [
  { environment: 'production' }, { property: 'wrong' }, { connection: 'wrong' },
  { generation: 2 }, { version: 2 }, { digest: 'wrong' }, { authority: 'guesty' },
  { enabled: false }, { complete: false }, { freshUntil: 0 }, { freshUntil: NaN },
]) test(`dispatch fails closed: ${JSON.stringify(override)}`, () => {
  const { q, j } = setup();
  assert.throws(() => q.beginDispatch('one', j.token!, { ...context(j), ...override } as DispatchContext, 0));
  assert.equal(q.list()[0].attempts, 0);
});
test('expired lease cannot dispatch even before recovery sweep', () => {
  const { q, j } = setup();
  assert.throws(() => q.beginDispatch('one', j.token!, context(j), 100));
});
