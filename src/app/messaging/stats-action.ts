'use server';

import { auth } from '@/auth';
import { getStats, explainError, type MessagingStats } from '@/lib/stay-concierge';

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
