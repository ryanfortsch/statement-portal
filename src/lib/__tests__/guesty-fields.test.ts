/**
 * The Guesty fields screen: both directions on one table (UI/UX audit
 * 2026-10-17, appendix 05: "Sync to Guesty" and "Fill blanks from Guesty"
 * were two look-alike tools going opposite ways).
 *
 * Guesty to Helm only ever fills a blank. It used to write on one click with
 * no preview; now it previews, and the writer refuses a column that is no
 * longer blank, so a value typed on Facts meanwhile is never replaced.
 *
 * Run: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { guestyPullValues, helmPullValues, pullStatus, pullUpdates } from '../guesty-fields.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const listing = { bedrooms: 4, bathrooms: 2.5, area: 1800, propertyType: 'House', address: { lat: 42.61, lng: -70.66 } };

test('each field reads the same way on both sides', () => {
  assert.deepEqual(guestyPullValues(listing), { bedrooms: '4', bathrooms: '2.5', square_feet: '1800', type_of_unit: 'House', map_pin: '42.61, -70.66' });
  assert.deepEqual(helmPullValues({ bedrooms: null, bathrooms: 2.5, square_feet: '', type_of_unit: ' ', latitude: 42.61, longitude: null }), {
    bedrooms: '', bathrooms: '2.5', square_feet: '', type_of_unit: '', map_pin: '',
  });
});

test('a pull fills a blank, matches, or leaves Helm its own value', () => {
  assert.equal(pullStatus('', '4'), 'fill');
  assert.equal(pullStatus('4', '4'), 'same');
  assert.equal(pullStatus('house', 'House'), 'same');
  assert.equal(pullStatus('3', '4'), 'kept');
  assert.equal(pullStatus('', ''), 'guesty-empty');
});

test('the writes cover only ticked blanks; half a map pin is never overwritten', () => {
  const helm = { bedrooms: null, bathrooms: 3, square_feet: null, type_of_unit: '', latitude: 42.6, longitude: null };
  assert.deepEqual(pullUpdates(['bedrooms', 'bathrooms', 'type_of_unit', 'map_pin'], helm, listing), { bedrooms: 4, type_of_unit: 'House' });
  assert.deepEqual(pullUpdates(['square_feet'], helm, listing), { square_feet: 1800 });
  assert.deepEqual(pullUpdates(['map_pin'], { latitude: null, longitude: null }, listing), { latitude: 42.61, longitude: -70.66 });
  assert.deepEqual(pullUpdates([], helm, listing), {});
});

test('one screen: the old Facts button is gone and the writer guards each column on blank', () => {
  assert.ok(!existsSync(new URL('../../../src/app/properties/[id]/PropertyBackfillButton.tsx', import.meta.url)));
  assert.ok(!read('src/app/properties/[id]/actions.ts').includes('backfillPropertyFromIntegrations'));
  const actions = read('src/app/properties/[id]/sync-guesty/actions.ts');
  assert.ok(actions.includes("for (const c of f.columns) q = c === 'type_of_unit' ? q.or(`${c}.is.null,${c}.eq.`) : q.is(c, null);"));
  const client = read('src/app/properties/[id]/sync-guesty/SyncGuestyClient.tsx');
  assert.ok(client.includes("{direction === 'push' ? '→' : '←'}"), 'each row shows its arrow');
  assert.ok(client.includes("Send ${pushCount} to Guesty →") && client.includes("← Fill ${pullCount} in Helm"));
  // The not-linked state says where the listing id is set.
  assert.ok(client.includes('href={`/properties/${propertyId}/stay-cape-ann`}') && client.includes('Set the Guesty listing ID →'));
});
