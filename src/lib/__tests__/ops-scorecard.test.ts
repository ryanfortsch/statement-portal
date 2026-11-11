import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MISSING_INFO_COLUMNS, ageDays, countMissingInfo, hasClearNote, isBlankFact, missingInfoTile,
  ratingTile, seesScorecard, workTile,
} from '../ops-scorecard.ts';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

describe("the operations scorecard: Delaney's three numbers", () => {
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
    // The goal rides beside the number; the line is the fact that decides the rest: age, then notes.
    assert.equal(workTile({ open: 346, oldestDays: 74, closed: 9, closedWithNote: 6 }).goal, 'goal under 120');
    assert.equal(workTile({ open: 346, oldestDays: 74, closed: 9, closedWithNote: 6 }).detail, 'oldest 74 days, goal 60');
    assert.equal(workTile({ open: 50, oldestDays: 5, closed: 3, closedWithNote: 2 }).detail, 'notes on 2 of 3');
    assert.equal(workTile({ open: 50, oldestDays: 5, closed: 3, closedWithNote: 3 }).detail, 'oldest 5 days');
    assert.equal(workTile({ open: 0, oldestDays: null, closed: 3, closedWithNote: 3 }).detail, 'nothing open');
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
    assert.equal(missingInfoTile(counted).goal, 'goal none');
    assert.equal(ratingTile({ avg: 4.95, total: 174 }).goal, 'goal 4.98');
    assert.equal(ratingTile({ avg: 4.95, total: 174 }).detail, '174 reviews, 90 days');
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
    missingInfoTile({ blanks: 141, homes: 24, homesWithBlanks: 22 }),
    missingInfoTile({ blanks: 0, homes: 24, homesWithBlanks: 0 }),
  ];
  for (const t of tiles) {
    assert.ok((t.detail ?? '').length <= 24, `${t.key}: "${t.detail}" is too long for the strip`);
    assert.ok(t.goal.length <= 16, `${t.key}: "${t.goal}" does not fit beside the number`);
  }
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
