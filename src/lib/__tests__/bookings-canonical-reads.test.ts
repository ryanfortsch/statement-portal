/**
 * Guest-facing reads of `bookings` take canonical rows only: the invariant audit.
 *
 * `bookings` holds duplicate rows per stay BY DESIGN, one per source, and
 * `duplicate_of` is what marks the losers. A read that omits the filter does
 * not fail, it just sometimes answers with a superseded twin: an altered
 * Airbnb code, or the Booking.com "Guest to be announced" placeholder that a
 * named record later replaced. Sorted by check_in and sliced to 25, the twin
 * can win.
 *
 * That was survivable while these rows only filled a collapsed accordion. It
 * stops being survivable the moment a guest name is promoted somewhere an
 * operator reads it aloud, or a door code is issued against it.
 *
 * The guard is one `.is('duplicate_of', null)` per query, with nothing else
 * holding it in place, so this reads the source and asserts it is still
 * there. Same shape as shoot-offer-optin.test.ts, and for the same reason.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/**
 * Pull the chained query that starts at `.from('<table>')` and runs until the
 * call that terminates it. Good enough to assert which filters ride along,
 * which is all this file needs.
 */
function queryFrom(src: string, table: string): string {
  const start = src.indexOf(`.from('${table}')`);
  assert.notEqual(start, -1, `no .from('${table}') in this file any more`);
  // Cut at the end of the chained statement. Not every query has a .limit(),
  // so the terminator is the first semicolon after the chain begins.
  const end = src.indexOf(';', start);
  assert.notEqual(end, -1, `could not find the end of the ${table} query`);
  return src.slice(start, end);
}

describe('guest-facing booking reads take canonical rows only', () => {
  test("getGuestCodeView's bookings query filters duplicate_of", () => {
    const src = read('src/lib/guest-locks.ts');
    const q = queryFrom(src, 'bookings');

    assert.ok(
      q.includes(".is('duplicate_of', null)"),
      'The Guest door codes panel reads bookings without the canonical-row filter, so a ' +
        'superseded twin can be shown as the stay in residence and take a door code.',
    );
    assert.ok(q.includes(".eq('status', 'confirmed')"), 'lost the confirmed-only filter');
    assert.ok(q.includes(".gte('check_out', today)"), 'lost the still-upcoming filter');
  });

  test('the reason the filter exists is written down next to it', () => {
    const src = read('src/lib/guest-locks.ts');
    assert.match(
      src,
      /duplicate rows per stay by design/i,
      'the comment explaining the canonical-row filter is gone; without it the filter reads as redundant',
    );
  });

  /**
   * Availability and occupancy reads, audited 2026-09-26 after the door-code
   * one turned up. A superseded twin can carry the OLD dates of a stay that
   * has moved, so an unfiltered read does not merely double-count: it holds
   * nights nothing occupies.
   *
   * The iCal export is the one that leaves the building. buildIcalExport
   * emits a VEVENT per row with no dedupe, so every OTA subscribed to the
   * feed blocks whatever a stale twin publishes.
   */
  const AVAILABILITY_READS: Array<[string, string]> = [
    ['src/app/book/[propertyId]/actions.ts', 'the direct-booking conflict check refuses real bookings'],
    ['src/app/book/[propertyId]/page.tsx', 'the public availability calendar greys out free nights'],
    ['src/app/api/channels/ical/[token]/route.ts', 'the OTA iCal feed blocks nights on every channel'],
    ['src/lib/climate.ts', 'the thermostat holds comfort on an empty house'],
    ['src/lib/ai/campaign-context.ts', 'campaign targeting double-counts a deduped stay'],
  ];

  for (const [file, consequence] of AVAILABILITY_READS) {
    test(`${file} reads canonical rows only`, () => {
      const q = queryFrom(read(file), 'bookings');
      assert.ok(
        q.includes(".is('duplicate_of', null)"),
        `without the canonical-row filter, ${consequence}`,
      );
    });
  }

  test('the iCal importer is exempt, and says why', () => {
    // It diffs the rows it created, keyed by ical_uid. Filtering would make
    // it re-add a deduped row on every sync. Asserted so the exemption reads
    // as a decision rather than the one place somebody forgot.
    const src = read('src/lib/ical-sync.ts');
    assert.match(
      src,
      /NO duplicate_of filter here, deliberately/,
      'the ical importer lost the comment explaining why it is the one stay read without the filter',
    );
  });
});
