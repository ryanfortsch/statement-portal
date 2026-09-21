/**
 * Which bookings rows are the same stay. Fixture is the real 20 Hammond
 * cluster of 2026-09-21: Lauren Foy (HMWM9T9STJ) cancelled 08-23, Ashley
 * Dobransky (HMEFDNMS4Z) rebooked the exact dates 08-26, and each
 * reservation is seen three ways (Guesty aggregate feed, direct Airbnb
 * feed, guesty_legacy backfill).
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planDedupe, type DedupRow, type DedupPlan } from '../booking-dedupe.ts';
import { isPlaceholderGuestName } from '../ical.ts';
import { findDoubleBookings } from '../booking-conflicts.ts';

const AGGREGATE = 'listing-guesty';
const DIRECT = 'listing-airbnb';
const opts = {
  isFromAggregateFeed: (r: DedupRow) => r.source === 'ical_import' && r.channel_listing_id === AGGREGATE,
  isPlaceholderGuestName,
};

function row(over: Partial<DedupRow> & { id: string }): DedupRow {
  return {
    property_id: '20_hammond',
    source: 'ical_import',
    status: 'confirmed',
    check_in: '2026-09-19',
    check_out: '2026-09-22',
    duplicate_of: null,
    created_at: '2026-08-01T00:00:00Z',
    cancelled_at: null,
    channel_listing_id: DIRECT,
    guest_name: null,
    guest_email: null,
    guest_phone: null,
    external_confirmation_code: null,
    external_booking_id: null,
    payout: null,
    gross_amount: null,
    num_guests: null,
    ...over,
  };
}

const lauren = [
  row({
    id: 'L-agg',
    channel_listing_id: AGGREGATE,
    status: 'cancelled',
    cancelled_at: '2026-08-23T16:01:15Z',
    guest_name: 'Lauren Foy',
    external_confirmation_code: 'HMWM9T9STJ',
    external_booking_id: 'guesty-1',
    created_at: '2026-08-22T17:31:25Z',
  }),
  // The direct Airbnb feed: no code, no name, just "Reserved".
  row({ id: 'L-direct', status: 'cancelled', cancelled_at: '2026-08-23T16:01:18Z', created_at: '2026-08-22T17:31:27Z' }),
  row({
    id: 'L-legacy',
    source: 'guesty_legacy',
    channel_listing_id: null,
    status: 'cancelled',
    cancelled_at: '2026-08-23T18:26:19Z',
    guest_name: 'Lauren Foy',
    external_confirmation_code: 'HMWM9T9STJ',
    external_booking_id: 'guesty-1',
    created_at: '2026-08-23T04:45:44Z',
  }),
];

const ashley = [
  row({
    id: 'A-agg',
    channel_listing_id: AGGREGATE,
    guest_name: 'Reservation HMEFDNMS4Z',
    external_confirmation_code: 'HMEFDNMS4Z',
    created_at: '2026-08-26T21:00:45Z',
  }),
  row({ id: 'A-direct', created_at: '2026-08-26T21:00:44Z' }),
  row({
    id: 'A-legacy',
    source: 'guesty_legacy',
    channel_listing_id: null,
    guest_name: 'Ashley Dobransky',
    external_confirmation_code: 'HMEFDNMS4Z',
    external_booking_id: 'guesty-2',
    created_at: '2026-08-26T21:01:57Z',
  }),
];

const canonicalOf = (plan: DedupPlan, id: string): string => plan.desired.get(id) ?? id;
const byId = (rows: DedupRow[]) => new Map(rows.map((r) => [r.id, r]));
/** Every row the plan leaves standing canonical, whatever its status. */
const canonicals = (plan: DedupPlan, rows: DedupRow[]) => rows.filter((r) => (plan.desired.get(r.id) ?? null) === null);
/** The canonical's name once its patch is applied: a placeholder gives way to the patch. */
const pooledName = (plan: DedupPlan, rows: DedupRow[], id: string) =>
  (plan.enrichPatches.get(id)?.guest_name as string | undefined) ?? byId(rows).get(id)!.guest_name;
/** What the canonical row will carry once its patch is applied. */
const pooled = (plan: DedupPlan, rows: DedupRow[], id: string, field: keyof DedupRow) =>
  byId(rows).get(id)![field] ?? plan.enrichPatches.get(id)?.[field] ?? null;

