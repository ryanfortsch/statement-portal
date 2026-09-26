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
 *   - the sync counts Booking.com closures for both cancel guards, and a
 *     release answers only the guarded run it followed, used up by one run;
 *   - closures sit out the cancel pass while a home's closures are dropped;
 *   - retiring a feed, and the sweep, never cancel a Booking.com closure;
 *     no feed row with upcoming rows, and never the Guesty row, is deleted;
 *   - the export reads duplicates and windows by overlap, the availability
 *     bridge reads duplicate imported OTA holds, and both writers share one
 *     overlap rule whose only exemptions serve a Booking.com booking typed
 *     over its own closure, with a move checked only over added nights;
 *   - the importer's Guesty-echo set throws on a failed read and stops
 *     dropping closures once an OTA imports Helm's export;
 *   - the dedupe's strict homes (Helm-run, or an OTA already reading Helm)
 *     come from a loader that throws;
 *   - an operator checking a line is never credited as the OTA's pull.
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

  test('a release answers only the guard on screen when it was pressed, and one run uses it up', () => {
    assert.ok(src.includes('const answered = releaseAnswers(ackAt, lastRun);'));
    assert.ok(src.includes("const emptyReleased = emptyFeed && answered === 'empty_feed';"));
    assert.ok(src.includes("allowMassCancel: answered === 'mass_cancel' || emptyReleased,"));
    assert.ok(src.includes('treatMissingAsReady: emptyReleased,'));
    // The clear sits after both branches: an empty-feed run consumes a stale
    // release too (it once survived one and released the next empty feed).
    const clear = src.indexOf(".update({ mass_cancel_acknowledged_at: null })");
    const emptyBranch = src.indexOf("result.guard = 'empty_feed';");
    const cancelPass = src.indexOf('const plan = planCancelPass({');
    assert.ok(clear > emptyBranch && clear > cancelPass, 'the release is cleared outside both branches');
  });

  test("closures on a home whose closures are dropped as Guesty's echoes sit out the cancel pass", () => {
    assert.ok(src.includes("const judged = dropDirectBlocks ? existing.filter((r) => !(r.status === 'block' && r.hold_kind === 'ota')) : existing;"));
    assert.ok(src.includes('existing: judged,'));
  });

  test('the stale-closure sweep leaves Booking.com closures live, re-reads eligibility, and runs only on a full sync', () => {
    assert.ok(src.includes("if (r.hold_kind === 'ota') return !holdsAreReservations(r.channel) && !read(r.channel_listing_id);"));
    assert.ok(src.includes('staleHoldsRetired = await retireStaleOtaHolds(sb);'));
    assert.ok(src.includes('if (!opts.onlyListingId) {'));
  });

  test("the dedupe's strict homes come from the loader that throws, and include the cutover window", () => {
    assert.ok(src.includes('const cutovers = await loadStrictDedupeHomes(sb);'));
    assert.ok(!src.includes('loadHelmRunPropertyIds'), 'the forgiving loader must not feed the dedupe');
    const guards = squash(read('src/lib/pms-guards.ts'));
    assert.ok(guards.includes("else if (live.has(p.id)) out.set(p.id, live.get(p.id) ?? null);"));
  });
});

describe('a feed row is never deleted out from under its rows', () => {
  const src = squash(read('src/app/channels/listings/actions.ts'));
  test('retireFeedHolds returns before the cancel for booking_com', () => {
    assert.ok(src.includes('if (!listing || holdsAreReservations((listing as { channel: string }).channel)) return 0;'));
  });
  test('deleteListing refuses the Guesty aggregate row and any row with an upcoming import', () => {
    assert.ok(src.includes("if ((listing as { channel: string }).channel === 'guesty') {"));
    assert.ok(src.includes('if ((count ?? 0) > 0) {'));
  });
  test('nothing re-attaches orphaned imports by channel (it handed Guesty rows to a direct feed)', () => {
    assert.ok(!src.includes('reattachOrphanedImports'));
  });
});

describe('every reader that holds nights sees duplicate OTA closures', () => {
  test('the export route reads duplicates and windows by overlap; the builder is the one gate', () => {
    const src = squash(read('src/app/api/channels/ical/[token]/route.ts'));
    assert.ok(!src.includes(".is('duplicate_of', null)"), 'the route must not drop duplicates before the builder sees them');
    assert.ok(src.includes(".gt('check_out', fromIso)"));
    assert.ok(!src.includes(".gte('check_in', fromIso)"), 'windowing by check-in drops a long stay in progress');
  });

  test('the availability bridge reads duplicate OTA holds, and only imported ones', () => {
    const src = squash(read('src/lib/pms-bridge.ts'));
    assert.ok(src.includes(".or('duplicate_of.is.null,and(hold_kind.eq.ota,source.eq.ical_import)')"));
  });

  test('both writers use one overlap rule; a move is checked only over the nights it adds', () => {
    const sql = squash(read('supabase/migrations/20260926200000_helm_pms_plumbing.sql'));
    assert.ok(sql.includes('create or replace function public.helm_row_conflicts(b public.bookings, p_channel public.booking_channel)'));
    assert.ok(sql.includes('and public.helm_row_conflicts(b, p_channel)'));
    assert.ok(sql.includes('and public.helm_row_conflicts(b, v_before.channel)'));
    // Duplicates of an imported OTA closure count; a Helm hold is canonical-only.
    assert.ok(sql.includes("when b.status = 'block' and b.hold_kind = 'ota' and b.source = 'ical_import' then"));
    assert.ok(sql.includes("else b.duplicate_of is null"));
    // The only exemptions are for a Booking.com booking.
    assert.ok(sql.includes("not (p_channel = 'booking_com' and ("));
    assert.ok(sql.includes("or (p_check_in < least(p_check_out, v_before.check_in)"));
    assert.ok(sql.includes("or (greatest(p_check_in, v_before.check_out) < p_check_out"));
  });
});

describe("the importer's Guesty-echo set fails closed", () => {
  test('no catch turns a failed read into "every home"', () => {
    assert.ok(!squash(read('src/lib/pms-guards.ts')).includes("new Set(['*'])"));
  });
  test('the fleet sync derives it from the listing read it already made', () => {
    assert.ok(squash(read('src/lib/ical-sync.ts')).includes(': guestyEchoPropertyIds((data ?? []) as ListingScopeRow[]);'));
  });
});

describe('only an OTA can be credited with an OTA pull', () => {
  test('an operator checking a line (signed-in browser, curl) is credited to nobody', () => {
    const src = squash(read('src/app/api/channels/ical/[token]/route.ts'));
    assert.ok(src.includes("!!request.cookies.get('__Secure-authjs.session-token') ||"));
    assert.ok(src.includes('channel: operatorClient ? null :'));
  });
});
