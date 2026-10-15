import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { authorizeCron } from '@/lib/cron-auth';
import { refreshWorkBriefs } from '@/lib/work-briefs';

/**
 * GET/POST /api/cron/work-briefs
 *
 * Nightly per-home work briefs (schedule in vercel.json, 05:05 UTC: after
 * the 04:50 organize pass has filed new slips into lanes, before the 05:15
 * field-packets planner). Each home whose open slip set changed gets its
 * headline and paragraph rewritten; unchanged homes cost nothing. See
 * lib/work-briefs.ts.
 *
 * Query params for manual runs:
 *   ?property=<id>   one home only
 *   ?force=1         rewrite even when the slip set is unchanged
 *   ?max=N           homes per run (default 30)
 *
 * Auth: Vercel Cron bearer or a signed-in Helm session (authorizeCron).
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
    const result = await refreshWorkBriefs(supabaseAdmin, {
      propertyId: params.get('property') || undefined,
      force: params.get('force') === '1',
      maxProperties: Number.isFinite(max) && max > 0 ? max : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/work-briefs]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
