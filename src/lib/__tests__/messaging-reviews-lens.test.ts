import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The Guest reviews lens's invariants, read from the source (2026-10-30):
 * the Inbox and the guests count leave its cards out, the lens never wires
 * Approve on a host-review card, and the lens row and atlas know the route.
 * Each line here is thin across files and easy to lose in a refactor.
 */
const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('the Inbox leaves the lens kinds out, and the guests count mirrors it', () => {
  const queue = read('src/app/messaging/MessagingQueue.tsx');
  assert.match(queue, /approvals\.filter\(\(a\) => !isReviewLensKind\(proactiveKind\(a\.guesty_message_id, a\.topic\)\)\)/);
  assert.match(queue, /approvals=\{inbox\}/);
  const count = read('src/app/api/messaging/pending-count/route.ts');
  assert.match(count, /notScheduled\(a\) && !onReviewLens\(a\)/);
  assert.match(count, /notScheduled\(a\) && onReviewLens\(a\)/);
  assert.match(count, /reviews,\n\s*\}\);/);
  assert.match(read('src/lib/pending-count-client.ts'), /reviews\?: number \| null;/);
});

test('a host-review card never gets Approve, Send later, Coach or Redraft', () => {
  const src = read('src/app/messaging/reviews/ReviewsQueue.tsx');
  const host = src.slice(src.indexOf('function HostReviewCardView'), src.indexOf('function ReviewReplyCardView'));
  assert.doesNotMatch(host, /approve:/);
  assert.doesNotMatch(host, /schedule:/);
  assert.doesNotMatch(host, /coach:/);
  assert.doesNotMatch(host, /redraft:/);
  assert.match(host, /markHandled: \(capture\) => markReviewHandled\(id, capture\)/);
  // The reply card's one send is Post reply, and only where Guesty can post it.
  const reply = src.slice(src.indexOf('function ReviewReplyCardView'), src.indexOf('function PlainCard'));
  assert.match(reply, /byHand \? \{\} : \{ approve: \(\) => postReply\(id\) \}/);
  assert.match(reply, /approveLabel="Post reply"/);
  assert.doesNotMatch(reply, /coach:|redraft:|schedule:/);
});

test('the lens is on the Guests row with its count, and in the atlas', () => {
  const tabs = read('src/components/MessagingTabs.tsx');
  assert.match(tabs, /\{ id: 'reviews', label: 'Guest reviews', href: '\/messaging\/reviews' \}/);
  assert.match(tabs, /l\.id === 'reviews' && <MessagingTabCount category="reviews" \/>/);
  const modules = read('src/lib/helm-modules.ts');
  assert.match(modules, /href: '\/messaging\/reviews'/);
  const page = read('src/app/messaging/reviews/page.tsx');
  assert.match(page, /<MessagingTabs current="guests" lens="reviews" \/>/);
});

test('the Recent stays row carries our review of them', () => {
  assert.match(read('src/lib/recent-stays.ts'), /ourReview: describeHostReview\(ask, today\)/);
  assert.match(read('src/app/guests/ReviewsTab.tsx'), /stay\.ourReview && \(/);
});
