import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MISSING_INFO_COLUMNS, ageDays, countMissingInfo, hasClearNote, inspectionsTile, isBlankFact, missingInfoTile, mondayOf,
  ratingTile, seesScorecard, workTile,
} from '../ops-scorecard.ts';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

describe("the operations scorecard: Delaney's four numbers", () => {
  test('rating: 4.98 is met, 4.979 is not, and it never rounds up', () => {
    assert.equal(ratingTile({ avg: 4.98, total: 40 }).state, 'met');
    const near = ratingTile({ avg: 4.979, total: 40 });
    assert.equal(near.value, '4.97');
    assert.equal(near.state, 'off');
    assert.equal(ratingTile(null).state, 'unknown', 'a failed read is never met');
    assert.equal(ratingTile({ avg: null, total: 0 }).state, 'idle');
  });

  test('work: under 120 open, oldest 60 days or less, every close with a note', () => {
    assert.equal(workTile({ open: 119, oldestDays: 60, closed: 4, closedWithNote: 4 }).state, 'met');
    assert.equal(workTile({ open: 120, oldestDays: 10, closed: 0, closedWithNote: 0 }).state, 'off', '120 is not under 120');
    assert.equal(workTile({ open: 50, oldestDays: 61, closed: 0, closedWithNote: 0 }).state, 'off');
    assert.equal(workTile({ open: 50, oldestDays: 5, closed: 3, closedWithNote: 2 }).state, 'off');
    // The line names the standard that decides the tile: count, then age, then notes.
    assert.equal(workTile({ open: 346, oldestDays: 74, closed: 9, closedWithNote: 6 }).detail, 'goal under 120');
    assert.equal(workTile({ open: 50, oldestDays: 74, closed: 9, closedWithNote: 6 }).detail, 'oldest 74 days, goal 60');
    assert.equal(workTile({ open: 50, oldestDays: 5, closed: 3, closedWithNote: 2 }).detail, 'notes on 2 of 3');
    assert.equal(workTile({ open: 50, oldestDays: 5, closed: 3, closedWithNote: 3 }).detail, 'under 120, none over 60');
  });

  test('inspections: a plain count for the week, with what is still planned', () => {
    assert.equal(inspectionsTile({ done: 3, planned: 2 }).detail, 'this week · 2 planned');
    assert.equal(inspectionsTile({ done: 0, planned: 0 }).detail, 'this week');
    assert.equal(inspectionsTile({ done: 3, planned: 0 }).state, 'plain', 'no standard, so never met or missed');
    assert.equal(inspectionsTile(null).state, 'unknown');
    assert.equal(mondayOf('2026-11-08'), '2026-11-02', 'a Sunday belongs to the week that started the Monday before');
    assert.equal(mondayOf('2026-11-09'), '2026-11-09');
    assert.equal(mondayOf('2026-11-14'), '2026-11-09');
  });

  test('missing information: blank facts counted across the managed homes', () => {
    assert.equal(isBlankFact(null), true);
    assert.equal(isBlankFact('  '), true);
    assert.equal(isBlankFact(0), false, 'a number is an answer');
    assert.equal(isBlankFact('Casella carts beside the garage'), false);
    const full = Object.fromEntries(MISSING_INFO_COLUMNS.map((c) => [c, 'x']));
    const counted = countMissingInfo([full, { ...full, wifi_password: '', parking: null }, { ...full, heating: null }]);
    assert.deepEqual(counted, { blanks: 3, homes: 3, homesWithBlanks: 2 });
    assert.equal(missingInfoTile(counted).value, '3 blanks');
    assert.equal(missingInfoTile(counted).detail, 'on 2 of 3 homes');
    assert.equal(missingInfoTile(counted).state, 'off');
    assert.equal(missingInfoTile({ blanks: 0, homes: 24, homesWithBlanks: 0 }).value, 'None');
    assert.equal(missingInfoTile(null).state, 'unknown');
  });

  test('every missing-information column is a Facts row on the property page', () => {
    const page = read('src/app/properties/[id]/page.tsx');
    for (const col of MISSING_INFO_COLUMNS) {
      assert.ok(page.includes(`col: '${col}'`), `${col} is not a row the property page shows and edits`);
    }
  });

  test('small helpers', () => {
    assert.equal(ageDays('2026-09-10T15:00:00Z', '2026-11-08'), 59);
    assert.equal(hasClearNote('done'), false);
    assert.equal(hasClearNote('Replaced the bathroom fan motor'), true);
    assert.equal(seesScorecard({ teamRole: 'operations', ownerLogin: false }), true);
    assert.equal(seesScorecard({ teamRole: null, ownerLogin: false }), false, 'other staff do not see her goals');
    assert.equal(seesScorecard({ teamRole: null, ownerLogin: true }), true);
  });
});

test('every tile is one line under the number, never a paragraph', () => {
  const tiles = [
    ratingTile({ avg: 4.95, total: 175 }),
    workTile({ open: 350, oldestDays: 142, closed: 210, closedWithNote: 167 }),
    workTile({ open: 50, oldestDays: 74, closed: 9, closedWithNote: 6 }),
    workTile({ open: 50, oldestDays: 5, closed: 3, closedWithNote: 3 }),
    inspectionsTile({ done: 12, planned: 14 }),
    missingInfoTile({ blanks: 141, homes: 24, homesWithBlanks: 22 }),
    missingInfoTile({ blanks: 0, homes: 24, homesWithBlanks: 0 }),
  ];
  for (const t of tiles) assert.ok((t.detail ?? '').length <= 24, `${t.key}: "${t.detail}" is too long for the strip`);
});

test('the band sits at the top of the For Me home, and holds no money', () => {
  const page = read('src/app/(home)/page.tsx');
  assert.ok(page.includes('<OpsScorecard />'), 'the scorecard left the home');
  assert.ok(page.indexOf('<OpsScorecard />') < page.indexOf('<ForMeFeed />'), 'the scorecard is not above the feed');
  const server = read('src/lib/ops-scorecard-server.ts');
  for (const money of ['owner_payout', 'property_statements', 'management_fee', 'revenue']) {
    assert.ok(!server.includes(money), `the scorecard reads ${money}`);
  }
});
