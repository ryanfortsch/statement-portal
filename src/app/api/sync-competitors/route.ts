import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { syncAllCompetitors, resetCompetitor } from '@/lib/competitors/sync';
import type { CompetitorId } from '@/lib/competitors';

const KNOWN_COMPETITORS: CompetitorId[] = ['atlantic-vacation-homes', 'shoreway-management'];

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

  // `?reset=<competitor-id>` wipes that competitor's current+events
  // before syncing. Used when an early sync ran with a buggy diff key
  // and left phantom dropped/added rows that need to flush out. Only
  // honoured for known competitor ids and only with an authed session.
  const resetParam = request.nextUrl.searchParams.get('reset');
  let resetReport: { competitorId: CompetitorId; deletedCurrent: number; deletedEvents: number } | null = null;
  if (resetParam && !isCron) {
    if (!KNOWN_COMPETITORS.includes(resetParam as CompetitorId)) {
      return NextResponse.json({ error: `unknown competitor: ${resetParam}` }, { status: 400 });
    }
    try {
      const r = await resetCompetitor(resetParam as CompetitorId);
      resetReport = { competitorId: resetParam as CompetitorId, ...r };
    } catch (err) {
      console.error('[sync-competitors] reset failed', err);
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  }

  try {
    const reports = await syncAllCompetitors();
    revalidatePath('/competitors');
    for (const r of reports) {
      revalidatePath(`/competitors/${r.competitorId}`);
    }
    return NextResponse.json({ ok: true, reset: resetReport, reports });
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
