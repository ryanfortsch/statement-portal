/**
 * Conversations reach past the 60-day list (2026-10-18): the window math, and
 * the browser's promises that it walks back and never ends without a word.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { earlierWindow, floorFor, formatWindow, reachedFloor, windowProblem, WINDOW_DAYS } from '../conversation-window.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('conversation windows', () => {
  test('a step back is the 120 days ending the day before', () => {
    assert.deepEqual(earlierWindow('2026-08-19'), { from: '2026-04-21', to: '2026-08-18' });
    assert.equal(WINDOW_DAYS, 120);
  });

  test('the floor is two years back, and reaching it is visible', () => {
    assert.equal(floorFor('2026-10-18'), '2024-10-18');
    assert.equal(reachedFloor('2024-10-01', '2026-10-18'), true);
    assert.equal(reachedFloor('2025-06-01', '2026-10-18'), false);
  });

  test('a picked window is checked before the concierge is asked', () => {
    assert.equal(windowProblem('2026-07-01', '2026-09-15'), null);
    assert.equal(windowProblem('2026-09-15', '2026-07-01'), 'The second date is before the first.');
    assert.equal(windowProblem('2026-01-01', '2026-09-01'), 'Pick 120 days or fewer at a time.');
    assert.equal(windowProblem('', '2026-09-01'), 'Pick both dates.');
  });

  test('a window reads as dates', () => {
    assert.equal(formatWindow('2026-06-20', '2026-10-17'), 'Jun 20 to Oct 17, 2026');
    assert.equal(formatWindow('2025-12-01', '2026-02-01'), 'Dec 1, 2025 to Feb 1, 2026');
  });

  test('the list walks back and hands off to Guesty instead of ending silently', () => {
    const src = read('src/app/messaging/Conversations.tsx');
    assert.ok(src.includes('loadConversationWindow('), 'it asks the concierge for older windows');
    assert.ok(src.includes('Older conversations are in Guesty'), 'past what Helm reaches, it says so');
    assert.ok(src.includes('href={GUESTY_INBOX_URL}'), 'with a link');
    assert.ok(src.includes('aria-label="Check-in dates"'), 'a date range');
    const action = read('src/app/messaging/conversation-actions.ts');
    assert.ok(action.includes('windowProblem(from, to)') && action.includes('listConversationsInRange(from, to)'), 'the action checks the window, then asks');
  });
});
