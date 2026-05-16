/**
 * Smart forecast — the alternative to seasonality-curve projection.
 *
 * Logic:
 *   1. For each forward month M, sum the booked nights and revenue across
 *      RT-managed properties (from `guesty_reservations`).
 *   2. Compute the portfolio's current pacing:
 *         pacing[M] = total_nights_booked_for_M / total_nights_possible_for_M
 *      where nights_possible = days_in_M × number_of_active_properties.
 *   3. Look up the historical Gloucester market average occupancy for M
 *      (HISTORICAL_AVG_RECENT, four-year post-pandemic).
 *   4. Pacing multiplier = max(1, historicalAvg / pacing). If the portfolio
 *      is already pacing above historical (rare), no upward adjustment.
 *   5. For each property P, project its M revenue:
 *         projected_gross[P,M] = booked_revenue[P,M] × multiplier[M]
 *         rt_mgmt_fee[P,M]      = projected_gross[P,M] × P.management_fee_pct
 *
 * The result is a per-property × per-month grid of projected RT
 * management-fee revenue, plus the inputs that produced it (so the
 * page can show "you're at X% pacing → expecting Y× lift").
 */

import { supabase } from './supabase';
import {
  HISTORICAL_AVG_RECENT,
  GLOUCESTER_REVENUE_SEASONALITY,
  daysInMonth,
} from './forecast-occupancy';
import type { ForecastBaselines } from './forecast-statement-actuals';

// Reservation statuses we count as "real bookings" for forward pacing.
const ACTIVE_STATUSES = new Set([
  'confirmed', 'reserved', 'checked_in', 'checked-in', 'checkedin',
]);

const EXCLUDED_STATUSES = new Set([
  'cancelled', 'canceled', 'inquiry', 'declined', 'expired',
]);

function normalizeStatus(s: string | null): string {
  return (s || '').toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
}

function isActiveBooking(status: string | null): boolean {
  const n = normalizeStatus(status);
  if (EXCLUDED_STATUSES.has(n) || n.includes('cancel') || n.includes('declin')) return false;
  return (
    ACTIVE_STATUSES.has(n) ||
    n.includes('confirmed') ||
    n.includes('checked') ||
    n.includes('reserved')
  );
}

