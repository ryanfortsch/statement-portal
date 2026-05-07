import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { syncAllCompetitors } from '@/lib/competitors/sync';

/**
 * Manual trigger + work handler for competitor inventory sync.
 *
 * Scrapes AVH + Shoreway, diffs against competitor_listings_current,
 * appends added/dropped/returned events. The cron route at
 * /api/cron/sync-competitors imports this POST in-process so they share
 * the same code path; bearer-token auth lives there.
 *
 * Manual auth: a signed-in user with a Helm session can fire this from
 * the "Sync now" button on the detail page. CRON_SECRET requests skip
 * the session check (handled in the cron wrapper).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const isCron = request.headers.get('x-helm-cron') === '1';
  if (!isCron) {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const reports = await syncAllCompetitors();
    revalidatePath('/competitors');
    for (const r of reports) {
      revalidatePath(`/competitors/${r.competitorId}`);
    }
    return NextResponse.json({ ok: true, reports });
  } catch (err) {
    console.error('[sync-competitors]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
