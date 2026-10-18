/**
 * The copy notes the launcher index's Needs review filter and the launcher's
 * Step 1 print (the retired Listing Copy Studio's flags, in plain words).
 *
 * Run: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listingCopyNotes } from '../sca-copy-notes.ts';

test('clean copy has no notes', () => {
  assert.deepEqual(listingCopyNotes({ tagline: 'On the harbor', description: 'Two floors.', highlights: ['A', 'B', 'C'] }), []);
});

test('each OTA habit gets its note', () => {
  assert.deepEqual(listingCopyNotes({}), ['no copy']);
  assert.deepEqual(listingCopyNotes({ tagline: '✓ Steps to the beach', highlights: ['A', 'B', 'C'] }), ['OTA checkmarks']);
  assert.deepEqual(listingCopyNotes({ tagline: 'Wow!', highlights: ['A', 'B', 'C'] }), ['exclamation marks']);
  assert.deepEqual(listingCopyNotes({ tagline: 'Harbor \u2014 views', highlights: ['A', 'B', 'C'] }), ['em dashes']);
  assert.deepEqual(listingCopyNotes({ tagline: 'x'.repeat(141), highlights: ['A', 'B', 'C'] }), ['tagline over 140 characters']);
  assert.deepEqual(listingCopyNotes({ tagline: 'T', description: 'x'.repeat(1601), highlights: ['A', 'B', 'C'] }), ['About over 1,600 characters']);
  assert.deepEqual(listingCopyNotes({ tagline: 'T', highlights: ['A', ' ', 'B'] }), ['fewer than 3 highlights']);
});
