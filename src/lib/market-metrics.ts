/**
 * Market metrics (AirDNA) — shared computation lib.
 *
 * The DB table `market_metrics_monthly` stores raw monthly readings:
 *   { market_slug, month, active_listings, occupancy_rate, avg_listing_revenue }
 *
 * Two surfaces consume this data:
 *
 *   1) Helm's public snapshot API (/api/markets/airdna/[slug]) — turns
 *      the raw rows into the shape the rising-tide-str
 *      <MarketSnapshot /> component already expects (KPI cards +
 *      chart points).
 *
 *   2) Helm's reminder cron (/api/cron/airdna-reminder) — finds
 *      markets that are missing the previous month's reading after
 *      AirDNA's typical mid-month publish window.
 *
 * Keeping the maths in this module (rather than baked into the route
 * handler) means the reminder cron can use the same "last month for a
 * market" helpers without rebuilding them.
 *
 * Conventions:
 *   - `month` columns are always the first of the month (date).
 *   - `occupancy_rate` is a percent (e.g. 49.6 means 49.6%).
 *   - Revenue / listings YoY deltas are in percent; occupancy YoY
 *     deltas are in percentage POINTS (the existing
 *     <MarketSnapshot /> already renders the "pp" suffix).
 */

import { createClient } from "@supabase/supabase-js";

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Cape Ann off-season window. The headline verdict on a town page
 *  defaults to "Off-Season" when the trailing-3-month window sits
 *  entirely inside this set so off-peak YoY swings don't read as
 *  structural trends. */
const OFF_SEASON_MONTHS = new Set([10, 11, 0, 1, 2, 3]); // Nov, Dec, Jan, Feb, Mar, Apr (0-indexed)

const SEASONAL_NOTE =
  "Cape Ann is a seasonal market. The bulk of an owner's year lands between May and October, so quiet winter months aren't the right window to read a structural trend.";

export type MarketRow = {
  market_slug: string;
  month: string; // YYYY-MM-DD
  active_listings: number | null;
  occupancy_rate: number | null;
  avg_listing_revenue: number | null;
  source: string;
};

export type MarketMetricCard = {
  label: string;
  current: string;
  t3m: string;
  t3mPositive: boolean;
  recent: string;
  recentPositive: boolean;
  recentLabel: string;
};

export type MarketChartPoint = {
  month: string;
  monthly: number;
  avg12: number;
};

export type MarketSnapshot = {
  asOf: string;
  revenue: MarketMetricCard;
  occupancy: MarketMetricCard;
  listings: MarketMetricCard;
  health: "Strengthening" | "Steady" | "Cooling" | "Off-Season";
  healthNote?: string;
  chart: {
    title: string;
    yFormat: "currency" | "percentage" | "number";
    points: MarketChartPoint[];
  };
  source: string;
};

// --- DB access ----------------------------------------------------

/** Read-only Supabase client. Public select policy on
 *  market_metrics_monthly means the anon key is enough. */
function readClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing",
    );
  }
  return createClient(url, key);
}

/** Service-role client for writes (ingest, manual edits). */
export function writeClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing",
    );
  }
  return createClient(url, key);
}

