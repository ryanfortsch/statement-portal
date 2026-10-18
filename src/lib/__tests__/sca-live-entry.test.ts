/**
 * A live Stay Cape Ann listing opens in the launcher on its live registry
 * entry, so the launcher can be the one place its copy and bedroom photos are
 * edited (the fleet Bedroom photos page and Listing Copy Studio wrote the
 * registry directly and left the launcher's saved draft behind).
 *
 * The read-back must be the exact inverse of what the launcher writes, or an
 * update PR opened from an untouched form would still change the live page.
 *
 * Run: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyEntryToRegistryJson,
  buildRegistryEntry,
  mergeRegistryEntry,
  registryEntryFor,
  registryEntryToDraft,
  scaPreviewSignature,
  validateScaForm,
  type ScaRegistryEntry,
} from '../sca-launch.ts';

const live: ScaRegistryEntry = {
  internalName: 'Harbor House',
  publicName: 'Stay by the Harbor',
  icalUrl: 'https://example.test/calendar',
  rank: 30,
  stripeAccountKey: 'HARBOR',
  pitch: 'By the water',
  tagline: 'Harbor views from the porch',
  description: 'A quiet home.\n\nTwo floors.',
  highlights: ['Waterfront', 'Patio', 'Parking', 'Walk to town'],
  stayFavorite: { name: 'Example Cafe', category: 'dining', lat: 42.6, lng: -70.6, town: 'Gloucester', blurb: 'Breakfast nearby' },
  extraFavorites: [{ name: 'Second Spot', category: 'dining', lat: 42.61, lng: -70.61, town: 'Rockport', blurb: 'Dinner' }],
  sleepingArrangements: [
    { name: 'Primary', beds: 'King', photo: 'https://example.test/one.jpg' },
    { name: 'Bunk room', beds: '2 Twins', photo: ['https://example.test/two.jpg', 'https://example.test/three.jpg'] },
    { name: 'Loft', beds: 'Queen' },
  ],
  reviews: [{ name: 'Sam', date: '2026-07', rating: 5, text: 'Lovely.' }],
  rating: 4.9,
  reviewCount: 41,
};
const fallback = { internalName: 'Fallback', stripeAccountKey: 'FALLBACK', rank: 100 };

test('a live entry reads back into a form that writes the same entry', () => {
  const draft = registryEntryToDraft('harbor', live as unknown as Record<string, unknown>, fallback);
  const valid = validateScaForm(draft);
  assert.ok(valid.ok, JSON.stringify(!valid.ok && valid.errors));
  assert.equal(scaPreviewSignature('harbor', buildRegistryEntry(valid.data)), scaPreviewSignature('harbor', live));
  // Every bedroom photo is in the form as a list, the one shape the uploader edits.
  assert.deepEqual(draft.sleepingArrangements?.map((s) => s.photo), [
    ['https://example.test/one.jpg'],
    ['https://example.test/two.jpg', 'https://example.test/three.jpg'],
    [],
  ]);
});

test('missing fields take the form defaults and the launcher names what a launch needs', () => {
  const draft = registryEntryToDraft('bare', { publicName: 'Stay Bare', icalUrl: 'https://example.test/c' }, fallback);
  assert.equal(draft.internalName, 'Fallback');
  assert.equal(draft.stripeAccountKey, 'FALLBACK');
  assert.equal(draft.rank, 100);
  assert.deepEqual(draft.highlights, ['', '', '']);
  const valid = validateScaForm(draft);
  assert.ok(!valid.ok);
  assert.ok('pitch' in valid.errors && 'tagline' in valid.errors && 'highlights' in valid.errors);
});

test('the entry is found by listing id in the raw registry', () => {
  const raw = applyEntryToRegistryJson(JSON.stringify({ listings: {} }), 'harbor', live);
  assert.equal(registryEntryFor(raw, 'harbor')?.publicName, 'Stay by the Harbor');
  assert.equal(registryEntryFor(raw, ' harbor ')?.publicName, 'Stay by the Harbor');
  assert.equal(registryEntryFor(raw, 'missing'), null);
  assert.equal(registryEntryFor(raw, ''), null);
});

test('an update keeps what the launcher does not write and drops what the form cleared', () => {
  const handEdited = {
    ...live,
    stayFavorite: { ...live.stayFavorite!, address: '5 Main Street' },
    nearbyOverrides: { 'Good Harbor Beach': { walking: { minutes: 4 } } },
  } as unknown as Record<string, unknown>;
  const draft = registryEntryToDraft('harbor', handEdited, fallback);
  // Untouched: the merged entry is the live entry, byte for byte.
  const valid = validateScaForm(draft);
  assert.ok(valid.ok);
  assert.equal(JSON.stringify(mergeRegistryEntry(handEdited, buildRegistryEntry(valid.data))), JSON.stringify(handEdited));
  // The preview check compares only the launcher's fields.
  assert.equal(scaPreviewSignature('harbor', handEdited), scaPreviewSignature('harbor', buildRegistryEntry(valid.data)));

  // Edited: the tagline changes, the About is cleared, the pick is swapped.
  const edited = validateScaForm({
    ...draft,
    tagline: 'New tagline',
    description: '',
    stayFavorite: { name: 'Other Place', town: 'Gloucester', blurb: 'Lunch', lat: 42.6, lng: -70.6 },
  });
  assert.ok(edited.ok);
  const merged = mergeRegistryEntry(handEdited, buildRegistryEntry(edited.data));
  assert.equal(merged.tagline, 'New tagline');
  assert.ok(!('description' in merged), 'a cleared About falls back to Guesty');
  assert.deepEqual(merged.nearbyOverrides, handEdited.nearbyOverrides);
  assert.ok(!('address' in (merged.stayFavorite as object)), 'a different restaurant does not inherit the old address');
  // Same restaurant, new blurb: its address stays.
  const sameName = validateScaForm({ ...draft, stayFavorite: { ...draft.stayFavorite, blurb: 'New blurb' } });
  assert.ok(sameName.ok);
  const kept = mergeRegistryEntry(handEdited, buildRegistryEntry(sameName.data)).stayFavorite as Record<string, unknown>;
  assert.equal(kept.address, '5 Main Street');
  assert.equal(kept.blurb, 'New blurb');
});

test('an empty bedroom in the middle stays as its placeholder card', () => {
  const draft = registryEntryToDraft('harbor', { ...live, sleepingArrangements: [{ name: 'One' }, {}, { beds: '2 Twins' }] } as unknown as Record<string, unknown>, fallback);
  const valid = validateScaForm(draft);
  assert.ok(valid.ok);
  assert.deepEqual(buildRegistryEntry(valid.data).sleepingArrangements, [{ name: 'One' }, {}, { beds: '2 Twins' }]);
});
