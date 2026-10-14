import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { authorizeCron } from '@/lib/cron-auth';
import { organizeOpenWorkSlips } from '@/lib/organize-work-slips';

/**
 * GET/POST /api/cron/organize-work
 *
 * Nightly organize pass over NEW open work slips (schedule in vercel.json,
 * 04:50 UTC, ahead of the 05:15 field-packets cron so the maintenance-run
 * planner sees owner purchases and supplies already moved out of its pool).
 * Each slip is read once, filed into a lane by category / run_scope / the
 * owner flag, given a synthesized action line when its description is a
 * pasted source, and clustered with slips about the same object. Title and
 * description are never written. See lib/organize-work-slips.ts.
 *
 * Query params for manual runs:
 *   ?max=24          homes per run (default 12)
 *   ?property=<id>   one home only
 *   ?dry=1           decide and report, write nothing
 *
 * Auth: Vercel Cron bearer or a signed-in Helm session (authorizeCron).
 * Runs on the service role: work_slips is RLS-locked.
 */

export const maxDuration = 300;

async function handle(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  if (!isServiceConfigured) {
    return NextResponse.json({ error: 'supabase service role not configured' }, { status: 500 });
  }

  const params = request.nextUrl.searchParams;
  const max = Number(params.get('max'));
  try {
    const result = await organizeOpenWorkSlips(supabaseAdmin, {
      maxProperties: Number.isFinite(max) && max > 0 ? max : undefined,
      propertyId: params.get('property') || undefined,
      dryRun: params.get('dry') === '1',
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/organize-work]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
