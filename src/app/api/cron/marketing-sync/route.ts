import { NextRequest, NextResponse } from 'next/server';
import { syncAllSitesForDate, yesterdayUTC } from '@/lib/marketing/sync';

// Long-running upserts across two GA4 properties + Vercel API.
// Stay well under the 5-minute Fluid Compute default ceiling.
export const maxDuration = 300;

// Daily cron at 5am UTC (vercel.json crons block). Pulls d-1 GA4 data
// and trailing-7d Speed Insights, upserts into Supabase. Idempotent on
// (site_id, date) per table -- safe to retry.
export async function GET(request: NextRequest) {
  // Optional CRON_SECRET auth: Vercel signs cron requests with the
  // configured CRON_SECRET in the Authorization header. If unset, we
  // skip the check (Vercel cron is the only scheduled caller); set
  // CRON_SECRET in env to lock down the route to scheduled runs only.
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

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
