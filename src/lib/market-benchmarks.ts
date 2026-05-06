/**
 * Market Context: trailing same-month average revenue from AirDNA, used to
 * frame an actual owner payout against what a comparable property in the
 * same market and bedroom count would have earned.
 *
 * Defaults assume Rising Tide's standard math:
 *   - 25% management fee
 *   - 10% cleaning run-rate (an Allie / Ryan benchmark, not a per-property
 *     calculation; some properties run higher in months with high turnover,
 *     some lower)
 *
 * Use `getTrailingMonthlyBenchmark()` for the raw lookup. Use
 * `marketAndBedroomsForProperty()` to derive the right comp from a Helm
 * property row. Use `impliedOwnerPayout()` to convert revenue to a payout-
 * equivalent.
 */
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import type { HelmPropertyRow } from '@/lib/properties';

export type MarketKey = 'gloucester' | 'rockport' | 'beverly';

const VALID_MARKETS: MarketKey[] = ['gloucester', 'rockport', 'beverly'];

export const DEFAULT_MGMT_FEE_PCT = 25;
export const DEFAULT_CLEANING_RUN_RATE_PCT = 10;

/**
 * Default trailing window. For a statement in (year, month), we look at
 * the same month in the prior 3 years. We deliberately don't include the
 * statement's own year because the question we're answering is "did we
 * beat the market this period?" — including the period itself collapses
 * the comparison.
 */
export const DEFAULT_TRAILING_YEARS = 3;

export type TrailingMonthlyBenchmark = {
  /** Mean of the underlying observations. */
  avg_revenue: number;
  /** Raw observations averaged (one per year in the trailing window). */
  observations: Array<{ year: number; month: number; avg_revenue: number }>;
  /** The market and bedrooms used. */
  market: MarketKey;
  bedrooms: number;
  /** Window the average covers, inclusive. */
  from_year: number;
  to_year: number;
};

export type ImpliedPayoutBreakdown = {
  revenue: number;
  mgmt_fee: number;
  cleaning: number;
  payout: number;
  mgmt_fee_pct: number;
  cleaning_pct: number;
};

/**
 * Reads the AirDNA observations from `market_revenue_benchmarks` and
 * averages the same-month rows in the trailing window.
 *
 * Returns null if Helm Supabase isn't configured, the property has no
 * benchmarkable market, or no observations exist in the window.
 */
export async function getTrailingMonthlyBenchmark(opts: {
  market: MarketKey;
  bedrooms: number;
  /** YYYY-MM string, e.g. "2026-04" */
  month: string;
  trailingYears?: number;
}): Promise<TrailingMonthlyBenchmark | null> {
  if (!isHelmConfigured) return null;

  const trailingYears = opts.trailingYears ?? DEFAULT_TRAILING_YEARS;
  const [yearStr, monthStr] = opts.month.split('-');
  const statementYear = Number(yearStr);
  const statementMonth = Number(monthStr);
  if (!Number.isFinite(statementYear) || !Number.isFinite(statementMonth)) {
    return null;
  }

  const toYear = statementYear - 1;
  const fromYear = toYear - (trailingYears - 1);

  const { data, error } = await supabase
    .from('market_revenue_benchmarks')
    .select('year, month, avg_revenue')
    .eq('market', opts.market)
    .eq('bedrooms', opts.bedrooms)
    .eq('month', statementMonth)
    .gte('year', fromYear)
    .lte('year', toYear)
    .order('year', { ascending: true });

  if (error) throw error;
  const obs = (data ?? []) as Array<{ year: number; month: number; avg_revenue: number }>;
  if (obs.length === 0) return null;

  const sum = obs.reduce((acc, r) => acc + Number(r.avg_revenue), 0);
  const avg = sum / obs.length;

  return {
    avg_revenue: avg,
    observations: obs,
    market: opts.market,
    bedrooms: opts.bedrooms,
    from_year: fromYear,
    to_year: toYear,
  };
}

/**
 * Converts a market revenue number into the equivalent owner payout, using
 * the management fee and cleaning run-rate. The result is what the average
 * comparable owner would net after Rising Tide's standard fee structure.
 *
 * If a property has its own management fee that differs from 25%, pass it
 * here so the comparison is apples-to-apples for that owner. Cleaning is
 * always an estimate (no per-property cleaning data on the comp side), so
 * the run-rate stays a single dial.
 */
export function impliedOwnerPayout(
  revenue: number,
  opts?: { mgmt_fee_pct?: number; cleaning_pct?: number },
): ImpliedPayoutBreakdown {
  const mgmtPct = opts?.mgmt_fee_pct ?? DEFAULT_MGMT_FEE_PCT;
  const cleanPct = opts?.cleaning_pct ?? DEFAULT_CLEANING_RUN_RATE_PCT;
  const mgmt_fee = revenue * (mgmtPct / 100);
  const cleaning = revenue * (cleanPct / 100);
  const payout = revenue - mgmt_fee - cleaning;
  return {
    revenue,
    mgmt_fee,
    cleaning,
    payout,
    mgmt_fee_pct: mgmtPct,
    cleaning_pct: cleanPct,
  };
}

/**
 * Pulls the AirDNA market and the bedroom count off a Helm property row.
 * Returns null when either piece is missing — the caller should hide the
 * Market Context tile rather than render a partial comparison.
 *
 * Handles the AirDNA "6+" bedroom bucket: any bedroom count >= 6 is
 * collapsed to 6 for the lookup (matches how the seed file stores it).
 */
export function marketAndBedroomsForProperty(
  p: Pick<HelmPropertyRow, 'market' | 'bedrooms'>,
): { market: MarketKey; bedrooms: number } | null {
  if (!p.market || p.bedrooms == null) return null;
  if (!VALID_MARKETS.includes(p.market as MarketKey)) return null;
  const bedrooms = Math.max(1, Math.min(6, p.bedrooms));
  return { market: p.market as MarketKey, bedrooms };
}

/**
 * Pretty-prints a market key for UI tooltips and labels.
 */
export function marketLabel(market: MarketKey): string {
  switch (market) {
    case 'gloucester': return 'Gloucester';
    case 'rockport': return 'Rockport';
    case 'beverly': return 'Beverly';
  }
}

/**
 * Pretty-prints a bedroom count, mapping 6 back to "6+" to mirror AirDNA.
 */
export function bedroomLabel(bedrooms: number): string {
  return bedrooms >= 6 ? '6+ BR' : `${bedrooms} BR`;
}
