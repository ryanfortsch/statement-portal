import { NextRequest, NextResponse } from 'next/server';
import { suggestPackets, persistSuggestions, revalidatePublishedPackets } from '@/lib/field-packets';

export const maxDuration = 300;

/**
 * GET /api/cron/field-packets
 *
 * Nightly Field maintenance (schedule in vercel.json):
 *   1. Re-suggest packets over the upcoming window so the board stays fresh
 *      as bookings change. New draft packets only — Ryan still publishes.
 *   2. Re-validate every published packet against current bookings/blocks so
 *      the marketplace never shows a packet a guest has since moved into.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const suggestions = await suggestPackets();
    const created = await persistSuggestions(suggestions, 'cron@risingtidestr.com');
    const revalidated = await revalidatePublishedPackets();
    return NextResponse.json({ ok: true, suggested: suggestions.length, created, revalidated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Tolerate the pre-migration window so the cron doesn't 500 nightly until
    // the Field tables exist.
    if (/does not exist|relation .* does not exist/i.test(msg)) {
      return NextResponse.json({ ok: true, skipped: 'migration_not_applied' });
    }
    console.error('[cron/field-packets]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
