import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanPaidSessions, paidReceipt } from '../payment-link-paid-core.ts';

test('finds a paid checkout after newer unpaid attempts', async () => {
  const cursors: (string | undefined)[] = [];
  const paid = { id: 'older-paid', payment_status: 'paid', created: 1000 };
  const result = await scanPaidSessions(async after => {
    cursors.push(after);
    return after ? { data: [paid], has_more: false } : { data: [{ id: 'newer-unpaid', payment_status: 'unpaid' }], has_more: true };
  });
  assert.deepEqual(cursors, [undefined, 'newer-unpaid']);
  assert.deepEqual(result, { ok: true, session: paid, seen: 2 });
});
test('unpaid requires complete readable results', async () => {
  assert.deepEqual(await scanPaidSessions(async () => ({ data: [], has_more: false })), { ok: true, session: null, seen: 0 });
  for (const raw of [null, {}, { data: [] }, { data: [], has_more: true }, { data: [{}], has_more: false }]) {
    assert.equal((await scanPaidSessions(async () => raw)).ok, false);
  }
});
test('outage, repeated cursor and scan limit are unknown rather than unpaid', async () => {
  assert.equal((await scanPaidSessions(async () => { throw Error('offline'); })).ok, false);
  assert.equal((await scanPaidSessions(async () => ({ data: [{ id: 'repeat', payment_status: 'unpaid' }], has_more: true }))).ok, false);
  assert.equal((await scanPaidSessions(async after => ({ data: [{ id: after ? 'second' : 'first', payment_status: 'unpaid' }], has_more: true }), 2)).ok, false);
});
test('stored paid receipt remains authoritative on an empty subsequent result', () => {
  assert.equal(paidReceipt('2026-01-01T12:00:00Z', null), '2026-01-01T12:00:00Z');
  assert.equal(paidReceipt(null, { id: 'paid', payment_status: 'paid', created: 1000 }), '1970-01-01T00:16:40.000Z');
  assert.equal(paidReceipt(null, null), '');
});
