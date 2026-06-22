import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { runClimateAutomation } from '@/lib/climate';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Climate automation cron.
 *
 * POST or GET /api/cron/thermostats (Vercel Cron every 15 min; also the
 * "Run now" path uses the in-process engine directly).
 *
 * Reads every enabled+mapped property_climate_profiles row, computes the
 * desired setpoint from that property's booking calendar, and pushes it to
 * the Seam thermostat ONLY when it changed since last applied. No-ops
 * gracefully when nothing is enabled or SEAM_API_KEY is unset.
 *
 * Auth: CRON_SECRET bearer for Vercel Cron, or a signed-in Helm user.
 */
async function handle(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  try {
    const results = await runClimateAutomation();
    const applied = results.filter((r) => r.applied).length;
    return NextResponse.json({ ok: true, count: results.length, applied, results });
  } catch (err) {
    console.error('[cron/thermostats]', err);
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
