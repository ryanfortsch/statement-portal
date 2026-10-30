import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAcknowledgment, splitReplyUpdates } from '../home-reply-triage.ts';

test('only standalone acknowledgments move out of the reply list', () => {
  for(const text of ['Perfect! Thanks!', 'Thank you so much.', 'Got it 👍', 'OK, sounds good.', 'Thanks 😊', 'Of course!', 'No problem.']) assert.equal(isAcknowledgment(text), true, text);
  for(const text of ['', 'Thanks, can you call me?', 'Great, but the heat is broken.', 'No thanks', 'Of course, can you call?', 'No problem tomorrow at 10', 'Perfect! Please block Friday.', 'Thanks! Is that tomorrow?', 'Confirmed for Friday at 9 AM.', '👍 Can you help?', 'Great. The check never arrived.']) assert.equal(isAcknowledgment(text), false, text);
});
test('triage preserves every item and does not mutate source records', () => {
  const touches=[{summary:'Perfect! Thanks!',id:'a'}, {summary:'Could you block June 10?',id:'b'}, {summary:'Unknown message',id:'c'}];
  const original=structuredClone(touches), split=splitReplyUpdates(touches);
  assert.deepEqual(split.replies.map(t=>t.id),['b','c']);
  assert.deepEqual(split.updates.map(t=>t.id),['a']);
  assert.deepEqual(touches,original);
  assert.equal(split.replies.length+split.updates.length,touches.length);
});
