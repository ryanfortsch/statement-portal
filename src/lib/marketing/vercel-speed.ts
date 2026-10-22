// Vercel Speed Insights: trailing 7-day p75 of Core Web Vitals per
// project, from Vercel's observability query API (POST
// /v2/observability/query, the vercel.speed_insights.* metrics). Auth via
// VERCEL_API_TOKEN, a personal token, so every query names the team.
//
// This used to GET /v1/speed-insights, which is not in Vercel's API at all
// (checked against the CLI's OpenAPI spec, 2026-10-22). Every marketing
// sync logged "404 for project stay-cape-ann" and /marketing never got a
// Speed Insights row. The project is staycapeann.com's Vercel project,
// `stay-cape-ann` (prj_FUW7B2zJRqnM7fURGEdroPWLgHmd); the query API takes
// the id or the name, so marketing_sites.vercel_project_id may hold either.

const VERCEL_API_BASE = 'https://api.vercel.com';

/** The Rising Tide team (rising-tide-fc584d5d), which owns stay-cape-ann.
 *  An id, not a secret; VERCEL_TEAM_ID overrides it. */
export const RISING_TIDE_VERCEL_TEAM_ID = 'team_V5mX3oTPV1F5dltLhEjkRJFb';

export type SpeedInsightsP75 = {
  lcp_p75_ms: number | null;
  inp_p75_ms: number | null;
  cls_p75: number | null;
  fcp_p75_ms: number | null;
  ttfb_p75_ms: number | null;
  sample_count: number | null;
};

/** Each stored column, the metric it reads, and how. The sample count is
 *  the page loads that reported an LCP, the vital the page leads with. */
export const SPEED_METRICS: ReadonlyArray<{ column: keyof SpeedInsightsP75; metric: string; aggregation: 'p75' | 'sum' }> = [
  { column: 'lcp_p75_ms', metric: 'vercel.speed_insights.lcp_ms', aggregation: 'p75' },
  { column: 'inp_p75_ms', metric: 'vercel.speed_insights.inp_ms', aggregation: 'p75' },
  { column: 'cls_p75', metric: 'vercel.speed_insights.cls', aggregation: 'p75' },
  { column: 'fcp_p75_ms', metric: 'vercel.speed_insights.fcp_ms', aggregation: 'p75' },
  { column: 'ttfb_p75_ms', metric: 'vercel.speed_insights.ttfb_ms', aggregation: 'p75' },
  { column: 'sample_count', metric: 'vercel.speed_insights.lcp_count', aggregation: 'sum' },
];

/**
 * The seven days ending on `endDateISO`, inclusive, as UTC day bounds. Day
 * buckets keep the window exact: a 7-day bucket is snapped to calendar
 * weeks and widens the window.
 */
export function speedInsightsWindow(endDateISO: string): { startTime: string; endTime: string } {
  const end = Date.parse(`${endDateISO.slice(0, 10)}T00:00:00.000Z`);
  const day = 24 * 3600 * 1000;
  return {
    startTime: new Date(end - 6 * day).toISOString(),
    endTime: new Date(end + day).toISOString(),
  };
}

/** The query body for one metric over the window. */
export function speedInsightsQuery(args: {
  teamId: string;
  project: string;
  metric: string;
  aggregation: string;
  window: { startTime: string; endTime: string };
}): Record<string, unknown> {
  return {
    scope: { type: 'project', ownerId: args.teamId, projectIds: [args.project] },
    metric: args.metric,
    aggregation: args.aggregation,
    startTime: args.window.startTime,
    endTime: args.window.endTime,
    granularity: { days: 1 },
    limit: 10,
  };
}

/** The window's rollup from a query response: the one number in
 *  `summary[0]` (keyed like `vercel_speed_insights_lcp_ms_p75`). Null when
 *  the window has no data. */
export function rollupValue(json: unknown): number | null {
  const summary = (json as { summary?: unknown } | null)?.summary;
  const first = Array.isArray(summary) ? (summary[0] as Record<string, unknown> | undefined) : undefined;
  if (!first || typeof first !== 'object') return null;
  for (const v of Object.values(first)) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/** Whole milliseconds and a four-place CLS: what the page prints. */
function tidy(column: keyof SpeedInsightsP75, v: number | null): number | null {
  if (v == null) return null;
  if (column === 'cls_p75') return Math.round(v * 10_000) / 10_000;
  return Math.round(v);
}

export async function fetchSpeedInsights(
  projectId: string,
  endDateISO: string,
): Promise<SpeedInsightsP75 | null> {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) throw new Error('VERCEL_API_TOKEN env var not set');
  const teamId = process.env.VERCEL_TEAM_ID || RISING_TIDE_VERCEL_TEAM_ID;
  const window = speedInsightsWindow(endDateISO);
  const url = `${VERCEL_API_BASE}/v2/observability/query?teamId=${encodeURIComponent(teamId)}`;

  const values = await Promise.all(
    SPEED_METRICS.map(async ({ column, metric, aggregation }) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(speedInsightsQuery({ teamId, project: projectId, metric, aggregation, window })),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        throw new Error(`Vercel Speed Insights ${metric} failed for ${projectId}: ${res.status} ${(await res.text()).slice(0, 300)}`);
      }
      return [column, tidy(column, rollupValue(await res.json()))] as const;
    }),
  );

  const out = Object.fromEntries(values) as SpeedInsightsP75;
  // No page load reported a vital in the window: no row, rather than a row
  // of nulls that reads as "measured and blank".
  if (out.lcp_p75_ms == null && out.inp_p75_ms == null && out.cls_p75 == null && !out.sample_count) return null;
  return out;
}
