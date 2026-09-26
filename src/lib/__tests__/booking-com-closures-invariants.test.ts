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
    assert.ok(src.includes('keepsEmptyFeedGuardUp(r, cutoff, isBlockSummary, reservationHolds || isGuestyFeed)'));
    assert.ok(src.includes('holdsAreReservations: reservationHolds,'));
  });

  test('a release answers only the run whose alert it was pressed on, and one decisive run uses it up', () => {
    assert.ok(src.includes('const answered = releaseAnswers(ack?.runId ?? null, lastRun);'));
    // A run that failed before the decision is not "newer".
    assert.ok(src.includes(".or('success.eq.true,guard.not.is.null')"));
    const actions = squash(read('src/app/channels/listings/actions.ts'));
    assert.ok(actions.includes("if (!lastRun || lastRun.id !== runId || (lastRun.guard !== 'mass_cancel' && lastRun.guard !== 'empty_feed')) {"));
    assert.ok(actions.includes('mass_cancel_ack_run_id: runId'));
    assert.ok(src.includes("const emptyReleased = emptyFeed && answered === 'empty_feed';"));
    assert.ok(src.includes("allowMassCancel: answered === 'mass_cancel' || emptyReleased,"));
    assert.ok(src.includes('treatMissingAsReady: emptyReleased,'));
    // The clear sits after both branches: an empty-feed run consumes a stale
    // release too (it once survived one and released the next empty feed).
    const clear = src.indexOf(".update({ mass_cancel_acknowledged_at: null, mass_cancel_ack_run_id: null })");
    const emptyBranch = src.indexOf("result.guard = 'empty_feed';");
    const cancelPass = src.indexOf('const plan = planCancelPass({');
    assert.ok(clear > emptyBranch && clear > cancelPass, 'the release is cleared outside both branches');
  });

  test("closures on a home whose closures are dropped as Guesty's echoes sit out the cancel pass", () => {
    assert.ok(src.includes("? existing.filter((r) => !(r.status === 'block' && r.hold_kind === 'ota'))"));
    // During a cutover the Guesty feed's own blocks are the flip's, not the cancel pass's.
    assert.ok(src.includes('const cutoverUnderway = isGuestyFeed && !hasAggregateFeed(aggregateFeeds, opts.property_id);'));
    assert.ok(src.includes("? existing.filter((r) => r.status !== 'block')"));
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
    assert.ok(sql.includes('and public.helm_row_conflicts(b, p_channel, p_status, p_check_in, p_check_out)'));
    assert.ok(sql.includes('and public.helm_row_conflicts(b, v_before.channel, p_status, p_check_in, p_check_out)'));
    // A hold never conflicts with a hold; Guesty's rule artifacts never conflict.
    assert.ok(sql.includes("when p_status = 'block' and b.status = 'block'"));
    // ...except a Booking.com closure nothing else on file explains.
    assert.ok(sql.includes("and not (b.source = 'ical_import' and b.hold_kind is not distinct from 'ota' and b.channel = 'booking_com'"));
    assert.ok(sql.includes("_(an|bw|bd|b|a)_"));
    // The Booking.com echo exemption is tested over the written nights only.
    assert.ok(sql.includes('generate_series(greatest(b.check_in, p_from), least(b.check_out, p_to) - 1'));
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
    const sync = squash(read('src/lib/ical-sync.ts'));
    assert.ok(sync.includes(': guestyEchoPropertyIds((data ?? []) as ListingScopeRow[], authoritiesFrom(data ?? []));'));
    assert.ok(sync.includes('export_subscribed, properties(calendar_authority)'), 'authority rides the listing read, no second read');
  });
});

describe('only an OTA can be credited with an OTA pull', () => {
  test('an operator checking a line (signed-in browser, curl) is credited to nobody', () => {
    const src = squash(read('src/app/api/channels/ical/[token]/route.ts'));
    assert.ok(src.includes("!!request.cookies.get('__Secure-authjs.session-token') ||"));
    assert.ok(src.includes('channel: operatorClient ? null :'));
  });
});

describe('an imported row is its feed\'s, and a Guesty-run guest is the concierge\'s', () => {
  test('Delete refuses a row imported from a feed; a Helm hold is lifted as a cancel', () => {
    const src = squash(read('src/lib/bookings-write.ts'));
    // Delete, move and cancel all refuse a feed-owned row.
    assert.equal(src.split('if (await isFeedOwned(').length - 1, 3);
    assert.ok(src.includes("reason = 'a lifted hold is kept as cancelled so its channel echoes can be traced';"));
  });
  test('the Quo webhook opens a Helm thread only for a stay at a Helm-run home', () => {
    const src = squash(read('src/lib/quo-ingest.ts'));
    assert.equal(src.split('helmRunOnly: true,').length - 1, 2, 'inbound and outbound');
  });
  test('the turnover pipeline gates stays by region only, not by is_active', () => {
    const src = squash(read('src/lib/operations.ts'));
    assert.ok(src.includes('const capeAnnIds = new Set(allProps.filter(isCapeAnnOps).map((p) => p.id));'));
  });
});

describe('round 6: Guesty passes, live_since, the record form and the rule type', () => {
  test('no Guesty pass writes bookings for a home mid-cutover', () => {
    for (const f of ['src/lib/reservation-reconcile.ts', 'src/lib/guesty-backfill.ts', 'src/lib/ghost-booking-reconcile.ts']) {
      assert.ok(squash(read(f)).includes('loadGuestyWriteExcludedIds('), f);
    }
    // The reconcile refuses to run on a failed read rather than cancel blind.
    assert.ok(squash(read('src/lib/reservation-reconcile.ts')).includes("if (!excludedIds) throw new Error("));
  });
  test('the sync stamps live_since when a row is inserted, revived or moved', () => {
    const src = squash(read('src/lib/ical-sync.ts'));
    assert.ok(src.includes("return !prior || prior.status === 'cancelled' || prior.check_in !== r.check_in || prior.check_out !== r.check_out;"));
    assert.ok(src.includes('fresh.map((r) => ({ ...r, live_since: startedAt.toISOString() }))'));
    assert.ok(src.includes('live_since: startedAt.toISOString(),'));
  });
  test('the record form never moves or cancels a feed-owned row', () => {
    const src = squash(read('src/app/channels/bookings/[id]/actions.ts'));
    assert.ok(src.includes('const feedOwned = await isFeedOwned(before);'));
    assert.ok(src.includes('const statusChanged = !feedOwned && status !== before.status;'));
  });
  test("the calendar mirror records Guesty's rule type on a night no hold covers", () => {
    const src = squash(read('src/lib/calendar-days.ts'));
    assert.ok(src.includes("block_rule_type: status === 'unavailable' && !holdRef ? ruleTypeOf(day.blockRefs) : null,"));
  });
});
