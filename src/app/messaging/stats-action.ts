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
): Promise<FetchTimeseriesResult> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const res = await getStatsTimeseries(days, topic);
  if (!res.ok) return { ok: false, error: explainError(res.error) };
  return { ok: true, data: res.data };
}