describe('cancel-then-rebook on the exact same dates', () => {
  // Row order must not matter: the nameless direct-feed row may attach to
  // either reservation, but the two coded reservations never fuse.
  const orders: Array<[string, DedupRow[]]> = [
    ['cancelled first', [...lauren, ...ashley]],
    ['rebooking first', [...ashley, ...lauren]],
    ['interleaved', [lauren[0], ashley[1], ashley[0], lauren[1], ashley[2], lauren[2]]],
  ];

  for (const [label, rows] of orders) {
    test(`the rebooking keeps a live canonical (${label})`, () => {
      const plan = planDedupe(rows, opts);
      const all = byId(rows);
      const live = canonicalOf(plan, 'A-agg');
      assert.equal(canonicalOf(plan, 'A-legacy'), live, 'both coded Ashley rows share one canonical');
      assert.equal(all.get(live)!.status, 'confirmed', 'and it is a confirmed row');
      assert.equal(pooled(plan, rows, live, 'external_confirmation_code'), 'HMEFDNMS4Z');

      const gone = canonicalOf(plan, 'L-agg');
      assert.equal(canonicalOf(plan, 'L-legacy'), gone, 'both coded Lauren rows share one canonical');
      assert.equal(all.get(gone)!.status, 'cancelled', 'and it stays cancelled');
      assert.notEqual(live, gone, 'two reservations, two stays');
    });
  }

  test('the live canonical gets the real guest name pooled onto it', () => {
    const rows = [...lauren, ...ashley];
    const plan = planDedupe(rows, opts);
    const live = canonicalOf(plan, 'A-agg');
    // An iCal row wins on source priority and wears a placeholder (or no
    // name at all), so the guesty_legacy row must donate the name.
    assert.equal(pooled(plan, rows, live, 'guest_name'), 'Ashley Dobransky');
  });

  test('nothing of the cancelled reservation is pooled onto the live one', () => {
    const rows = [
      ...lauren.map((r) => (r.id === 'L-legacy' ? { ...r, guest_phone: '+19785550100', payout: 900 } : r)),
      ...ashley,
    ];
    const plan = planDedupe(rows, opts);
    const patch = plan.enrichPatches.get(canonicalOf(plan, 'A-agg')) ?? {};
    assert.notEqual(patch.guest_phone, '+19785550100');
    assert.notEqual(patch.payout, 900);
  });
});

