'use server';

import { auth } from '@/auth';
import {
  getStats,
  getStatsTimeseries,
  explainError,
  type MessagingStats,
  type TimeseriesResponse,
} from '@/lib/stay-concierge';

export type FetchStatsResult =
  | { ok: true; data: MessagingStats }
  | { ok: false; error: string };

export async function fetchStats(hours: number): Promise<FetchStatsResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const res = await getStats(hours);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  return { ok: true, data: res.data };
}

export type FetchTimeseriesResult =
  | { ok: true; data: TimeseriesResponse }
  | { ok: false; error: string };

export async function fetchTimeseries(
  days: number,
  topic?: string,
  scope: 'all' | 'substantive' = 'substantive',
): Promise<FetchTimeseriesResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  // Defaults to the substantive slice so the chart tracks the same number as
  // the hero. Charting everything meant 39% of the line was courtesy acks at
  // ~95%, which is why three weeks of work left it visually flat.
  const res = await getStatsTimeseries(days, topic, scope);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  return { ok: true, data: res.data };
}
