import test from 'node:test';
import assert from 'node:assert/strict';
import { proactiveBadge, proactiveKind } from '../../app/messaging/format.ts';

test('a payment reminder card reads as proactive, in the add-on plum', () => {
  const id = 'quo_sms:payremind:addon:6a99a610bb2a4b1726c26fc9:pet-fee-for-both-dogs:30000:1';
  assert.equal(proactiveKind(id, 'payment_reminder'), 'payment');
  assert.equal(proactiveKind(id, ''), 'payment');
  assert.deepEqual(proactiveBadge('payment'), { label: 'Payment reminder', tone: '#6b4f7a' });
  // An ordinary guest text is still a guest reply, not a proactive card.
  assert.equal(proactiveKind('quo_sms:abc123', 'general'), null);
});