describe('a booking id pooled onto an iCal row is not identity', () => {
  // 53 Rocky Neck, 2026-10-08 to 10-12, as the table held it on 2026-09-21.
  // Monica Lashley booked HMTWCKF422, cancelled it on 07-17 and rebooked the
  // same dates on 07-20 as HMSZKNJ3CD. While the clusters were fused, the
  // cancelled aggregate-feed row stood canonical and pooled the LIVE
  // reservation's Guesty id (with the name and the payout); the rebooking's
  // direct-feed row pooled the same id while it stood canonical later. The
  // sync never writes external_booking_id on an ical_import row, so every
  // one of those is a copy. cancelled_at is stamped on the confirmed rows
  // too, as the table has it; only status 'cancelled' reads as a cancel.
  const LIVE_ID = '6a5e32b311b34fc38573a38a';
  const CANCELLED_ID = '6a5a2f046b457b66d97f3a4b';
  const rn = (over: Partial<DedupRow> & { id: string }) =>
    row({ property_id: '53_rocky_neck', check_in: '2026-10-08', check_out: '2026-10-12', ...over });
  const first = [
    rn({
      id: 'old-agg',
      channel_listing_id: AGGREGATE,
      status: 'cancelled',
      cancelled_at: '2026-07-17T19:30:17Z',
      created_at: '2026-07-17T14:00:19Z',
      guest_name: 'Monica Lashley',
      external_confirmation_code: 'HMTWCKF422',
      external_booking_id: LIVE_ID,
      payout: 2648.23,
    }),
    rn({
      id: 'old-direct',
      status: 'cancelled',
      cancelled_at: '2026-07-17T19:30:14Z',
      created_at: '2026-07-17T14:00:25Z',
      external_confirmation_code: 'HMTWCKF422',
    }),
    rn({
      id: 'old-legacy',
      source: 'guesty_legacy',
      channel_listing_id: null,
      status: 'cancelled',
      cancelled_at: '2026-08-05T15:09:07Z',
      created_at: '2026-07-18T04:45:35Z',
      guest_name: 'Monica Lashley',
      external_confirmation_code: 'HMTWCKF422',
      external_booking_id: CANCELLED_ID,
      payout: 0,
    }),
  ];
  const rebooked = [
    rn({
      id: 'new-agg',
      channel_listing_id: AGGREGATE,
      cancelled_at: '2026-08-05T15:09:07Z',
      created_at: '2026-07-20T15:00:29Z',
      guest_name: 'Reservation HMSZKNJ3CD',
      external_confirmation_code: 'HMSZKNJ3CD',
    }),
    rn({
      id: 'new-direct',
      cancelled_at: '2026-08-05T15:09:07Z',
      created_at: '2026-07-20T15:00:31Z',
      external_confirmation_code: 'HMSZKNJ3CD',
      external_booking_id: LIVE_ID,
      payout: 2648.23,
    }),
    rn({
      id: 'new-legacy',
      source: 'guesty_legacy',
      channel_listing_id: null,
      cancelled_at: '2026-08-05T15:09:07Z',
      created_at: '2026-07-21T04:45:31Z',
      guest_name: 'Monica Lashley',
      external_confirmation_code: 'HMSZKNJ3CD',
      external_booking_id: LIVE_ID,
      payout: 2648.23,
    }),
  ];

  const orders: Array<[string, DedupRow[]]> = [
    ['cancelled first', [...first, ...rebooked]],
    ['rebooking first', [...rebooked, ...first]],
    ['interleaved', [first[0], rebooked[1], rebooked[0], first[1], rebooked[2], first[2]]],
  ];

  for (const [label, rows] of orders) {
    test(`the rebooking keeps a confirmed canonical and the cancelled stay stays apart (${label})`, () => {
      const plan = planDedupe(rows, opts);
      const all = byId(rows);
      assert.equal(plan.clusters, 2, 'two reservations, two stays');

      const live = canonicalOf(plan, 'new-agg');
      assert.equal(canonicalOf(plan, 'new-direct'), live);
      assert.equal(canonicalOf(plan, 'new-legacy'), live);
      assert.equal(all.get(live)!.status, 'confirmed', 'the rebooking is live');
      assert.equal(pooled(plan, rows, live, 'external_confirmation_code'), 'HMSZKNJ3CD');
      assert.equal(pooled(plan, rows, live, 'external_booking_id'), LIVE_ID);
      // The aggregate-feed row is canonical and wears the placeholder, so
      // the name arrives by patch.
      assert.equal(plan.enrichPatches.get(live)?.guest_name, 'Monica Lashley');

      const gone = canonicalOf(plan, 'old-agg');
      assert.equal(canonicalOf(plan, 'old-direct'), gone);
      assert.equal(canonicalOf(plan, 'old-legacy'), gone);
      assert.equal(all.get(gone)!.status, 'cancelled', 'the first booking stays cancelled');
      assert.notEqual(live, gone);
    });
  }

  test('the borrowed id on the cancelled canonical is corrected from its own cluster', () => {
    const rows = [...first, ...rebooked];
    const plan = planDedupe(rows, opts);
    // The aggregate-feed row is canonical (iCal outranks the backfill, and
    // it is the earliest), still wearing the live reservation's id.
    assert.equal(canonicalOf(plan, 'old-agg'), 'old-agg');
    assert.equal(plan.enrichPatches.get('old-agg')?.external_booking_id, CANCELLED_ID);
  });

  test('a borrowed id is never copied from one iCal row to another', () => {
    // No backfill row yet: nothing native vouches for the id the direct-feed
    // row carries, so the canonical is not lent it.
    const rows = [rebooked[0], rebooked[1]];
    const plan = planDedupe(rows, opts);
    const live = canonicalOf(plan, 'new-direct');
    assert.equal(live, 'new-agg');
    assert.equal(plan.enrichPatches.get('new-agg')?.external_booking_id, undefined);
  });

  test('an iCal row standing alone sheds a borrowed id', () => {
    const plan = planDedupe([rebooked[1]], opts);
    assert.equal(plan.desired.get('new-direct'), null);
    const patch = plan.enrichPatches.get('new-direct') ?? {};
    assert.ok('external_booking_id' in patch, 'the id is cleared');
    assert.equal(patch.external_booking_id, null);
  });

  test('a native booking id is never rewritten', () => {
    // The backfill row is canonical (its status matches the cluster's, the
    // aggregate feed's cancel is not trusted), and the copy on its iCal twin
    // says something else. Its own id stands.
    const rows = [
      rn({ id: 'legacy', source: 'guesty_legacy', channel_listing_id: null, guest_name: 'Monica Lashley', external_confirmation_code: 'HMSZKNJ3CD', external_booking_id: LIVE_ID }),
      rn({ id: 'agg', channel_listing_id: AGGREGATE, status: 'cancelled', cancelled_at: '2026-09-01T12:00:00Z', guest_name: 'Reservation HMSZKNJ3CD', external_confirmation_code: 'HMSZKNJ3CD', external_booking_id: CANCELLED_ID }),
    ];
    const plan = planDedupe(rows, opts);
    assert.equal(canonicalOf(plan, 'agg'), 'legacy');
    assert.equal(plan.enrichPatches.get('legacy')?.external_booking_id, undefined);
  });

  test('a borrowed id does not keep an iCal row out of its own stay either', () => {
    // A nameless, codeless direct-feed row wearing a stale copy, next to the
    // backfill row of the stay it actually belongs to. Two differing booking
    // ids used to read as two reservations and block the date merge.
    const rows = [
      rn({ id: 'legacy', source: 'guesty_legacy', channel_listing_id: null, guest_name: 'Monica Lashley', external_confirmation_code: 'HMSZKNJ3CD', external_booking_id: LIVE_ID }),
      rn({ id: 'direct', external_booking_id: CANCELLED_ID }),
    ];
    const plan = planDedupe(rows, opts);
    assert.equal(canonicalOf(plan, 'legacy'), canonicalOf(plan, 'direct'));
    assert.equal(plan.clusters, 1);
  });
});

