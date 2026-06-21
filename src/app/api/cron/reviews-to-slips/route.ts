import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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
 */

async function handle(request: NextRequest) {
  // Cron auth: Vercel Cron bearer, or a signed-in Helm user (manual trigger).
  const denied = await authorizeCron(request);
  if (denied) return denied;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: 'supabase env not configured' },
      { status: 500 },
    );
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const result = await createSlipsFromActionableReviews(supabase);
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
