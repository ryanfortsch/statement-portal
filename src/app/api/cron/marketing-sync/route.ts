import { NextRequest, NextResponse } from 'next/server';
import { syncAllSitesForDate, yesterdayUTC } from '@/lib/marketing/sync';
import { authorizeCron } from '@/lib/cron-auth';

// Long-running upserts across two GA4 properties + Vercel API.
// Stay well under the 5-minute Fluid Compute default ceiling.
export const maxDuration = 300;

// Daily cron at 5am UTC (vercel.json crons block). Pulls d-1 GA4 data
// and trailing-7d Speed Insights, upserts into Supabase. Idempotent on
// (site_id, date) per table -- safe to retry.
export async function GET(request: NextRequest) {
  // Optional CRON_SECRET auth: Vercel signs cron requests with the
  // Auth via the shared helper: Vercel Cron's bearer, or a signed-in Helm
  // user hitting it as a manual sync. Fails closed when CRON_SECRET is
  // unset, so an anonymous caller is never let through.
  const denied = await authorizeCron(request);
  if (denied) return denied;

  // Allow ?date=YYYY-MM-DD for manual re-runs / spot fixes; default d-1.
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || yesterdayUTC();

  try {
    const results = await syncAllSitesForDate(date);
    return NextResponse.json({ ok: true, date, results });
  } catch (err) {
    console.error('[cron/marketing-sync]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