describe('what the tighter clustering must still do', () => {
  test('one stay under reissued Guesty ids still collapses', () => {
    // Guesty reissued the reservation id on a modification; the old row
    // lingers, confirmed, with its own id. No codes, placeholder name on one.
    const rows = [
      row({ id: 'g-old', source: 'guesty_legacy', channel_listing_id: null, guest_name: 'Robin Tellier', external_booking_id: 'guesty-10' }),
      row({ id: 'g-new', source: 'guesty_legacy', channel_listing_id: null, guest_name: 'Guest to be announced', external_booking_id: 'guesty-11' }),
      row({ id: 'ical', channel_listing_id: AGGREGATE, guest_name: 'Reservation BC-777', external_confirmation_code: 'BC-777' }),
    ];
    const plan = planDedupe(rows, opts);
    const c = canonicalOf(plan, 'g-old');
    assert.equal(canonicalOf(plan, 'g-new'), c);
    assert.equal(canonicalOf(plan, 'ical'), c);
    assert.equal(plan.clusters, 1);
  });

  test('one guest under three Airbnb codes is one stay while none is cancelled', () => {
    // 21 Horton, Robin Tellier, 2026-08-08 to 08-22, as the Guesty backfill
    // holds it: three confirmed reservations, one per alteration, plus the
    // iCal rows of the first code dropped AFTER checkout (not a cancel).
    const rows = [
      row({ id: 'ical-1', channel_listing_id: AGGREGATE, status: 'cancelled', cancelled_at: '2026-08-23T04:00:00Z', check_in: '2026-08-08', check_out: '2026-08-22', guest_name: 'Reservation HM3BQ4EMHD', external_confirmation_code: 'HM3BQ4EMHD' }),
      row({ id: 'legacy-1', source: 'guesty_legacy', channel_listing_id: null, check_in: '2026-08-08', check_out: '2026-08-22', guest_name: 'Robin Tellier', external_confirmation_code: 'HM3BQ4EMHD', external_booking_id: 'guesty-21' }),
      row({ id: 'legacy-2', source: 'guesty_legacy', channel_listing_id: null, check_in: '2026-08-08', check_out: '2026-08-22', guest_name: 'Robin Tellier', external_confirmation_code: 'HMTRNXC2NY', external_booking_id: 'guesty-22', created_at: '2026-08-25T00:00:00Z' }),
      row({ id: 'legacy-3', source: 'guesty_legacy', channel_listing_id: null, check_in: '2026-08-08', check_out: '2026-08-22', guest_name: 'Robin Tellier', external_confirmation_code: 'HMRB4PZK89', external_booking_id: 'guesty-23', created_at: '2026-08-25T00:00:01Z' }),
    ];
    const plan = planDedupe(rows, opts);
    assert.equal(plan.clusters, 1, 'one stay, not three');
    const c = canonicalOf(plan, 'legacy-1');
    assert.equal(canonicalOf(plan, 'legacy-2'), c);
    assert.equal(canonicalOf(plan, 'legacy-3'), c);
    assert.equal(byId(rows).get(c)!.status, 'confirmed');
  });

  test('the same guest cancelling and rebooking the same dates keeps the new booking live', () => {
    const rows = [
      row({ id: 'old', source: 'guesty_legacy', channel_listing_id: null, status: 'cancelled', cancelled_at: '2026-09-01T12:00:00Z', guest_name: 'Robin Tellier', external_confirmation_code: 'HM-OLD', external_booking_id: 'guesty-31' }),
      row({ id: 'new', source: 'guesty_legacy', channel_listing_id: null, guest_name: 'Robin Tellier', external_confirmation_code: 'HM-NEW', external_booking_id: 'guesty-32', created_at: '2026-09-01T12:05:00Z' }),
      row({ id: 'new-ical', channel_listing_id: AGGREGATE, guest_name: 'Reservation HM-NEW', external_confirmation_code: 'HM-NEW', created_at: '2026-09-01T12:30:00Z' }),
    ];
    const plan = planDedupe(rows, opts);
    const live = canonicalOf(plan, 'new');
    assert.equal(canonicalOf(plan, 'new-ical'), live);
    assert.equal(byId(rows).get(live)!.status, 'confirmed');
    assert.equal(plan.desired.get('old'), null, 'the cancelled booking stands on its own');
  });

  test('two exact-date rows naming different people are refused', () => {
    const rows = [
      row({ id: 'p', source: 'guesty_legacy', channel_listing_id: null, guest_name: 'Pat Lee' }),
      row({ id: 'q', source: 'guesty_legacy', channel_listing_id: null, guest_name: 'Quinn Ross' }),
    ];
    const plan = planDedupe(rows, opts);
    assert.equal(plan.clusters, 0);
  });

  test('a nameless row cannot bridge two differently named reservations either', () => {
    const rows = [
      row({ id: 'p', source: 'guesty_legacy', channel_listing_id: null, guest_name: 'Pat Lee' }),
      row({ id: 'bridge' }),
      row({ id: 'q', source: 'guesty_legacy', channel_listing_id: null, guest_name: 'Quinn Ross' }),
    ];
    const plan = planDedupe(rows, opts);
    assert.notEqual(canonicalOf(plan, 'p'), canonicalOf(plan, 'q'));
  });

  test('a trusted cancellation still collapses its stale confirmed twin', () => {
    const rows = [
      row({ id: 'ical', channel_listing_id: AGGREGATE, guest_name: 'Reservation HM1', external_confirmation_code: 'HM1' }),
      row({
        id: 'legacy',
        source: 'guesty_legacy',
        channel_listing_id: null,
        status: 'cancelled',
        cancelled_at: '2026-09-01T12:00:00Z',
        guest_name: 'Sam Field',
        external_confirmation_code: 'HM1',
      }),
    ];
    const plan = planDedupe(rows, opts);
    assert.equal(canonicalOf(plan, 'ical'), 'legacy');
    assert.equal(plan.desired.get('legacy'), null);
  });

  test('consecutive stays never merge', () => {
    const rows = [
      row({ id: 'out', check_in: '2026-09-19', check_out: '2026-09-22' }),
      row({ id: 'in', check_in: '2026-09-22', check_out: '2026-09-25' }),
    ];
    assert.equal(planDedupe(rows, opts).clusters, 0);
  });
});

