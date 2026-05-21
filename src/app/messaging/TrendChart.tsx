'use client';

import { useState, useTransition } from 'react';
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
import type { TimeseriesPoint, TopicRollup } from '@/lib/stay-concierge';
import { fetchTimeseries } from './stats-action';

type Props = {
  initialSeries: TimeseriesPoint[];
  initialAvailableTopics: TopicRollup[];
};

const AUTO_SEND_THRESHOLD = 97;

/**
 * Rolling 7-day one-shot rate over the last 30 days, with optional
 * per-topic filtering.
 *
 * The dashed reference line at 97% is the auto-send eligibility
 * threshold Dotti set on 2026-05-18. A topic that sits at or above
 * the line consistently is a candidate for the auto-send allowlist
 * (Phase B). Today the chart is read-only — no behavior changes — but
 * watching which topics cross the line is exactly what tells us when
 * to flip auto-send on for them.
 */
export function TrendChart({ initialSeries, initialAvailableTopics }: Props) {
  const [series, setSeries] = useState<TimeseriesPoint[]>(initialSeries);
  const [availableTopics] = useState<TopicRollup[]>(initialAvailableTopics);
  const [topic, setTopic] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleTopicChange = (next: string) => {
    setTopic(next);
    setError(null);
    startTransition(async () => {
      const res = await fetchTimeseries(30, next || undefined);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSeries(res.data.series);
    });
  };

  if (series.length === 0) {
    return <EmptyState message="No activity in the last 30 days." />;
  }

  const plot = series
    .filter((p) => p.rolling_one_shot_rate !== null)
    .map((p) => ({
      ...p,
      rate_pct: (p.rolling_one_shot_rate ?? 0) * 100,
    }));

  if (plot.length === 0) {
    return (
      <div>
        <TopicSelector
          topic={topic}
          options={availableTopics}
          onChange={handleTopicChange}
          disabled={isPending}
        />
        <EmptyState
          message={
            topic
              ? `Not enough ${topic} data yet for a trend line.`
              : 'Not enough data yet for a trend line. Check back in a few days.'
          }
        />
      </div>
    );
  }

  const currentRate = plot[plot.length - 1].rate_pct;
  const max = Math.max(...plot.map((p) => p.rate_pct), AUTO_SEND_THRESHOLD + 5);
  const yMax = Math.min(100, Math.max(20, Math.ceil((max + 5) / 5) * 5));
  const currentTopicMeta = topic
    ? availableTopics.find((t) => t.topic === topic)
    : null;

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div
          className="eyebrow"
          style={{ color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          AI quality · trailing 7-day · approved + escalated only
          {isPending && (
            <span style={{ color: 'var(--ink-4)', fontStyle: 'italic' }}>loading…</span>
          )}
        </div>
        <TopicSelector
          topic={topic}
          options={availableTopics}
          onChange={handleTopicChange}
          disabled={isPending}
        />
      </div>
      {currentTopicMeta && currentTopicMeta.rate !== null && currentTopicMeta.rate * 100 >= AUTO_SEND_THRESHOLD && (
        <div
          style={{
            marginBottom: 10,
            fontSize: 12,
            color: 'var(--ink)',
            background: 'var(--paper-2)',
            border: '1px solid var(--ink)',
            padding: '6px 12px',
            display: 'inline-block',
          }}
        >
          <b>{prettyTopic(topic)}</b> is above the 97% auto-send threshold
          ({currentTopicMeta.first_pass_clean}/{currentTopicMeta.engaged}). Candidate for Phase B.
        </div>
      )}
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
              y={AUTO_SEND_THRESHOLD}
              stroke="var(--signal)"
              strokeDasharray="3 3"
              label={{
                value: 'AUTO-SEND · 97%',
                position: 'right',
                fill: 'var(--signal)',
                fontSize: 9,
                letterSpacing: '0.16em',
              }}
            />
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
      {error && (
        <div
          role="alert"
          style={{
            marginTop: 10,
            fontSize: 12,
            color: 'var(--signal)',
            fontWeight: 500,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function TopicSelector({
  topic,
  options,
  onChange,
  disabled,
}: {
  topic: string;
  options: TopicRollup[];
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  return (
    <label
      style={{
        fontSize: 10,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: 'var(--ink-4)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      Topic
      <select
        value={topic}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          fontFamily: 'inherit',
          fontSize: 12,
          letterSpacing: 'normal',
          textTransform: 'none',
          color: 'var(--ink)',
          background: 'var(--paper)',
          border: '1px solid var(--ink-3)',
          padding: '4px 8px',
          cursor: disabled ? 'wait' : 'pointer',
        }}
      >
        <option value="">All topics</option>
        {options.map((t) => {
          const rate = t.rate !== null ? Math.round(t.rate * 100) : null;
          const rateLabel = rate !== null ? `${rate}%` : 'n/a';
          const star = rate !== null && rate >= AUTO_SEND_THRESHOLD ? '★ ' : '';
          return (
            <option key={t.topic} value={t.topic}>
              {star}
              {prettyTopic(t.topic)} ({t.first_pass_clean}/{t.engaged} · {rateLabel})
            </option>
          );
        })}
      </select>
    </label>
  );
}

function prettyTopic(slug: string): string {
  if (!slug) return '';
  return slug.replace(/_/g, ' ');
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
