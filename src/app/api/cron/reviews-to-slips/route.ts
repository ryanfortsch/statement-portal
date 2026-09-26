import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { authorizeCron } from '@/lib/cron-auth';
import { createSlipsFromActionableReviews } from '@/lib/reviews-to-slips';

/**
 * Manual / backfill trigger for the reviews → work-slips pipeline.
 *
 * /api/cron/sync-guesty already runs this at the end of each daily
 * sync. This standalone route is for two cases:
 *
 *   1. Backfill: when the feature first ships, the existing reviews
 *      table has below-five and feedback-bearing rows that pre-date
 *      the linkage. A one-time POST to this endpoint creates slips
 *      for all of them at once.
 *
 *   2. Manual recovery: if a slip got deleted by mistake, deleting
 *      its from_review_id link and re-hitting this endpoint will
 *      recreate it. (Or just edit the slip — usually that's enough.)
 *
 * Auth: optional CRON_SECRET in Authorization header. Same pattern as
 * /api/cron/sync-gmail-replies and /api/cron/sync-guesty. Manual
 * trigger from the dashboard would pass x-helm-manual-sync: 1 instead.
 *
 * Runs on the service role (supabaseAdmin), never a hand-rolled client
 * with an anon fallback: work_slips is RLS-locked and the route is on a
 * daily schedule now, independent of the Guesty sync.
 */

async function handle(request: NextRequest) {
  // Cron auth: Vercel Cron bearer, or a signed-in Helm user (manual trigger).
  const denied = await authorizeCron(request);
  if (denied) return denied;

  if (!isServiceConfigured) {
    return NextResponse.json(
      { error: 'supabase service role not configured' },
      { status: 500 },
    );
  }

  try {
    const result = await createSlipsFromActionableReviews(supabaseAdmin);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/reviews-to-slips]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
