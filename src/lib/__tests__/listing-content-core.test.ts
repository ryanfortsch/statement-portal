/**
 * The pure half of listing-content.ts: bedSummary over property_rooms rows,
 * the SCA Listing assembly (toScaListing), the Guesty "space" text into
 * About blocks, the ✓ summary into highlights, and the per-field consumer
 * map the editor prints.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AMENITY_CATALOG,
  amenityMatchKey,
  bedSummary,
  consumersOf,
  descriptionBlocksFrom,
  FIELD_CONSUMERS,
  splitSummary,
  toScaListing,
  type ListingRecord,
} from '../listing-content.ts';
import type { PropertyRoom } from '../property-rooms-shared.ts';
import type { RatePlanRow } from '../rate-plan.ts';

const room = (over: Partial<PropertyRoom>): PropertyRoom => ({
  id: over.id ?? 'r',
  property_id: '65_calderwood',
  room_type: 'bedroom',
  name: 'Bedroom',
  sort_order: 0,
  details: {},
  guest_summary: null,
  created_by_email: null,
  created_at: '2026-09-25T00:00:00Z',
  updated_at: '2026-09-25T00:00:00Z',
  ...over,
});

const rooms: PropertyRoom[] = [
  room({ id: 'b3', name: 'Bedroom 3', sort_order: 2, details: { beds: [{ size: 'king', count: 1 }] } }),
  room({ id: 'b1', name: 'Bedroom 1', sort_order: 0, details: { beds: [{ size: 'queen', count: 1 }] } }),
  room({ id: 'b2', name: 'Bedroom 2', sort_order: 1, details: { beds: [{ size: 'single', count: 2 }] } }),
  room({ id: 'lr', name: 'Living room', room_type: 'living', sort_order: 3, details: { tv: '65in' } }),
  room({ id: 'den', name: 'Den', room_type: 'living', sort_order: 4, details: { beds: [{ size: 'sofa bed', count: 1 }] } }),
];

const plan: RatePlanRow = {
  property_id: '65_calderwood',
  currency: 'USD',
  base_nightly_cents: 35000,
  weekend_nightly_cents: 35000,
  weekend_days: [5, 6],
  guests_included: 4,
  extra_guest_cents_per_night: 3500,
  cleaning_fee_cents: 30000,
  pet_fee_cents: null,
  security_deposit_cents: 20000,
  weekly_discount_pct: 0,
  monthly_discount_pct: 0,
  direct_markup_pct: 0,
  min_nights_default: 3,
  max_nights: 91,
  advance_notice_hours: 24,
  booking_window_days: 365,
  turnover_buffer_days: 0,
  checkin_time: '16:00',
  checkout_time: '11:00',
  max_occupancy: 6,
  pets_allowed: false,
  quiet_hours: null,
  cancellation_policy_key: 'custom',
  cancellation_terms: null,
  house_rules: null,
};

const record: ListingRecord = {
  property: {
    id: '65_calderwood',
    name: '65 Calderwood',
    title: 'Stay at Black Rock Harbor',
    address: '65 Calderwood Court',
    city: 'Bridgeport',
    region: 'bridgeport_ct',
    latitude: 41.1533573,
    longitude: -73.2219381,
    bedrooms: 3,
    bathrooms: 2,
    calendar_authority: 'helm',
  },
  content: {
    property_id: '65_calderwood',
    title: 'Stay at Black Rock Harbor',
    summary: '✓ Great Location – Short stroll to the beach\n✓ Premium Comfort – 3 bedrooms\nA sun-filled Cape by the harbor.',
    space: '☆☆☆ FIRST FLOOR ☆☆☆\n\n→ Kitchen: Fully equipped\n→ Dining: Sunroom banquet seating\n\nAccessibility\nThe front entrance has steps.',
    access: 'Whole house except the basement.',
    interaction: null,
    neighborhood: 'Set along the shores of Black Rock Harbor.',
    house_rules: 'No parties.',
    notes: null,
    property_type: 'House',
    room_type: 'Entire home/apt',
    accommodates: 6,
    bedrooms: 3,
    bathrooms: 2,
    beds: 4,
    amenities: ['Wireless Internet', 'EV charger'],
    amenities_not_included: [],
    hero_photo_id: 'ph2',
    source: 'guesty_seed',
    source_ref: '66797ba7f51d72001388bc29',
    updated_by: null,
  },
  photos: [
    { id: 'ph1', property_id: '65_calderwood', url: 'https://blob/1.jpg', source_url: null, thumbnail_url: null, caption: 'Dining', room_hint: null, sort_order: 0, is_hero: false, source: 'guesty_seed', external_id: 'p1', width: null, height: null },
    { id: 'ph2', property_id: '65_calderwood', url: 'https://blob/2.jpg', source_url: null, thumbnail_url: null, caption: null, room_hint: null, sort_order: 1, is_hero: true, source: 'guesty_seed', external_id: 'p2', width: null, height: null },
    { id: 'ph3', property_id: '65_calderwood', url: 'https://blob/3.jpg', source_url: null, thumbnail_url: null, caption: 'King bed', room_hint: 'Bedroom 3', sort_order: 2, is_hero: false, source: 'helm', external_id: null, width: null, height: null },
  ],
  rooms,
};

describe('bedSummary', () => {
  test('totals across rooms in size order, per-room lines in sort order, bedless rooms ignored', () => {
    const s = bedSummary(rooms);
    assert.equal(s.text, '1 king, 1 queen, 2 singles, 1 sofa bed');
    assert.equal(s.totalBeds, 5);
    assert.equal(s.bedrooms, 3);
    assert.deepEqual(s.perRoom, [
      { name: 'Bedroom 1', beds: '1 queen' },
      { name: 'Bedroom 2', beds: '2 singles' },
      { name: 'Bedroom 3', beds: '1 king' },
      { name: 'Den', beds: '1 sofa bed' },
    ]);
  });

  test('no rooms, or rooms without beds, is an empty summary', () => {
    assert.deepEqual(bedSummary([]), { text: '', totalBeds: 0, bedrooms: 0, perRoom: [] });
    assert.equal(bedSummary([room({ details: { beds: [] } })]).text, '');
  });

  test('the same size in two rooms adds up', () => {
    const s = bedSummary([
      room({ id: 'a', sort_order: 0, details: { beds: [{ size: 'queen', count: 1 }] } }),
      room({ id: 'b', sort_order: 1, details: { beds: [{ size: 'Queen', count: 1 }] } }),
    ]);
    assert.equal(s.text, '2 queens');
  });
});

describe('toScaListing', () => {
  const sca = toScaListing(record, plan);

  test('title, town, address and coordinates come from the record', () => {
    assert.equal(sca.id, '65_calderwood');
    assert.equal(sca.title, 'Stay at Black Rock Harbor');
    assert.equal(sca.town, 'Bridgeport');
    assert.deepEqual(sca.address, { city: 'Bridgeport', state: 'CT', full: '65 Calderwood Court, Bridgeport, CT', lat: 41.1533573, lng: -73.2219381 });
  });

  test('money is dollars from the plan', () => {
    assert.equal(sca.basePrice, 350);
    assert.equal(sca.cleaningFee, 300);
    assert.equal(sca.extraPersonFee, 35);
    assert.equal(sca.guestsIncludedInRegularFee, 4);
    assert.equal(sca.currency, 'USD');
  });

  test('photos hero-first then by sort order, captions never null', () => {
    assert.deepEqual(sca.photos, [
      { url: 'https://blob/2.jpg', caption: '' },
      { url: 'https://blob/1.jpg', caption: 'Dining' },
      { url: 'https://blob/3.jpg', caption: 'King bed' },
    ]);
  });

  test('the summary splits into highlights and a tagline; the space becomes blocks', () => {
    assert.deepEqual(sca.highlights, ['Great Location – Short stroll to the beach', 'Premium Comfort – 3 bedrooms']);
    assert.equal(sca.tagline, 'A sun-filled Cape by the harbor.');
    assert.deepEqual(sca.descriptionBlocks, [
      { kind: 'heading', text: 'FIRST FLOOR' },
      { kind: 'bullets', items: ['Kitchen: Fully equipped', 'Dining: Sunroom banquet seating'] },
      { kind: 'prose', text: 'Accessibility The front entrance has steps.' },
    ]);
    assert.match(sca.description, /FIRST FLOOR/);
    assert.match(sca.description, /Black Rock Harbor/);
  });

  test('sleeping arrangements follow property_rooms, with a room-hinted photo attached', () => {
    assert.deepEqual(sca.sleepingArrangements, [
      { name: 'Bedroom 1', beds: '1 queen' },
      { name: 'Bedroom 2', beds: '2 singles' },
      { name: 'Bedroom 3', beds: '1 king', photo: 'https://blob/3.jpg' },
      { name: 'Den', beds: '1 sofa bed' },
    ]);
    assert.equal(sca.bedrooms, 3);
    assert.equal(sca.bathrooms, 2);
    assert.equal(sca.accommodates, 6);
    assert.deepEqual(sca.amenities, ['Wireless Internet', 'EV charger']);
  });

  test('no content row and no plan still produces a shape (registry title, zero money)', () => {
    const bare = toScaListing({ ...record, content: null, photos: [], rooms: [] }, null);
    assert.equal(bare.title, 'Stay at Black Rock Harbor');
    assert.equal(bare.basePrice, 0);
    assert.equal(bare.accommodates, 0);
    assert.equal(bare.bedrooms, 3);
    assert.deepEqual(bare.photos, []);
    assert.equal(bare.descriptionBlocks, undefined);
    assert.equal(bare.sleepingArrangements, undefined);
    const noTitle = toScaListing({ ...record, content: null, property: { ...record.property, title: null } }, null);
    assert.equal(noTitle.title, '65 Calderwood');
  });

  test('a cape_ann or unknown region reads as MA', () => {
    assert.equal(toScaListing({ ...record, property: { ...record.property, region: 'cape_ann' } }, plan).address.state, 'MA');
    assert.equal(toScaListing({ ...record, property: { ...record.property, region: null } }, plan).address.state, 'MA');
  });
});

describe('text helpers', () => {
  test('splitSummary with no ✓ lines is all tagline', () => {
    assert.deepEqual(splitSummary('Just a sentence.'), { tagline: 'Just a sentence.', highlights: [] });
    assert.deepEqual(splitSummary(null), { tagline: '', highlights: [] });
  });

  test('descriptionBlocksFrom treats plain paragraphs as prose', () => {
    assert.deepEqual(descriptionBlocksFrom('One.\nTwo.\n\nThree.'), [
      { kind: 'prose', text: 'One. Two.' },
      { kind: 'prose', text: 'Three.' },
    ]);
    assert.deepEqual(descriptionBlocksFrom(null), []);
  });

  test('amenityMatchKey folds the two Pack n Play spellings', () => {
    assert.equal(amenityMatchKey('Pack ’n Play/travel crib'), amenityMatchKey("Pack 'n play/travel  crib"));
  });
});

describe('the consumer map', () => {
  test('every content field the editor shows names at least one consumer', () => {
    for (const field of ['title', 'summary', 'space', 'access', 'neighborhood', 'house_rules', 'amenities', 'photos', 'rooms', 'hero']) {
      assert.ok(consumersOf(field).length > 0, `${field} has no consumer`);
    }
    assert.deepEqual(consumersOf('nonsense'), []);
    assert.ok(FIELD_CONSUMERS.title.includes('staycapeann.com'));
  });

  test('the amenity catalog has no duplicate entries across groups', () => {
    const all = AMENITY_CATALOG.flatMap((g) => g.items.map(amenityMatchKey));
    assert.equal(new Set(all).size, all.length);
  });
});