function nightsBetween(startStr: string, endStr: string): number {
  const ms = new Date(endStr).getTime() - new Date(startStr).getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

function ymd(d: Date): string {
  return d.toISOString().split('T')[0];
}

/** Returns the YYYY-MM key the given date string falls into. */
function ymKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export type SmartProperty = {
  id: string;
  name: string;
  /** Nullable for RT-owned properties (we don't charge ourselves a fee). */
  mgmtFeePct: number | null;
  isRtOwned: boolean;
  activatedAt: string | null;
};

export type SmartMonthInputs = {
  /** YYYY-MM. */
  month: string;
  /** Total nights booked across the active portfolio for this month. */
  portfolioNightsBooked: number;
  /** Total nights possible (days × active properties). */
  portfolioNightsPossible: number;
  /** Current pacing as 0-100. */
  pacingPct: number;
  /** Historical Gloucester avg for this month-of-year, 0-100. */
  historicalAvgPct: number;
  /** historicalAvgPct / pacingPct, floored at 1. */
  multiplier: number;
};

export type SmartPropertyMonth = {
  month: string;
  bookedNights: number;
  bookedRevenue: number;
  projectedGross: number;
  projectedMgmtFee: number;
};

export type SmartPropertyForecast = {
  property: SmartProperty;
  monthly: SmartPropertyMonth[];
  totals: {
    bookedRevenue: number;
    projectedGross: number;
    projectedMgmtFee: number;
  };
};

export type SmartForecast = {
  /** The set of forward months the forecast covers, e.g. ["2026-05", ...]. */
  months: string[];
  monthInputs: SmartMonthInputs[];
  /** One entry per property (excluding RT-owned). */
  properties: SmartPropertyForecast[];
  /** Sum across all properties. */
  totals: {
    bookedRevenue: number;
    projectedGross: number;
    projectedMgmtFee: number;
  };
};

type ReservationRow = {
  property_id: string | null;
  check_in: string | null;
  check_out: string | null;
  status: string | null;
  host_payout: number | null;
  owner_net_revenue_guesty: number | null;
  total_paid: number | null;
};

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

/**
 * Compute the forward-month list given a starting "today". Always returns
 * the months from the start of next month through the end of `endYear`.
 * Past months in the same year are skipped because actuals already cover
 * them in the Monthly Detail table.
 */
export function forwardMonths(today: Date, endYear: number): string[] {
  const start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const out: string[] = [];
  const cursor = new Date(start);
  while (cursor.getFullYear() <= endYear) {
    out.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

/**
 * Pull every reservation that overlaps our forward window, bucket by
 * property × YYYY-MM, and return booked nights + booked revenue.
 *
 * A stay that straddles two months is pro-rated by nights into each.
 */
export async function getBookedByPropertyByMonth(
  forwardMonthList: string[]
): Promise<{
  bookedByPropMonth: Map<string, Map<string, { nights: number; revenue: number }>>;
  properties: SmartProperty[];
}> {
  if (forwardMonthList.length === 0) {
    return { bookedByPropMonth: new Map(), properties: [] };
  }

  // Window: from start of first forward month to end of last forward month.
  const firstMonth = forwardMonthList[0];
  const lastMonth = forwardMonthList[forwardMonthList.length - 1];
  const [fy, fm] = firstMonth.split('-').map((s) => parseInt(s, 10));
  const [ly, lm] = lastMonth.split('-').map((s) => parseInt(s, 10));
  const windowStart = ymd(new Date(fy, fm - 1, 1));
  // exclusive upper bound = first day of month-after-last
  const windowEndExclusive = ymd(new Date(ly, lm, 1));

  // Active properties (with management fee + ownership flag).
  const { data: propsData, error: propsErr } = await supabase
    .from('properties')
    .select('id, name, nickname, management_fee_pct, is_rising_tide_owned, is_active, activated_at')
    .eq('is_active', true)
    .order('name');
  if (propsErr) throw new Error(`Failed to load properties: ${propsErr.message}`);

  const properties: SmartProperty[] = (propsData ?? []).map((p: {
    id: string;
    name: string;
    nickname: string | null;
    management_fee_pct: number | null;
    is_rising_tide_owned: boolean;
    activated_at: string | null;
  }) => ({
    id: p.id,
    name: p.nickname || p.name,
    mgmtFeePct: p.is_rising_tide_owned ? null : Number(p.management_fee_pct ?? 0),
    isRtOwned: !!p.is_rising_tide_owned,
    activatedAt: p.activated_at,
  }));

  // Reservations that overlap any forward month.
  const { data: resData, error: resErr } = await supabase
    .from('guesty_reservations')
    .select('property_id, check_in, check_out, status, host_payout, owner_net_revenue_guesty, total_paid')
    .lt('check_in', windowEndExclusive)
    .gte('check_out', windowStart);
  if (resErr) throw new Error(`Failed to load reservations: ${resErr.message}`);

  const bookedByPropMonth = new Map<string, Map<string, { nights: number; revenue: number }>>();

  const propById = new Map(properties.map((p) => [p.id, p]));

  for (const r of (resData ?? []) as ReservationRow[]) {
    if (!r.property_id || !r.check_in || !r.check_out) continue;
    if (!isActiveBooking(r.status)) continue;
    const prop = propById.get(r.property_id);
    if (!prop || prop.isRtOwned) continue; // RT-owned out of mgmt scope

    const totalNights = nightsBetween(r.check_in, r.check_out);
    if (totalNights <= 0) continue;
    const mgmtFraction = (prop.mgmtFeePct ?? 0) / 100;
    const fullPayout = resolveGrossPayout(r, mgmtFraction);
    if (fullPayout <= 0) continue;
    const perNight = fullPayout / totalNights;

    // Walk through the months this stay touches and pro-rate by nights in
    // each month.
    let cursor = new Date(r.check_in);
    const checkOut = new Date(r.check_out);
    while (cursor < checkOut) {
      const cy = cursor.getFullYear();
      const cm = cursor.getMonth();
      const monthStart = new Date(cy, cm, 1);
      const monthEnd = new Date(cy, cm + 1, 1); // exclusive
      const overlapStart = cursor > monthStart ? cursor : monthStart;
      const overlapEnd = checkOut < monthEnd ? checkOut : monthEnd;
      const nightsInMonth = nightsBetween(ymd(overlapStart), ymd(overlapEnd));
      if (nightsInMonth > 0) {
        const ym = `${cy}-${String(cm + 1).padStart(2, '0')}`;
        if (forwardMonthList.includes(ym)) {
          let propMap = bookedByPropMonth.get(r.property_id);
          if (!propMap) {
            propMap = new Map();
            bookedByPropMonth.set(r.property_id, propMap);
          }
          const cur = propMap.get(ym) ?? { nights: 0, revenue: 0 };
          cur.nights += nightsInMonth;
          cur.revenue += perNight * nightsInMonth;
          propMap.set(ym, cur);
        }
      }
      cursor = monthEnd;
    }
  }

  return { bookedByPropMonth, properties };
}

/**
 * Given the booked-by-property data and the historical occupancy benchmark,
 * compute the smart forecast.
 */
export function computeSmartForecast(
  forwardMonthList: string[],
  bookedByPropMonth: Map<string, Map<string, { nights: number; revenue: number }>>,
  properties: SmartProperty[],
  historicalAvgByMonthOfYear: number[] = HISTORICAL_AVG_RECENT,
  /**
   * Per-property baselines + the portfolio revenue-seasonality curve.
   * See getPropertyAnnualBaselines() / ForecastBaselines.
   */
  baselineData: ForecastBaselines = {
    byProperty: new Map(),
    revenueSeasonality: GLOUCESTER_REVENUE_SEASONALITY,
  },
): SmartForecast {
  // Active mgmt props only (exclude RT-owned).
  const mgmtProps = properties.filter((p) => !p.isRtOwned);

  // Part B seasonality: share of annual revenue per month-of-year.
  const revenueShare = baselineData.revenueSeasonality;

  // Per-month inputs: portfolio-level pacing computation.
  const monthInputs: SmartMonthInputs[] = forwardMonthList.map((ym) => {
    const [y, m] = ym.split('-').map((s) => parseInt(s, 10));
    const days = daysInMonth(y, m);

    let portfolioNightsBooked = 0;
    let activePropsThisMonth = 0;
    for (const p of mgmtProps) {
      // Only count properties active in this month
      const monthStart = `${ym}-01`;
      if (p.activatedAt && p.activatedAt.slice(0, 10) > monthStart) continue;
      activePropsThisMonth += 1;
      const cell = bookedByPropMonth.get(p.id)?.get(ym);
      if (cell) portfolioNightsBooked += cell.nights;
    }
    const portfolioNightsPossible = days * activePropsThisMonth;
    const pacingPct = portfolioNightsPossible > 0
      ? (portfolioNightsBooked / portfolioNightsPossible) * 100
      : 0;
    const histAvg = historicalAvgByMonthOfYear[m - 1] ?? 0;
    // Multiplier capped on the low end at 1 (we never project DOWN — booked
    // revenue is contractually committed). No high-end cap; if the
    // portfolio is at 5% pacing for August (76% historical), multiplier is
    // 15× on the booked base, which mathematically projects what the
    // remaining 71% of nights would add.
    const multiplier = pacingPct > 0 && histAvg > pacingPct ? histAvg / pacingPct : 1;
    return {
      month: ym,
      portfolioNightsBooked,
      portfolioNightsPossible,
      pacingPct,
      historicalAvgPct: histAvg,
      multiplier,
    };
  });

  const inputsByMonth = new Map(monthInputs.map((mi) => [mi.month, mi]));

  // Per-property projection — two-part blend.
  const propsForecast: SmartPropertyForecast[] = mgmtProps.map((p) => {
    const propBooked = bookedByPropMonth.get(p.id) ?? new Map();
    const baseline = baselineData.byProperty.get(p.id);
    const monthly: SmartPropertyMonth[] = forwardMonthList.map((ym) => {
      const cell = propBooked.get(ym) ?? { nights: 0, revenue: 0 };
      const [y, m] = ym.split('-').map((s) => parseInt(s, 10));
      const monthIdx = m - 1;
      const days = daysInMonth(y, m);

      // ── Part A — pacing scale-up ──────────────────────────────────────
      // Take what's booked for this month, and scale by how full the
      // market typically gets vs how full this property currently is.
      // $5K booked at 30% property occupancy, 60% market → $5K × 2 = $10K.
      // Only exists when the property has bookings for the month.
      let partA: number | null = null;
      if (cell.revenue > 0 && cell.nights > 0 && days > 0) {
        const propertyOcc = cell.nights / days;
        const marketOcc = (historicalAvgByMonthOfYear[monthIdx] ?? 0) / 100;
        // Floor at 1× — never project below what's already on the books.
        const ratio = propertyOcc > 0 ? Math.max(1, marketOcc / propertyOcc) : 1;
        partA = cell.revenue * ratio;
      }

      // ── Part B — annual revenue × month's revenue share ──────────────
      // The property's expected annual gross × the % of annual revenue
      // that typically lands in this month.
      const partB = (baseline?.annualGross ?? 0) * revenueShare[monthIdx];

      // ── Blend ─────────────────────────────────────────────────────────
      // 50/50 when Part A exists; 100% Part B when there are no bookings
      // for the month yet.
      const projectedGross = partA != null ? 0.5 * partA + 0.5 * partB : partB;

      const feeFraction = (p.mgmtFeePct ?? 0) / 100;
      return {
        month: ym,
        bookedNights: cell.nights,
        bookedRevenue: cell.revenue,
        projectedGross,
        projectedMgmtFee: projectedGross * feeFraction,
      };
    });
    const totals = monthly.reduce(
      (acc, m) => ({
        bookedRevenue: acc.bookedRevenue + m.bookedRevenue,
        projectedGross: acc.projectedGross + m.projectedGross,
        projectedMgmtFee: acc.projectedMgmtFee + m.projectedMgmtFee,
      }),
      { bookedRevenue: 0, projectedGross: 0, projectedMgmtFee: 0 }
    );
    return { property: p, monthly, totals };
  });

  const totals = propsForecast.reduce(
    (acc, p) => ({
      bookedRevenue: acc.bookedRevenue + p.totals.bookedRevenue,
      projectedGross: acc.projectedGross + p.totals.projectedGross,
      projectedMgmtFee: acc.projectedMgmtFee + p.totals.projectedMgmtFee,
    }),
    { bookedRevenue: 0, projectedGross: 0, projectedMgmtFee: 0 }
  );

  return {
    months: forwardMonthList,
    monthInputs,
    properties: propsForecast,
    totals,
  };
}
