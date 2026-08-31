/**
 * Revenue snapshot computation. Reads from `guesty_reservations` (already
 * synced via /api/sync-guesty) and `properties`, runs nights-pro-rated
 * revenue math, and returns one row per active property.
 *
 * This mirrors Perfection's `fetchOwnerSnapshots` Edge Function but without
 * the live Guesty pull: Helm syncs reservations into Supabase ahead of time
 * so any range query can be answered from the local table.
 *
 * Key calculation: a stay that straddles the period boundary is pro-rated by
 * nights, so a 6-night stay where 2 nights fall inside the range contributes
 * (host_payout * 2 / 6) to that range's revenue.
 */
import { supabaseAdmin as supabase } from './supabase-admin';
import { selectAllPaged } from './paged-select';
import {
  dayAfter,
  daysInMonth,
  exactCalendarMonth,
  nightsBetween,
} from './revenue-date-range';
import { HISTORICAL_AVG_RECENT } from './forecast-occupancy';
import { loadInstallmentsForCodes, type Installment } from './installments';
import {
  allocateStayByNights,
  loadReconciledStayValues,
  type RevenueBasis,
  type ReconciledStays,
} from './revenue-nights-basis';

const ALLOWED_STATUSES = new Set([
  'confirmed',
  'reserved',
  'checked_in',
  'checked-in',
  'checkedin',
  'checked_out',
  'checked-out',
  'checkedout',
  'closed',
]);

const FORWARD_EXCLUDED = new Set(['cancelled', 'canceled', 'inquiry', 'declined', 'expired']);

/**
 * Channel mix. Four buckets, matching the statement page's chLabel():
 * Airbnb, VRBO (HomeAway), Booking.com, and Stay Cape Ann (Guesty's
 * Direct/Manual channel -- RT's own direct-booking brand).
 */
export const CHANNELS = ['airbnb', 'vrbo', 'booking', 'sca'] as const;
export type ChannelKey = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<ChannelKey, string> = {
  airbnb: 'Airbnb',
  vrbo: 'VRBO',
  booking: 'Booking.com',
  sca: 'Stay Cape Ann',
};

export type ChannelAgg = { revenue: number; stays: number; nights: number };
export type ChannelMix = Record<ChannelKey, ChannelAgg>;

export function emptyChannelMix(): ChannelMix {
  return {
    airbnb: { revenue: 0, stays: 0, nights: 0 },
    vrbo: { revenue: 0, stays: 0, nights: 0 },
    booking: { revenue: 0, stays: 0, nights: 0 },
    sca: { revenue: 0, stays: 0, nights: 0 },
  };
}

/**
 * Accepts both guesty_reservations.channel values (Airbnb, VRBO,
 * Booking.com, Direct) and statements-module reservations.platform values
 * (Airbnb, HomeAway, Booking.com, Manual), plus the raw Guesty ids
 * (airbnb2, homeaway2, bookingCom, manual) for safety. Unknown / empty
 * falls to 'sca', matching channelFromGuesty's Direct default.
 */
function normalizeChannel(raw: string | null | undefined): ChannelKey {
  const c = (raw || '').toLowerCase();
  if (c.startsWith('airbnb')) return 'airbnb';
  if (c.startsWith('homeaway') || c === 'vrbo') return 'vrbo';
  if (c.startsWith('booking')) return 'booking';
  return 'sca';
}

function addToMix(
  mix: ChannelMix,
  ch: ChannelKey,
  revenue: number,
  nights: number,
  stays: number,
): void {
  mix[ch].revenue += revenue;
  mix[ch].nights += nights;
  mix[ch].stays += stays;
}

/** Add src into target. revenueFactor scales revenue only (pacing multiplies
 * revenue, never stays/nights -- mirrors the headline metric treatment). */
function mergeMix(target: ChannelMix, src: ChannelMix, revenueFactor = 1): void {
  for (const ch of CHANNELS) {
    target[ch].revenue += src[ch].revenue * revenueFactor;
    target[ch].nights += src[ch].nights;
    target[ch].stays += src[ch].stays;
  }
}

function roundMix(mix: ChannelMix): ChannelMix {
  for (const ch of CHANNELS) mix[ch].revenue = round2(mix[ch].revenue);
  return mix;
}

export type PropertyRevenueMetrics = {
  staysCount: number;
  nightsSold: number;
  totalRevenue: number | null;
  ADR: number | null;
  /**
   * Physical calendar occupancy: nights actually occupied within the range
   * over bookable nights. Unlike the money metrics (checkout-attributed,
   * Statement methodology), a stay straddling month-end counts its in-range
   * nights here even though its revenue belongs to the checkout month.
   */
  occupancyPct: number | null;
  managementFee: number | null;
  cleaningCost: number | null;
  projectedOwnerPayout: number | null;
};

/**
 * Where this property's numbers came from for the requested range.
 *
 *   'statement' - we found a closed `property_statements` row for this
 *                 calendar month; the metrics are the Statement values
 *                 (canonical for closed months).
 *   'pacing'    - the requested range is the current calendar month; the
 *                 metrics combine booked-so-far with a portfolio pacing
 *                 multiplier that projects toward historical Gloucester
 *                 occupancy for this month-of-year.
 *   'computed'  - pro-rated from guesty_reservations only (used for
 *                 non-month-aligned ranges, future months, or months
 *                 without a Statement yet).
 */
export type SnapshotSource = 'statement' | 'pacing' | 'booked' | 'computed';

export type PacingInfo = {
  /** Portfolio pacing (booked nights / nights possible) as 0-100. */
  pacingPct: number;
  /** Historical Gloucester avg for this month-of-year as 0-100. */
  historicalAvgPct: number;
  /** historicalAvgPct / pacingPct, floored at 1. Applied to revenue. */
  multiplier: number;
  /** YYYY-MM key the pacing applies to. */
  month: string;
};

export type PropertySnapshot = {
  propertyId: string;
  propertyName: string;
  propertyCode: string | null;
  guestyListingId: string | null;
  isRisingTideOwned: boolean;
  metrics: PropertyRevenueMetrics;
  turnoversNext30: number;
  /** Where the metrics came from. */
  source: SnapshotSource;
  /**
   * Revenue / stays / nights split by booking channel. Follows the same
   * per-month layering as the headline metrics: closed statement months
   * use the statement's own reservation rows (exact), pacing months scale
   * revenue by the month multiplier, everything else is booked actuals.
   */
  channelMix: ChannelMix;
};

export type SnapshotsResponse = {
  rangeStart: string;
  rangeEnd: string;
  snapshots: PropertySnapshot[];
  portfolio: PortfolioTotals;
  /** Portfolio-wide channel mix (sum of every property's channelMix). */
  channelMix: ChannelMix;
  /** Set when the entire range is the current calendar month. */
  pacing: PacingInfo | null;
};

export type PortfolioTotals = {
  propertyCount: number;
  totalStays: number;
  totalNights: number;
  totalRevenue: number;
  totalPayout: number;
  totalManagementFee: number;
  totalPortfolioRevenue: number; // owner payout from RT-owned properties
  avgADR: number | null;
  avgOccupancy: number | null;
};

type PropertyRow = {
  id: string;
  name: string;
  nickname: string | null;
  code: string | null;
  guesty_listing_id: string | null;
  activated_at: string | null;
  cleaning_cost_estimate: number | null;
  management_fee_pct: number;
  is_rising_tide_owned: boolean;
  is_active: boolean;
};

type ReservationRow = {
  property_id: string | null;
  listing_id: string | null;
  confirmation_code: string | null;
  check_in: string | null;
  check_out: string | null;
  status: string | null;
  channel: string | null;
  host_payout: number | null;
  owner_net_revenue_guesty: number | null;
  total_paid: number | null;
};