export async function readAllMonths(marketSlug: string): Promise<MarketRow[]> {
  const supa = readClient();
  const { data, error } = await supa
    .from("market_metrics_monthly")
    .select(
      "market_slug, month, active_listings, occupancy_rate, avg_listing_revenue, source",
    )
    .eq("market_slug", marketSlug)
    .order("month", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MarketRow[];
}

/** Latest month per market across the whole table. Used by the
 *  reminder cron to spot markets still missing the previous month. */
export async function readLatestMonthByMarket(): Promise<
  Record<string, string>
> {
  const supa = readClient();
  const { data, error } = await supa
    .from("market_metrics_monthly")
    .select("market_slug, month")
    .order("month", { ascending: false });
  if (error) throw error;
  const latest: Record<string, string> = {};
  for (const row of data ?? []) {
    if (!latest[row.market_slug]) latest[row.market_slug] = row.month;
  }
  return latest;
}

// --- Computation --------------------------------------------------

function parseMonth(s: string): { year: number; monthIdx: number } {
  // Tolerate both 'YYYY-MM-DD' and 'YYYY-MM' just in case.
  const [y, m] = s.split("-");
  return { year: Number(y), monthIdx: Number(m) - 1 };
}

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

function fmtPctDelta(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function fmtPpDelta(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "" : "";
  return `${sign}${n.toFixed(1)}pp`;
}

function fmtCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function buildSeries(monthly: number[], firstMonth: string): MarketChartPoint[] {
  const { year: startY, monthIdx: startM } = parseMonth(firstMonth);
  return monthly.map((value, i) => {
    const monthIdx = (startM + i) % 12;
    const year = startY + Math.floor((startM + i) / 12);
    const start = Math.max(0, i - 11);
    const window = monthly.slice(start, i + 1);
    return {
      month: `${MONTH_SHORT[monthIdx]} ${year}`,
      monthly: value,
      avg12: Math.round(avg(window)),
    };
  });
}

const pctChange = (cur: number, prev: number) =>
  prev === 0 ? 0 : ((cur - prev) / prev) * 100;
const ppChange = (cur: number, prev: number) => cur - prev;

/** YYYY-MM-DD of the same calendar month one year earlier. */
function yearAgoKey(monthKey: string): string {
  const { year, monthIdx } = parseMonth(monthKey);
  return `${year - 1}-${String(monthIdx + 1).padStart(2, "0")}-01`;
}

type MetricKind = "money" | "pct" | "count";

type MetricCalc = {
  curT3M: number;
  /** Percent for money/count, percentage-points for pct metrics. */
  t3mDelta: number;
  /** null when there's no year-ago value to compare the latest month to. */
  recentDelta: number | null;
  /** Month index (0-11) of THIS metric's latest non-null reading. */
  recentMonthIdx: number;
};

/**
 * Compute a metric's headline numbers from ONLY the months where that
 * metric is actually present.
 *
 * Why per-metric: AirDNA's single-metric exports (Average Revenue,
 * Occupancy, Occupancy by Bedrooms) don't carry an active-listings
 * column. So a market can be current through May on revenue + occupancy
 * but only through, say, March on listings. The old code assumed the
 * latest ROW had all three metrics and compared a null latest listings
 * against last year, producing a bogus "-100% (May YoY)". Sourcing each
 * card from its own latest non-null reading fixes that: listings shows
 * its real last value with an honest "(Mar YoY)" label instead.
 */
function computeMetric(
  sorted: MarketRow[],
  pick: (r: MarketRow) => number | null,
  isPct: boolean,
): MetricCalc | null {
  const series = sorted
    .map((r) => ({ month: r.month, value: Number(pick(r)) }))
    .filter((x) => Number.isFinite(x.value));
  if (series.length === 0) return null;

  const byMonth = new Map<string, number>(series.map((s) => [s.month, s.value]));
  const latest = series[series.length - 1];
  const { monthIdx: recentMonthIdx } = parseMonth(latest.month);

  // T3M = the last up-to-3 months that HAVE this metric (not the last 3
  // calendar months, which may be null for this metric).
  const last3 = series.slice(-3);
  const curT3M = avg(last3.map((s) => s.value));
  const yaT3M = avg(
    last3
      .map((s) => byMonth.get(yearAgoKey(s.month)))
      .filter((v): v is number => v !== undefined),
  );
  const t3mDelta = isPct ? ppChange(curT3M, yaT3M) : pctChange(curT3M, yaT3M);

  const recentYa = byMonth.get(yearAgoKey(latest.month));
  const recentDelta =
    recentYa === undefined
      ? null
      : isPct
        ? ppChange(latest.value, recentYa)
        : pctChange(latest.value, recentYa);

  return { curT3M, t3mDelta, recentDelta, recentMonthIdx };
}

function toCard(label: string, kind: MetricKind, m: MetricCalc | null): MarketMetricCard {
  if (!m) {
    return {
      label,
      current: "—",
      t3m: "—",
      t3mPositive: true,
      recent: "—",
      recentPositive: true,
      recentLabel: "",
    };
  }
  const deltaFmt = kind === "pct" ? fmtPpDelta : fmtPctDelta;
  const current =
    kind === "money" ? fmtMoney(m.curT3M) : kind === "pct" ? fmtPct(m.curT3M) : fmtCount(m.curT3M);
  return {
    label,
    current,
    t3m: deltaFmt(m.t3mDelta),
    t3mPositive: m.t3mDelta >= 0,
    recent: m.recentDelta === null ? "—" : deltaFmt(m.recentDelta),
    recentPositive: m.recentDelta === null ? true : m.recentDelta >= 0,
    recentLabel: `(${MONTH_SHORT[m.recentMonthIdx]} YoY)`,
  };
}

/** Build the full snapshot the public API returns. Pure function of
 *  the rows — no DB access — so the cron can pass synthetic rows
 *  in tests. */
export function buildSnapshot(rows: MarketRow[]): MarketSnapshot | null {
  if (rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const latest = sorted[sorted.length - 1];
  const { year: latestYear, monthIdx: latestMonthIdx } = parseMonth(latest.month);

  // --- Card-level numbers ----------------------------------------
  // Each card is computed from ONLY the months where its metric is
  // present, so a market that's current-through-May on revenue but
  // only-through-March on listings shows each honestly (see
  // computeMetric). The old code assumed the latest row had all three
  // metrics and produced a bogus "-100% (May YoY)" when listings were
  // null for the freshest months.
  const last3 = sorted.slice(-3);

  const revCalc = computeMetric(sorted, (r) => r.avg_listing_revenue, false);
  const occCalc = computeMetric(sorted, (r) => r.occupancy_rate, true);
  const listCalc = computeMetric(sorted, (r) => r.active_listings, false);

  const revenue = toCard("Avg monthly rental revenue", "money", revCalc);
  const occupancy = toCard("Market occupancy", "pct", occCalc);
  const listings = toCard("Active listings", "count", listCalc);

  // Revenue T3M YoY drives the health verdict.
  const revT3MDelta = revCalc?.t3mDelta ?? 0;

  // --- Health verdict --------------------------------------------
  // Default to a tone that doesn't over-interpret off-peak swings on
  // a seasonal market. Inside the Cape Ann off-season window, force
  // "Off-Season" and surface the seasonality note. Otherwise infer
  // from T3M revenue YoY.
  const offSeasonT3M = last3.every((r) =>
    OFF_SEASON_MONTHS.has(parseMonth(r.month).monthIdx),
  );

  let health: MarketSnapshot["health"];
  let healthNote: string | undefined;
  if (offSeasonT3M) {
    health = "Off-Season";
    healthNote = SEASONAL_NOTE;
  } else if (revT3MDelta >= 5) {
    health = "Strengthening";
  } else if (revT3MDelta <= -5) {
    health = "Cooling";
  } else {
    health = "Steady";
  }

  // --- Chart series ---------------------------------------------
  // Round to whole dollars at the source so the chart + its hover
  // tooltip never render cents (AirDNA hands us values like 4207.68).
  const chartMonthly = sorted.map((r) => Math.round(Number(r.avg_listing_revenue ?? 0)));
  const chartPoints = buildSeries(chartMonthly, sorted[0].month);

  return {
    asOf: `Data through ${MONTH_LONG[latestMonthIdx]} ${latestYear}`,
    revenue,
    occupancy,
    listings,
    health,
    healthNote,
    chart: {
      title: "Avg Monthly Rental Revenue ($)",
      yFormat: "currency",
      points: chartPoints,
    },
    source: "AirDNA",
  };
}

/** Returns the YYYY-MM-DD of the previous calendar month, first day. */
export function previousMonthKey(today: Date = new Date()): string {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth(); // 0-11
  const prev = new Date(Date.UTC(y, m - 1, 1));
  const py = prev.getUTCFullYear();
  const pm = String(prev.getUTCMonth() + 1).padStart(2, "0");
  return `${py}-${pm}-01`;
}

/** Format a YYYY-MM-DD month as "April 2026". */
export function formatMonthLong(monthKey: string): string {
  const { year, monthIdx } = parseMonth(monthKey);
  return `${MONTH_LONG[monthIdx]} ${year}`;
}

/** The set of markets the rising-tide-str site currently renders.
 *  Reminder cron uses this; ingest accepts any. Add a market here
 *  when you add /markets/<slug> on the public site. */
export const PUBLIC_MARKETS = ["gloucester", "rockport"] as const;
