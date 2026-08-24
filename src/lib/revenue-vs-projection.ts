import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { computeProjection } from '@/lib/projections-model';
import type { ProjectionRow } from '@/lib/projections-types';

/**
 * "Against projection" layer for the Revenue page.
 *
 * Every managed property promoted out of a prospect carries a
 * `projection_id`. That projection is the number Rising Tide put in front of
 * the owner, so it is the budget the property is actually held to. This
 * module turns those projections into a revenue target for any date range
 * the Revenue page can ask for, and reports coverage honestly so the
 * comparison never mixes projected and unprojected homes.
 *
 * Nothing here touches the revenue math itself (see revenue-snapshot.ts) or
 * statement payout math. It reads projections, computes the same model the
 * proposal deck renders, and joins by property id.
 *
 * Calendar-year semantics come straight from the deliverable: the render
 * page's "Launch year" slide labels Year 1 as the calendar year of
 * `presentation_month`, ramped from `start_month`; Year 2 is the following
 * calendar year at full run rate. So:
 *
 *   year <  launch year   -> no target (property wasn't pitched yet)
 *   year == launch year   -> monthlyYear1Ramped (partial, ramped)
 *   year == launch + 1    -> monthlyYear2
 *   year >  launch + 1    -> monthlyYear2 held flat (run rate)
 *
 * Holding Year 2 flat beyond year 3 is deliberate: `year2_growth_pct` is a
 * one-step launch-to-steady-state assumption, not a compounding forecast,
 * and compounding it would invent a target the owner never saw.
 */

export type ProjectionBaseline = {
  propertyId: string;
  projectionId: string;
  propertyAddress: string | null;
  /** Calendar year the proposal treats as Year 1. */
  launchYear: number;
  /** Gross revenue by calendar month index (0-11) for the launch year, ramped. */
  year1Monthly: number[];
  /** Gross revenue by calendar month index for Year 2 and beyond. */
  year2Monthly: number[];
  /** Annualized figures for context lines. */
  year1AnnualGross: number;
  year2AnnualGross: number;
};

export type PropertyVsProjection = {
  propertyId: string;
  target: number;
  actual: number;
  /** actual / target, null when target is 0. */
  ratio: number | null;
};

export type VsProjectionSummary = {
  /** Properties with a projection baseline covering part of the range. */
  covered: PropertyVsProjection[];
  /** Sum of targets across covered properties. */
  target: number;
  /** Sum of ACTUALS for those same covered properties only. */
  actual: number;
  ratio: number | null;
  coveredCount: number;
  /** Active properties in the snapshot, projected or not. */
  totalCount: number;
};

const DAY_MS = 86400_000;

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * Load every active property that has a projection, and precompute its
 * monthly gross-revenue curve. Returns a map keyed by property id.
 *
 * Best-effort like the rest of the Revenue page: any failure yields an
 * empty map, which renders as "no projection coverage" rather than an error.
 */
export async function loadProjectionBaselines(): Promise<Map<string, ProjectionBaseline>> {
  const out = new Map<string, ProjectionBaseline>();
  if (!isServiceConfigured) return out;
  try {
    const { data: props, error: propsErr } = await supabaseAdmin
      .from('properties')
      .select('id, projection_id')
      .eq('is_active', true)
      .not('projection_id', 'is', null);
    if (propsErr) throw propsErr;
    const rows = (props ?? []) as Array<{ id: string; projection_id: string }>;
    if (rows.length === 0) return out;

    const { data: projs, error: projErr } = await supabaseAdmin
      .from('projections')
      .select('*')
      .in('id', rows.map((r) => r.projection_id));
    if (projErr) throw projErr;
    const byId = new Map(
      ((projs ?? []) as ProjectionRow[]).map((p) => [p.id, p]),
    );

    for (const { id: propertyId, projection_id } of rows) {
      const projection = byId.get(projection_id);
      if (!projection) continue;
      let computed;
      try {
        computed = computeProjection(projection);
      } catch {
        // A projection missing model inputs (market, bedrooms, home value)
        // simply contributes no target rather than breaking the page.
        continue;
      }
      const launchYear = (() => {
        const y = projection.presentation_month?.split('-')[0];
        const parsed = y ? Number(y) : NaN;
        return Number.isFinite(parsed) ? parsed : new Date().getUTCFullYear();
      })();

      out.set(propertyId, {
        propertyId,
        projectionId: projection_id,
        propertyAddress: projection.property_address ?? null,
        launchYear,
        year1Monthly: computed.monthlyYear1Ramped.map((m) => m.grossRevenue),
        year2Monthly: computed.monthlyYear2.map((m) => m.grossRevenue),
        year1AnnualGross: computed.year1Ramped.grossRevenue,
        year2AnnualGross: computed.year2.grossRevenue,
      });
    }
    return out;
  } catch {
    return out;
  }
}

