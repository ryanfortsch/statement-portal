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
import { supabase } from './supabase';
import {
  dayAfter,
  daysInMonth,
  exactCalendarMonth,
  nightsBetween,
} from './revenue-date-range';
import { HISTORICAL_AVG_RECENT } from './forecast-occupancy';

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

export type PropertyRevenueMetrics = {
  staysCount: number;
  nightsSold: number;
  totalRevenue: number | null;
  ADR: number | null;
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
};

export type SnapshotsResponse = {
  rangeStart: string;
  rangeEnd: string;
  snapshots: PropertySnapshot[];
  portfolio: PortfolioTotals;
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
  check_in: string | null;
  check_out: string | null;
  status: string | null;
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

function isAllowed(status: string | null): boolean {
  const n = normalizeStatus(status);
  return (
    ALLOWED_STATUSES.has(n) ||
    n.includes('confirmed') ||
    n.includes('checked') ||
    n.includes('closed')
  );
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
};

export async function computeRevenueSnapshot(
  rangeStart: string,
  rangeEnd: string,
  options: SnapshotOptions = {},
): Promise<SnapshotsResponse> {
  const applyPacing = options.applyPacing !== false;
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

  // 2. Reservations overlapping the period:
  //    overlap iff (check_in < periodEndExclusive) AND (check_out > periodStart).
  const periodEndExclusive = dayAfter(rangeEnd);

  const { data: resData, error: resErr } = await supabase
    .from('guesty_reservations')
    .select('property_id, listing_id, check_in, check_out, status, host_payout, owner_net_revenue_guesty, total_paid')
    .lt('check_in', periodEndExclusive)
    .gt('check_out', rangeStart);

  if (resErr) {
    throw new Error(`Failed to load reservations: ${resErr.message}`);
  }

  const reservations = ((resData ?? []) as ReservationRow[]).filter(
    (r) => r.check_in && r.check_out && isAllowed(r.status),
  );

  // 3. Forward reservations: today through +30d, count turnovers per property.
  const today = new Date().toISOString().split('T')[0];
  const thirty = new Date();
  thirty.setDate(thirty.getDate() + 30);
  const thirtyEnd = thirty.toISOString().split('T')[0];

  const { data: fwdData } = await supabase
    .from('guesty_reservations')
    .select('property_id, listing_id, check_in, check_out, status')
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

  // 5. Per-property pro-rated math.
  const totalNightsInPeriod = nightsBetween(rangeStart, periodEndExclusive);

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
      };
    }

    const propReservations = resByProperty.get(prop.id) ?? [];

    let nightsSold = 0;
    let totalRevenue = 0;
    let staysCount = 0;
    let cleaningCost = 0;
    const cleaningPerStay = Number(prop.cleaning_cost_estimate ?? 0);
    // properties.management_fee_pct stored as percent (e.g. 25 = 25%).
    const mgmtFeeFraction = prop.is_rising_tide_owned ? 0 : Number(prop.management_fee_pct) / 100;

    for (const r of propReservations) {
      const checkIn = r.check_in!;
      const checkOut = r.check_out!;
      const totalNights = nightsBetween(checkIn, checkOut);
      if (totalNights <= 0) continue;

      const overlapStart = checkIn > propStart ? checkIn : propStart;
      const overlapEnd = checkOut < periodEndExclusive ? checkOut : periodEndExclusive;
      const nightsInPeriod = nightsBetween(overlapStart, overlapEnd);
      if (nightsInPeriod <= 0) continue;

      const fullPayout = resolveGrossPayout(r, mgmtFeeFraction);

      // Skip rows with no money — these are owner blocks, holds, or
      // cancelled-but-not-deleted stays. They shouldn't count toward
      // stays/nights/occupancy either.
      if (fullPayout <= 0) continue;

      nightsSold += nightsInPeriod;
      totalRevenue += fullPayout * (nightsInPeriod / totalNights);

      // Cleaning attributed at checkout (so it doesn't double-count for stays
      // that overlap multiple periods).
      if (checkOut > rangeStart && checkOut <= periodEndExclusive) {
        staysCount += 1;
        cleaningCost += cleaningPerStay;
      }
    }

    const managementFee = totalRevenue * mgmtFeeFraction;
    const ownerPayout = totalRevenue - cleaningCost - managementFee;
    const ADR = nightsSold > 0 && totalRevenue > 0 ? totalRevenue / nightsSold : null;
    const propTotalNights = nightsBetween(propStart, periodEndExclusive);
    const occupancyPct = propTotalNights > 0 ? (nightsSold / propTotalNights) * 100 : null;

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
    };
  });

  // 5b. Per-property overrides for calendar-month ranges.
  //   - Closed month with a Statement -> use Statement values exactly (matches
  //     what the owner received in their monthly statement).
  //   - Current month -> apply the smart-forecast pacing multiplier on top of
  //     booked-so-far revenue, so the dashboard projects toward the historical
  //     Gloucester occupancy benchmark for this month-of-year.
  const { snapshots, pacing } = await applyStatementsAndPacing(
    baseSnapshots,
    rangeStart,
    rangeEnd,
    properties,
    applyPacing,
  );

  // 6. Portfolio totals.
  let totalStays = 0;
  let totalNights = 0;
  let totalRevenueP = 0;
  let totalPayout = 0;
  let totalMgmtFee = 0;
  let totalPortfolioRevenue = 0;
  let propertiesWithData = 0;

  for (const s of snapshots) {
    if (s.metrics.totalRevenue == null) continue;
    propertiesWithData += 1;
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
  const totalPossibleNights = propertiesWithData * totalNightsInPeriod;
  const avgOccupancy = totalPossibleNights > 0 ? (totalNights / totalPossibleNights) * 100 : null;

  return {
    rangeStart,
    rangeEnd,
    snapshots,
    pacing,
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
 * For a single-calendar-month range, overlay Statement data on closed months
 * and a portfolio pacing multiplier on the current month. Returns the
 * possibly-mutated snapshots plus the pacing inputs (so the UI can show
 * "pacing toward X% based on booked-so-far Y%").
 */
async function applyStatementsAndPacing(
  base: PropertySnapshot[],
  rangeStart: string,
  rangeEnd: string,
  properties: PropertyRow[],
  applyPacing: boolean,
): Promise<{ snapshots: PropertySnapshot[]; pacing: PacingInfo | null }> {
  const cal = exactCalendarMonth({ rangeStart, rangeEnd });
  if (!cal) return { snapshots: base, pacing: null };

  const monthKey = `${cal.year}-${String(cal.month + 1).padStart(2, '0')}`;
  const daysThisMonth = daysInMonth(cal.year, cal.month + 1);

  // Statements for this month, keyed by property_id.
  const { data: stmtData } = await supabase
    .from('property_statements')
    .select('property_id, num_stays, nights_booked, rental_revenue, management_fee, cleaning_total, owner_payout')
    .eq('month', monthKey);

  const stmtByProperty = new Map<string, StatementRow>();
  for (const row of (stmtData ?? []) as StatementRow[]) {
    stmtByProperty.set(row.property_id, row);
  }

  // Classify the month: closed (in the past), current, or future.
  const now = new Date();
  const todayYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const isCurrentMonth = now.getFullYear() === cal.year && now.getMonth() === cal.month;
  const isCurrentOrFuture = monthKey >= todayYM;

  // Pacing multiplier (portfolio-level). Computed for any current-or-future
  // month: the math is the same (booked nights vs. days × props, compared to
  // historical Gloucester occupancy). For closed months we already use
  // Statement values, so pacing is moot — skip the compute.
  let pacing: PacingInfo | null = null;
  if (isCurrentOrFuture) {
    const mgmtProps = properties.filter(
      (p) =>
        !p.is_rising_tide_owned &&
        (!p.activated_at || p.activated_at.slice(0, 10) <= `${monthKey}-01`),
    );
    let portfolioNightsBooked = 0;
    const mgmtIds = new Set(mgmtProps.map((p) => p.id));
    for (const s of base) {
      if (mgmtIds.has(s.propertyId)) portfolioNightsBooked += s.metrics.nightsSold;
    }
    const portfolioNightsPossible = daysThisMonth * mgmtProps.length;
    // For a current month, pacing% = nights-booked-so-far / nights-possible.
    // For a future month, this still reads the same way (it's just "what's
    // been booked vs. what could be filled"), and the multiplier scales
    // toward the seasonal historical average.
    const pacingPct =
      portfolioNightsPossible > 0
        ? (portfolioNightsBooked / portfolioNightsPossible) * 100
        : 0;
    const historicalAvgPct = HISTORICAL_AVG_RECENT[cal.month] ?? 0;
    const multiplier =
      pacingPct > 0 && historicalAvgPct > pacingPct ? historicalAvgPct / pacingPct : 1;
    pacing = { pacingPct: round1(pacingPct), historicalAvgPct: round1(historicalAvgPct), multiplier, month: monthKey };
  }
  void isCurrentMonth;

  const snapshots = base.map((s): PropertySnapshot => {
    // (1) Closed month with a Statement -> use Statement values exactly.
    const stmt = stmtByProperty.get(s.propertyId);
    if (stmt) {
      const nights = Number(stmt.nights_booked) || 0;
      const revenue = Number(stmt.rental_revenue) || 0;
      const ADR = nights > 0 && revenue > 0 ? revenue / nights : null;
      const occupancy = daysThisMonth > 0 ? (nights / daysThisMonth) * 100 : null;
      return {
        ...s,
        source: 'statement',
        metrics: {
          staysCount: Number(stmt.num_stays) || 0,
          nightsSold: nights,
          totalRevenue: revenue > 0 ? round2(revenue) : null,
          ADR: ADR !== null ? round2(ADR) : null,
          occupancyPct: occupancy !== null ? round1(occupancy) : null,
          managementFee: Number(stmt.management_fee) > 0 ? round2(Number(stmt.management_fee)) : 0,
          cleaningCost: Number(stmt.cleaning_total) > 0 ? round2(Number(stmt.cleaning_total)) : null,
          projectedOwnerPayout: Number(stmt.owner_payout) > 0 ? round2(Number(stmt.owner_payout)) : null,
        },
      };
    }

    // (2) Current-or-future month with pacing requested -> apply pacing
    //     multiplier to revenue/mgmt/payout. Stays/nights/occupancy/ADR stay
    //     as booked-so-far (those are honest actuals; revenue gets projected
    //     toward the historical Gloucester occupancy benchmark).
    if (isCurrentOrFuture && pacing && pacing.multiplier > 1 && applyPacing) {
      const m = s.metrics;
      if (m.totalRevenue == null) return { ...s, source: 'pacing' };
      const prop = properties.find((p) => p.id === s.propertyId);
      const mgmtFraction = prop?.is_rising_tide_owned
        ? 0
        : Number(prop?.management_fee_pct ?? 0) / 100;
      const projectedRevenue = m.totalRevenue * pacing.multiplier;
      const projectedMgmtFee = projectedRevenue * mgmtFraction;
      const projectedPayout = projectedRevenue - projectedMgmtFee - (m.cleaningCost ?? 0);
      return {
        ...s,
        source: 'pacing',
        metrics: {
          ...m,
          totalRevenue: round2(projectedRevenue),
          managementFee: round2(projectedMgmtFee),
          projectedOwnerPayout: projectedPayout > 0 ? round2(projectedPayout) : null,
        },
      };
    }

    // (3) Current-or-future month, pacing disabled -> show booked-so-far
    //     actuals (no multiplier). Tag source so the UI can label honestly.
    if (isCurrentOrFuture) {
      return { ...s, source: 'booked' };
    }

    return s;
  });

  return { snapshots, pacing };
}

type StatementRow = {
  property_id: string;
  num_stays: number | null;
  nights_booked: number | null;
  rental_revenue: number | null;
  management_fee: number | null;
  cleaning_total: number | null;
  owner_payout: number | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
