import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { autoSendTomorrowDigest, regionsForDigests, type AutoSendResult } from '@/lib/cleaner-digest';

/**
 * Send tomorrow's cleaner schedule unattended, at the operator's chosen
 * local hour (default 18:00 ET), one digest per region.
 *
 * Separate from /api/cron/cleaner-schedule on purpose. That one DRAFTS in
 * the afternoon and must never send; this one only sends. Keeping the two
 * apart means the draft still happens even if sending is switched off, and
 * a failure in the AI/mining pass can never take the send down with it.
 *
 * Scheduled at BOTH 22:00 and 23:00 UTC. Eastern is UTC-4 in summer and
 * UTC-5 in winter, so exactly one of those lands on 18:00 ET on any given
 * date; the other sees the wrong local hour and no-ops. A single fixed UTC
 * cron would silently drift an hour twice a year, which for a message the
 * cleaners plan their morning around is not acceptable.
 *
 * Everything that decides whether to actually send lives in
 * autoSendTomorrowDigest: the operator's on/off switch, respect for a
 * skipped day, and the atomic pending->sending claim that makes a
 * double-send impossible even against a simultaneous manual approval.
 * It runs once per region from regionsForDigests (Cape Ann always, then
 * every region with an enabled recipient); each recipient gets a body
 * filtered to their scope in their language. One region failing never
 * stops the next.
 *
 * Manual params:
 *   ?force=1        ignore the hour gate (still honours the on/off switch,
 *                   a skipped day, and an already-sent digest)
 *   ?region=<id>    one region only
 */
export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

async function handle(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const force = url.searchParams.get('force') === '1';
  const explicitRegion = url.searchParams.get('region');
  if (explicitRegion && !/^[a-z0-9_]{1,40}$/.test(explicitRegion)) {
    return NextResponse.json({ error: 'bad region' }, { status: 400 });
  }
  try {
    const regions = explicitRegion ? [explicitRegion] : await regionsForDigests(supabase);
    const results: Array<AutoSendResult | { region: string; sent: false; reason: 'error'; detail: string }> = [];
    for (const region of regions) {
      try {
        results.push(await autoSendTomorrowDigest(supabase, { region, force }));
      } catch (err) {
        results.push({ region, sent: false, reason: 'error', detail: err instanceof Error ? err.message : String(err) });
      }
    }
    // The first region is Cape Ann unless ?region= named another; its result
    // stays spread at the top level so existing readers keep working.
    const [first] = results;
    return NextResponse.json({ ok: true, ...(first ?? {}), regions: results });
  } catch (err) {
    // Never 500 a cron: a thrown error here would retry-storm the send.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 200 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
