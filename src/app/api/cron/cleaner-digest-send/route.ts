import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { autoSendTomorrowDigest } from '@/lib/cleaner-digest';

/**
 * Send tomorrow's cleaner schedule unattended, at the operator's chosen
 * local hour (default 18:00 ET).
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
 *
 * Manual params:
 *   ?force=1   ignore the hour gate (still honours the on/off switch,
 *              a skipped day, and an already-sent digest)
 */
export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

async function handle(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  const force = new URL(request.url).searchParams.get('force') === '1';
  try {
    const result = await autoSendTomorrowDigest(supabase, { force });
    return NextResponse.json({ ok: true, ...result });
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
