/**
 * Forecast contribution from the live Prospects pipeline.
 *
 * Each prospect record carries everything we need to compute its expected
 * value contribution to RT mgmt-fee revenue:
 *   - mgmt_fee_pct          — RT's take rate negotiated with the owner
 *   - home value / AirDNA / overrides → year-1 monthly gross + mgmt fee
 *   - start_month           — when revenue begins
 *   - close_likelihood_pct  — analyst-entered confidence (0-100); null → 50
 *
 * For a given forecast year we compute, per prospect:
 *   expectedMonthlyMgmtFee[m] = year1MonthlyMgmtFee[m] × closeProbability
 * Aggregated across all prospects → portfolio weighted contribution per
 * month.
 *
 * For 2027/2028 (years AFTER 2026), prospects are assumed to have closed
 * (or not) and contribute a FULL year of expected mgmt fee — start_month
 * ramps no longer apply because they're past their launch window.
 */

import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from './supabase-admin';
import { computeProjection } from './projections-model';
import type { ProjectionRow } from './projections-types';

/**
 * Convert the stored `close_likelihood_pct` (0-100, nullable) into the
 * 0..1 probability the forecast uses. Null treated as 50% — a neutral
 * default for prospects without analyst confidence entered.
 */
function probabilityFrom(p: ProjectionRow): number {
  const raw = p.close_likelihood_pct;
  const pct = raw == null ? 50 : Math.max(0, Math.min(100, Number(raw)));
  return pct / 100;
}

export type ProspectMonthly = {
  prospectId: string;
  name: string;
  market: string;
  bedrooms: number;
  mgmtFeePct: number; // 0.20, 0.22, 0.25, etc.
  closeProbability: number; // 0..1, derived from close_likelihood_pct

  /** Owner-facing annual net payout (the "what the owner gets" number). */
  ownerPayoutLow: number;
  ownerPayoutHigh: number;
  ownerPayoutMid: number;

  /**
   * Year-1 monthly mgmt fee, 12 values starting Jan. For 2026 these reflect
   * the prospect's actual start_month + ramp. For later years it's the
   * full-year run rate.
   */
  monthlyMgmtFee: number[];

  /** Expected (close-weighted) version: monthlyMgmtFee × closeProbability. */
  monthlyExpectedMgmtFee: number[];

  /** Annual mgmt fee at full-year run rate. */
  annualMgmtFee: number;
  /** Annual expected (× close pct). */
  annualExpectedMgmtFee: number;

  /** Property has been promoted to managed (close-won). */
  isClosed: boolean;
};

export type ProspectForecast = {
  prospects: ProspectMonthly[];
  /** Sum of monthlyExpectedMgmtFee across all prospects, per month index 0..11. */
  monthlyExpectedTotals: number[];
  totals: {
    expectedMgmtFee: number;
    headlineOwnerPayoutMid: number;
    count: number;
  };
};

function rampedYear1Monthly(p: ProjectionRow): number[] {
  const result = computeProjection(p);
  return result.monthlyYear1Ramped.map((m) => m.managementFee);
}

function fullYearMonthly(p: ProjectionRow): number[] {
  const result = computeProjection(p);
  return result.monthlyYear1.map((m) => m.managementFee);
}

function ownerPayout(p: ProjectionRow): { low: number; high: number; mid: number } {
  const r = computeProjection(p);
  return {
    low: r.heroLow,
    high: r.heroHigh,
    mid: r.year1.mid.netPayout,
  };
}

/**
 * Fetch prospects from Helm and compute their forecast contribution.
 */
export async function getProspectForecast(forecastYear: number): Promise<ProspectForecast> {
  if (!isConfigured) {
    return emptyForecast();
  }

  const { data, error } = await supabase
    .from('projections')
    .select('*')
    .is('property_id', null) // not yet promoted to managed property
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[forecast-prospects] query failed:', error.message);
    return emptyForecast();
  }

  const rows = (data ?? []) as ProjectionRow[];

  // Today gate: an unlisted prospect (property_id IS NULL — by the query
  // filter, all rows here qualify) can't actually contribute revenue to
  // the current month or any prior month, no matter what start_month says
  // on their projection. By the time they sign + onboard + list, that
  // month is gone. Only applies to the year that contains today.
  const today = new Date();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth() + 1; // 1..12
  const earliestContributingMonth =
    forecastYear === todayYear ? todayMonth + 1 : 1;

  const prospects: ProspectMonthly[] = rows
    .filter((p) => p.property_address && p.home_value > 0)
    .map((p) => {
      const monthly = forecastYear === 2026 ? rampedYear1Monthly(p) : fullYearMonthly(p);
      const closeProbability = probabilityFrom(p);
      // Zero out months at or before today's month for the current year —
      // unlisted prospects can't backfill revenue they didn't earn.
      const monthlyAfterTodayGate = monthly.map((v, i) =>
        i + 1 < earliestContributingMonth ? 0 : v
      );
      const monthlyExpected = monthlyAfterTodayGate.map((v) => v * closeProbability);
      const payout = ownerPayout(p);

      return {
        prospectId: p.id,
        name: p.prospect_name || p.property_address,
        market: p.market,
        bedrooms: p.bedrooms,
        mgmtFeePct: p.mgmt_fee_pct,
        closeProbability,
        ownerPayoutLow: payout.low,
        ownerPayoutHigh: payout.high,
        ownerPayoutMid: payout.mid,
        monthlyMgmtFee: monthly,
        monthlyExpectedMgmtFee: monthlyExpected,
        annualMgmtFee: monthly.reduce((s, v) => s + v, 0),
        annualExpectedMgmtFee: monthlyExpected.reduce((s, v) => s + v, 0),
        isClosed: !!p.contract_signed_at,
      };
    });

  const monthlyExpectedTotals = Array(12).fill(0);
  for (const p of prospects) {
    for (let i = 0; i < 12; i++) {
      monthlyExpectedTotals[i] += p.monthlyExpectedMgmtFee[i];
    }
  }

  return {
    prospects,
    monthlyExpectedTotals,
    totals: {
      expectedMgmtFee: prospects.reduce((s, p) => s + p.annualExpectedMgmtFee, 0),
      headlineOwnerPayoutMid: prospects.reduce((s, p) => s + p.ownerPayoutMid, 0),
      count: prospects.length,
    },
  };
}

function emptyForecast(): ProspectForecast {
  return {
    prospects: [],
    monthlyExpectedTotals: Array(12).fill(0),
    totals: { expectedMgmtFee: 0, headlineOwnerPayoutMid: 0, count: 0 },
  };
}
