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

test('our review of a guest and our reply to theirs are lens kinds, never Inbox cards', async () => {
  const { isReviewLensKind } = await import('../../app/messaging/format.ts');
  assert.equal(proactiveKind('hostreview:6aadab46:stop', 'host_review_stop'), 'hostreview');
  assert.equal(proactiveKind('hostreview:6aadab46:post', 'host_review'), 'hostreview');
  assert.equal(proactiveKind('hostreview:6aadab46:post', ''), 'hostreview');
  assert.equal(proactiveKind('reviewreply:68f1', 'review_reply'), 'reviewreply');
  assert.equal(proactiveKind('reviewreply:68f1', ''), 'reviewreply');
  // A review ASK is still its own kind: the Inbox keeps it.
  assert.equal(proactiveKind('review:6aadab46:first', 'review_request'), 'review');
  assert.equal(isReviewLensKind('hostreview'), true);
  assert.equal(isReviewLensKind('reviewreply'), true);
  assert.equal(isReviewLensKind('review'), false);
  assert.equal(isReviewLensKind(null), false);
  assert.deepEqual(proactiveBadge('hostreview'), { label: 'Our review', tone: '#4a3f6b' });
  assert.deepEqual(proactiveBadge('reviewreply'), { label: 'Review reply', tone: '#6b4a2b' });
});
