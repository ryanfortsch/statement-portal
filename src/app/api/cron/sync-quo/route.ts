import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { POST as syncQuoPost } from '../../sync-quo/route';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Safety-net cron for the Quo (OpenPhone) backfill.
 *
 * POST or GET /api/cron/sync-quo
 *
 * The webhook is the live path, but it's the ONLY live path — a single
 * missed delivery silently drops a cleaner ping, owner text, or call with
 * no automatic recovery. This re-pulls recent messages + calls per known
 * phone on a cadence so the feed self-heals. Idempotent (dedup on Quo
 * message/call id), so overlapping windows are safe.
 *
 * Thin in-process wrapper around /api/sync-quo (same pattern as
 * /api/cron/sync-guesty). Also records last_synced_at in sync_status so
 * Quo shows up alongside the other tracked feeds. Auth: optional
 * CRON_SECRET bearer; manual trigger may pass x-helm-manual-sync: 1.
 */

async function handle(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    const isManual = request.headers.get('x-helm-manual-sync') === '1';
    if (!isManual) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await syncQuoPost(request);
    if (result.ok) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      );
      await supabase
        .from('sync_status')
        .upsert(
          { source: 'quo', last_synced_at: new Date().toISOString() },
          { onConflict: 'source' },
        );
    }
    return result;
  } catch (err) {
    console.error('[cron/sync-quo]', err);
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
