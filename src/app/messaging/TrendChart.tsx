'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import type { TimeseriesPoint } from '@/lib/stay-concierge';

type Props = {
  series: TimeseriesPoint[];
};

/**
 * Rolling 7-day one-shot rate over the last 30 days.
 *
 * Daily values are too noisy at this volume (some days have 0 inbound,
 * others have 8+), so the line plots a trailing-7-day rate. The numerator
 * and denominator both get rolled, which keeps the metric meaningful
 * even on quiet days. Hover shows the raw activity for the day itself.
 */
export function TrendChart({ series }: Props) {
  if (series.length === 0) {
    return (
      <EmptyState message="No activity in the last 30 days." />
    );
  }
  // Filter out leading days with no rolling rate available (first ~few
  // days seed the trailing window).
  const plot = series
    .filter((p) => p.rolling_one_shot_rate !== null)
    .map((p) => ({
      ...p,
      rate_pct: (p.rolling_one_shot_rate ?? 0) * 100,
    }));

  if (plot.length === 0) {
    return <EmptyState message="Not enough data yet for a trend line. Check back in a few days." />;
  }

  const currentRate = plot[plot.length - 1].rate_pct;
  // Y-axis range: 0 to max+5, capped at 100. Keeps small numbers readable.
  const max = Math.max(...plot.map((p) => p.rate_pct));
  const yMax = Math.min(100, Math.max(20, Math.ceil((max + 5) / 5) * 5));

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 10,
        }}
      >
        <div className="eyebrow" style={{ color: 'var(--ink-4)' }}>
          One-shot rate · trailing 7-day rolling · last 30 days
        </div>
        <div className="eyebrow" style={{ color: 'var(--ink-4)' }}>
          today: <b style={{ color: 'var(--ink)' }}>{currentRate.toFixed(1)}%</b>
        </div>
      </div>
      <div style={{ width: '100%', height: 180 }}>
        <ResponsiveContainer>
          <LineChart data={plot} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--rule)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--ink-4)', fontSize: 10 }}
              tickFormatter={(v: string) => v.slice(5)}
              stroke="var(--rule)"
              interval="preserveStartEnd"
              minTickGap={32}
            />
            <YAxis
              tick={{ fill: 'var(--ink-4)', fontSize: 10 }}
              stroke="var(--rule)"
              width={40}
              domain={[0, yMax]}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip content={<TrendTooltip />} />
            <ReferenceLine
              y={currentRate}
              stroke="var(--ink-4)"
              strokeDasharray="2 4"
            />
            <Line
              type="monotone"
              dataKey="rate_pct"
              stroke="var(--ink)"
              strokeWidth={2}
              dot={{ r: 2, fill: 'var(--ink)' }}
              activeDot={{ r: 5, fill: 'var(--signal)', stroke: 'var(--ink)' }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

type TooltipDatum = TimeseriesPoint & { rate_pct: number };

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: TooltipDatum }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div
      style={{
        background: 'var(--paper)',
        border: '1px solid var(--ink)',
        padding: '10px 12px',
        fontSize: 12,
        lineHeight: 1.5,
        color: 'var(--ink-2)',
      }}
    >
      <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
        {d.date}
      </div>
      <div>
        Rolling rate: <b style={{ color: 'var(--ink)' }}>{d.rate_pct.toFixed(1)}%</b>
      </div>
      <div style={{ color: 'var(--ink-4)' }}>
        {d.rolling_first_pass_clean} of {d.rolling_engaged} over trailing 7 days
      </div>
      <div style={{ marginTop: 6, color: 'var(--ink-3)' }}>
        This day: {d.first_pass_clean} first-pass, {d.engaged} engaged
        {d.escalated > 0 && (
          <>
            , <span style={{ color: 'var(--signal)' }}>{d.escalated} escalated</span>
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        height: 180,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--ink-4)',
        fontSize: 12,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        border: '1px dashed var(--rule)',
      }}
    >
      {message}
    </div>
  );
}
