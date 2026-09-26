/**
 * The Guesty seed mapper against a trimmed copy of the 65 Calderwood listing
 * export (scratchpad/calderwood_guesty_seed.json, 2026-09-25): base $350,
 * weekend {5,6}, CT 15% exempt over 30 nights with Airbnb collecting its
 * own, 3 bedrooms with beds out of 11 listingRooms, 45 amenity strings that
 * dedupe to 44 (two Pack 'n Play spellings), and calendar days that are
 * never written closed for booked / unavailable status.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  amenityKey,
  bedSize,
  calendarDaysOf,
  dedupeAmenities,
  mapGuestyListingToHelm,
  mapTaxConfig,
  slugFromNickname,
  type GuestySeedCalendarDay,
  type GuestySeedListing,
} from '../pricing-seed.ts';

// 44 distinct amenities once the two Pack 'n Play spellings collapse.
const AMENITIES = [
  'Air conditioning', 'BBQ grill', 'Baking sheet', 'Barbeque utensils', 'Bathtub', 'Beach access', 'Bed linens',
  'Carbon monoxide detector', 'Clothing storage', 'Coffee', 'Coffee maker', 'Cookware', 'Dining table',
  'Dishes and silverware', 'Dishwasher', 'EV charger', 'Essentials', 'Fire extinguisher', 'First aid kit',
  'Free parking on premises', 'Freezer', 'Garden or backyard', 'Hair dryer', 'Hangers', 'Heating', 'High chair',
  'Hot water', 'Iron', 'Kettle', 'Kitchen', 'Laptop friendly workspace', 'Microwave', 'Oven',
  'Pack ’n Play/travel crib', 'Pack ’n play/travel crib', 'Refrigerator', 'Room-darkening shades', 'Smoke detector',
  'Stove', 'Suitable for children (2-12 years)', 'Suitable for infants (under 2 years)', 'TV', 'Toaster',
  'Wine glasses', 'Wireless Internet',
];

const listing: GuestySeedListing = {
  _id: '66797ba7f51d72001388bc29',
  nickname: '65 Calderwood',
  title: 'Stay at Black Rock Harbor',
  timezone: 'America/New_York',
  accommodates: 6,
  bedrooms: 3,
  bathrooms: 2,
  beds: 4,
  propertyType: 'House',
  roomType: 'Entire home/apt',
  defaultCheckInTime: '16:00',
  defaultCheckOutTime: '11:00',
  importedAt: '2024-06-24T13:59:03.280Z',
  lastUpdatedAt: '2026-09-17T09:38:59.408Z',
  address: { state: 'Connecticut', city: 'Bridgeport', lat: 41.1533573, lng: -73.2219381 },
  prices: {
    monthlyPriceFactor: 1,
    weeklyPriceFactor: 1,
    currency: 'USD',
    basePrice: 350,
    weekendDays: [5, 6],
    securityDepositFee: 200,
    guestsIncludedInRegularFee: 4,
    extraPersonFee: 35,
    cleaningFee: 300,
    weekendBasePrice: 350,
  },
  terms: { minNights: 3, maxNights: 91 },
  calendarRules: {
    advanceNotice: { defaultSettings: { hours: 24 } },
    bookingWindow: { defaultSettings: { days: 365 } },
    preparationTime: { defaultSettings: { days: 0 } },
  },
  taxes: [
    {
      type: 'STATE_TAX',
      amount: 15,
      units: 'PERCENTAGE',
      appliedToAllFees: false,
      appliedOnFees: ['AF', 'CF'],
      channelConfig: [{ channel: 'airbnb2', userConfig: { syncSelection: 'DO_NOT_SYNC' } }],
      conditionalOverrides: { viewType: 'LOS', maxNightCountToApplyOn: 30 },
    },
  ],
  amenities: AMENITIES,
  amenitiesNotIncluded: [],
  listingRooms: [
    { _id: 'r0', roomNumber: 0, beds: [] },
    { _id: 'r1', roomNumber: 1, beds: [{ type: 'QUEEN_BED', quantity: 1 }] },
    { _id: 'r2', roomNumber: 2, beds: [{ type: 'SINGLE_BED', quantity: 2 }] },
    { _id: 'r3', roomNumber: 3, beds: [{ type: 'KING_BED', quantity: 1 }] },
    { _id: 'r4', roomNumber: 4, beds: [] },
    { _id: 'r5', roomNumber: 5, beds: [] },
  ],
  publicDescription: {
    summary: '✓ Great Location – Short stroll to the beach\n✓ Premium Comfort – 3 well-appointed bedrooms',
    space: '☆☆☆ FIRST FLOOR ☆☆☆\n\n→ Kitchen: Fully equipped\n→ Dining: Sunroom banquet seating',
    access: 'Guests have access to the entire house except the basement and garage.',
    interactionWithGuests: 'We are here to help.\n',
    neighborhood: 'Set along the shores of Black Rock Harbor.',
    houseRules: 'Please help us maintain a great home.',
    notes: 'Cancellations made more than 30 days before check-in are eligible for a 50% refund.',
  },
  picture: { large: 'https://assets.guesty.com/x/original_8954553--xLwr', caption: 'Banquet dining' },
  pictures: [
    { _id: 'p1', original: 'https://s3/original_1.jpg', thumbnail: 'https://s3/thumb_1.jpg', caption: 'Banquet dining' },
    { _id: 'p2', original: 'https://s3/original_2.jpg', thumbnail: 'https://s3/thumb_2.jpg', caption: 'Living room' },
    { _id: 'p3', original: 'https://s3/original_3.jpg', thumbnail: null as unknown as string, caption: '' },
  ],
};

// The secrets Guesty carries that the mapper must never read. Added to the
// fixture as a live object so a regression that starts reading them would
// surface in the mapped output.
const listingWithSecrets = {
  ...listing,
  doorCode: '1234',
  lockCode: '5678',
  checkInInstructions: 'Keycode 1234 on the back door',
  checkOutInstructions: 'Lock up with 1234',
} as GuestySeedListing;

const days: GuestySeedCalendarDay[] = [
  { date: '2026-09-01', price: 285, minNights: 2, status: 'available', cta: false, ctd: false, blocks: {}, blockRefs: [] },
  { date: '2026-09-04', price: 457, minNights: 2, status: 'booked', blocks: { b: true }, blockRefs: [{ type: 'b', reservationId: 'r' }] },
  { date: '2026-09-05', price: 495, minNights: 2, status: 'booked', blocks: { b: true, an: true }, blockRefs: [{ type: 'b' }, { type: 'an' }] },
  { date: '2027-09-26', price: 350, minNights: 3, status: 'unavailable', blocks: { bw: true }, blockRefs: [{ type: 'bw' }] },
  { date: '2026-12-24', price: 600, minNights: 4, status: 'unavailable', cta: true, blocks: { m: true }, blockRefs: [{ type: 'm' }] },
  { date: '2026-12-25', price: 600, minNights: 4, status: 'unavailable', blocks: { o: true }, blockRefs: [{ type: 'o' }] },
  { date: '2026-09-01', price: 999, minNights: 9, status: 'available' }, // duplicate date, ignored
  { date: 'nonsense', price: 1 }, // no date, ignored
];

describe('mapGuestyListingToHelm: the rate plan', () => {
  const seed = mapGuestyListingToHelm(listing, { data: { days } });

  test('property id slugs from the nickname', () => {
    assert.equal(seed.propertyId, '65_calderwood');
    assert.equal(slugFromNickname("3246 NE 27th"), '3246_ne_27th');
    assert.equal(mapGuestyListingToHelm(listing, [], { propertyId: 'custom_id' }).propertyId, 'custom_id');
  });

  test('base 35000, weekend 35000 on {5,6}, fees in cents, factors 1.0 => 0% discounts, markup 0 explicit', () => {
    const p = seed.ratePlan;
    assert.equal(p.base_nightly_cents, 35000);
    assert.equal(p.weekend_nightly_cents, 35000);
    assert.deepEqual(p.weekend_days, [5, 6]);
    assert.equal(p.guests_included, 4);
    assert.equal(p.extra_guest_cents_per_night, 3500);
    assert.equal(p.cleaning_fee_cents, 30000);
    assert.equal(p.security_deposit_cents, 20000);
    assert.equal(p.pet_fee_cents, null);
    assert.equal(p.weekly_discount_pct, 0);
    assert.equal(p.monthly_discount_pct, 0);
    assert.equal(p.direct_markup_pct, 0);
    assert.equal(p.currency, 'USD');
  });

  test('terms and calendar rules', () => {
    const p = seed.ratePlan;
    assert.equal(p.min_nights_default, 3);
    assert.equal(p.max_nights, 91);
    assert.equal(p.advance_notice_hours, 24);
    assert.equal(p.booking_window_days, 365);
    assert.equal(p.turnover_buffer_days, 0);
    assert.equal(p.checkin_time, '16:00');
    assert.equal(p.checkout_time, '11:00');
    assert.equal(p.max_occupancy, 6);
    assert.equal(p.pets_allowed, false);
  });

  test('cancellation terms come from publicDescription.notes, house rules from houseRules', () => {
    assert.equal(seed.ratePlan.cancellation_policy_key, 'custom');
    assert.match(seed.ratePlan.cancellation_terms ?? '', /50% refund/);
    assert.equal(seed.ratePlan.house_rules, 'Please help us maintain a great home.');
  });

  test('a factor of 0.9 becomes a 10% discount', () => {
    const s = mapGuestyListingToHelm({ ...listing, prices: { ...listing.prices, weeklyPriceFactor: 0.9, monthlyPriceFactor: 0.75 } }, []);
    assert.equal(s.ratePlan.weekly_discount_pct, 10);
    assert.equal(s.ratePlan.monthly_discount_pct, 25);
  });
});

describe('mapGuestyListingToHelm: tax config', () => {
  test('CT 15% on accommodation + cleaning, exempt over 30, airbnb collects its own', () => {
    const t = mapGuestyListingToHelm(listing, []).taxConfig;
    assert.ok(t);
    assert.equal(t.jurisdiction, 'CT');
    assert.equal(t.state_rate, 0.15);
    assert.equal(t.local_rate, 0);
    assert.equal(t.cif_rate, 0);
    assert.deepEqual(t.applies_to, ['accommodation', 'cleaning']);
    assert.equal(t.long_stay_exempt_over_nights, 30);
    assert.deepEqual(t.collected_by_channels, ['airbnb']);
  });

  test('no taxes => null; an unknown state with taxes throws instead of guessing', () => {
    assert.equal(mapTaxConfig({ ...listing, taxes: [] }, 'x'), null);
    assert.throws(() => mapTaxConfig({ ...listing, address: { state: 'Vermont' } }, 'x'), /not MA, CT or FL/);
  });

  test('city and county taxes land in local_rate; a flat-amount tax is ignored', () => {
    const t = mapTaxConfig(
      {
        ...listing,
        address: { state: 'MA' },
        taxes: [
          { type: 'STATE_TAX', amount: 5.7, units: 'PERCENTAGE', appliedToAllFees: true },
          { type: 'CITY_TAX', amount: 6, units: 'PERCENTAGE', appliedOnFees: ['AF'] },
          { type: 'OTHER', amount: 25, units: 'FIXED' },
        ],
      },
      'x',
    );
    assert.ok(t);
    assert.equal(t.jurisdiction, 'MA');
    assert.equal(t.state_rate, 0.057);
    assert.equal(t.local_rate, 0.06);
    assert.equal(t.long_stay_exempt_over_nights, null);
    assert.deepEqual(t.collected_by_channels, []);
  });
});

describe('mapGuestyListingToHelm: amenities, rooms, content, photos', () => {
  const seed = mapGuestyListingToHelm(listing, []);

  test('45 strings dedupe to 44, first spelling kept', () => {
    assert.equal(AMENITIES.length, 45);
    assert.equal(seed.amenities.length, 44);
    assert.equal(seed.amenities.filter((a) => amenityKey(a) === amenityKey('Pack ’n Play/travel crib')).length, 1);
    assert.ok(seed.amenities.includes('Pack ’n Play/travel crib'));
    assert.deepEqual(dedupeAmenities(['TV', ' tv ', 'Tv', null, '']), ['TV']);
    assert.deepEqual(seed.content.amenities, seed.amenities);
  });

  test('only listingRooms with beds become rooms, in the property_rooms details shape', () => {
    assert.equal(seed.rooms.length, 3);
    assert.deepEqual(
      seed.rooms.map((r) => ({ name: r.name, type: r.room_type, sort: r.sort_order, beds: r.details.beds })),
      [
        { name: 'Bedroom 1', type: 'bedroom', sort: 0, beds: [{ size: 'queen', count: 1 }] },
        { name: 'Bedroom 2', type: 'bedroom', sort: 1, beds: [{ size: 'single', count: 2 }] },
        { name: 'Bedroom 3', type: 'bedroom', sort: 2, beds: [{ size: 'king', count: 1 }] },
      ],
    );
    assert.deepEqual(seed.rooms.map((r) => r.external_id), ['r1', 'r2', 'r3']);
    assert.equal(bedSize('SOFA_BED'), 'sofa bed');
    assert.equal(bedSize('FUTON_BED'), 'futon');
  });

  test('content carries the public description and the facts, sourced guesty_seed', () => {
    const c = seed.content;
    assert.equal(c.property_id, '65_calderwood');
    assert.equal(c.title, 'Stay at Black Rock Harbor');
    assert.match(c.summary ?? '', /Great Location/);
    assert.match(c.space ?? '', /FIRST FLOOR/);
    assert.match(c.access ?? '', /entire house/);
    assert.equal(c.interaction, 'We are here to help.');
    assert.match(c.neighborhood ?? '', /Black Rock Harbor/);
    assert.match(c.house_rules ?? '', /great home/);
    assert.match(c.notes ?? '', /50% refund/);
    assert.equal(c.property_type, 'House');
    assert.equal(c.room_type, 'Entire home/apt');
    assert.equal(c.accommodates, 6);
    assert.equal(c.bedrooms, 3);
    assert.equal(c.bathrooms, 2);
    assert.equal(c.beds, 4);
    assert.equal(c.source, 'guesty_seed');
    assert.equal(c.source_ref, '66797ba7f51d72001388bc29');
  });

  test('the photo manifest keeps Guesty order, hero on index 0 when listing.picture does not match', () => {
    assert.equal(seed.photoManifest.length, 3);
    assert.deepEqual(seed.photoManifest.map((p) => p.sort_order), [0, 1, 2]);
    assert.deepEqual(seed.photoManifest.map((p) => p.is_hero), [true, false, false]);
    assert.equal(seed.photoManifest[0].external_id, 'p1');
    assert.equal(seed.photoManifest[0].source_url, 'https://s3/original_1.jpg');
    assert.equal(seed.photoManifest[2].caption, null);
    assert.equal(seed.photoManifest[2].thumbnail_url, null);
  });

  test('hero follows listing.picture when it names one of the pictures', () => {
    const s = mapGuestyListingToHelm({ ...listing, picture: { large: 'https://s3/original_2.jpg' } }, []);
    assert.deepEqual(s.photoManifest.map((p) => p.is_hero), [false, true, false]);
  });
});

describe('mapGuestyListingToHelm: calendar days', () => {
  test('handles both the API envelope and a bare array', () => {
    assert.equal(calendarDaysOf({ data: { days } }).length, days.length);
    assert.equal(calendarDaysOf(days).length, days.length);
    assert.equal(calendarDaysOf(null).length, 0);
    assert.equal(calendarDaysOf({ data: null }).length, 0);
  });

  test('prices in cents, min nights as given, source seed, sorted, duplicates and bad dates dropped', () => {
    const { rateDays } = mapGuestyListingToHelm(listing, { data: { days } });
    assert.equal(rateDays.length, 6);
    assert.deepEqual(rateDays.map((d) => d.date), ['2026-09-01', '2026-09-04', '2026-09-05', '2026-12-24', '2026-12-25', '2027-09-26']);
    const first = rateDays[0];
    assert.equal(first.nightly_cents, 28500);
    assert.equal(first.min_nights, 2);
    assert.equal(first.source, 'seed');
    assert.equal(first.property_id, '65_calderwood');
    assert.match(first.note ?? '', /PriceLabs via Guesty 2026-09-17/);
    assert.equal(rateDays.find((d) => d.date === '2026-12-24')?.cta, true);
  });

  test('booked and unavailable days are NEVER written as closed', () => {
    const { rateDays } = mapGuestyListingToHelm(listing, days);
    assert.ok(rateDays.every((d) => d.closed === false));
    const booked = rateDays.find((d) => d.date === '2026-09-04');
    assert.equal(booked?.closed, false);
    assert.equal(booked?.nightly_cents, 45700);
    const window = rateDays.find((d) => d.date === '2027-09-26');
    assert.equal(window?.closed, false);
  });

  test('manual and owner block refs are listed for the operator and write nothing', () => {
    const { operatorBlocks, rateDays } = mapGuestyListingToHelm(listing, days);
    assert.deepEqual(operatorBlocks, [
      { date: '2026-12-24', kind: 'manual' },
      { date: '2026-12-25', kind: 'owner' },
    ]);
    assert.equal(rateDays.find((d) => d.date === '2026-12-24')?.closed, false);
  });

  test('a custom rate day note is honoured', () => {
    const { rateDays } = mapGuestyListingToHelm(listing, days, { rateDayNote: 'PriceLabs via Guesty 2026-09-25' });
    assert.ok(rateDays.every((d) => d.note === 'PriceLabs via Guesty 2026-09-25'));
  });
});

describe('door codes never leave Guesty through this mapper', () => {
  test('the mapped output carries none of the secret fields', () => {
    const seed = mapGuestyListingToHelm(listingWithSecrets, days);
    const json = JSON.stringify(seed);
    assert.ok(!json.includes('1234'), 'a door code leaked into the seed output');
    assert.ok(!json.includes('5678'), 'a lock code leaked into the seed output');
    assert.ok(!/Keycode/i.test(json));
    assert.deepEqual(mapGuestyListingToHelm(listing, days), seed);
  });

  test('the mapper source never reads doorCode, lockCode, checkInInstructions or checkOutInstructions', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, '..', 'pricing-seed.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const key of ['doorCode', 'lockCode', 'checkInInstructions', 'checkOutInstructions']) {
      assert.ok(!src.includes(key), `pricing-seed.ts reads ${key}`);
    }
  });
});