/**
 * Resolve the per-stay GROSS payout (the figure that gets split into
 * management fee + owner payout, before cleaning is deducted).
 *
 *   `host_payout`               - already gross. Use as-is.
 *   `owner_net_revenue_guesty`  - already NET of management fee per Guesty's
 *                                 accounting export. Back it out by
 *                                 dividing by (1 - mgmtFraction).
 *   `total_paid`                - what the guest paid; for past months in our
 *                                 data this matches stmt rental_revenue
 *                                 exactly (17_beach_rd, 20_hammond,
 *                                 3_south_st all reconcile to the cent).
 *
 * Verified against Helm's Statement reconciliation: 17_beach_rd at 22% has
 * owner_net $717.10 and stmt rental_revenue $919.36 (= 717.10 / 0.78);
 * 20_hammond at 25% has owner_net $2980.02 and rental_revenue $3973.36
 * (= 2980.02 / 0.75).
 */
function resolveGrossPayout(r: ReservationRow, mgmtFraction: number): number {
  const hp = Number(r.host_payout ?? 0);
  if (hp > 0) return hp;
  const own = Number(r.owner_net_revenue_guesty ?? 0);
  if (own > 0) {
    if (mgmtFraction <= 0 || mgmtFraction >= 1) return own;
    return own / (1 - mgmtFraction);
  }
  const tp = Number(r.total_paid ?? 0);
  if (tp > 0) return tp;
  return 0;
}

function effectiveStart(rangeStart: string, activatedAt: string | null): string {
  if (!activatedAt) return rangeStart;
  const d = new Date(activatedAt).toISOString().split('T')[0];
  return d > rangeStart ? d : rangeStart;
}

function normalizeStatus(s: string | null): string {
  return (s || '').toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
}

/**
 * Collapse duplicate reservations that represent the same stay. Guesty
 * sometimes ends up with two rows for one booking — a CSV-ingested row +
 * an API-synced row, a modification where the new reservation_id didn't
 * replace the old one, etc. They share (property_id, check_in, check_out)
 * but have different guesty_reservation_id, so the upsert doesn't catch
 * them. Verified case: 20 Hammond / Catherine Stevens May 28 - Jun 1.
 *
 * Keep the row with the largest non-null payout signal (host_payout |
 * owner_net_revenue_guesty | total_paid) — it's the one with the most
 * complete money data.
 */
function dedupeReservations(rows: ReservationRow[]): ReservationRow[] {
  const payoutSignal = (r: ReservationRow): number =>
    Math.max(
      Number(r.host_payout ?? 0),
      Number(r.owner_net_revenue_guesty ?? 0),
      Number(r.total_paid ?? 0),
    );
  // Tie-break must be deterministic, not first-seen. The reservation read is
  // paged now, so input order is a function of the OFFSET windows rather than
  // of the heap, and a first-seen winner would make the result depend on
  // where a page boundary happened to fall. Eight (property, check_in,
  // check_out) groups currently tie; all of them tie at a payout signal of 0
  // and carry identical consumed fields, so no money moves either way today.
  // One of them (21 Horton, 2026-08-08 to 08-22) does carry two different
  // confirmation codes, and a code is what a reconciled statement value is
  // looked up by, so leaving this to chance would be a live hazard the
  // moment anything keys off the code.
  const better = (a: ReservationRow, b: ReservationRow): boolean => {
    const sa = payoutSignal(a);
    const sb = payoutSignal(b);
    if (sa !== sb) return sa > sb;
    // Equal money: prefer a row that has a confirmation code, then the
    // lexicographically smaller one. Total order, no ties left.
    const ca = a.confirmation_code ?? '';
    const cb = b.confirmation_code ?? '';
    if (!!ca !== !!cb) return !!ca;
    return ca < cb;
  };
  const byKey = new Map<string, ReservationRow>();
  for (const r of rows) {
    const key = `${r.property_id ?? ''}|${r.check_in ?? ''}|${r.check_out ?? ''}`;
    const cur = byKey.get(key);
    if (!cur || better(r, cur)) byKey.set(key, r);
  }
  return Array.from(byKey.values());
}

function isAllowed(status: string | null): boolean {
  const n = normalizeStatus(status);
  return (
    ALLOWED_STATUSES.has(n) ||
    n.includes('confirmed') ||
    n.includes('checked') ||
    n.includes('closed')
  );
}

function ymd(d: Date): string {
  return d.toISOString().split('T')[0];
}

function monthKey(year: number, monthZeroIndexed: number): string {
  return `${year}-${String(monthZeroIndexed + 1).padStart(2, '0')}`;
}

/**
 * Per-property month-segmented contributions, accumulated during the base
 * pro-rated loop. Used by applyStatementsAndPacing to replace closed-month
 * portions with Statement values and apply per-month pacing multipliers.
 */
type PropertyMonthBuckets = {
  /** Revenue from stays whose checkout is in the given YYYY-MM. */
  revenueByMonth: Map<string, number>;
  /** Full stay-nights from stays whose checkout is in the given YYYY-MM. */
  nightsByMonth: Map<string, number>;
  /** Count of stays checking out in the given YYYY-MM. */
  staysByMonth: Map<string, number>;
  /** Cleaning charges for stays checking out in the given YYYY-MM. */
  cleaningByMonth: Map<string, number>;
  /**
   * Physical nights this property was occupied in the given YYYY-MM
   * (calendar attribution). Used as the pacing %'s numerator; NOT used
   * for revenue or any money metric.
   */
  calendarNightsByMonth: Map<string, number>;
  /**
   * Physical nights occupied within the requested range (calendar
   * attribution, clipped to the range and activation date). Numerator for
   * the displayed occupancy % — occupancy is a physical question, so it
   * uses calendar nights even though money stays checkout-attributed.
   */
  calendarNightsInRange: number;
  /**
   * Nights blocked by zero-payout reservations (owner stays, holds,
   * cancelled-but-not-deleted rows). These represent inventory that's
   * unavailable to guests, so they should be subtracted from the
   * denominator of occupancy and pacing, not just ignored.
   */
  blockedNightsByMonth: Map<string, number>;
  /**
   * Channel split of the checkout-attributed money metrics, per month.
   * Mirrors revenueByMonth / nightsByMonth / staysByMonth so the post-pass
   * can swap closed statement months and scale pacing months per channel.
   */
  channelByMonth: Map<string, ChannelMix>;
};

/**
 * Iterate the YYYY-MM month keys touched by [rangeStart, rangeEndInclusive].
 * Returns each month with its in-range segment (segStart/segEnd) and whether
 * that segment fully covers the calendar month.
 */
function monthSegments(rangeStart: string, rangeEndInclusive: string): Array<{
  monthKey: string;
  year: number;
  month: number; // 0-indexed
  segStart: string;
  segEndExclusive: string;
  fullMonth: boolean;
}> {
  const out: Array<{
    monthKey: string;
    year: number;
    month: number;
    segStart: string;
    segEndExclusive: string;
    fullMonth: boolean;
  }> = [];
  const periodEndExclusive = dayAfter(rangeEndInclusive);
  let cursor = rangeStart;
  while (cursor < periodEndExclusive) {
    const cy = parseInt(cursor.slice(0, 4), 10);
    const cm = parseInt(cursor.slice(5, 7), 10) - 1;
    const monthStart = ymd(new Date(Date.UTC(cy, cm, 1)));
    const monthEndExclusive = ymd(new Date(Date.UTC(cy, cm + 1, 1)));
    const segStart = cursor;
    const segEndExclusive =
      periodEndExclusive < monthEndExclusive ? periodEndExclusive : monthEndExclusive;
    out.push({
      monthKey: monthKey(cy, cm),
      year: cy,
      month: cm,
      segStart,
      segEndExclusive,
      fullMonth: segStart === monthStart && segEndExclusive === monthEndExclusive,
    });
    cursor = monthEndExclusive;
  }
  return out;
}

export type SnapshotOptions = {
  /**
   * Whether to apply the pacing multiplier to the current month's revenue.
   * Defaults to true (projects toward historical occupancy benchmark). Set
   * false when the user explicitly wants to see booked-so-far actuals.
   * Has no effect on closed months (Statement override always applies) or
   * non-month-aligned ranges (multiplier isn't computed at all).
   */
  applyPacing?: boolean;
  /**
   * Which month a dollar is recognized in. 'checkout' (the default, and the
   * owner-statement methodology) puts a stay's whole value in its checkout
   * month. 'nights' spreads it across the months its nights fall in.
   * Display only: nothing here writes, and owner payouts always follow
   * checkout.
   */
  basis?: RevenueBasis;
};

