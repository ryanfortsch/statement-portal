'use client';

// Recharts wrappers for the /marketing dashboard. Kept in one client
// file so the rest of the page can stay server-rendered. Recharts ships
// with no built-in tree-shaking story, so importing here lets Next bundle
// it once.

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

type TrafficPoint = { date: string; sessions: number; users: number };

export function TrafficLineChart({ data }: { data: TrafficPoint[] }) {
  if (data.length === 0) {
    return (
      <div
        style={{
          height: 240,
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
        No data yet — first cron run is 5am UTC
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--rule)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: 'var(--ink-4)', fontSize: 10 }}
            tickFormatter={(v: string) => v.slice(5)}
            stroke="var(--rule)"
          />
          <YAxis
            tick={{ fill: 'var(--ink-4)', fontSize: 10 }}
            stroke="var(--rule)"
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--paper)',
              border: '1px solid var(--ink)',
              borderRadius: 0,
              fontSize: 12,
            }}
            labelStyle={{ color: 'var(--ink)', fontWeight: 500 }}
          />
          <Line
            type="monotone"
            dataKey="sessions"
            stroke="var(--signal)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
