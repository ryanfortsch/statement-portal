/**
 * Guest-facing reads of `bookings` take canonical rows only: the invariant audit.
 *
 * `bookings` holds duplicate rows per stay BY DESIGN, one per source, and
 * `duplicate_of` is what marks the losers. A read that omits the filter does
 * not fail, it just sometimes answers with a superseded twin: an altered
 * Airbnb code, or the Booking.com "Guest to be announced" placeholder that a
 * named record later replaced. Sorted by check_in and sliced to 25, the twin
 * can win.
 *
 * That was survivable while these rows only filled a collapsed accordion. It
 * stops being survivable the moment a guest name is promoted somewhere an
 * operator reads it aloud, or a door code is issued against it.
 *
 * The guard is one `.is('duplicate_of', null)` per query, with nothing else
 * holding it in place, so this reads the source and asserts it is still
 * there. Same shape as shoot-offer-optin.test.ts, and for the same reason.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/**
 * Pull the chained query that starts at `.from('<table>')` and runs until the
 * call that terminates it. Good enough to assert which filters ride along,
 * which is all this file needs.
 */
function queryFrom(src: string, table: string): string {
  const start = src.indexOf(`.from('${table}')`);
  assert.notEqual(start, -1, `no .from('${table}') in this file any more`);
  const end = src.indexOf('.limit(', start);
  assert.notEqual(end, -1, `the ${table} query lost its .limit()`);
  return src.slice(start, end);
}

describe('guest-facing booking reads take canonical rows only', () => {
  test("getGuestCodeView's bookings query filters duplicate_of", () => {
    const src = read('src/lib/guest-locks.ts');
    const q = queryFrom(src, 'bookings');

    assert.ok(
      q.includes(".is('duplicate_of', null)"),
      'The Guest door codes panel reads bookings without the canonical-row filter, so a ' +
        'superseded twin can be shown as the stay in residence and take a door code.',
    );
    // The filters this query is worthless without, asserted so a refactor
    // that drops one is visible here rather than in front of a guest.
    assert.ok(q.includes(".eq('status', 'confirmed')"), 'lost the confirmed-only filter');
    assert.ok(q.includes(".gte('check_out', today)"), 'lost the still-upcoming filter');
  });

  test('the reason the filter exists is written down next to it', () => {
    const src = read('src/lib/guest-locks.ts');
    // Cheap, but this is exactly the guard someone deletes while tidying a
    // query, and the comment is the only thing that says why it is load-bearing.
    assert.match(
      src,
      /duplicate rows per stay by design/i,
      'the comment explaining the canonical-row filter is gone; without it the filter reads as redundant',
    );
  });
});
