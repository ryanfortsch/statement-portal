/**
 * Smart forecast — per-property forward projection of RT management-fee
 * revenue.
 *
 * Each property × forward-month projected gross is a blend of two parts:
 *
 *   Part A — pacing scale-up. Take the revenue a property has on the
 *     books for a forward month and scale it by how full the market
 *     typically gets vs how full the property currently is. $5K booked
 *     at 30% property occupancy with 60% market occupancy → $10K.
 *     Floored at 1× (we never project below what's already booked).
 *     Only exists for months that have bookings.
 *
 *   Part B — annual × seasonality. The property's expected annual gross
 *     × the share of annual revenue that typically lands in that month
 *     (the Gloucester revenue-seasonality curve).
 *
 * Blend: 50/50 when a month has bookings, 100% Part B when it doesn't.
 *
 * The annual gross feeding Part B is itself derived from Part A — a
 * property's pacing-corrected booked months, annualized via the
 * seasonality curve. Helm has no complete trailing-year per-property
 * revenue history (guesty_reservations only carries recent + forward
 * stays, and property_statements only a handful of reconciled months),
 * so the property's own forward booking pace is the baseline. Properties
 * with no forward bookings at all fall back to the portfolio average.
 */

import { supabase } from './supabase';
import {
  HISTORICAL_AVG_RECENT,
  GLOUCESTER_REVENUE_SEASONALITY,
  daysInMonth,
} from './forecast-occupancy';

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

/**
 * Properties that don't operate every month of the forecast horizon —
 * business facts the properties table doesn't capture.
 *   seasonMonths — months-of-year (1-12) the property is open.
 *   offlineFrom  — first YYYY-MM the property is permanently offline
 *                  (e.g. being decommissioned).
 * Keyed by properties.id. Edit here when a property's window changes.
 */
type OperatingWindow = { seasonMonths?: number[]; offlineFrom?: string };

const OPERATING_WINDOWS: Record<string, OperatingWindow> = {
  // 4 Brier Neck is a summer-only rental — open June through September.
  '4_brier_neck': { seasonMonths: [6, 7, 8, 9] },
  // 73 Rocky Neck is being decommissioned; last operating month Aug 2026.
  '73_rocky_neck': { offlineFrom: '2026-09' },
};

/** Whether a property is open for business in the given YYYY-MM. */
function isOperating(propertyId: string, ym: string): boolean {
  const w = OPERATING_WINDOWS[propertyId];
  if (!w) return true;
  if (w.offlineFrom && ym >= w.offlineFrom) return false;
  if (w.seasonMonths && !w.seasonMonths.includes(parseInt(ym.slice(5, 7), 10))) {
    return false;
  }
  return true;
}

