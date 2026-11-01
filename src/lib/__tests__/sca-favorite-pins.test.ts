import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeScaErrors,
  fillFavoritePins,
  needsFavoritePins,
  validateScaForm,
  type ScaFormDraft,
} from '../sca-launch.ts';
import { VERIFIED_RESTAURANTS, findRestaurant, restaurantChoices } from '../sca-restaurants.ts';

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
    assert.match(line, /^Restaurant: Helm could not find it on the map/);
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
  assert.match(describeScaErrors({ 'extraFavorites.0.lat': 'Latitude required' }), /^Extra spot 1: Helm could not find it/);
});

test('the dropdown holds the verified picks plus any pinned restaurant on a live listing', () => {
  const registry = JSON.stringify({
    listings: {
      a: { stayFavorite: { name: 'Short & Main', town: 'Gloucester', lat: 1, lng: 2, blurb: 'x' } },
      b: { extraFavorites: [{ name: 'New Spot', town: 'Essex', lat: 42.63, lng: -70.78, blurb: 'Clams.' }, { name: 'No pin', town: 'Rockport' }] },
    },
  });
  const choices = restaurantChoices(registry);
  assert.equal(choices.length, VERIFIED_RESTAURANTS.length + 1, 'Short & Main is the verified Short and Main; No pin is left out');
  assert.deepEqual(findRestaurant(choices, 'New Spot', 'essex'), { name: 'New Spot', town: 'Essex', lat: 42.63, lng: -70.78, sampleBlurb: 'Clams.' });
  assert.equal(findRestaurant(choices, 'Short & Main', 'Gloucester')?.lat, 42.6129, 'the verified pin wins');
  assert.equal(findRestaurant(choices, 'Gloucester House', 'Gloucester')?.name, 'The Gloucester House');
  assert.equal(findRestaurant(choices, 'Short and Main', 'Rockport'), null);
  assert.equal(restaurantChoices('not json').length, VERIFIED_RESTAURANTS.length);
  for (const r of VERIFIED_RESTAURANTS) assert.ok(Number.isFinite(r.lat) && Number.isFinite(r.lng), r.name);
});

test('the launcher has no coordinate boxes; the restaurant is a dropdown', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../../app/properties/[id]/stay-cape-ann/ScaLaunchClient.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /placeholder="Lat"|placeholder="Lng"/);
  assert.match(src, /<RestaurantPicker value=\{form\.stayFavorite\}/);
});

test("Step 3 names Helm's own key and its seven permissions, matching what Helm calls", async () => {
  const { HELM_STRIPE_KEY_PERMISSIONS, helmStripeKeyEnvName } = await import('../sca-config.ts');
  assert.equal(helmStripeKeyEnvName('47_atlantic'), 'STRIPE_KEY_47_ATLANTIC');
  assert.deepEqual(
    HELM_STRIPE_KEY_PERMISSIONS.map((p) => `${p.resource} ${p.access}`),
    ['Charges Read', 'Balance Read', 'Checkout Sessions Read', 'Payment Links Write', 'Products Write', 'Prices Write', 'Payment Intents Write'],
  );
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../../app/properties/[id]/stay-cape-ann/ScaLaunchClient.tsx', import.meta.url), 'utf8');
  assert.match(src, /HELM_STRIPE_KEY_PERMISSIONS\.map/);
  assert.match(src, /helmStripeKeyEnvName\(props\.propertyId\)/);
});
