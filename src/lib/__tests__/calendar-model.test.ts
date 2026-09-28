/**
 * The pure view model behind the multi-calendar and the property month grid.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorityBadge,
  barLabel,
  barSegments,
  buildMonthGrid,
  cellPrice,
  freshnessOf,
  importFreshness,
  parseMonthParam,
  pullFreshness,
  shiftMonth,
  sourceGlyph,
  splitByRow,
  unsellableReason,
  type BarBooking,
} from '../calendar-model.ts';
import type { RateDayRow, RatePlanRow } from '../rate-plan.ts';

const plan: RatePlanRow = {
  property_id: '65_calderwood',
  currency: 'USD',
  base_nightly_cents: 30000,
  weekend_nightly_cents: 35000,
  weekend_days: [5, 6],
  guests_included: 4,
  extra_guest_cents_per_night: 3500,
  cleaning_fee_cents: 30000,
  pet_fee_cents: null,
  security_deposit_cents: null,
  weekly_discount_pct: 0,
  monthly_discount_pct: 0,
  direct_markup_pct: 0,
  min_nights_default: 3,
  max_nights: null,
  advance_notice_hours: 24,
  booking_window_days: 365,
  turnover_buffer_days: 0,
  checkin_time: '16:00',
  checkout_time: '11:00',
  max_occupancy: 6,
  pets_allowed: false,
  quiet_hours: null,
  cancellation_policy_key: 'sca_50_30',
  cancellation_terms: null,
  house_rules: null,
};

const day = (date: string, patch: Partial<RateDayRow> = {}): RateDayRow => ({
  property_id: '65_calderwood',
  date,
  nightly_cents: null,
  min_nights: null,
  cta: false,
  ctd: false,
  closed: false,
  note: null,
  source: 'operator',
  ...patch,
});

const stay = (id: string, check_in: string, check_out: string, patch: Partial<BarBooking> = {}): BarBooking => ({
  id,
  status: 'confirmed',
  channel: 'airbnb',
  source: 'ical_import',
  check_in,
  check_out,
  ...patch,
});

describe('buildMonthGrid', () => {
  test('September 2026 starts on a Tuesday and pads to whole weeks', () => {
    const g = buildMonthGrid(2026, 9);
    assert.equal(g.label, 'September 2026');
    assert.equal(g.start, '2026-09-01');
    assert.equal(g.end, '2026-09-30');
    assert.equal(g.gridStart, '2026-08-30'); // the Sunday before
    assert.equal(g.gridEnd, '2026-10-03'); // the Saturday after
    assert.equal(g.cells.length, 35);
    assert.equal(g.weeks.length, 5);
    assert.equal(g.cells[0].inMonth, false);
    assert.equal(g.cells[2].date, '2026-09-01');
    assert.equal(g.cells[2].inMonth, true);
    assert.equal(g.cells[2].weekday, 2);
    assert.equal(g.weeks.every((w) => w.length === 7), true);
  });

  test('a 31-day month starting on Saturday needs six rows; February 2026 needs four', () => {
    assert.equal(buildMonthGrid(2026, 8).weeks.length, 6); // Aug 1 2026 is a Saturday
    assert.equal(buildMonthGrid(2026, 2).weeks.length, 4); // Feb 1 2026 is a Sunday, 28 days
  });

  test('month arithmetic wraps the year', () => {
    assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
    assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
    assert.deepEqual(shiftMonth(2026, 9, -9), { year: 2025, month: 12 });
    assert.deepEqual(parseMonthParam('2026-09'), { year: 2026, month: 9 });
    assert.equal(parseMonthParam('2026-13'), null);
    assert.equal(parseMonthParam('nope'), null);
  });
});

describe('barSegments', () => {
  const range = { start: '2026-09-01', end: '2026-09-30' };

  test('clips a stay to the window and flags the overhang', () => {
    const segs = barSegments(
      [stay('a', '2026-08-30', '2026-09-03'), stay('b', '2026-09-10', '2026-09-12'), stay('c', '2026-09-28', '2026-10-04')],
      range,
    );
    assert.equal(segs.length, 3);
    const [a, b, c] = segs;
    assert.equal(a.startIdx, 0);
    assert.equal(a.endIdx, 2); // nights of Sep 1 and Sep 2
    assert.equal(a.startsBefore, true);
    assert.equal(a.endsAfter, false);
    assert.equal(b.startIdx, 9);
    assert.equal(b.endIdx, 11);
    assert.equal(b.nights, 2);
    assert.equal(c.startIdx, 27);
    assert.equal(c.endIdx, 30); // Sep 28, 29, 30
    assert.equal(c.endsAfter, true);
  });

  test('a checkout on the first day of the window draws nothing; inquiries, cancels and echoes never draw', () => {
    const segs = barSegments(
      [
        stay('out', '2026-08-28', '2026-09-01'),
        stay('inq', '2026-09-05', '2026-09-08', { status: 'inquiry' }),
        stay('canc', '2026-09-05', '2026-09-08', { status: 'cancelled' }),
        stay('echo', '2026-09-05', '2026-09-08', { duplicate_of: 'other' }),
        stay('blk', '2026-09-20', '2026-09-22', { status: 'block', channel: 'block' }),
      ],
      range,
    );
    assert.deepEqual(segs.map((s) => s.booking.id), ['blk']);
  });

  test('splitByRow cuts a bar at the seven-column boundary', () => {
    const [seg] = barSegments([stay('x', '2026-09-05', '2026-09-10')], { start: '2026-08-30', end: '2026-10-03' });
    // Sep 5 is index 6 (Saturday of row 0); nights Sep 5..9 = indices 6..10
    const pieces = splitByRow(seg, 7);
    assert.equal(pieces.length, 2);
    assert.deepEqual(
      pieces.map((p) => ({ row: p.row, col: p.col, span: p.span, prev: p.continuesFromPrevious, next: p.continuesToNext })),
      [
        { row: 0, col: 6, span: 1, prev: false, next: true },
        { row: 1, col: 0, span: 4, prev: true, next: false },
      ],
    );
  });

  test('the bar label prefers the guest, then the code, then the channel; a block reads its kind and note', () => {
    const label = (c: string) => (c === 'airbnb' ? 'Airbnb' : c);
    assert.equal(barLabel(stay('a', '2026-09-01', '2026-09-02', { guest_name: 'Jane Doe' }), label), 'Jane Doe');
    assert.equal(barLabel(stay('a', '2026-09-01', '2026-09-02', { external_confirmation_code: 'HMABC' }), label), 'HMABC');
    assert.equal(barLabel(stay('a', '2026-09-01', '2026-09-02'), label), 'Airbnb');
    assert.equal(
      barLabel(stay('a', '2026-09-01', '2026-09-02', { status: 'block', hold_kind: 'owner', notes: 'July 4' }), label),
      'Owner: July 4',
    );
  });
});

describe('cellPrice', () => {
  test('a helm-run home prices from its plan: override, then weekend, then base', () => {
    // 2026-09-05 is a Saturday.
    assert.deepEqual(cellPrice({ date: '2026-09-05', plan, rateDay: null, calendarAuthority: 'helm' }).cents, 35000);
    assert.deepEqual(cellPrice({ date: '2026-09-02', plan, rateDay: null, calendarAuthority: 'helm' }).cents, 30000);
    const override = cellPrice({ date: '2026-09-05', plan, rateDay: day('2026-09-05', { nightly_cents: 42000, min_nights: 5, cta: true }), calendarAuthority: 'helm' });
    assert.equal(override.cents, 42000);
    assert.equal(override.source, 'helm');
    assert.equal(override.minNights, 5);
    assert.equal(override.cta, true);
  });

  test('a helm-run home with no plan has no price, even when a stale mirror row exists', () => {
    const r = cellPrice({ date: '2026-09-05', plan: null, mirrorDay: { price: 250 }, calendarAuthority: 'helm' });
    assert.equal(r.cents, null);
    assert.equal(r.source, 'none');
  });

  test('a guesty-run home reads the mirror and says so', () => {
    const r = cellPrice({ date: '2026-09-05', plan, mirrorDay: { price: 275, min_nights: 2 }, calendarAuthority: 'guesty' });
    assert.equal(r.cents, 27500);
    assert.equal(r.source, 'guesty_mirror');
    assert.equal(r.minNights, 2);
    assert.equal(cellPrice({ date: '2026-09-05', mirrorDay: null, calendarAuthority: 'guesty' }).source, 'none');
  });
});

describe('freshness', () => {
  const now = Date.parse('2026-09-26T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

  test('imports age on the 2h / 6h lines, pulls on 6h / 24h', () => {
    assert.equal(importFreshness(hoursAgo(1), now), 'fresh');
    assert.equal(importFreshness(hoursAgo(3), now), 'aging');
    assert.equal(importFreshness(hoursAgo(7), now), 'stale');
    assert.equal(importFreshness(null, now), 'never');
    assert.equal(pullFreshness(hoursAgo(3), now), 'fresh');
    assert.equal(pullFreshness(hoursAgo(12), now), 'aging');
    assert.equal(pullFreshness(hoursAgo(30), now), 'stale');
  });

  test('freshnessOf is the worst of the stamps provided; an undefined stamp is not applicable', () => {
    assert.equal(freshnessOf({ lastImportedAt: hoursAgo(1), lastPulledAt: hoursAgo(30), now }), 'stale');
    assert.equal(freshnessOf({ lastImportedAt: hoursAgo(1), lastPulledAt: null, now }), 'never');
    // A guesty-run home: the OTAs read Guesty, not Helm, so no pull is expected.
    assert.equal(freshnessOf({ lastImportedAt: hoursAgo(1), now }), 'fresh');
    assert.equal(freshnessOf({ now }), 'never');
  });
});

describe('sourceGlyph and the authority badge', () => {
  test('each source has its own glyph and a block is a block whatever wrote it', () => {
    assert.equal(sourceGlyph({ source: 'ical_import', status: 'confirmed' }).key, 'ical');
    assert.equal(sourceGlyph({ source: 'manual', status: 'confirmed' }).key, 'manual');
    assert.equal(sourceGlyph({ source: 'direct_booking', status: 'confirmed' }).key, 'direct');
    assert.equal(sourceGlyph({ source: 'guesty_legacy', status: 'completed' }).key, 'legacy');
    assert.equal(sourceGlyph({ source: 'ical_import', status: 'block' }).key, 'block');
    assert.equal(sourceGlyph({ source: 'weird', status: 'confirmed' }).key, 'unknown');
  });

  test('Guesty without feeds, Shadow with a direct feed, Helm since the cutover date', () => {
    assert.equal(authorityBadge({ calendar_authority: 'guesty' }, false).kind, 'guesty');
    assert.equal(authorityBadge({ calendar_authority: 'guesty' }, true).kind, 'shadow');
    const helm = authorityBadge({ calendar_authority: 'helm', cutover_at: '2026-10-01T14:00:00Z' }, true);
    assert.equal(helm.kind, 'helm');
    assert.equal(helm.label, 'Helm since 2026-10-01');
  });
});

describe('unsellableReason', () => {
  const today = '2026-09-26';
  const now = Date.parse('2026-09-26T16:00:00Z'); // noon Eastern

  test('occupancy wins, then the past, closure, season, notice and window', () => {
    assert.equal(unsellableReason({ date: '2026-10-05', today, isStayNight: true, rateDay: day('2026-10-05', { closed: true }), plan, now }), 'stay');
    assert.equal(unsellableReason({ date: '2026-10-05', today, isBlockNight: true, plan, now }), 'block');
    assert.equal(unsellableReason({ date: '2026-09-01', today, plan, now }), 'past');
    assert.equal(unsellableReason({ date: '2026-10-05', today, rateDay: day('2026-10-05', { closed: true }), plan, now }), 'closed');
    assert.equal(unsellableReason({ date: '2026-10-05', today, isOpen: false, plan, now }), 'off_season');
    // Tonight at 4 PM is inside a 24h notice window from noon today.
    assert.equal(unsellableReason({ date: '2026-09-26', today, plan, now }), 'advance_notice');
    assert.equal(unsellableReason({ date: '2027-12-01', today, plan, now }), 'booking_window');
    assert.equal(unsellableReason({ date: '2026-10-05', today, plan, now }), null);
  });

  test('without a plan only occupancy, the past, closure and season apply', () => {
    assert.equal(unsellableReason({ date: '2026-09-26', today, plan: null, now }), null);
    assert.equal(unsellableReason({ date: '2026-09-26', today, plan: null, rateDay: day('2026-09-26', { closed: true }), now }), 'closed');
  });
});