describe('a closed Booking.com placeholder is not a stay, nor a cancellation of one', () => {
  // Guesty records a Booking.com stay before the guest is named ("Guest to
  // be announced", no BC- code, its own reservation id) and again once the
  // guest is, then retires the placeholder as `closed`; a placeholder never
  // followed by a named record is a booking that fell through. The backfill
  // mirrors a record closed before its check-in as cancelled
  // (guesty-legacy-status.ts). Rows as the table held them on 2026-09-21,
  // with that mirror applied.
  const locust = (over: Partial<DedupRow> & { id: string }) => row({ property_id: '3_locust', ...over });
  const tba = (over: Partial<DedupRow> & { id: string }) =>
    locust({
      source: 'guesty_legacy',
      channel_listing_id: null,
      status: 'cancelled',
      guest_name: 'Guest to be announced',
      created_at: '2026-08-25T15:31:24Z',
      ...over,
    });

  test('beside the named record it is a duplicate of a live stay', () => {
    // 3 Locust, 2027-06-01 to 06-08: the placeholder booked 05-29, Gary
    // Heathcote's BC-l0PnOpEkV a day later. Trusting the placeholder's
    // cancel made the cluster cancelled, elected the placeholder canonical
    // and hid Gary's stay from every schedule surface.
    const heathcote = [
      locust({ id: 'gh-agg', channel_listing_id: AGGREGATE, check_in: '2027-06-01', check_out: '2027-06-08', guest_name: 'Reservation BC-l0PnOpEkV', external_confirmation_code: 'BC-l0PnOpEkV', created_at: '2026-05-30T15:30:00Z' }),
      locust({ id: 'gh-legacy', source: 'guesty_legacy', channel_listing_id: null, check_in: '2027-06-01', check_out: '2027-06-08', guest_name: 'Gary Heathcote', external_confirmation_code: 'BC-l0PnOpEkV', external_booking_id: '6a1af22055f83200154db385', payout: 6566.7, created_at: '2026-05-31T04:45:00Z' }),
      tba({ id: 'tba-jun', check_in: '2027-06-01', check_out: '2027-06-08', external_booking_id: '6a19928f4543e9001284d66a', payout: 6516.13 }),
    ];
    const orders: Array<[string, DedupRow[]]> = [
      ['named first', heathcote],
      ['placeholder first', [...heathcote].reverse()],
      ['interleaved', [heathcote[1], heathcote[2], heathcote[0]]],
    ];
    for (const [label, rows] of orders) {
      const plan = planDedupe(rows, opts);
      assert.equal(plan.clusters, 1, `one stay (${label})`);
      const live = canonicalOf(plan, 'gh-legacy');
      assert.equal(canonicalOf(plan, 'tba-jun'), live, `the placeholder is a duplicate of the stay (${label})`);
      assert.equal(byId(rows).get(live)!.status, 'confirmed', `and the stay is live (${label})`);
      assert.equal(pooledName(plan, rows, live), 'Gary Heathcote');
      assert.deepEqual(findDoubleBookings(canonicals(plan, rows)), []);
    }
  });

  test('alone, or with only its own twin, it is a cancelled stay', () => {
    // Rachel Lindas, VRBO 10-13 to 10-18, next to the placeholder booked
    // 2025-08-28 for 10-16 to 10-19; then Diane Walkinshaw, Airbnb 2027-07-02
    // to 07-09, next to two placeholders for 06-30 to 07-06. Confirmed, these
    // were two of the five double-bookings on the list.
    const rows = [
      locust({ id: 'rl-agg', channel_listing_id: AGGREGATE, check_in: '2026-10-13', check_out: '2026-10-18', guest_name: 'Reservation HA-x33CAMu', external_confirmation_code: 'HA-x33CAMu', created_at: '2026-08-15T21:00:14Z' }),
      locust({ id: 'rl-legacy', source: 'guesty_legacy', channel_listing_id: null, check_in: '2026-10-13', check_out: '2026-10-18', guest_name: 'Rachel Lindas', external_confirmation_code: 'HA-x33CAMu', external_booking_id: '6a80ce101d1d5f8d468fc410', created_at: '2026-08-16T04:45:02Z' }),
      tba({ id: 'tba-oct', check_in: '2026-10-16', check_out: '2026-10-19', external_booking_id: '68b066c96a70ce001325081a', payout: 2466.34 }),
      locust({ id: 'dw-direct', check_in: '2027-07-02', check_out: '2027-07-09', external_confirmation_code: 'HMKPYXXF5N', created_at: '2026-09-15T15:30:29Z' }),
      locust({ id: 'dw-agg', channel_listing_id: AGGREGATE, check_in: '2027-07-02', check_out: '2027-07-09', guest_name: 'Reservation HMKPYXXF5N', external_confirmation_code: 'HMKPYXXF5N', created_at: '2026-09-15T15:30:30Z' }),
      locust({ id: 'dw-legacy', source: 'guesty_legacy', channel_listing_id: null, check_in: '2027-07-02', check_out: '2027-07-09', guest_name: 'Diane Walkinshaw', external_confirmation_code: 'HMKPYXXF5N', external_booking_id: '6aa95f3456eb63a39e09606a', created_at: '2026-09-15T17:08:32Z' }),
      tba({ id: 'tba-jul-1', check_in: '2027-06-30', check_out: '2027-07-06', external_booking_id: '6a4a7c21fc96cd0014bc33fc', payout: 0 }),
      tba({ id: 'tba-jul-2', check_in: '2027-06-30', check_out: '2027-07-06', external_booking_id: '6a4be6298b2f12000eac46a4', payout: 0 }),
    ];
    const plan = planDedupe(rows, opts);
    const all = byId(rows);
    assert.equal(plan.desired.get('tba-oct'), null, 'the October placeholder stands alone');
    const lindas = canonicalOf(plan, 'rl-legacy');
    assert.equal(canonicalOf(plan, 'rl-agg'), lindas);
    assert.equal(all.get(lindas)!.status, 'confirmed');
    const july = canonicalOf(plan, 'tba-jul-1');
    assert.equal(canonicalOf(plan, 'tba-jul-2'), july, 'the two July placeholders are one record');
    assert.equal(all.get(july)!.status, 'cancelled', 'and it is cancelled');
    const walkinshaw = canonicalOf(plan, 'dw-legacy');
    assert.equal(canonicalOf(plan, 'dw-direct'), walkinshaw);
    assert.equal(canonicalOf(plan, 'dw-agg'), walkinshaw);
    assert.equal(all.get(walkinshaw)!.status, 'confirmed');
    assert.notEqual(july, walkinshaw);
    assert.equal(plan.clusters, 3);
    assert.deepEqual(findDoubleBookings(canonicals(plan, rows)), []);
  });
});