/** The projected gross for one calendar month, per the year mapping above. */
function monthlyTarget(baseline: ProjectionBaseline, year: number, month0: number): number {
  if (year < baseline.launchYear) return 0;
  const curve = year === baseline.launchYear ? baseline.year1Monthly : baseline.year2Monthly;
  return curve[month0] ?? 0;
}

/**
 * Projected gross revenue for an arbitrary [rangeStart, rangeEnd] window,
 * inclusive of both endpoints (the Revenue page's convention). Partial
 * months are prorated by day count, so "last 30 days" and month-to-date
 * both land on a sensible slice of the monthly curve.
 */
export function targetForRange(
  baseline: ProjectionBaseline,
  rangeStart: string,
  rangeEnd: string,
): number {
  const start = Date.parse(`${rangeStart}T00:00:00Z`);
  const end = Date.parse(`${rangeEnd}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;

  let total = 0;
  // Walk month by month from the range start.
  const cursor = new Date(start);
  cursor.setUTCDate(1);
  while (cursor.getTime() <= end) {
    const year = cursor.getUTCFullYear();
    const month0 = cursor.getUTCMonth();
    const dim = daysInMonth(year, month0);
    const monthStart = Date.UTC(year, month0, 1);
    const monthEnd = Date.UTC(year, month0, dim);

    const overlapStart = Math.max(monthStart, start);
    const overlapEnd = Math.min(monthEnd, end);
    if (overlapEnd >= overlapStart) {
      const days = Math.round((overlapEnd - overlapStart) / DAY_MS) + 1;
      const monthly = monthlyTarget(baseline, year, month0);
      total += monthly * (days / dim);
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return total;
}

/**
 * Roll per-property actuals against their projection targets.
 *
 * Only properties WITH a baseline contribute to either side of the ratio.
 * Summing portfolio-wide actuals against a target that covers 9 of 19 homes
 * would read as a catastrophic overshoot; comparing like with like, and
 * naming the coverage, is the whole point.
 */
export function summarizeVsProjection(
  actualsByProperty: Array<{ propertyId: string; revenue: number | null }>,
  baselines: Map<string, ProjectionBaseline>,
  rangeStart: string,
  rangeEnd: string,
): VsProjectionSummary {
  const covered: PropertyVsProjection[] = [];
  let target = 0;
  let actual = 0;

  for (const row of actualsByProperty) {
    const baseline = baselines.get(row.propertyId);
    if (!baseline) continue;
    const t = targetForRange(baseline, rangeStart, rangeEnd);
    // A property whose range predates its launch year has no target; leaving
    // it in would credit its actuals against zero and inflate the ratio.
    if (t <= 0) continue;
    const a = row.revenue ?? 0;
    covered.push({ propertyId: row.propertyId, target: t, actual: a, ratio: a / t });
    target += t;
    actual += a;
  }

  return {
    covered,
    target,
    actual,
    ratio: target > 0 ? actual / target : null,
    coveredCount: covered.length,
    totalCount: actualsByProperty.length,
  };
}
