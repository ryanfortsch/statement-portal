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
 * NO LEAD-TIME BOOKING CURVE, and not for want of trying. Scaling a month by
 * how full months like it usually are at this point would beat all of this,
 * and Helm cannot measure that yet. `bookings.first_seen_at` looks like the
 * field for it and is not: it equals `created_at` on every row of both
 * sources (704/704 ical_import, 445/445 guesty_legacy), so it records when a
 * row was inserted, not when a guest booked. On the legacy rows it also
 * equals `last_seen_at` -- written once by a backfill, never re-observed --
 * and July 2026's nights are ~100% legacy. A curve built on it measures when
 * the sync ran.
 *
 * Backtested anyway, standing on 2026-08-01 with July as the only clean
 * month: dividing the book by July's completion share beat the days-remaining
 * rule below by 0.1% on the 1st and lost badly every day after, 9.1% mean
 * absolute error against 4.5%. July's shape says a month is 98.5% sold by day
 * 14; August was still selling into its final week. Two peak months do not
 * share a shape, and neither of them can speak for a November.
 *
 * guesty_reservations.booked_at now captures Guesty's own confirmedAt. It
 * only works forward, so the curve becomes buildable roughly a year after
 * 2026-09-02, on real timestamps and with a shoulder month among them.
 *
 * The current month runs the same path as every other month, with its uplift
 * over the book pro-rated by the days still ahead. It used to short-circuit
 * to the raw book, which meant the month in progress was forecast to pick up
 * nothing at all, even on the 1st.
 *
 * Blend: 50/50 when a month has bookings, 100% Part B when it doesn't,
 * then floored at the month's booked revenue. The floor is on the blend
 * rather than on Part A alone: a property booked past the benchmark pins
 * Part A at exactly booked, and averaging that with a smaller Part B would
 * otherwise print a forecast under the current book.
 *
 * The annual gross feeding Part B is itself derived from Part A — a
 * property's pacing-corrected booked months, annualized via the
 * seasonality curve. Helm has no complete trailing-year per-property
 * revenue history (guesty_reservations only carries recent + forward
 * stays, and property_statements only a handful of reconciled months),
 * so the property's own forward booking pace is the baseline. Properties
 * with no forward bookings at all fall back to the portfolio average.
 */

import { supabaseAdmin as supabase } from './supabase-admin';
import { selectAllPaged } from './paged-select';
import {
  HISTORICAL_AVG_RECENT,
  GLOUCESTER_REVENUE_SEASONALITY,
  daysInMonth,
} from './forecast-occupancy';
import { isOperating, operatingFactor } from './forecast-operating-windows';

/**
 * Ceiling on the pacing scale-up.
 *
 * Part A takes what a property has on the books for a forward month and
 * scales it by market-occupancy / property-occupancy. That ratio is
 * unbounded as the booked figure approaches zero, so far-out months read
 * absurdly: on 2026-08-26 the portfolio ratio was 2.0x for October, 7.6x
 * for November and 29.2x for December.
 *
 * A cap is a blunt instrument, and the honest reason it is blunt is that
 * Helm cannot yet measure its own booking curve: `bookings.first_seen_at`
 * only starts 2026-05-20, and `guesty_reservations` carries no 2024-25
 * history, so there is no way to say what share of an October is normally
 * on the books in late August. Until there is, this bounds the damage.
 */
const MAX_PACING_MULTIPLIER = 2.5;

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
 * Compute the forward-month list given a starting "today". Returns the
 * months from the start of the CURRENT month through the end of
 * `endYear`. The current month is included: bank actuals lag a month
 * behind, so the in-progress month still needs a live Guesty-based
 * projection rather than the seasonality fallback. Fully-closed past
 * months are skipped — actuals cover them in the Monthly Detail table.
 */
