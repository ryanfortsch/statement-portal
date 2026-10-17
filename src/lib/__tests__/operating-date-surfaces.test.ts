/**
 * "Today" on an operator surface is the Eastern operating date, never the
 * server's UTC date.
 *
 * Vercel runs in UTC, so from 8 PM Eastern (7 PM in winter) a bare
 * `new Date().toISOString().slice(0, 10)` already says tomorrow. The work
 * board read today through operatingDate() while the home tile, the For Me
 * feed, search, the print sheet and the turnovers strip read the UTC clock,
 * so for four hours every evening the counts and the "due today" labels
 * disagreed, and planning a walk after 8 PM for a check-in dated today
 * defaulted the date past its own check-in (UI/UX audit, 2026-10-17, Part 5).
 *
 * The fix is one import per file, and that is exactly the kind of guard a
 * later edit drops without noticing. So this reads the source of each
 * surface and asserts it still goes through operatingDate(), the way
 * shoot-offer-optin.test.ts guards its one-line filters.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { operatingDate } from '../operating-date.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** Every surface the audit found reading the UTC clock for "today". */
const SURFACES = [
  'src/app/page.tsx',
  'src/components/ForMeFeed.tsx',
  'src/app/search/page.tsx',
  'src/app/properties/[id]/work-slips/print/page.tsx',
  'src/app/turnovers/page.tsx',
  'src/app/turnovers/PlanButton.tsx',
  // The same snooze filter the board applies, on the properties list and the slip page.
  'src/app/properties/page.tsx',
  'src/app/work/[id]/page.tsx',
  // Already correct before the fix; listed so they cannot regress either.
  'src/app/work/page.tsx',
  'src/app/work/QueueClient.tsx',
  'src/app/turnovers/CompactTurnoverRow.tsx',
];

/** The two shapes the bug took: a bare `new Date()` sliced or split to a date. */
const UTC_TODAY = /new Date\(\)\s*\.toISOString\(\)\s*\.(?:slice\(0,\s*10\)|split\('T'\)\[0\]|substring\(0,\s*10\))/;

describe('today is the Eastern operating date on every operator surface', () => {
  for (const file of SURFACES) {
    test(`${file} reads today through operatingDate()`, () => {
      const src = read(file);
      assert.ok(
        src.includes("from '@/lib/operating-date'") || src.includes("from './operating-date'"),
        `${file} no longer imports operatingDate`,
      );
      assert.ok(!UTC_TODAY.test(src), `${file} derives today from the UTC clock again`);
    });
  }

  test('the evening gap is real: 9 PM Eastern is still today, the UTC slice says tomorrow', () => {
    // 2026-10-17 21:00 EDT is 2026-10-18 01:00Z.
    const at = new Date('2026-10-18T01:00:00Z');
    assert.equal(at.toISOString().slice(0, 10), '2026-10-18');
    assert.equal(operatingDate(at), '2026-10-17');
    // And in winter the gap opens an hour earlier: 7 PM EST is midnight UTC.
    const winter = new Date('2026-12-16T00:30:00Z');
    assert.equal(winter.toISOString().slice(0, 10), '2026-12-16');
    assert.equal(operatingDate(winter), '2026-12-15');
  });
});
