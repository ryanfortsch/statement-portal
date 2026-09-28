/**
 * Per-recipient scoping of the cleaner digest: Rosa ('{}', cape_ann) never
 * reads a Connecticut checkout, Luana (['65_calderwood']) reads that home
 * alone, and the Portuguese text for a '{}' cape_ann recipient is exactly
 * the region-wide text the digest sent before scoping existed.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleSms,
  composeDigestBody,
  describeRecipientScope,
  filterScheduleForRecipient,
  propertyInScope,
  recipientScope,
  shapeRecipient,
  updateMarker,
  type ScheduleRecipient,
} from '../cleaner-digest-core.ts';
import type { ScheduleDay, ScheduleRow } from '../checkout-schedule.ts';

function row(propertyId: string, propertyName: string, time = '11:00', extra: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    propertyId,
    propertyName,
    address: `${propertyName} Street`,
    city: 'Gloucester',
    guestName: 'Guest',
    checkIn: '2026-09-24',
    baseCheckOut: '2026-09-27',
    effectiveCheckOut: '2026-09-27',
    time,
    defaultTime: '10:00',
    sameDayTurnover: false,
    conflictingCheckOut: null,
    nextCheckinTime: null,
    nextGuestName: null,
    adjustment: null,
    proposals: [],
    ...extra,
  };
}

const propertiesById = new Map<string, { id: string; region: string | null }>([
  ['21_horton', { id: '21_horton', region: 'cape_ann' }],
  ['3_south_st', { id: '3_south_st', region: 'cape_ann' }],
  ['65_calderwood', { id: '65_calderwood', region: 'bridgeport_ct' }],
  ['3246_ne_27th', { id: '3246_ne_27th', region: 'lighthouse_point_fl' }],
]);

/** A mixed day, as if the region scope on buildCheckoutSchedule were off:
 *  the second gate has to hold on its own. */
const mixedDay: ScheduleDay = {
  date: '2026-09-27',
  rows: [
    row('21_horton', '21 Horton', '11:00', { sameDayTurnover: true, nextCheckinTime: '16:00' }),
    row('65_calderwood', '65 Calderwood', '10:00'),
    row('3_south_st', '3 South', '10:00', {
      adjustment: { id: 'a1', source: 'operator', note: '', adjustedTime: '10:00', adjustedDate: null, evidence: null, drifted: false },
    }),
    row('3246_ne_27th', '3246 NE 27th', '11:00'),
  ],
  counts: { checkouts: 4, sameDay: 1, adjusted: 1, proposed: 0 },
};

const rosa: ScheduleRecipient = {
  phone: '+19785550001',
  display_name: 'Rosa',
  portal_token: 'aaaaaaaaaaaaaaaa',
  enabled: true,
  property_ids: [],
  region: 'cape_ann',
  language: 'pt',
};

const luana: ScheduleRecipient = {
  phone: '+12035550002',
  display_name: 'Luana',
  portal_token: 'bbbbbbbbbbbbbbbb',
  enabled: true,
  property_ids: ['65_calderwood'],
  region: 'bridgeport_ct',
  language: 'en',
};

describe('recipientScope', () => {
  test("'{}' means every home in the recipient's region", () => {
    assert.deepEqual(recipientScope(rosa), { region: 'cape_ann' });
  });
  test('an explicit property list is the scope, whatever the region', () => {
    assert.deepEqual(recipientScope(luana), { region: 'bridgeport_ct', propertyIds: ['65_calderwood'] });
  });
  test('a missing region reads as Cape Ann', () => {
    assert.deepEqual(recipientScope({ property_ids: [], region: '' }), { region: 'cape_ann' });
  });
});

describe('propertyInScope', () => {
  test('region scope compares regions, null region is Cape Ann', () => {
    assert.equal(propertyInScope({ id: 'x', region: null }, { region: 'cape_ann' }), true);
    assert.equal(propertyInScope({ id: 'x', region: 'bridgeport_ct' }, { region: 'cape_ann' }), false);
    assert.equal(propertyInScope({ id: 'x', region: 'bridgeport_ct' }, { region: 'bridgeport_ct' }), true);
  });
  test('an id list ignores region entirely', () => {
    assert.equal(propertyInScope({ id: '65_calderwood', region: 'bridgeport_ct' }, { region: 'cape_ann', propertyIds: ['65_calderwood'] }), true);
    assert.equal(propertyInScope({ id: '21_horton', region: 'cape_ann' }, { region: 'cape_ann', propertyIds: ['65_calderwood'] }), false);
  });
});

