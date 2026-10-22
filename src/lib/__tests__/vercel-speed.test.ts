/**
 * /marketing's Speed Insights read Vercel's observability query API.
 *
 * The fetcher called GET /v1/speed-insights, which Vercel's API does not
 * have, so every marketing sync logged a 404 and the page never had a row
 * (2026-10-22). The body, the window and the response parsing are pinned
 * here; the live call was checked against stay-cape-ann by hand.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rollupValue, SPEED_METRICS, speedInsightsQuery, speedInsightsWindow } from '../marketing/vercel-speed.ts';

describe('speed insights', () => {
  test('the window is the seven days ending on the sync date, inclusive', () => {
    assert.deepEqual(speedInsightsWindow('2026-10-21'), {
      startTime: '2026-10-15T00:00:00.000Z',
      endTime: '2026-10-22T00:00:00.000Z',
    });
  });

  test('the query names the team and the project, in day buckets', () => {
    const body = speedInsightsQuery({
      teamId: 'team_x',
      project: 'stay-cape-ann',
      metric: 'vercel.speed_insights.lcp_ms',
      aggregation: 'p75',
      window: speedInsightsWindow('2026-10-21'),
    });
    assert.deepEqual(body.scope, { type: 'project', ownerId: 'team_x', projectIds: ['stay-cape-ann'] });
    assert.equal(body.metric, 'vercel.speed_insights.lcp_ms');
    assert.equal(body.aggregation, 'p75');
    // A 7-day bucket is snapped to calendar weeks and widens the window.
    assert.deepEqual(body.granularity, { days: 1 });
  });

  test('every stored vital has a metric', () => {
    assert.deepEqual(
      SPEED_METRICS.map((m) => m.column).sort(),
      ['cls_p75', 'fcp_p75_ms', 'inp_p75_ms', 'lcp_p75_ms', 'sample_count', 'ttfb_p75_ms'],
    );
    for (const m of SPEED_METRICS) assert.match(m.metric, /^vercel\.speed_insights\./);
  });

  test('the rollup is read from the summary, the shape Vercel returns', () => {
    // Trimmed from a real response for stay-cape-ann, 2026-10-22.
    const res = {
      data: [{ timestamp: '2026-10-15T00:00:00.000Z', vercel_speed_insights_lcp_ms_p75: 1106 }],
      summary: [{ vercel_speed_insights_lcp_ms_p75: 1259.7777099609375 }],
      statistics: { rowsRead: 107374 },
    };
    assert.equal(rollupValue(res), 1259.7777099609375);
    assert.equal(rollupValue({ data: [], summary: [] }), null);
    assert.equal(rollupValue({ summary: [{ vercel_speed_insights_lcp_ms_p75: null }] }), null);
    assert.equal(rollupValue(null), null);
  });

  test('the old endpoint does not come back', () => {
    const src = readFileSync(new URL('../marketing/vercel-speed.ts', import.meta.url), 'utf8');
    assert.ok(src.includes('/v2/observability/query'));
    assert.ok(!src.includes('`${VERCEL_API_BASE}/v1/speed-insights'), 'the fetcher calls /v1/speed-insights again, which 404s');
  });
});
