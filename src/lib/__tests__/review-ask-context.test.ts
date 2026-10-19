import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewAskContext } from '../review-ask-context.ts';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

// The concierge's own format (stay-concierge src/review_requests.py _audit_text).
const NOTE = 'No review visible yet, though Airbnb and VRBO can keep one sealed for up to 14 days, so they may already have written it.';

test('a review ask reads as a few words', () => {
  assert.equal(
    reviewAskContext(`[REVIEW FOLLOW-UP · Airbnb] Checked out 2026-10-12 (7d ago). Second and last ask; our first ask already went out. Stay read as: positive. ${NOTE} Approve to send.`),
    'Review follow-up · checked out Oct 12',
  );
  assert.equal(
    reviewAskContext(`[REVIEW REQUEST · VRBO] Checked out 2026-10-17 (2d ago). First ask. Stay read as: positive. ${NOTE} Approve to send.`),
    'Review ask · checked out Oct 17',
  );
  assert.equal(
    reviewAskContext(`[REVIEW REQUEST, LATE · Airbnb] Checked out 2026-10-01 (18d ago). First ask, sent late because the earlier window was missed. Stay read as: neutral. ${NOTE} Approve to send.`),
    'Review ask, late · checked out Oct 1',
  );
});

test('a borderline stay keeps its reason, and only that', () => {
  assert.equal(
    reviewAskContext(`[REVIEW REQUEST · Airbnb] Checked out 2026-10-13 (6d ago). FRINGE, your call: the guest reported a broken door handle. The stay otherwise read as positive. ${NOTE} Approve only if you still want to ask, otherwise reject and nothing is sent.`),
    'Review ask · checked out Oct 13. Your call: the guest reported a broken door handle.',
  );
});

test('anything else is shown as written', () => {
  assert.equal(reviewAskContext('Hi! What time is check-in?'), null);
  assert.equal(reviewAskContext(''), null);
  assert.equal(reviewAskContext(null), null);
});

test('the guest card and the conversation list both use it', () => {
  const queue = read('src/app/messaging/MessagingQueue.tsx');
  assert.ok(queue.includes("kind === 'review' ? reviewAskContext(approval.guest_text) ?? approval.guest_text : approval.guest_text"));
  const list = read('src/app/messaging/Conversations.tsx');
  assert.ok(list.includes('reviewAskContext(c.last_preview) ?? c.last_preview'));
});
