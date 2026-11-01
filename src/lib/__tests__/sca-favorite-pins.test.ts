import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeScaErrors,
  fillFavoritePins,
  knownFavoritePin,
  registryFavoritePins,
  needsFavoritePins,
  validateScaForm,
  type ScaFormDraft,
} from '../sca-launch.ts';

const base = (): ScaFormDraft => ({
  guestyListingId: 'abc',
  internalName: '47 Atlantic',
  publicName: 'Stay at Bass Rocks',
  icalUrl: 'https://app.guesty.com/ical',
  stripeAccountKey: '47_ATLANTIC',
  rank: 30,
  pitch: 'Across the road from the ocean.',
  tagline: 'Ocean across the road',
  highlights: ['a', 'b', 'c'],
  stayFavorite: { name: 'Short & Main', town: 'Gloucester', blurb: 'Wood-fired pizza.', lat: NaN, lng: NaN },
});

test('a blank pin, as NaN or as null after JSON, reads as its own field, never zod words', () => {
  const nan = validateScaForm(base());
  const viaJson = validateScaForm(JSON.parse(JSON.stringify(base())));
  for (const v of [nan, viaJson]) {
    assert.equal(v.ok, false);
    if (v.ok) continue;
    assert.equal(v.errors['stayFavorite.lat'], 'Latitude required');
    assert.equal(v.errors['stayFavorite.lng'], 'Longitude required');
    const line = describeScaErrors(v.errors);
    assert.doesNotMatch(line, /expected number|received null/);
    assert.match(line, /^Restaurant map pin: /);
    assert.equal(line.split('; ').length, 1, 'latitude and longitude read as one line');
  }
});

test('the lookup fills a named restaurant and the draft then validates', async () => {
  const calls: string[] = [];
  const filled = await fillFavoritePins(base(), async (name, town) => {
    calls.push(`${name}|${town}`);
    return { lat: 42.61, lng: -70.66 };
  });
  assert.deepEqual(calls, ['Short & Main|Gloucester']);
  assert.equal(filled.stayFavorite.lat, 42.61);
  assert.equal(validateScaForm(filled).ok, true);
});

test('a miss keeps the pin blank, and a draft with pins or no name is left alone', async () => {
  const miss = await fillFavoritePins(base(), async () => null);
  assert.equal(validateScaForm(miss).ok, false);

  const pinned = { ...base(), stayFavorite: { ...base().stayFavorite, lat: 1, lng: 2 } };
  assert.equal(needsFavoritePins(pinned), false);
  assert.equal(await fillFavoritePins(pinned, async () => assert.fail('no lookup')), pinned);

  const unnamed = { ...base(), stayFavorite: { ...base().stayFavorite, name: '' } };
  assert.equal(needsFavoritePins(unnamed), false);
});

test('extra spots are filled too and named by position', async () => {
  const draft = { ...base(), extraFavorites: [{ name: 'Duckworth', town: 'Gloucester', blurb: 'x', lat: NaN, lng: NaN }] };
  const filled = await fillFavoritePins(draft, async (name) => (name === 'Duckworth' ? { lat: 1, lng: 2 } : null));
  assert.equal(filled.extraFavorites?.[0].lat, 1);
  assert.equal(Number.isNaN(filled.stayFavorite.lat), true);
  assert.match(describeScaErrors({ 'extraFavorites.0.lat': 'Latitude required' }), /^Extra spot 1 map pin/);
});

test('a restaurant already on a live listing takes that pin, spelled loosely', () => {
  const registry = JSON.stringify({
    listings: {
      a: { stayFavorite: { name: 'Short and Main', town: 'Gloucester', lat: 42.61, lng: -70.66 } },
      b: { extraFavorites: [{ name: 'The Gloucester House', town: 'Gloucester', lat: 42.6, lng: -70.67 }, { name: 'No pin', town: 'Rockport' }] },
    },
  });
  const pins = registryFavoritePins(registry);
  assert.deepEqual(knownFavoritePin(pins, 'Short & Main', 'gloucester'), { lat: 42.61, lng: -70.66 });
  assert.deepEqual(knownFavoritePin(pins, 'Gloucester House', 'Gloucester'), { lat: 42.6, lng: -70.67 });
  assert.equal(knownFavoritePin(pins, 'Short and Main', 'Rockport'), null);
  assert.equal(knownFavoritePin(pins, 'No pin', 'Rockport'), null);
  assert.equal(registryFavoritePins('not json').size, 0);
});
