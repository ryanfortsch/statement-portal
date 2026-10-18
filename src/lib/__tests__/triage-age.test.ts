/**
 * /crm's two triage boxes count the last 30 days and fold the rest
 * (src/lib/triage-age.ts). The rule is pure; the guards at the bottom read
 * the source so the page, the client and the nightly address-book rebuild
 * keep to it.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TRIAGE_RECENT_DAYS,
  easternDay,
  isOlderThanWindow,
  shiftDay,
  splitByAge,
  suggestionActivity,
  unknownNumberActivity,
} from '../triage-age.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const TODAY = '2026-10-18';

describe('the 30-day window, in Eastern days', () => {
  test('the window is thirty days', () => {
    assert.equal(TRIAGE_RECENT_DAYS, 30);
    assert.equal(shiftDay(TODAY, -30), '2026-09-18');
  });
  test('a text on the window edge is still recent', () => {
    assert.equal(isOlderThanWindow('2026-09-18T15:00:00Z', TODAY), false);
  });
  test('a text the day before the edge folds', () => {
    assert.equal(isOlderThanWindow('2026-09-17T15:00:00Z', TODAY), true);
  });
  test('late evening Eastern is still that Eastern day', () => {
    // 2026-09-18 01:30 UTC is 9:30 PM on Sep 17 in Gloucester
    assert.equal(easternDay('2026-09-18T01:30:00Z'), '2026-09-17');
    assert.equal(isOlderThanWindow('2026-09-18T01:30:00Z', TODAY), true);
  });
  test('the August stranger folds, this week\'s does not', () => {
    assert.equal(isOlderThanWindow('2026-08-20T14:00:00Z', TODAY), true);
    assert.equal(isOlderThanWindow('2026-10-17T14:00:00Z', TODAY), false);
  });
  test('no date reads as recent: a fold never hides something new', () => {
    assert.equal(isOlderThanWindow(null, TODAY), false);
    assert.equal(isOlderThanWindow(undefined, TODAY), false);
    assert.equal(isOlderThanWindow('not a date', TODAY), false);
  });
});

describe('what counts as a sign of life', () => {
  test('an unknown number: the last message, else when first seen', () => {
    assert.equal(unknownNumberActivity({ last_message_at: '2026-10-01T00:00:00Z', first_seen_at: '2026-01-01T00:00:00Z' }), '2026-10-01T00:00:00Z');
    assert.equal(unknownNumberActivity({ last_message_at: null, first_seen_at: '2026-01-01T00:00:00Z' }), '2026-01-01T00:00:00Z');
  });
  test("a suggestion: the Quo contact's last edit, never the nightly row's created_at", () => {
    assert.equal(suggestionActivity({ quo_contact_updated_at: '2025-03-01T00:00:00Z' }), '2025-03-01T00:00:00Z');
    assert.equal(suggestionActivity({ quo_contact_updated_at: null }), null);
  });
});

describe('splitByAge', () => {
  test('keeps order and puts each row in exactly one place', () => {
    const rows = [
      { id: 'a', at: '2026-10-17T12:00:00Z' },
      { id: 'b', at: '2026-08-01T12:00:00Z' },
      { id: 'c', at: null },
      { id: 'd', at: '2026-09-30T12:00:00Z' },
    ];
    const { recent, older } = splitByAge(rows, (r) => r.at, TODAY);
    assert.deepEqual(recent.map((r) => r.id), ['a', 'c', 'd']);
    assert.deepEqual(older.map((r) => r.id), ['b']);
  });
});

describe('one rule for both boxes, and nothing is capped away', () => {
  // The triage moved from /crm to one card on /messaging (2026-10-18):
  // the loader is lib/number-triage, the card components/messaging/NumberTriage.
  test('the loader reads the whole pending queue and splits it with the rule', () => {
    const src = read('src/lib/number-triage.ts');
    assert.ok(!/from\('quo_unknown_numbers'\)[\s\S]{0,200}\.limit\(/.test(src), 'a cap would misstate the count');
    assert.ok(src.includes('splitByAge(unknowns, unknownNumberActivity, today)'));
    assert.ok(src.includes('splitByAge(suggestions, suggestionActivity, today)'));
  });
  test('the card counts the recent rows and the fold offers the same controls', () => {
    const src = read('src/components/messaging/NumberTriage.tsx');
    assert.ok(src.includes('const recentCount = visibleUnknowns.length + visibleSuggestions.length;'));
    assert.ok(src.includes('New numbers · {recentCount}'));
    assert.ok(src.includes('visibleOlderUnknowns.slice(0, OLDER_SHOWN).map(renderUnknown)'), 'older numbers can still be attached');
    assert.ok(src.includes('visibleOlderSuggestions.slice(0, OLDER_SHOWN).map(renderSuggestion)'));
  });
  test('the nightly rebuild stamps the Quo date and never re-offers a Skip', () => {
    const src = read('src/lib/quo-reconcile.ts');
    assert.ok(src.includes('const quoUpdatedAt = qc.updatedAt ?? qc.createdAt ?? null;'));
    assert.equal(src.split('quo_contact_updated_at: quoUpdatedAt').length - 1, 3, 'all three suggestion kinds carry it');
    const skip = src.indexOf(".eq('status', 'dismissed')");
    const del = src.indexOf(".delete().eq('status', 'pending')");
    assert.ok(skip > 0 && skip < del, 'skipped keys are read before the rebuild');
    assert.ok(src.includes('.insert(fresh)'));
  });
});
