/**
 * A refused send keeps its card and says why; only a card that moved on is stale.
 *
 * Jane / 19 Rackliffe, 2026-10-15: the concierge refused two approves with a
 * 409 from the review guard ("Review message blocked: conversation evidence is
 * unavailable or incomplete"). Helm read every 409 as "the card moved on",
 * refreshed, got the same pending card back, and left the button on "Sending"
 * for five minutes with no reason on screen.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { explainError, isStaleConflict, type StayConciergeError } from '../stay-concierge.ts';

const http = (status: number, detail: string): StayConciergeError => ({ kind: 'http', status, detail });

describe('isStaleConflict', () => {
  test('already_<status> is a card that moved on', () => {
    assert.equal(isStaleConflict(http(409, 'already_superseded')), true);
    assert.equal(isStaleConflict(http(409, 'already_approved')), true);
  });
  test('a review-guard refusal is not stale', () => {
    assert.equal(
      isStaleConflict(http(409, 'Review message blocked: conversation evidence is unavailable or incomplete.')),
      false,
    );
  });
  test('a channel violation is not stale', () => {
    assert.equal(isStaleConflict(http(409, 'channel_violation: edit the draft to remove a link')), false);
  });
  test('other statuses and kinds are never stale', () => {
    assert.equal(isStaleConflict(http(502, 'already_x')), false);
    assert.equal(isStaleConflict({ kind: 'network', message: 'down' }), false);
    assert.equal(isStaleConflict({ kind: 'unconfigured' }), false);
  });
});

describe('explainError on a 409', () => {
  test('a refusal shows the reason', () => {
    assert.equal(
      explainError(http(409, 'Review request blocked: a platform review record exists.')),
      'Not sent: Review request blocked: a platform review record exists.',
    );
  });
  test('a card that moved on keeps its message', () => {
    assert.equal(explainError(http(409, 'already_approved')), 'That approval is no longer pending (already_approved).');
  });
});

describe('the queue actions use it', () => {
  test('mapResult marks stale only through isStaleConflict', () => {
    const src = readFileSync('src/app/messaging/actions.ts', 'utf8');
    assert.match(src, /const stale = isStaleConflict\(result\.error\);/);
    assert.doesNotMatch(src, /const stale = result\.error\.kind === 'http' && result\.error\.status === 409;/);
  });
});