function nightsBetween(startStr: string, endStr: string): number {
  const ms = new Date(endStr).getTime() - new Date(startStr).getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

function ymd(d: Date): string {
  return d.toISOString().split('T')[0];
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
  /** False when the property is closed or decommissioned that month. */
  operating: boolean;
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
 * Given the booked-by-property data and the historical occupancy
 * benchmark, compute the per-property × per-month smart forecast.
 */
export function computeSmartForecast(
  forwardMonthList: string[],
  bookedByPropMonth: Map<string, Map<string, { nights: number; revenue: number }>>,
  properties: SmartProperty[],
  historicalAvgByMonthOfYear: number[] = HISTORICAL_AVG_RECENT,
): SmartForecast {
  // Active mgmt props only (exclude RT-owned).
  const mgmtProps = properties.filter((p) => !p.isRtOwned);

  // Part B seasonality: share of annual revenue per month-of-year.
  const revenueShare = GLOUCESTER_REVENUE_SEASONALITY;

  // Per-month inputs: portfolio-level pacing computation.
  const monthInputs: SmartMonthInputs[] = forwardMonthList.map((ym) => {
    const [y, m] = ym.split('-').map((s) => parseInt(s, 10));
    const days = daysInMonth(y, m);

    let portfolioNightsBooked = 0;
    let activePropsThisMonth = 0;
    for (const p of mgmtProps) {
      // Only count properties active and operating in this month
      const monthStart = `${ym}-01`;
      if (p.activatedAt && p.activatedAt.slice(0, 10) > monthStart) continue;
      if (!isOperating(p.id, ym)) continue;
      activePropsThisMonth += 1;
      const cell = bookedByPropMonth.get(p.id)?.get(ym);
      if (cell) portfolioNightsBooked += cell.nights;
    }
    const portfolioNightsPossible = days * activePropsThisMonth;
    const pacingPct = portfolioNightsPossible > 0
      ? (portfolioNightsBooked / portfolioNightsPossible) * 100
      : 0;
    const histAvg = historicalAvgByMonthOfYear[m - 1] ?? 0;
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

  // ── Pass 1 — Part A + each property's implied annual gross ──────────
  // Part A is the pacing scale-up: booked revenue × (market occupancy ÷
  // the property's current occupancy), floored at 1×. Summing a
  // property's Part A across its booked months and dividing by the
  // revenue-seasonality share those months represent gives the annual
  // gross the property is pacing toward — the basis for Part B.
  const partAByProp = new Map<string, Map<string, number>>();
  const annualByProp = new Map<string, number>();
  for (const p of mgmtProps) {
    const propBooked = bookedByPropMonth.get(p.id) ?? new Map();
    const partA = new Map<string, number>();
    let paceSum = 0;
    let shareSum = 0;
    for (const ym of forwardMonthList) {
      if (!isOperating(p.id, ym)) continue;
      const cell = propBooked.get(ym);
      if (!cell || cell.revenue <= 0 || cell.nights <= 0) continue;
      const [y, m] = ym.split('-').map((s) => parseInt(s, 10));
      const days = daysInMonth(y, m);
      if (days <= 0) continue;
      const propertyOcc = cell.nights / days;
      const marketOcc = (historicalAvgByMonthOfYear[m - 1] ?? 0) / 100;
      // Floor at 1× — never project below what's already on the books.
      const ratio = propertyOcc > 0 ? Math.max(1, marketOcc / propertyOcc) : 1;
      const a = cell.revenue * ratio;
      partA.set(ym, a);
      paceSum += a;
      shareSum += revenueShare[m - 1] ?? 0;
    }
    partAByProp.set(p.id, partA);
    annualByProp.set(p.id, shareSum > 0 ? paceSum / shareSum : 0);
  }

  // Portfolio-average annual, the fallback for any property with no
  // forward bookings at all (so it still gets a seasonal projection).
  const knownAnnuals = [...annualByProp.values()].filter((v) => v > 0);
  const fallbackAnnual = knownAnnuals.length
    ? knownAnnuals.reduce((s, v) => s + v, 0) / knownAnnuals.length
    : 0;

  // ── Pass 2 — blend Part A and Part B per property × month ───────────
  const propsForecast: SmartPropertyForecast[] = mgmtProps.map((p) => {
    const propBooked = bookedByPropMonth.get(p.id) ?? new Map();
    const partA = partAByProp.get(p.id) ?? new Map<string, number>();
    const ownAnnual = annualByProp.get(p.id) ?? 0;
    const annualGross = ownAnnual > 0 ? ownAnnual : fallbackAnnual;
    const feeFraction = (p.mgmtFeePct ?? 0) / 100;

    const monthly: SmartPropertyMonth[] = forwardMonthList.map((ym) => {
      if (!isOperating(p.id, ym)) {
        // Closed for the season or decommissioned — no projection.
        return {
          month: ym,
          bookedNights: 0,
          bookedRevenue: 0,
          projectedGross: 0,
          projectedMgmtFee: 0,
          operating: false,
        };
      }
      const cell = propBooked.get(ym) ?? { nights: 0, revenue: 0 };
      const monthIdx = parseInt(ym.slice(5, 7), 10) - 1;

      const a = partA.get(ym) ?? null;
      const partB = annualGross * (revenueShare[monthIdx] ?? 0);
      // 50/50 when the month has bookings; 100% Part B when it doesn't.
      const projectedGross = a != null ? 0.5 * a + 0.5 * partB : partB;

      return {
        month: ym,
        bookedNights: cell.nights,
        bookedRevenue: cell.revenue,
        projectedGross,
        projectedMgmtFee: projectedGross * feeFraction,
        operating: true,
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
