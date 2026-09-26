/**
 * A Booking.com closure may be a guest: the invariant audit.
 *
 * Booking.com's iCal publishes every reservation as a bare "CLOSED - Not
 * available" night, so on a Helm-run home a Booking.com guest arrives as an
 * OTA hold (status 'block', hold_kind 'ota'), not a stay. The pure rules are
 * tested where they live (ical-export, ical-cancel-policy, availability,
 * cutover-carryover, ical-mesh). What holds them in place in the IO code is a
 * handful of one-line guards spread over seven files, and losing any one of
 * them either reopens a Booking.com guest's nights on Airbnb and VRBO or
 * cancels the guest outright:
 *
 *   - the sync counts Booking.com closures for both cancel guards;
 *   - an empty feed is released only by a release given for THAT guard;
 *   - retiring a feed, and the nightly sweep, never cancel a Booking.com
 *     closure;
 *   - the export reads duplicates and windows by overlap, the availability
 *     bridge reads duplicate OTA holds, and the booking writer counts them;
 *   - the writer exempts a channel's own closure, so the Booking.com booking
 *     entered by hand is not refused by the closure Booking.com published for
 *     it;
 *   - the importer's Guesty-echo set throws on a failed read (it used to
 *     answer "every home" and drop every closure) and stops dropping once an
 *     OTA imports Helm's export;
 *   - the dedupe's Helm-run loader throws rather than run on Guesty rules.
 *
 * So this reads the source and asserts each guard is still there, in the
 * shape shoot-offer-optin.test.ts uses. Break one and watch it fail.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');
const squash = (s: string) => s.replace(/\s+/g, ' ');

describe('the sync treats a Booking.com closure as a possible guest', () => {
  const src = squash(read('src/lib/ical-sync.ts'));

  test('both cancel guards are told when a feed publishes reservations as closures', () => {
    assert.ok(src.includes('const reservationHolds = holdsAreReservations(opts.channel);'));
    assert.ok(src.includes('keepsEmptyFeedGuardUp(r, cutoff, isBlockSummary, reservationHolds)'));
    assert.ok(src.includes('holdsAreReservations: reservationHolds,'));
  });

  test("an empty feed is released only by a release answering the empty-feed guard", () => {
    assert.ok(src.includes("const emptyReleased = emptyFeed && !!ackAt && (await readLastGuard(sb, opts.listing_id)) === 'empty_feed';"));
    assert.ok(src.includes('if (emptyFeed && !emptyReleased) {'));
    assert.ok(src.includes('treatMissingAsReady: emptyReleased,'));
  });

  test('the stale-closure sweep leaves Booking.com closures live, and runs only on a full sync', () => {
    assert.ok(src.includes('.filter((r) => !holdsAreReservations(r.channel))'));
    assert.ok(src.includes('if (!opts.onlyListingId) {'));
  });

  test("the dedupe's Helm-run options come from the loader that throws", () => {
    assert.ok(src.includes('const cutovers = await loadHelmRunCutovers(sb);'));
    assert.ok(!src.includes('loadHelmRunPropertyIds'), 'the forgiving loader must not feed the dedupe');
  });
});

describe('retiring a feed never cancels a Booking.com closure', () => {
  test('retireFeedHolds returns before the cancel for booking_com', () => {
    const src = squash(read('src/app/channels/listings/actions.ts'));
    assert.ok(src.includes('if (!listing || holdsAreReservations((listing as { channel: string }).channel)) return 0;'));
  });

  test('a re-added feed takes back its orphaned imports', () => {
    const src = squash(read('src/app/channels/listings/actions.ts'));
    assert.ok(src.includes('await reattachOrphanedImports(saved.id as string, propertyId, channel);'));
  });
});

describe('every reader that holds nights sees duplicate OTA closures', () => {
  test('the export route reads duplicates and windows by overlap; the builder is the one gate', () => {
    const src = squash(read('src/app/api/channels/ical/[token]/route.ts'));
    assert.ok(!src.includes(".is('duplicate_of', null)"), 'the route must not drop duplicates before the builder sees them');
    assert.ok(src.includes(".gt('check_out', fromIso)"));
    assert.ok(!src.includes(".gte('check_in', fromIso)"), 'windowing by check-in drops a long stay in progress');
  });

  test('the availability bridge reads duplicate OTA holds', () => {
    const src = squash(read('src/lib/pms-bridge.ts'));
    assert.ok(src.includes(".or('duplicate_of.is.null,hold_kind.eq.ota')"));
  });

  test("the writer's overlap check counts duplicate OTA holds and exempts the row's own channel", () => {
    const sql = squash(read('supabase/migrations/20260926200000_helm_pms_plumbing.sql'));
    const counted = "(b.duplicate_of is null or (b.status = 'block' and b.hold_kind = 'ota'))";
    assert.equal(sql.split(counted).length - 1, 2, 'helm_create_booking and helm_move_booking');
    assert.ok(sql.includes("and not (b.status = 'block' and b.hold_kind = 'ota' and b.channel = p_channel)"));
    assert.ok(sql.includes("and not (b.status = 'block' and b.hold_kind = 'ota' and b.channel = v_before.channel)"));
  });
});

describe("the importer's Guesty-echo set fails closed", () => {
  const src = squash(read('src/lib/pms-guards.ts'));
  test('no catch turns a failed read into "every home"', () => {
    assert.ok(!src.includes("new Set(['*'])"));
  });
  test('a home stops dropping closures once an OTA imports Helm', () => {
    assert.ok(src.includes('else if (r.export_subscribed) subscribed.add(r.property_id);'));
    assert.ok(src.includes('for (const id of subscribed) aggregate.delete(id);'));
  });
});
