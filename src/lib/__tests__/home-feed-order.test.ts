import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homeFeedOrder, windowPayments, PAYMENTS_WINDOW } from '../home-feed-order.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('the home feed reads as the signed-in person\'s day', () => {
  test('staff: my work, then replies, then the clock-bound team items, then the queues, then payments', () => {
    const order = homeFeedOrder('staff');
    assert.deepEqual(order, ['work', 'walks', 'meetings', 'replies', 'holds', 'cleanings', 'unassigned', 'queues', 'payments']);
  });

  test('owners keep the clean-after card first and the rest of the day after it', () => {
    const order = homeFeedOrder('owner');
    assert.equal(order[0], 'holds');
    assert.deepEqual(order.slice(1), homeFeedOrder('staff').filter((s) => s !== 'holds'));
  });

  test('payments are last and capped, unpaid first, with the rest counted', () => {
    const w = windowPayments(['o1', 'o2'], ['k1'], ['p1', 'p2', 'p3']);
    assert.equal(PAYMENTS_WINDOW, 4);
    assert.deepEqual(w.overdue, ['o1', 'o2']);
    assert.deepEqual(w.problems, ['k1']);
    assert.deepEqual(w.paid, ['p1']);
    assert.equal(w.more, 2);
    const few = windowPayments([], [], ['p1']);
    assert.equal(few.more, 0);
    assert.deepEqual(few.paid, ['p1']);
    const flood = windowPayments(Array.from({ length: 20 }, (_, i) => i), [], []);
    assert.equal(flood.overdue.length, 4);
    assert.equal(flood.more, 16);
  });

  test('the feed renders in that order, and every row of payments goes through the window', () => {
    const feed = read('src/components/ForMeFeed.tsx');
    assert.ok(feed.includes('const shown = homeFeedOrder(role).filter((key) => sections[key] != null);'), 'the feed must render through homeFeedOrder');
    assert.ok(feed.includes('shown.map((key) => ('), 'and in that order');
    assert.ok(feed.includes('const payments = windowPayments(overdueLinks, keyProblems, paidLinks);'), 'payments are windowed');
    assert.ok(feed.includes('{payments.more > 0 && <MoreRow'), 'the rest fold into N more');
    assert.ok(!feed.includes("Showing the team's unclaimed backlog"), 'no explainer under Unassigned work');
    assert.ok(!feed.includes('lands on the statement through the extras queue'), 'no statement plumbing on a paid row');
  });

  test('a staff login sees its own meetings and none of an owner inbox', () => {
    const feed = read('src/components/ForMeFeed.tsx');
    assert.ok(feed.includes("owner ? loadMeetingCards() : email ? loadMeetingCards(new Date(), { createdBy: email }) : Promise.resolve([])"));
    assert.ok(feed.includes('if (!owner && !mail.canOpen) {'), 'the triaged mail waits on its owners only');
    const meetings = read('src/lib/meetings.ts');
    assert.ok(meetings.includes("if (opts.createdBy) q = q.eq('created_by_email', opts.createdBy);"));
  });
});

describe('one × with one meaning', () => {
  test('the × hides a row from my feed and is never the concierge clear', () => {
    const button = read('src/components/FeedClearButton.tsx');
    assert.ok(button.includes('title="Hide from my feed"'));
    const actions = read('src/app/feed-actions.ts');
    assert.ok(!/DISMISSIBLE_TYPES = new Set\([^)]*'concierge'/.test(actions), 'concierge is not a feed dismissal');
    assert.ok(actions.includes('export async function clearConciergeAlert('), 'the global clear is its own action');
    const alerts = read('src/components/ConciergeAlerts.tsx');
    assert.ok(!alerts.includes('FeedClearButton'), 'a concierge alert never wears the feed ×');
    assert.ok(read('src/components/ConciergeClearButton.tsx').includes("'Clear for everyone'"), 'and says it clears for everyone');
  });

  test('cards that clear by being answered carry no ×', () => {
    const feed = read('src/components/ForMeFeed.tsx');
    for (const fn of ['function HoldRow', 'function CleaningFlagRow', 'function QueueRow', 'function PaymentKeyProblemRow', 'function MeetingFeedRow', 'function PlannedWalkRow']) {
      const at = feed.indexOf(fn);
      if (at < 0) continue; // HoldRow lives with the cleaner card
      const body = feed.slice(at, feed.indexOf('\nfunction ', at + fn.length));
      assert.ok(!body.includes('<FeedClearButton'), `${fn} must not carry the ×`);
    }
  });
});

test('a packet row says its stop count once', () => {
  const feed = read('src/components/ForMeFeed.tsx');
  assert.ok(feed.includes('p.stop_count && !/\\bstops?\\b/i.test(p.title)'), 'a title that already counts its stops is not counted again');
});
