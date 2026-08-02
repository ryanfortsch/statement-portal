import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';

/**
 * Nightly Stripe fee true-up.
 *
 * POST or GET /api/cron/sync-stripe
 *
 * Runs the cross-property Stripe sync for the PREVIOUS and CURRENT
 * statement months, so estimated 3.9% fees flip to Stripe actuals without
 * anyone remembering the dashboard's "Sync Stripe" button. Two months
 * because fee corrections matter most while last month's statements are
 * being closed out during the first days of the new month.
 *
 * Thin wrapper over /api/sync-stripe -- same in-process import pattern as
 * cron/sync-guesty, so both share env and the sync_status recording the
 * dashboard badge reads. A month whose statement period doesn't exist yet
 * (current month before its first ingest) 404s in the underlying route;
 * the cron records it as a benign skip, not a failure.
 */

import { POST as syncStripePost } from '../../sync-stripe/route';

function monthUTC(offset: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 7);
}

type MonthSummary = {
  month: string;
  skipped?: string;
  properties?: number;
  fee_updates?: number;
  errors?: number;
  error?: string;
};

async function handle(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  const months = [monthUTC(-1), monthUTC(0)];
  const summaries: MonthSummary[] = [];

  for (const month of months) {
    try {
      const req = new NextRequest('http://cron.internal/api/sync-stripe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ month }),
      });
      const res = await syncStripePost(req);
      const data = await res.json().catch(() => ({} as Record<string, unknown>));

      if (res.status === 404) {
        summaries.push({ month, skipped: 'no statement period yet' });
        continue;
      }
      if (!res.ok) {
        summaries.push({ month, error: (data as { error?: string }).error || `HTTP ${res.status}` });
        continue;
      }

      type PropResult = { fee_updates?: unknown[]; error?: string };
      const results = ((data as { results?: PropResult[] }).results || []);
      summaries.push({
        month,
        properties: results.length,
        fee_updates: results.reduce((n, r) => n + (r.fee_updates?.length || 0), 0),
        errors: results.filter(r => r.error).length,
      });
    } catch (err) {
      summaries.push({ month, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const failed = summaries.some(s => s.error);
  return NextResponse.json({ ok: !failed, months: summaries }, { status: failed ? 500 : 200 });
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