export async function computeRevenueSnapshot(
  rangeStart: string,
  rangeEnd: string,
  options: SnapshotOptions = {},
): Promise<SnapshotsResponse> {
  const applyPacing = options.applyPacing !== false;
  const basis: RevenueBasis = options.basis === 'nights' ? 'nights' : 'checkout';
  // 1. Properties (active only, with the fields we need for the math).
  const { data: propsData, error: propsErr } = await supabase
    .from('properties')
    .select('id, name, nickname, code, guesty_listing_id, activated_at, cleaning_cost_estimate, management_fee_pct, is_rising_tide_owned, is_active')
    .eq('is_active', true)
    .order('name');

  if (propsErr) {
    throw new Error(`Failed to load properties: ${propsErr.message}`);
  }

  const properties = (propsData ?? []) as PropertyRow[];

  // 1b. Cleaning-cost-per-stay estimate per property. Used for any month
  //     without a closed Statement (closed months use the Statement's
  //     actual cleaning_total). Derive from the most recent 3 closed
  //     Statements that had at least one stay, weighted by stays:
  //         estimate = sum(cleaning_total) / sum(num_stays)  over last 3
  //     So a property with 4 stays @ $200 cleaning each + 2 stays @ $250
  //     (over 2 months) reads $214/stay, not the simple month-average.
  //
  //     Stored properties.cleaning_cost_estimate stays as a manual
  //     override fallback if the property has no Statement history yet.
  const sixMoAgo = new Date();
  sixMoAgo.setMonth(sixMoAgo.getMonth() - 6);
  const sinceMonthKey = `${sixMoAgo.getFullYear()}-${String(sixMoAgo.getMonth() + 1).padStart(2, '0')}`;

  // `month` lives on statement_periods (joined via period_id), not on
  // property_statements. Resolve periods first, then pull statements for
  // those periods and re-key by month in JS.
  const { data: histPeriods } = await supabase
    .from('statement_periods')
    .select('id, month')
    .gte('month', sinceMonthKey);
  const histMonthByPeriod = new Map<string, string>(
    ((histPeriods ?? []) as Array<{ id: string; month: string }>).map((p) => [p.id, p.month]),
  );

  type HistStmt = { month: string; cleaning: number; stays: number };
  const histByProperty = new Map<string, HistStmt[]>();

  if (histMonthByPeriod.size > 0) {
    const { data: histStmts } = await supabase
      .from('property_statements')
      .select('period_id, property_id, num_stays, cleaning_total')
      .in('period_id', Array.from(histMonthByPeriod.keys()));

    for (const row of (histStmts ?? []) as Array<{
      period_id: string;
      property_id: string | null;
      num_stays: number | null;
      cleaning_total: number | null;
    }>) {
      if (!row.property_id || !row.num_stays || row.num_stays <= 0) continue;
      const month = histMonthByPeriod.get(row.period_id);
      if (!month) continue;
      const arr = histByProperty.get(row.property_id) ?? [];
      arr.push({
        month,
        cleaning: Number(row.cleaning_total ?? 0),
        stays: Number(row.num_stays),
      });
      histByProperty.set(row.property_id, arr);
    }
  }

  const cleaningEstimateByProperty = new Map<string, number>();
  for (const [propId, stmts] of histByProperty.entries()) {
    const recent3 = stmts
      .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0))
      .slice(0, 3);
    const totalC = recent3.reduce((s, r) => s + r.cleaning, 0);
    const totalS = recent3.reduce((s, r) => s + r.stays, 0);
    if (totalS > 0) cleaningEstimateByProperty.set(propId, totalC / totalS);
  }

  // 2. Reservations overlapping the period:
  //    overlap iff (check_in < periodEndExclusive) AND (check_out > periodStart).
  const periodEndExclusive = dayAfter(rangeEnd);

  // Paged, not a bare select. A full-year 2026 overlap already returns 745
  // rows against PostgREST's silent 1000-row cap, and the page issues this
  // query twice (current range + prior range) whose truncation points would
  // not even agree. A short read here does not error, it just quietly drops
  // reservations, which reads as "the revenue numbers are wrong".
  // .order('id') is mandatory: range() is an OFFSET window, so an unstable
  // sort lets pages overlap or skip rows.
  let resData: ReservationRow[];
  try {
    resData = await selectAllPaged<ReservationRow>(
      (from, to) =>
        supabase
          .from('guesty_reservations')
          .select('property_id, listing_id, confirmation_code, check_in, check_out, status, channel, host_payout, owner_net_revenue_guesty, total_paid')
          .lt('check_in', periodEndExclusive)
          .gt('check_out', rangeStart)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'revenue snapshot reservations' },
    );
  } catch (err) {
    throw new Error(`Failed to load reservations: ${err instanceof Error ? err.message : String(err)}`);
  }

  const reservations = dedupeReservations(
    ((resData ?? []) as ReservationRow[]).filter(
      (r) => r.check_in && r.check_out && isAllowed(r.status),
    ),
  );

  // Cross-month installment splits for any fetched booking. A split booking
  // is allocated to its months per the operator-entered slices (matching the
  // Statements module) instead of checkout attribution -- one batched query,
  // empty map when the table doesn't exist yet.
  const installmentsByCode = await loadInstallmentsForCodes(
    supabase,
    reservations.map((r) => r.confirmation_code || ''),
  );

  // Nights basis only: the reconciled dollar figure per stay, so a closed
  // month keeps its Stripe actuals and operator corrections instead of
  // reverting to Guesty gross. The checkout basis gets this from the monthly
  // statement swap in applyStatementsAndPacing, which cannot work here
  // because a monthly scalar does not say which nights its dollars belong to.
  const reconciled: ReconciledStays =
    basis === 'nights'
      ? await loadReconciledStayValues(
          supabase,
          rangeStart,
          periodEndExclusive,
          new Set(reservations.map((r) => r.confirmation_code || '').filter(Boolean)),
          new Set(installmentsByCode.keys()),
          selectAllPaged,
        )
      : { byCode: new Map(), orphansByProperty: new Map(), degraded: false };

  // 3. Forward reservations: today through +30d, count turnovers per property.
  const today = new Date().toISOString().split('T')[0];
  const thirty = new Date();
  thirty.setDate(thirty.getDate() + 30);
  const thirtyEnd = thirty.toISOString().split('T')[0];

  // Forward turnover count reads from the Helm-native bookings table (dates
  // only -- the money-bearing query above still reads guesty_reservations
  // until the accounting cutover). Canonical confirmed/completed stays only.
  const { data: fwdData } = await supabase
    .from('bookings')
    .select('property_id, check_in, check_out, status')
    .in('status', ['confirmed', 'completed'])
    .is('duplicate_of', null)
    .lt('check_in', dayAfter(thirtyEnd))
    .gt('check_out', today);

  const forwardCountByProperty = new Map<string, number>();
  for (const r of (fwdData ?? []) as ReservationRow[]) {
    if (!r.property_id || !r.check_in || !r.check_out) continue;
    if (FORWARD_EXCLUDED.has(normalizeStatus(r.status))) continue;
    forwardCountByProperty.set(r.property_id, (forwardCountByProperty.get(r.property_id) ?? 0) + 1);
  }

  // 4. Bucket reservations by property.
  const resByProperty = new Map<string, ReservationRow[]>();
  for (const r of reservations) {
    if (!r.property_id) continue;
    const arr = resByProperty.get(r.property_id) ?? [];
    arr.push(r);
    resByProperty.set(r.property_id, arr);
  }

  // 4b. Calendar-driven blocks (seasonal closures, manual date blocks in
  //     Guesty). Bucketed by property + YYYY-MM so the per-property loop
  //     can seed blockedNightsByMonth with them alongside owner-stay
  //     reservations. Synced into property_calendar_blocks by
  //     /api/sync-guesty.
  // Paged for the same reason. One row per blocked DAY, so a seasonal
  // closure is ~180 rows a year on its own: 16 Waterman going dark every
  // November through April puts this on the same path as the reservation
  // read. It feeds the occupancy and pacing denominators, so a short read
  // would inflate both.
  let blockData: Array<{ property_id: string | null; date: string | null }> = [];
  try {
    blockData = await selectAllPaged<{ property_id: string | null; date: string | null }>(
      (from, to) =>
        supabase
          .from('property_calendar_blocks')
          .select('property_id, date')
          .gte('date', rangeStart)
          .lte('date', rangeEnd)
          // No surrogate id on this table; (property_id, date) is its
          // natural key and both columns are NOT NULL, so this is a stable
          // total order for the OFFSET window.
          .order('property_id', { ascending: true })
          .order('date', { ascending: true })
          .range(from, to),
      { label: 'revenue snapshot calendar blocks' },
    );
  } catch {
    blockData = []; // non-fatal: blocks only refine the denominator
  }
  const calendarBlocksByProperty = new Map<string, Map<string, number>>();
  for (const row of (blockData ?? []) as { property_id: string | null; date: string | null }[]) {
    if (!row.property_id || !row.date) continue;
    const mKey = row.date.slice(0, 7); // YYYY-MM
    let m = calendarBlocksByProperty.get(row.property_id);
    if (!m) {
      m = new Map();
      calendarBlocksByProperty.set(row.property_id, m);
    }
    m.set(mKey, (m.get(mKey) ?? 0) + 1);
  }

  // 5. Per-property pro-rated math. Each property also accumulates per-month
  //    buckets (revenue/nights/stays/cleaning) so the post-pass layer can
  //    override closed months with Statement values and apply per-month
  //    pacing multipliers for current/future months.
  const totalNightsInPeriod = nightsBetween(rangeStart, periodEndExclusive);
  const monthBucketsByProperty = new Map<string, PropertyMonthBuckets>();

  const baseSnapshots: PropertySnapshot[] = properties.map((prop) => {
    const propStart = effectiveStart(rangeStart, prop.activated_at);
    const skipped = propStart >= periodEndExclusive;

    const empty: PropertyRevenueMetrics = {
      staysCount: 0,
      nightsSold: 0,
      totalRevenue: null,
      ADR: null,
      occupancyPct: skipped ? null : 0,
      managementFee: null,
      cleaningCost: null,
      projectedOwnerPayout: null,
    };

    if (skipped) {
      return {
        propertyId: prop.id,
        propertyName: prop.nickname || prop.name,
        propertyCode: prop.code,
        guestyListingId: prop.guesty_listing_id,
        isRisingTideOwned: prop.is_rising_tide_owned,
        metrics: empty,
        turnoversNext30: forwardCountByProperty.get(prop.id) ?? 0,
        source: 'computed',
        channelMix: emptyChannelMix(),
      };
    }

    const propReservations = resByProperty.get(prop.id) ?? [];

    let nightsSold = 0;
    let totalRevenue = 0;
    let staysCount = 0;
    let cleaningCost = 0;
    // Per-stay cleaning estimate. Prefer the rolling 3-month historical
    // average from Statements (computed once above). Fall back to the
    // manually-entered properties.cleaning_cost_estimate if the property
    // has no Statement history yet (e.g. newly onboarded).
    const cleaningPerStay =
      cleaningEstimateByProperty.get(prop.id) ?? Number(prop.cleaning_cost_estimate ?? 0);
    // properties.management_fee_pct stored as percent (e.g. 25 = 25%).
    const mgmtFeeFraction = prop.is_rising_tide_owned ? 0 : Number(prop.management_fee_pct) / 100;

    // Per-month accounting, keyed by checkout month (Statement methodology).
    // A stay is recognized in its checkout month — entire revenue, all stay
    // nights, the 1 staysCount, the cleaning. Matches how the Statements
    // module accrues monthly totals and how owners read their statements.
    //
    // Example: an Apr 15 -> May 1 stay attributes ALL its revenue/nights to
    // May, not pro-rated across April and May.
    const revenueByMonth = new Map<string, number>();
    const nightsByMonth = new Map<string, number>();
    const staysByMonth = new Map<string, number>();
    const cleaningByMonth = new Map<string, number>();
    const channelByMonth = new Map<string, ChannelMix>();
    const channelBucket = (mKey: string): ChannelMix => {
      let m = channelByMonth.get(mKey);
      if (!m) {
        m = emptyChannelMix();
        channelByMonth.set(mKey, m);
      }
      return m;
    };

    // Calendar-attributed nights, kept separately from the checkout-
    // attributed money metrics. Pacing % and the displayed occupancy % are
    // physical-occupancy questions ("what fraction of nights in this month
    // are booked"), so they stay calendar-based even though the money
    // metrics use checkout attribution.
    const calendarNightsByMonth = new Map<string, number>();
    let calendarNightsInRange = 0;
    // Unavailable nights bucketed by month. Sources:
    //   (1) Calendar-driven blocks (Guesty calendar status='blocked'):
    //       seasonal closures, manual date blocks. Seeded here.
    //   (2) Zero-payout reservations (owner stays, holds): added below
    //       inside the reservation loop.
    // Used to reduce the denominator of occupancy and pacing — these
    // nights aren't unsold inventory, they're unavailable.
    const blockedNightsByMonth = new Map<string, number>();
    const calBlocks = calendarBlocksByProperty.get(prop.id);
    if (calBlocks) {
      for (const [mKey, count] of calBlocks.entries()) {
        blockedNightsByMonth.set(mKey, (blockedNightsByMonth.get(mKey) ?? 0) + count);
      }
    }

    for (const r of propReservations) {
      const checkIn = r.check_in!;
      const checkOut = r.check_out!;
      const totalNights = nightsBetween(checkIn, checkOut);
      if (totalNights <= 0) continue;

      const fullPayout = resolveGrossPayout(r, mgmtFeeFraction);
      // Operator-entered cross-month split for this booking, if any.
      const instRows = r.confirmation_code ? installmentsByCode.get(r.confirmation_code) : undefined;
      const hasInstallments = !!instRows && instRows.length > 0;

      // Zero-payout rows are owner blocks, holds, or cancelled rows that
      // linger in guesty_reservations. They don't count toward
      // stays/nights/revenue, but the nights they occupy are unavailable —
      // bucket them per month so we can subtract from the denominator.
      // (A split booking is real revenue even when the guesty_reservations
      // money fields are empty -- e.g. an SCA stay paid through RT's Stripe
      // -- so installment bookings never take this branch.)
      if (fullPayout <= 0 && !hasInstallments) {
        const blockedStart = checkIn > propStart ? checkIn : propStart;
        const blockedEnd = checkOut < periodEndExclusive ? checkOut : periodEndExclusive;
        let cursor = blockedStart;
        while (cursor < blockedEnd) {
          const cy = parseInt(cursor.slice(0, 4), 10);
          const cm = parseInt(cursor.slice(5, 7), 10) - 1;
          const monthEndExclusive = ymd(new Date(Date.UTC(cy, cm + 1, 1)));
          const segEnd = monthEndExclusive < blockedEnd ? monthEndExclusive : blockedEnd;
          const segNights = nightsBetween(cursor, segEnd);
          if (segNights > 0) {
            const k = monthKey(cy, cm);
            blockedNightsByMonth.set(k, (blockedNightsByMonth.get(k) ?? 0) + segNights);
          }
          cursor = monthEndExclusive;
        }
        // Nights basis only: a zero-payout Guesty row can still carry real
        // statement money. This is the standard SCA-direct path, where the
        // guest pays through the property's own Stripe and Guesty never sees
        // the money (CLAUDE.md, "staycapeann.com direct bookings"). Sixteen
        // such stays carry $31,466.88 of adjusted_revenue today. The gate
        // above and the blocked-nights walk are deliberately untouched, so
        // occupancy and pacing stay byte-identical across the two bases.
        if (basis === 'nights') {
          const zCode = r.confirmation_code || '';
          const zValue = zCode ? reconciled.byCode.get(zCode) ?? 0 : 0;
          if (zValue > 0) {
            const zCh = normalizeChannel(r.channel);
            const zCoMonth = checkOut.slice(0, 7);
            for (const b of allocateStayByNights({
              checkIn, checkOut, value: zValue, propStart, rangeStart, periodEndExclusive,
            })) {
              totalRevenue += b.revenue;
              nightsSold += b.nights;
              revenueByMonth.set(b.month, (revenueByMonth.get(b.month) ?? 0) + b.revenue);
              nightsByMonth.set(b.month, (nightsByMonth.get(b.month) ?? 0) + b.nights);
              addToMix(channelBucket(b.month), zCh, b.revenue, b.nights, b.month === zCoMonth ? 1 : 0);
            }
            if (checkOut > rangeStart && checkOut <= periodEndExclusive) {
              staysCount += 1;
              cleaningCost += cleaningPerStay;
              staysByMonth.set(zCoMonth, (staysByMonth.get(zCoMonth) ?? 0) + 1);
              cleaningByMonth.set(zCoMonth, (cleaningByMonth.get(zCoMonth) ?? 0) + cleaningPerStay);
            }
          }
        }
        continue;
      }

      // Physical-occupancy bookkeeping: walk the calendar months this stay
      // physically occupies, regardless of where the checkout falls.
      {
        const physicalStart = checkIn > propStart ? checkIn : propStart;
        const physicalEnd = checkOut;
        // Occupancy numerator: only the nights inside the requested range.
        const inRangeEnd = physicalEnd < periodEndExclusive ? physicalEnd : periodEndExclusive;
        if (physicalStart < inRangeEnd) {
          calendarNightsInRange += nightsBetween(physicalStart, inRangeEnd);
        }
        let cursor = physicalStart;
        while (cursor < physicalEnd) {
          const cy = parseInt(cursor.slice(0, 4), 10);
          const cm = parseInt(cursor.slice(5, 7), 10) - 1;
          const monthEndExclusive = ymd(new Date(Date.UTC(cy, cm + 1, 1)));
          const segEnd = monthEndExclusive < physicalEnd ? monthEndExclusive : physicalEnd;
          const segNights = nightsBetween(cursor, segEnd);
          if (segNights > 0) {
            const k = monthKey(cy, cm);
            calendarNightsByMonth.set(k, (calendarNightsByMonth.get(k) ?? 0) + segNights);
          }
          cursor = monthEndExclusive;
        }
      }

      // ── Installment fork ──────────────────────────────────────────────
      // A split booking is allocated to its months per the operator's
      // reservation_installments slices -- the SAME allocation the
      // Statements module uses -- instead of whole-value checkout
      // attribution. Each in-range month gets its slice's revenue + nights;
      // the stay itself (1 staysCount + cleaning) is counted once, in the
      // final (checkout) month, mirroring statements' num_stays. A slice is
      // "recognized" at the END of its month so the same range window as
      // checkout attribution applies. installment_revenue is the
      // post-Stripe-fee, pre-mgmt-fee month slice -- the number that
      // month's owner statement recognizes (closed months are later
      // overridden by the actual statement in applyStatementsAndPacing
      // anyway, so this only ever shows on open/future months).
      // The `continue` below is the double-count guard: a split booking
      // NEVER also checkout-attributes its full value.
      if (hasInstallments) {
        if (prop.activated_at && prop.activated_at.slice(0, 10) > checkOut) continue;
        const instChannel = normalizeChannel(r.channel);
        for (const slice of instRows as Installment[]) {
          const [sy, sm] = slice.month.split('-').map(Number);
          if (!sy || !sm) continue;
          const sliceEnd = ymd(new Date(Date.UTC(sy, sm, 0))); // last day of slice month
          if (sliceEnd <= rangeStart || sliceEnd > periodEndExclusive) continue;
          const sliceRev = Number(slice.installment_revenue) || 0;
          const sliceNights = Number(slice.installment_nights) || 0;
          totalRevenue += sliceRev;
          nightsSold += sliceNights;
          revenueByMonth.set(slice.month, (revenueByMonth.get(slice.month) ?? 0) + sliceRev);
          nightsByMonth.set(slice.month, (nightsByMonth.get(slice.month) ?? 0) + sliceNights);
          addToMix(channelBucket(slice.month), instChannel, sliceRev, sliceNights, slice.is_final_month ? 1 : 0);
          if (slice.is_final_month) {
            staysCount += 1;
            cleaningCost += cleaningPerStay;
            staysByMonth.set(slice.month, (staysByMonth.get(slice.month) ?? 0) + 1);
            cleaningByMonth.set(slice.month, (cleaningByMonth.get(slice.month) ?? 0) + cleaningPerStay);
          }
        }
        continue;
      }

      // ── Nights fork ───────────────────────────────────────────────────
      // Money follows the nights. The stay itself and its cleaning still
      // anchor to the checkout month below, because a turnover happens once,
      // at an instant: one cleaner, one visit, one ACH. Accrue what accrues,
      // anchor what happens once.
      if (basis === 'nights') {
        // Same all-or-nothing activation guard as the checkout branch.
        if (prop.activated_at && prop.activated_at.slice(0, 10) > checkOut) continue;
        // Reconciled statement dollars where the stay has them, Guesty gross
        // otherwise. Either way it is a REDISTRIBUTION of the value the
        // checkout basis would have used, never a re-derivation.
        const code = r.confirmation_code || '';
        const value = (code && reconciled.byCode.get(code)) || fullPayout;
        const ch = normalizeChannel(r.channel);
        const coMonth = checkOut.slice(0, 7);
        for (const b of allocateStayByNights({
          checkIn, checkOut, value, propStart, rangeStart, periodEndExclusive,
        })) {
          totalRevenue += b.revenue;
          nightsSold += b.nights;
          revenueByMonth.set(b.month, (revenueByMonth.get(b.month) ?? 0) + b.revenue);
          nightsByMonth.set(b.month, (nightsByMonth.get(b.month) ?? 0) + b.nights);
          // The stay counts once, on its checkout month, exactly as the
          // installment fork does with is_final_month.
          addToMix(channelBucket(b.month), ch, b.revenue, b.nights, b.month === coMonth ? 1 : 0);
        }
        // Stays and cleaning keep checkout attribution, so they stay
        // byte-identical across the two bases. Same gate as below.
        if (checkOut > rangeStart && checkOut <= periodEndExclusive) {
          staysCount += 1;
          cleaningCost += cleaningPerStay;
          staysByMonth.set(coMonth, (staysByMonth.get(coMonth) ?? 0) + 1);
          cleaningByMonth.set(coMonth, (cleaningByMonth.get(coMonth) ?? 0) + cleaningPerStay);
        }
        continue;
      }

      // Statement methodology: revenue is recognized at checkout. If the
      // checkout falls in the requested range, the full stay's value
      // counts; otherwise the stay belongs to a different month's revenue
      // and shows up on that month's Statement.
      if (checkOut <= rangeStart || checkOut > periodEndExclusive) continue;
      // Don't recognize stays that pre-date this property's activation.
      if (prop.activated_at && prop.activated_at.slice(0, 10) > checkOut) continue;

      totalRevenue += fullPayout;
      nightsSold += totalNights;
      staysCount += 1;
      cleaningCost += cleaningPerStay;

      const coKey = checkOut.slice(0, 7); // YYYY-MM
      revenueByMonth.set(coKey, (revenueByMonth.get(coKey) ?? 0) + fullPayout);
      nightsByMonth.set(coKey, (nightsByMonth.get(coKey) ?? 0) + totalNights);
      staysByMonth.set(coKey, (staysByMonth.get(coKey) ?? 0) + 1);
      cleaningByMonth.set(coKey, (cleaningByMonth.get(coKey) ?? 0) + cleaningPerStay);
      addToMix(channelBucket(coKey), normalizeChannel(r.channel), fullPayout, totalNights, 1);
    }

    // Statement stays with no accepted Guesty twin. The checkout basis picks
    // these up inside the monthly rental_revenue swap; the nights basis has
    // to place them itself. Revenue and nights only: their stay count and
    // cleaning still arrive via the statement swap, and they must never
    // touch calendarNightsByMonth or they would move occupancy.
    if (basis === 'nights') {
      for (const o of reconciled.orphansByProperty.get(prop.id) ?? []) {
        const ch = normalizeChannel(o.platform);
        for (const b of allocateStayByNights({
          checkIn: o.checkIn, checkOut: o.checkOut, value: o.revenue,
          propStart, rangeStart, periodEndExclusive,
        })) {
          totalRevenue += b.revenue;
          nightsSold += b.nights;
          revenueByMonth.set(b.month, (revenueByMonth.get(b.month) ?? 0) + b.revenue);
          nightsByMonth.set(b.month, (nightsByMonth.get(b.month) ?? 0) + b.nights);
          addToMix(channelBucket(b.month), ch, b.revenue, b.nights, 0);
        }
      }
    }

    // Stash the per-month buckets on the snapshot so the post-pass layer
    // can do per-month Statement + pacing adjustments. calendarNightsByMonth
    // stays separate because pacing % requires calendar (physical) nights.
    monthBucketsByProperty.set(prop.id, {
      revenueByMonth,
      nightsByMonth,
      staysByMonth,
      cleaningByMonth,
      calendarNightsByMonth,
      calendarNightsInRange,
      blockedNightsByMonth,
      channelByMonth,
    });

    const managementFee = totalRevenue * mgmtFeeFraction;
    const ownerPayout = totalRevenue - cleaningCost - managementFee;
    const ADR = nightsSold > 0 && totalRevenue > 0 ? totalRevenue / nightsSold : null;
    const propTotalNights = nightsBetween(propStart, periodEndExclusive);
    // Subtract owner-block nights so per-property occupancy reads against
    // bookable inventory, not raw calendar days.
    let propBlockedNights = 0;
    for (const v of blockedNightsByMonth.values()) propBlockedNights += v;
    const propBookableNights = Math.max(0, propTotalNights - propBlockedNights);
    // Physical calendar occupancy (nights occupied in range), NOT the
    // checkout-attributed nightsSold — a stay straddling month-end counts
    // its in-range nights here while its money belongs to the checkout
    // month. Capped at 100 (overlapping rows or blocks can overshoot).
    const occupancyPct =
      propBookableNights > 0
        ? Math.min(100, (calendarNightsInRange / propBookableNights) * 100)
        : null;

    return {
      propertyId: prop.id,
      propertyName: prop.nickname || prop.name,
      propertyCode: prop.code,
      guestyListingId: prop.guesty_listing_id,
      isRisingTideOwned: prop.is_rising_tide_owned,
      metrics: {
        staysCount,
        nightsSold,
        totalRevenue: totalRevenue > 0 ? round2(totalRevenue) : null,
        ADR: ADR !== null ? round2(ADR) : null,
        occupancyPct: occupancyPct !== null ? round1(occupancyPct) : null,
        managementFee: managementFee > 0 ? round2(managementFee) : (totalRevenue > 0 ? 0 : null),
        cleaningCost: cleaningCost > 0 ? round2(cleaningCost) : null,
        projectedOwnerPayout: ownerPayout > 0 ? round2(ownerPayout) : null,
      },
      turnoversNext30: forwardCountByProperty.get(prop.id) ?? 0,
      source: 'computed',
      // Plain sum of the month buckets; the post-pass rebuilds this with
      // statement swaps + pacing scaling applied.
      channelMix: (() => {
        const mix = emptyChannelMix();
        for (const m of channelByMonth.values()) mergeMix(mix, m);
        return mix;
      })(),
    };
  });

  // 5b. Per-month layer.
  //   - Closed month FULLY inside range with a Statement -> swap that month's
  //     contribution for the Statement values (matches the owner statement).
  //   - Current / future month FULLY inside range, Pacing mode on -> apply
  //     that month's portfolio pacing multiplier to its revenue contribution.
  //   - Partial months at the edge of a range keep their pro-rated values
  //     (Statement doesn't divide cleanly across days).
  const { snapshots, pacing } = await applyStatementsAndPacing(
    baseSnapshots,
    rangeStart,
    rangeEnd,
    properties,
    applyPacing,
    monthBucketsByProperty,
    basis,
  );

  // 6. Portfolio totals.
  let totalStays = 0;
  let totalNights = 0;
  let totalRevenueP = 0;
  let totalPayout = 0;
  let totalMgmtFee = 0;
  let totalPortfolioRevenue = 0;

  for (const s of snapshots) {
    if (s.metrics.totalRevenue == null) continue;
    totalStays += s.metrics.staysCount;
    totalNights += s.metrics.nightsSold;
    totalRevenueP += s.metrics.totalRevenue;
    if (s.metrics.projectedOwnerPayout) totalPayout += s.metrics.projectedOwnerPayout;
    if (s.isRisingTideOwned) {
      if (s.metrics.projectedOwnerPayout) totalPortfolioRevenue += s.metrics.projectedOwnerPayout;
    } else if (s.metrics.managementFee) {
      totalMgmtFee += s.metrics.managementFee;
    }
  }

  const avgADR = totalNights > 0 ? totalRevenueP / totalNights : null;

  // Portfolio channel mix: straight sum of the (already post-passed)
  // per-property mixes.
  const portfolioChannelMix = emptyChannelMix();
  for (const s of snapshots) mergeMix(portfolioChannelMix, s.channelMix);
  roundMix(portfolioChannelMix);

  // Occupancy denominator = every active property's available nights in the
  // period (respecting activation date), whether or not it has bookings.
  // Empty units count as 0% so portfolio occupancy is honest and reconciles
  // with the pacing% line (which uses the same all-active basis). Using
  // propertiesWithData here would exclude empty units and inflate the number
  // for future months that aren't fully booked yet.
  let totalPossibleNights = 0;
  for (const prop of properties) {
    const propStart = effectiveStart(rangeStart, prop.activated_at);
    if (propStart < periodEndExclusive) {
      totalPossibleNights += nightsBetween(propStart, periodEndExclusive);
    }
  }
  // Subtract owner-block nights so portfolio occupancy reads against
  // bookable inventory. Numerator is physical calendar nights (same basis
  // as the per-property occupancy and the pacing %), not the
  // checkout-attributed totalNights that feeds ADR.
  let totalBlockedNights = 0;
  let totalCalendarNights = 0;
  for (const buckets of monthBucketsByProperty.values()) {
    for (const v of buckets.blockedNightsByMonth.values()) totalBlockedNights += v;
    totalCalendarNights += buckets.calendarNightsInRange;
  }
  totalPossibleNights = Math.max(0, totalPossibleNights - totalBlockedNights);
  const avgOccupancy =
    totalPossibleNights > 0
      ? Math.min(100, (totalCalendarNights / totalPossibleNights) * 100)
      : null;

  return {
    rangeStart,
    rangeEnd,
    snapshots,
    pacing,
    channelMix: portfolioChannelMix,
    portfolio: {
      propertyCount: snapshots.length,
      totalStays,
      totalNights,
      totalRevenue: round2(totalRevenueP),
      totalPayout: round2(totalPayout),
      totalManagementFee: round2(totalMgmtFee),
      totalPortfolioRevenue: round2(totalPortfolioRevenue),
      avgADR: avgADR !== null ? round2(avgADR) : null,
      avgOccupancy: avgOccupancy !== null ? round1(avgOccupancy) : null,
    },
  };
}

