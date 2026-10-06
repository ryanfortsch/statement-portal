/**
 * "No cleaning needed": a checkout the operator took off the route lives in
 * ScheduleDay.skipped, never in rows. The text names it in its own block so
 * the crew sees the plan changed, never carries the internal reason, scopes
 * it like any other row, and leaves a day with no skips byte-identical.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeDigestBody, filterScheduleForRecipient, recountDay } from '../cleaner-digest-core.ts';
import type { ScheduleRow } from '../checkout-schedule.ts';

function row(propertyId: string, propertyName: string, extra: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    propertyId,
    propertyName,
    address: `${propertyName} Street`,
    city: 'Gloucester',
    guestName: 'Guest',
    checkIn: '2026-10-05',
    baseCheckOut: '2026-10-06',
    effectiveCheckOut: '2026-10-06',
    time: '10:00',
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

const skip = { id: 's1', reason: 'owner doing work on the house', by: 'dotti@risingtidestr.com' };
const horton = row('21_horton', '21 Horton');
const south = row('3_south_st', '3 South', { noClean: skip });

test('a skipped home LEADS the text as a do-not-clean callout, never numbered, never with the reason', () => {
  const day = recountDay('2026-10-06', [horton], [south]);
  const pt = composeDigestBody(day);
  assert.match(pt, /\/ Tue, Oct 6\n\nATENCAO - NAO LIMPAR \(cancelado\):\n- 3 South\n\n1 check-out:/);
  assert.match(pt, /1\) 10:00 - 21 Horton/);
  assert.doesNotMatch(pt, /\d\) .*3 South/);
  assert.doesNotMatch(pt, /owner doing work/);
  const en = composeDigestBody(day, undefined, undefined, 'en');
  assert.match(en, /ATTENTION - DO NOT CLEAN \(cancelled\):\n- 3 South\n/);
  assert.doesNotMatch(en, /owner doing work/);
});

test('the callout names the time the vendor had the house booked', () => {
  const day = recountDay('2026-10-06', [horton], [south]);
  const vendor = new Map([['3_south_st', '14:30'], ['21_horton', '12:00']]);
  assert.match(composeDigestBody(day, vendor), /- 3 South \(era 14:30\)/);
  assert.match(composeDigestBody(day, vendor, undefined, 'en'), /- 3 South \(was 14:30\)/);
});

test('the digest card textarea remounts when the composed text changes (source guard)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../../app/cleaner-messaging/ScheduleDigestCard.tsx', import.meta.url), 'utf8');
  assert.match(src, /<textarea\s+key=\{shownBody\}\s+name="body"/);
});

test('a day whose only checkout is skipped says no cleanings, not no checkouts', () => {
  const day = recountDay('2026-10-06', [], [south]);
  assert.equal(day.counts.checkouts, 0);
  const pt = composeDigestBody(day);
  assert.match(pt, /Nenhuma limpeza neste dia\./);
  assert.doesNotMatch(pt, /Nenhum check-out/);
  assert.match(pt, /- 3 South/);
});

test('a day with no skips is byte-identical to a day without the field', () => {
  const withField = recountDay('2026-10-06', [horton], []);
  const without = { ...withField };
  delete without.skipped;
  assert.equal(composeDigestBody(withField), composeDigestBody(without));
  assert.equal(composeDigestBody(withField, undefined, undefined, 'en'), composeDigestBody(without, undefined, undefined, 'en'));
});

test('skipped rows are scoped like rows: Luana never reads a Gloucester skip', () => {
  const regions = new Map([
    ['21_horton', { id: '21_horton', region: 'cape_ann' }],
    ['3_south_st', { id: '3_south_st', region: 'cape_ann' }],
  ]);
  const day = recountDay('2026-10-06', [horton], [south]);
  const luana = filterScheduleForRecipient(day, { property_ids: ['65_calderwood'], region: 'bridgeport_ct' }, regions);
  assert.deepEqual(luana.skipped, []);
  const rosa = filterScheduleForRecipient(day, { property_ids: [], region: 'cape_ann' }, regions);
  assert.deepEqual(rosa.skipped?.map((r) => r.propertyId), ['3_south_st']);
});

test('the schedule keeps skipped rows out of rows (source guard)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../checkout-schedule.ts', import.meta.url), 'utf8');
  assert.match(src, /const bucket = row\.noClean \? skippedByDay : rowsByDay;/);
});
