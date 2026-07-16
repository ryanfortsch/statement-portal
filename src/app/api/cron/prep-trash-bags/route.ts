import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeCron } from '@/lib/cron-auth';
import { createTrashBagPrepSlips } from '@/lib/prep-trash-bags';

/**
 * Daily reservation-driven prep scan: purple trash bags for long stays.
 *
 * Walks upcoming confirmed bookings (next 14 days) and opens one 'inventory'
 * prep slip per 5+ night stay at a Gloucester property with a known trash
 * day, so the pre-arrival inspection brings / verifies official purple City
 * bags before the guest's mid-stay trash-day reminder promises them.
 *
 * Idempotent via work_slips.from_prep_rule_key ("trashbags:<booking_id>",
 * partial unique index) — safe to re-run, and a dismissed slip stays
 * dismissed. Scheduled at 05:20, after channels-backfill (04:45) has
 * refreshed the canonical bookings and alongside field-packets (05:15) so
 * slips exist before the day's packets build.
 *
 * Auth: Vercel Cron bearer (CRON_SECRET) or a signed-in Helm session for a
 * manual trigger — same pattern as /api/cron/reviews-to-slips.
 */

async function handle(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'supabase env not configured' }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const result = await createTrashBagPrepSlips(supabase);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/prep-trash-bags]', err);
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