/**
 * Walk each calendar month touched by the range and apply two kinds of
 * overrides per-month, per-property:
 *
 *   - Closed month FULLY inside range with a Statement -> swap in the
 *     Statement values (canonical for the owner statement).
 *   - Current/future month FULLY inside range, Pacing mode on -> multiply
 *     the property's revenue contribution by that month's portfolio
 *     pacing multiplier (booked nights / nights possible vs. historical
 *     Gloucester occupancy for the month-of-year).
 *
 * Partial months (range starts or ends mid-month) keep their pro-rated
 * contribution unchanged — Statements don't split cleanly across days
 * and applying pacing to a half-month is misleading.
 *
 * Also returns the headline pacing info (the month whose multiplier is
 * highest) so the UI can render the "Pacing X% so far this month" hero
 * line. For a multi-month range, that's the most-relevant month.
 */
async function applyStatementsAndPacing(
  base: PropertySnapshot[],
  rangeStart: string,
  rangeEnd: string,
  properties: PropertyRow[],
  applyPacing: boolean,
  monthBucketsByProperty: Map<string, PropertyMonthBuckets>,
  basis: RevenueBasis,
): Promise<{ snapshots: PropertySnapshot[]; pacing: PacingInfo | null }> {
  const segments = monthSegments(rangeStart, rangeEnd);
  if (segments.length === 0) return { snapshots: base, pacing: null };

  const now = new Date();
  const todayYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const propById = new Map(properties.map((p) => [p.id, p]));

  // Fetch all Statements for months touched by the range. `month` lives on
  // statement_periods (joined via period_id), NOT on property_statements, so
  // resolve the periods first, then pull their statements and re-key by month
  // in JS. (Mirror of get_statements in lib/ask/tools.ts.)
  const monthKeys = segments.map((s) => s.monthKey);
  const stmtByMonthAndProperty = new Map<string, StatementRow>();
  const monthByStatementId = new Map<string, string>();

  const { data: periodData, error: periodErr } = await supabase
    .from('statement_periods')
    .select('id, month')
    .in('month', monthKeys);
  if (periodErr) {
    throw new Error(`Failed to load statement periods: ${periodErr.message}`);
  }

  const monthByPeriod = new Map(
    ((periodData ?? []) as Array<{ id: string; month: string }>).map((p) => [p.id, p.month]),
  );

  if (monthByPeriod.size > 0) {
    const { data: stmtData, error: stmtErr } = await supabase
      .from('property_statements')
      .select('id, period_id, property_id, num_stays, nights_booked, rental_revenue, management_fee, cleaning_total, repairs_total, tax_remittance, owner_payout')
      .in('period_id', Array.from(monthByPeriod.keys()));
    if (stmtErr) {
      throw new Error(`Failed to load property statements: ${stmtErr.message}`);
    }

    // (month, property_id) -> Statement row.
    for (const row of (stmtData ?? []) as StatementRow[]) {
      const month = monthByPeriod.get(row.period_id);
      if (!month) continue;
      stmtByMonthAndProperty.set(`${month}|${row.property_id}`, row);
      if (row.id) monthByStatementId.set(row.id, month);
    }
  }

  // Exact channel mix for statement months, from the statements-module
  // reservation rows (platform + adjusted_revenue sum to the statement's
  // rental_revenue to the cent -- verified across every statement on file).
  // Best-effort: on error or empty (e.g. anon key + RLS in local dev) the
  // per-property loop falls back to the guesty-derived mix scaled to the
  // statement revenue.
  const stmtMixByStatementId = new Map<string, ChannelMix>();
  {
    const stmtIds = Array.from(
      new Set(Array.from(stmtByMonthAndProperty.values()).map((s) => s.id).filter(Boolean)),
    );
    if (stmtIds.length > 0) {
      // Paginate: a single select caps at 1000 rows (same reason
      // cost-analysis.ts pages its reads) and a full_year range across the
      // fleet can cross that. A partially-fetched statement would wear a
      // truthy-but-wrong "exact" mix, so on any error degrade EVERY
      // statement to the scaled guesty fallback instead of mixing exact
      // and missing.
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data: stmtResData, error: stmtResErr } = await supabase
          .from('reservations')
          .select('property_statement_id, platform, adjusted_revenue, nights, check_out')
          .in('property_statement_id', stmtIds)
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (stmtResErr) {
          stmtMixByStatementId.clear();
          break;
        }
        const rows = (stmtResData ?? []) as Array<{
          property_statement_id: string;
          platform: string | null;
          adjusted_revenue: number | null;
          nights: number | null;
          check_out: string | null;
        }>;
        for (const row of rows) {
          const rev = Number(row.adjusted_revenue ?? 0);
          if (rev === 0) continue; // homeowner stays carry no mix
          let mix = stmtMixByStatementId.get(row.property_statement_id);
          if (!mix) {
            mix = emptyChannelMix();
            stmtMixByStatementId.set(row.property_statement_id, mix);
          }
          // Mirror the ingest's header math. Revenue: every non-zero row,
          // negatives included, so the mix sums to rental_revenue (an
          // all-rows sum). Stays: num_stays counts a booking once, on its
          // checkout month, positive rows only -- a cross-month installment
          // booking's synthetic rows have checkout outside the statement
          // month. Nights: positive rows only (synthetic rows carry their
          // month-slice nights, matching nights_booked).
          const stmtMonth = monthByStatementId.get(row.property_statement_id);
          const staysHere =
            rev > 0 && stmtMonth && (row.check_out || '').slice(0, 7) === stmtMonth ? 1 : 0;
          addToMix(
            mix,
            normalizeChannel(row.platform),
            rev,
            rev > 0 ? Number(row.nights ?? 0) : 0,
            staysHere,
          );
        }
        if (rows.length < PAGE) break;
      }
    }
  }

  // Per-month pacing multipliers, keyed by monthKey. Only computed for
  // current/future months that are FULLY inside the range — partial months
  // don't get multipliers (the headline number on the card is mostly
  // computed-from-guesty for those edges).
  type MonthPacing = { pacingPct: number; historicalAvgPct: number; multiplier: number };
  const pacingByMonth = new Map<string, MonthPacing>();
  for (const seg of segments) {
    const isCurrentOrFuture = seg.monthKey >= todayYM;
    if (!seg.fullMonth || !isCurrentOrFuture) continue;

    const mgmtProps = properties.filter(
      (p) =>
        !p.is_rising_tide_owned &&
        (!p.activated_at || p.activated_at.slice(0, 10) <= `${seg.monthKey}-01`),
    );
    let portfolioNightsBooked = 0;
    let portfolioBlockedNights = 0;
    const mgmtIds = new Set(mgmtProps.map((p) => p.id));
    for (const [propId, buckets] of monthBucketsByProperty.entries()) {
      if (!mgmtIds.has(propId)) continue;
      // Pacing % needs calendar (physical-occupancy) nights, not the
      // checkout-attributed nights the dashboard displays.
      portfolioNightsBooked += buckets.calendarNightsByMonth.get(seg.monthKey) ?? 0;
      portfolioBlockedNights += buckets.blockedNightsByMonth.get(seg.monthKey) ?? 0;
    }
    const daysThisMonth = daysInMonth(seg.year, seg.month + 1);
    // Subtract owner blocks from possible nights so pacing % reads against
    // bookable inventory (not raw days × props).
    const portfolioNightsPossible = Math.max(
      0,
      daysThisMonth * mgmtProps.length - portfolioBlockedNights,
    );
    const pacingPct =
      portfolioNightsPossible > 0
        ? (portfolioNightsBooked / portfolioNightsPossible) * 100
        : 0;
    const historicalAvgPct = HISTORICAL_AVG_RECENT[seg.month] ?? 0;
    const rawMultiplier =
      pacingPct > 0 && historicalAvgPct > pacingPct ? historicalAvgPct / pacingPct : 1;

    // When the segment is the *current* calendar month, the raw multiplier
    // assumes the whole month is still bookable up to the historical
    // benchmark. That's wrong late in the month: only the days remaining
    // can absorb new bookings. Cap the multiplier by what last-minute
    // supply can plausibly add (remaining_days × mgmt_props × historical
    // fill rate). For future months we leave the raw multiplier alone —
    // the whole month is ahead of us.
    let multiplier = rawMultiplier;
    const isCurrentMonthSeg = seg.monthKey === todayYM;
    if (isCurrentMonthSeg && rawMultiplier > 1 && pacingPct > 0) {
      const dayOfMonth = now.getDate();
      const daysRemaining = Math.max(0, daysThisMonth - dayOfMonth);
      const maxAdditionalNights =
        daysRemaining * mgmtProps.length * (historicalAvgPct / 100);
      const cappedExpectedNights = portfolioNightsBooked + maxAdditionalNights;
      const cappedPct =
        portfolioNightsPossible > 0
          ? (cappedExpectedNights / portfolioNightsPossible) * 100
          : 0;
      const cappedMultiplier = cappedPct / pacingPct;
      multiplier = Math.max(1, Math.min(rawMultiplier, cappedMultiplier));
    }

    pacingByMonth.set(seg.monthKey, { pacingPct, historicalAvgPct, multiplier });
  }

  // Headline pacing for the UI: pick the month with the largest multiplier
  // (the one driving the biggest projection). Falls back to the latest month
  // if no month has a multiplier > 1.
  let headline: PacingInfo | null = null;
  for (const seg of segments) {
    const mp = pacingByMonth.get(seg.monthKey);
    if (!mp) continue;
    if (!headline || mp.multiplier > headline.multiplier) {
      headline = {
        pacingPct: round1(mp.pacingPct),
        historicalAvgPct: round1(mp.historicalAvgPct),
        multiplier: mp.multiplier,
        month: seg.monthKey,
      };
    }
  }

  const snapshots = base.map((s): PropertySnapshot => {
    const buckets = monthBucketsByProperty.get(s.propertyId);
    if (!buckets) return s;
    const prop = propById.get(s.propertyId);
    const mgmtFraction = prop?.is_rising_tide_owned
      ? 0
      : Number(prop?.management_fee_pct ?? 0) / 100;

    let revenueDelta = 0;
    let nightsDelta = 0;
    let staysDelta = 0;
    let cleaningDelta = 0;
    // Repairs + tax come straight off the Statement and reduce payout only.
    // PropertyRevenueMetrics has no field for them, so accumulate here and
    // subtract from the recomputed payout. Stays 0 for non-Statement months.
    let repairsTaxDelta = 0;
    let usedStatement = false;
    let usedPacing = false;
    let usedBooked = false;

    // Rebuilt per-month with the same three branches as the money deltas,
    // so the mix always sums (approximately) to the displayed revenue.
    const channelMix = emptyChannelMix();

    for (const seg of segments) {
      const isClosed = seg.monthKey < todayYM;
      const isCurrentOrFuture = seg.monthKey >= todayYM;
      const monthMix = buckets.channelByMonth.get(seg.monthKey);

      // (a) Full closed month with Statement -> swap in Statement values.
      if (seg.fullMonth && isClosed) {
        const stmt = stmtByMonthAndProperty.get(`${seg.monthKey}|${s.propertyId}`);
        if (stmt) {
          // Revenue and nights are swapped only under the CHECKOUT basis.
          // rental_revenue and nights_booked are whole-stay, checkout-scoped
          // scalars: substituting them here would delete the month's
          // night-attributed value and silently revert every closed month to
          // checkout numbers, which is the one thing the nights tab must not
          // do. The nights basis already carries reconciled dollars, because
          // it resolved them per stay in the base pass.
          if (basis === 'checkout') {
            revenueDelta += (Number(stmt.rental_revenue) || 0) - (buckets.revenueByMonth.get(seg.monthKey) ?? 0);
            nightsDelta += (Number(stmt.nights_booked) || 0) - (buckets.nightsByMonth.get(seg.monthKey) ?? 0);
          }
          // Stays and cleaning are checkout-anchored in BOTH bases, so the
          // statement's own figures are right either way.
          staysDelta += (Number(stmt.num_stays) || 0) - (buckets.staysByMonth.get(seg.monthKey) ?? 0);
          cleaningDelta += (Number(stmt.cleaning_total) || 0) - (buckets.cleaningByMonth.get(seg.monthKey) ?? 0);
          repairsTaxDelta += (Number(stmt.repairs_total) || 0) + (Number(stmt.tax_remittance) || 0);
          usedStatement = true;
          if (basis === 'nights') {
            // Keep the base pass's night-split mix. The statement mix is
            // checkout-scoped like the scalars above.
            if (monthMix) mergeMix(channelMix, monthMix);
            continue;
          }
          const stmtMix = stmt.id ? stmtMixByStatementId.get(stmt.id) : undefined;
          if (stmtMix) {
            mergeMix(channelMix, stmtMix);
          } else if (monthMix) {
            // Statement reservation rows unavailable: keep the guesty-
            // derived split, scaled so the month's mix revenue matches the
            // statement revenue that replaced it. With nothing meaningful
            // to scale (either side zero), skip entirely rather than merge
            // ghost stays/nights at factor 0.
            const monthRev = buckets.revenueByMonth.get(seg.monthKey) ?? 0;
            const stmtRev = Number(stmt.rental_revenue) || 0;
            if (monthRev > 0 && stmtRev > 0) {
              mergeMix(channelMix, monthMix, stmtRev / monthRev);
            }
          }
          continue;
        }
      }

      // (b) Full current/future month with Pacing mode on -> multiply this
      //     month's contribution by the pacing multiplier.
      const mp = pacingByMonth.get(seg.monthKey);
      if (seg.fullMonth && isCurrentOrFuture && applyPacing && mp && mp.multiplier > 1) {
        const monthRevenue = buckets.revenueByMonth.get(seg.monthKey) ?? 0;
        revenueDelta += monthRevenue * (mp.multiplier - 1);
        usedPacing = true;
        if (monthMix) mergeMix(channelMix, monthMix, mp.multiplier);
        continue;
      }

      // (c) Otherwise: keep the booked/pro-rated contribution as-is.
      if (isCurrentOrFuture) usedBooked = true;
      if (monthMix) mergeMix(channelMix, monthMix);
    }

    // Boundary stays: a checkout ON periodEndExclusive (the 1st of the
    // month after the range) is included in the money totals by the base
    // pass, but its bucket keys to a month no segment covers. Merge those
    // leftover buckets so the mix keeps summing to the displayed revenue.
    const segmentMonths = new Set(segments.map((seg) => seg.monthKey));
    for (const [mKey, monthMix] of buckets.channelByMonth.entries()) {
      if (!segmentMonths.has(mKey)) mergeMix(channelMix, monthMix);
    }

    const baseM = s.metrics;
    const newRevenue =
      baseM.totalRevenue != null ? Math.max(0, baseM.totalRevenue + revenueDelta) : null;
    const newNights = Math.max(0, baseM.nightsSold + nightsDelta);
    const newStays = Math.max(0, baseM.staysCount + staysDelta);
    const newCleaning =
      baseM.cleaningCost != null
        ? Math.max(0, baseM.cleaningCost + cleaningDelta)
        : cleaningDelta > 0
        ? cleaningDelta
        : null;

    const newMgmtFee = newRevenue != null ? newRevenue * mgmtFraction : null;
    const newPayout =
      newRevenue != null ? newRevenue - (newMgmtFee ?? 0) - (newCleaning ?? 0) - repairsTaxDelta : null;
    const newADR = newNights > 0 && newRevenue && newRevenue > 0 ? newRevenue / newNights : null;

    const source: SnapshotSource =
      // Multi-month with at least one Statement-overridden month: prefer the
      // Statement label if it dominates. Pacing wins over Booked. Computed
      // when nothing overrode (e.g. fully past range with no Statements).
      usedStatement && !usedPacing
        ? 'statement'
        : usedPacing
        ? 'pacing'
        : usedBooked
        ? 'booked'
        : 'computed';

    return {
      ...s,
      source,
      // Mirror the totalRevenue guard: when the headline resolves to
      // null/zero (base pass saw no revenue at all), ship an empty mix
      // too, or the Channel Mix strip could total more than the page shows.
      channelMix:
        newRevenue != null && newRevenue > 0 ? roundMix(channelMix) : emptyChannelMix(),
      metrics: {
        staysCount: newStays,
        nightsSold: newNights,
        totalRevenue: newRevenue != null && newRevenue > 0 ? round2(newRevenue) : null,
        ADR: newADR !== null ? round2(newADR) : null,
        // Occupancy is physical calendar occupancy from the base pass.
        // Statement swaps and pacing multipliers move money and
        // checkout-attributed nights, not what nights were slept in.
        occupancyPct: baseM.occupancyPct,
        managementFee: newMgmtFee && newMgmtFee > 0 ? round2(newMgmtFee) : (newRevenue ? 0 : null),
        cleaningCost: newCleaning && newCleaning > 0 ? round2(newCleaning) : null,
        projectedOwnerPayout: newPayout && newPayout > 0 ? round2(newPayout) : null,
      },
    };
  });

  return { snapshots, pacing: headline };
}

type StatementRow = {
  id: string;
  period_id: string;
  property_id: string;
  num_stays: number | null;
  nights_booked: number | null;
  rental_revenue: number | null;
  management_fee: number | null;
  cleaning_total: number | null;
  repairs_total: number | null;
  tax_remittance: number | null;
  owner_payout: number | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