describe("an inquiry from another guest on a stay's dates", () => {
  // 17 Beach, 2026-10-29 to 11-02. Airbnb reveals only a first name on an
  // inquiry, so Guesty holds "Rebecca" (asked 08-14) beside Todd Shepherd's
  // HMM5EZCBDB (booked 09-05): two people, two records. The same shape sat
  // at 3 South (Claire, Kelsey) and 53 Rocky Neck (Zoe) on 2026-09-21. The
  // inquiry is not the stay, and not a party to a double-booking.
  const beach = (over: Partial<DedupRow> & { id: string }) =>
    row({ property_id: '17_beach_rd', check_in: '2026-10-29', check_out: '2026-11-02', ...over });
  const rows = [
    beach({ id: 'ts-direct', external_confirmation_code: 'HMM5EZCBDB', created_at: '2026-09-05T23:30:27Z' }),
    beach({ id: 'ts-agg', channel_listing_id: AGGREGATE, guest_name: 'Reservation HMM5EZCBDB', external_confirmation_code: 'HMM5EZCBDB', created_at: '2026-09-05T23:30:29Z' }),
    beach({ id: 'ts-legacy', source: 'guesty_legacy', channel_listing_id: null, guest_name: 'Todd Shepherd', external_confirmation_code: 'HMM5EZCBDB', external_booking_id: '6a9ca35e6bba7f1c85d24a4b', created_at: '2026-09-06T02:02:00Z' }),
    beach({ id: 'rebecca', source: 'guesty_legacy', channel_listing_id: null, status: 'inquiry', guest_name: 'Rebecca', external_booking_id: '6a7f1379d358610fec31fd57', payout: 4873, created_at: '2026-08-25T15:31:24Z' }),
  ];

  test('stays its own record, and the stay keeps its name', () => {
    for (const order of [rows, [...rows].reverse()]) {
      const plan = planDedupe(order, opts);
      assert.equal(plan.clusters, 1);
      const live = canonicalOf(plan, 'ts-legacy');
      assert.equal(canonicalOf(plan, 'ts-direct'), live);
      assert.equal(canonicalOf(plan, 'ts-agg'), live);
      assert.equal(byId(order).get(live)!.status, 'confirmed');
      assert.equal(pooledName(plan, order, live), 'Todd Shepherd');
      assert.equal(plan.desired.get('rebecca'), null, 'the inquiry stands alone');
      assert.notEqual(plan.enrichPatches.get(live)?.payout, 4873, 'nothing of the inquiry reaches the stay');
      assert.deepEqual(findDoubleBookings(canonicals(plan, order)), []);
    }
  });
});
