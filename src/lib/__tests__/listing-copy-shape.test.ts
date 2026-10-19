/**
 * The listing's read view shapers beyond the two toScaListing shares:
 * whether Helm has listing copy of its own (an empty Guesty-run listing is
 * one line, not a run of empty blocks), and the live staycapeann.com copy
 * as the read-only snapshot shows it.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hasListingCopy, scaSnapshotFrom } from '../listing-copy-shape.ts';

describe('hasListingCopy', () => {
  test('nothing written, no photos: no copy', () => {
    assert.equal(hasListingCopy(null, 0), false);
    assert.equal(hasListingCopy({ title: '  ', summary: null, amenities: [], amenities_not_included: [] }, 0), false);
  });

  test('any copy, amenity or photo is Helm copy', () => {
    assert.equal(hasListingCopy({ neighborhood: 'Rocky Neck' }, 0), true);
    assert.equal(hasListingCopy({ amenities: ['Wifi'] }, 0), true);
    assert.equal(hasListingCopy({ amenities_not_included: ['No washer'] }, 0), true);
    assert.equal(hasListingCopy(null, 1), true);
  });
});

describe('scaSnapshotFrom', () => {
  test('reads the site entry the way the page shows it', () => {
    const snap = scaSnapshotFrom({
      publicName: 'Harbor Cottage',
      pitch: 'A short pitch',
      tagline: '',
      highlights: ['Deck', '', 'Walk to town'],
      description: 'Bright rooms.\n\nA deck over the cove.',
      sleepingArrangements: [{ name: 'Primary', beds: '1 King', photo: 'x.jpg' }, {}],
      heroPhoto: 'https://example.test/hero.jpg',
      stripeAccountKey: 'never shown',
    });
    assert.deepEqual(snap, {
      title: 'Harbor Cottage',
      tagline: 'A short pitch',
      highlights: ['Deck', 'Walk to town'],
      about: 'Bright rooms.\n\nA deck over the cove.',
      rooms: [{ name: 'Primary', beds: '1 King' }],
      heroPhoto: 'https://example.test/hero.jpg',
    });
  });

  test('no entry, or an entry with no copy, is no snapshot', () => {
    assert.equal(scaSnapshotFrom(null), null);
    assert.equal(scaSnapshotFrom({ icalUrl: 'https://example.test/cal.ics', rank: 3 }), null);
  });
});
