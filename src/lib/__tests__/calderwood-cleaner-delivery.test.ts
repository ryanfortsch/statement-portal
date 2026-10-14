import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCleanerDelivery, applyCleanerDelivery as apply, cleanerDeliverySummary as summary } from '../calderwood-rehearsal/cleaner-delivery.ts';
const initial = () => createCleanerDelivery('fictional-message', ['cleaner-a', 'cleaner-b']);
const start = (recipientId = 'cleaner-a', attemptId = 'attempt-a') => ({ type: 'start' as const, recipientId, attemptId });
test('partial delivery retains each provider ID and allows only rejected recipient retry review', () => {
  let ledger = apply(apply(initial(), start()), start('cleaner-b', 'attempt-b'));
  ledger = apply(ledger, { ...start(), type: 'result', state: 'delivered', providerId: 'provider-a' });
  ledger = apply(ledger, { ...start('cleaner-b', 'attempt-b'), type: 'result', state: 'rejected' });
  assert.deepEqual(summary(ledger).recipients.map(r => r.disposition), ['delivered', 'retry-review']);
  assert.equal(summary(ledger).allDelivered, false);
  assert.throws(() => apply(ledger, start('cleaner-a', 'retry-a')));
  ledger = apply(ledger, start('cleaner-b', 'retry-b'));
  ledger = apply(ledger, { ...start('cleaner-b', 'retry-b'), type: 'result', state: 'delivered', providerId: 'provider-b' });
  assert.equal(summary(ledger).allDelivered, true);
  assert.equal(summary(ledger).canSend, false);
  assert.equal(ledger.recipients[0].attempts[0].providerId, 'provider-a');
});
test('acceptance is not delivery, and late errors cannot downgrade it', () => {
  let ledger = apply(initial(), start());
  ledger = apply(ledger, { ...start(), type: 'result', state: 'accepted', providerId: 'provider-a' });
  ledger = apply(ledger, { ...start(), type: 'result', state: 'rejected' });
  assert.equal(summary(ledger).recipients[0].disposition, 'await-delivery');
  assert.equal(summary(ledger).allDelivered, false);
  assert.throws(() => apply(ledger, start('cleaner-a', 'retry')));
});
test('crash or timeout leaves recipient blocked until delivery reconciliation', () => {
  let ledger = apply(initial(), start());
  assert.throws(() => apply(ledger, start('cleaner-a', 'after-crash')));
  ledger = apply(ledger, { ...start(), type: 'result', state: 'unknown' });
  assert.equal(summary(ledger).recipients[0].disposition, 'reconcile');
  assert.throws(() => apply(ledger, start('cleaner-a', 'after-timeout')));
  ledger = apply(ledger, { ...start(), type: 'result', state: 'delivered', providerId: 'provider-a' });
  ledger = apply(ledger, { ...start(), type: 'result', state: 'unknown' });
  assert.equal(summary(ledger).recipients[0].disposition, 'delivered');
});
test('duplicate claims do not create additional attempts or mutate input', () => {
  const before = initial(); const claimed = apply(before, start());
  assert.equal(before.recipients[0].attempts.length, 0);
  assert.equal(apply(claimed, start()), claimed);
  assert.equal(claimed.recipients[0].attempts.length, 1);
});
test('mismatched recipients, attempts and provider receipts are rejected', () => {
  const claimed = apply(initial(), start());
  assert.throws(() => apply(claimed, start('other')));
  assert.throws(() => apply(claimed, start('cleaner-b')));
  assert.throws(() => apply(claimed, { ...start('cleaner-b', 'missing'), type: 'result', state: 'delivered', providerId: 'p' }));
  assert.throws(() => apply(claimed, { ...start(), type: 'result', state: 'accepted' }));
  const accepted = apply(claimed, { ...start(), type: 'result', state: 'accepted', providerId: 'p' });
  assert.throws(() => apply(accepted, { ...start(), type: 'result', state: 'delivered', providerId: 'other' }));
  const both = apply(accepted, start('cleaner-b', 'attempt-b'));
  assert.throws(() => apply(both, { ...start('cleaner-b', 'attempt-b'), type: 'result', state: 'delivered', providerId: 'p' }));
});
test('empty or duplicate recipient list cannot report successful delivery', () => {
  assert.throws(() => createCleanerDelivery('m', []));
  assert.throws(() => createCleanerDelivery('m', ['a', 'a']));
  assert.throws(() => createCleanerDelivery('', ['a']));
});