describe('filterScheduleForRecipient', () => {
  test("a bridgeport_ct checkout never appears for a '{}' cape_ann recipient", () => {
    const day = filterScheduleForRecipient(mixedDay, rosa, propertiesById);
    const ids = day.rows.map((r) => r.propertyId);
    assert.deepEqual(ids, ['21_horton', '3_south_st']);
    assert.ok(!ids.includes('65_calderwood'));
    assert.ok(!ids.includes('3246_ne_27th'));
  });

  test("a recipient with property_ids ['65_calderwood'] sees only that home", () => {
    const day = filterScheduleForRecipient(mixedDay, luana, propertiesById);
    assert.deepEqual(day.rows.map((r) => r.propertyId), ['65_calderwood']);
  });

  test('counts are recomputed over the filtered rows, not copied', () => {
    const day = filterScheduleForRecipient(mixedDay, rosa, propertiesById);
    assert.deepEqual(day.counts, { checkouts: 2, sameDay: 1, adjusted: 1, proposed: 0 });
    const one = filterScheduleForRecipient(mixedDay, luana, propertiesById);
    assert.deepEqual(one.counts, { checkouts: 1, sameDay: 0, adjusted: 0, proposed: 0 });
  });

  test('a row whose property is unknown to the lookup is Cape Ann, never another region', () => {
    const day: ScheduleDay = { date: '2026-09-27', rows: [row('mystery', 'Mystery House')], counts: { checkouts: 1, sameDay: 0, adjusted: 0, proposed: 0 } };
    assert.equal(filterScheduleForRecipient(day, rosa, propertiesById).rows.length, 1);
    assert.equal(filterScheduleForRecipient(day, { property_ids: [], region: 'bridgeport_ct' }, propertiesById).rows.length, 0);
    assert.equal(filterScheduleForRecipient(day, luana, propertiesById).rows.length, 0);
  });

  test('the input day is not mutated', () => {
    const before = JSON.stringify(mixedDay);
    filterScheduleForRecipient(mixedDay, luana, propertiesById);
    assert.equal(JSON.stringify(mixedDay), before);
  });
});

describe('composeDigestBody', () => {
  const capeAnnDay: ScheduleDay = filterScheduleForRecipient(mixedDay, rosa, propertiesById);

  test("Portuguese for a '{}' cape_ann recipient is the region-wide Portuguese text, byte for byte", () => {
    const regionWide = composeDigestBody(capeAnnDay);
    const forRosa = composeDigestBody(filterScheduleForRecipient(capeAnnDay, rosa, propertiesById), undefined, undefined, rosa.language);
    assert.equal(forRosa, regionWide);
    // The wording the crew has always read, unchanged.
    assert.ok(regionWide.startsWith('Rising Tide - limpezas\n'));
    assert.ok(regionWide.includes('2 check-outs, 1 mesmo dia:'));
    assert.ok(regionWide.includes('MESMO DIA, prox. entrada 16:00'));
    assert.ok(regionWide.includes('mudou de 10:00'));
    assert.ok(!regionWide.includes('Calderwood'));
  });

  test('the Portuguese empty day is unchanged', () => {
    const empty: ScheduleDay = { date: '2026-09-27', rows: [], counts: { checkouts: 0, sameDay: 0, adjusted: 0, proposed: 0 } };
    const lines = composeDigestBody(empty).split('\n');
    assert.equal(lines[0], 'Rising Tide - limpezas');
    assert.equal(lines[2], '');
    assert.equal(lines[3], 'Nenhum check-out neste dia.');
    assert.equal(lines.length, 4);
  });

  test('English renders the same shape in English, and only for language en', () => {
    const en = composeDigestBody(filterScheduleForRecipient(mixedDay, luana, propertiesById), new Map([['65_calderwood', '09:30']]), undefined, 'en');
    assert.ok(en.startsWith('Rising Tide - cleanings\n'));
    assert.ok(en.includes('1 checkout:'));
    assert.ok(en.includes('1) 09:30 - 65 Calderwood (WARNING: guest leaves at 10:00)'));
    assert.ok(en.includes('Time = scheduled cleaning. "checkout" = when the guest leaves.'));
    assert.ok(!en.includes('limpezas'));
    const emptyEn = composeDigestBody({ date: '2026-09-27', rows: [], counts: { checkouts: 0, sameDay: 0, adjusted: 0, proposed: 0 } }, undefined, undefined, 'en');
    assert.ok(emptyEn.endsWith('No checkouts this day.'));
  });

  test('the link footer and update marker keep the Portuguese wording and add an English one', () => {
    assert.equal(assembleSms('corpo', 'https://x/c/a', 'pt'), 'corpo\n\nAgenda ao vivo / live schedule:\nhttps://x/c/a');
    assert.equal(assembleSms('body', 'https://x/c/b', 'en'), 'body\n\nLive schedule:\nhttps://x/c/b');
    assert.equal(updateMarker('pt'), '(atualizacao / updated schedule)');
    assert.equal(updateMarker('en'), '(updated schedule)');
  });
});

describe('shapeRecipient', () => {
  test('a pre-scope row gets the table defaults: Cape Ann, every home, Portuguese', () => {
    const r = shapeRecipient({ phone: '+1', display_name: 'Rosa', portal_token: 't', enabled: true });
    assert.deepEqual(r, { phone: '+1', display_name: 'Rosa', portal_token: 't', enabled: true, property_ids: [], region: 'cape_ann', language: 'pt' });
  });
  test('an unknown language falls back to Portuguese, en is kept', () => {
    assert.equal(shapeRecipient({ phone: '+1', display_name: 'x', portal_token: 't', enabled: false, language: 'fr' }).language, 'pt');
    assert.equal(shapeRecipient({ phone: '+1', display_name: 'x', portal_token: 't', enabled: false, language: 'en' }).language, 'en');
  });
});

describe('describeRecipientScope', () => {
  const label = (r: string) => (r === 'cape_ann' ? 'Cape Ann' : r);
  const name = (id: string) => (id === '65_calderwood' ? '65 Calderwood' : id);
  test('names the region for an empty list and the homes for an explicit one', () => {
    assert.equal(describeRecipientScope(rosa, label, name), 'every home in Cape Ann');
    assert.equal(describeRecipientScope(luana, label, name), '65 Calderwood');
  });
});