export function forwardMonths(today: Date, endYear: number): string[] {
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
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
/**
 * Load the closed-month stays that the benchmark calibration is measured on.
 *
 * Deliberately a separate read from the forward-booking load: that one starts
 * at the current month, and calibration needs the months BEHIND it. Managed
 * properties only, revenue-bearing and non-cancelled, because an owner block
 * occupies a night without telling us anything about demand.
 */
export async function getClosedMonthStays(
  closedMonths: string[],
): Promise<Array<{ property_id: string | null; check_in: string | null; check_out: string | null }>> {
  if (closedMonths.length === 0) return [];
  const first = closedMonths[0];
  const last = closedMonths[closedMonths.length - 1];
  const [fy, fm] = first.split('-').map((n) => parseInt(n, 10));
  const [ly, lm] = last.split('-').map((n) => parseInt(n, 10));
  const windowStart = ymd(new Date(fy, fm - 1, 1));
  const windowEndExclusive = ymd(new Date(ly, lm, 1));

  const { data: propsData } = await supabase
    .from('properties')
    .select('id, is_rising_tide_owned')
    .eq('is_active', true);
  const managed = new Set(
    (propsData ?? [])
      .filter((p: { is_rising_tide_owned: boolean | null }) => !p.is_rising_tide_owned)
      .map((p: { id: string }) => p.id),
  );
  if (managed.size === 0) return [];

  const rows = await selectAllPaged<{
    property_id: string | null;
    check_in: string | null;
    check_out: string | null;
    status: string | null;
    host_payout: number | null;
    owner_net_revenue_guesty: number | null;
    total_paid: number | null;
  }>(
    (from, to) =>
      supabase
        .from('guesty_reservations')
        .select('property_id, check_in, check_out, status, host_payout, owner_net_revenue_guesty, total_paid')
        .lt('check_in', windowEndExclusive)
        .gt('check_out', windowStart)
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'calibration stays' },
  );

  return rows
    .filter((r) => r.property_id && managed.has(r.property_id))
    .filter((r) => isActiveBooking(r.status))
    .filter(
      (r) =>
        Number(r.host_payout ?? 0) > 0 ||
        Number(r.owner_net_revenue_guesty ?? 0) > 0 ||
        Number(r.total_paid ?? 0) > 0,
    )
    .map((r) => ({ property_id: r.property_id, check_in: r.check_in, check_out: r.check_out }));
}

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
      const factor = operatingFactor(p.id, ym);
      if (factor <= 0) continue;
      // Fractional on the month a property goes offline partway through:
      // its closed days are not bookable, so they must not inflate the
      // denominator and drag portfolio pacing down.
      activePropsThisMonth += factor;
      const cell = bookedByPropMonth.get(p.id)?.get(ym);
      if (cell) portfolioNightsBooked += cell.nights;
    }
    const portfolioNightsPossible = days * activePropsThisMonth;
    const pacingPct = portfolioNightsPossible > 0
      ? (portfolioNightsBooked / portfolioNightsPossible) * 100
      : 0;
    // The benchmark is an EXPECTED FINAL occupancy, so it cannot sit below
    // what the month has already sold. September 2026 is the case that
    // forced this: the calibrated benchmark read 45.9% while the portfolio
    // was already booked past it with four weeks left to sell, which says
    // the month is expected to end below where it already stands.
    //
    // This is a floor, not a correction. Where the benchmark still leads
    // pacing it is used untouched.
    const rawHistAvg = historicalAvgByMonthOfYear[m - 1] ?? 0;
    const histAvg = Math.max(rawHistAvg, pacingPct);
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
      // Floor at 1x: never project below what's already on the books.
      // Cap at MAX_PACING_MULTIPLIER: a month with a handful of bookings
      // produces an arbitrarily large ratio (December 2026 reads 29x off
      // 1.2% booked), and Part A carries half the blend, so an uncapped
      // ratio lets five stays drive a whole month's projection.
      const raw = propertyOcc > 0 ? marketOcc / propertyOcc : 1;
      const ratio = Math.min(MAX_PACING_MULTIPLIER, Math.max(1, raw));
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

  // The current calendar month is special: most of it is already realized
  // by the time the page renders. The pacing scale-up + Part B blend used
  // for future months assumes there is still room to book — for days
  // already past, there isn't. Use what's actually on the books instead.
  const today = new Date();
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  // ── Pass 2 — blend Part A and Part B per property × month ───────────
  const propsForecast: SmartPropertyForecast[] = mgmtProps.map((p) => {
    const propBooked = bookedByPropMonth.get(p.id) ?? new Map();
    const partA = partAByProp.get(p.id) ?? new Map<string, number>();
    const ownAnnual = annualByProp.get(p.id) ?? 0;
    const annualGross = ownAnnual > 0 ? ownAnnual : fallbackAnnual;
    const feeFraction = (p.mgmtFeePct ?? 0) / 100;

    const activated = p.activatedAt ? new Date(p.activatedAt) : null;
    const activatedYM = activated
      ? `${activated.getFullYear()}-${String(activated.getMonth() + 1).padStart(2, '0')}`
      : null;

    const monthly: SmartPropertyMonth[] = forwardMonthList.map((ym) => {
      const preActivation = activatedYM != null && ym < activatedYM;

      if (!isOperating(p.id, ym) || preActivation) {
        // Closed for the season, decommissioned, or not yet activated —
        // no projection.
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
      const [y, m] = ym.split('-').map((s) => parseInt(s, 10));
      const monthIdx = m - 1;

      let projectedGross: number;
      {
        const a = partA.get(ym) ?? null;
        const partB = annualGross * (revenueShare[monthIdx] ?? 0);
        // 50/50 when the month has bookings; 100% Part B when it doesn't.
        projectedGross = a != null ? 0.5 * a + 0.5 * partB : partB;

        // Current month: only the days still ahead can be sold.
        //
        // This used to print `cell.revenue` and stop, on the reasoning that
        // days already past carry no booking capacity. True, and it
        // over-corrected to zero pickup across the WHOLE month, including on
        // the 1st, which is when every day is still ahead of you.
        //
        // Backtested on August, standing on 2026-08-01 with only May, June
        // and July calibrated. Nights are cancellation-aware and deduplicated
        // to distinct (property, date), which is the only internally
        // consistent basis available:
        //
        //     on the books 8/1   339 nights   64.3% occupancy
        //     realized           363 nights   68.9%
        //     old rule           339          -6.6% against realized
        //     new rule           361          -0.5%
        //
        // The uplift over the book is pro-rated by the share of the month
        // still ahead: all of it on the 1st, none on the last day. Below the
        // floor it does nothing, because the floor already holds the book.
        if (ym === currentMonthKey) {
          const dim = daysInMonth(y, m);
          const remaining = Math.max(0, Math.min(1, (dim - today.getDate() + 1) / dim));
          projectedGross = cell.revenue + Math.max(0, projectedGross - cell.revenue) * remaining;
        }


        // Activation month: a mid-month activation only earns from the
        // activation day onward, so pro-rate by the days remaining.
        if (activated && activatedYM != null && ym === activatedYM) {
          const dim = daysInMonth(y, m);
          const factor = Math.max(0, (dim - activated.getDate() + 1) / dim);
          projectedGross *= factor;
        }
      }

      // Offboarding month: a property that goes offline partway through only
      // earns up to its last operating day. Applied outside the branch above
      // so it holds whether the month is projected or read off the books.
      const opFactor = operatingFactor(p.id, ym);
      if (opFactor < 1) projectedGross *= opFactor;

      // Never project below what is already on the books.
      //
      // Part A carries a 1x floor, so Part A alone can never sit under booked
      // revenue. The blend broke that promise anyway: for a property already
      // booked past the benchmark the ratio pins at exactly 1, so Part A
      // EQUALS booked, and averaging it with a smaller Part B lands under. On
      // 2026-09-02 that was ten of seventeen properties for September, 17
      // Beach worst at $28,240 projected against $35,159 booked.
      //
      // Applied LAST, after every pro-rate, because a floor that something
      // else can push you back under is not a floor. Scaled by opFactor for
      // the same reason the projection is: a property that leaves on the 21st
      // cannot be held to a book that runs past the 21st.
      const bookedFloor = cell.revenue * opFactor;
      if (bookedFloor > projectedGross) projectedGross = bookedFloor;

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
