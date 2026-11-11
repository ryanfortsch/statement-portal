import { NextRequest, NextResponse } from 'next/server';
import { isServiceConfigured } from '@/lib/supabase-admin';
import { authorizeCron } from '@/lib/cron-auth';
import { draftWeeklyCleaningReport } from '@/lib/cleaning-reviews';

/**
 * GET/POST /api/cron/cleaning-review-email
 *
 * Friday's cleaning review email (docs/cleaning-reviews.md; schedule in
 * vercel.json, 12:00 UTC Friday, 7 or 8 AM in Gloucester). Every rating no
 * report has carried, walked through Thursday, becomes ONE email filed
 * pending on the Team inbox. This route only drafts. Nothing reaches the
 * crew until an operator taps Approve & send on the card.
 *
 * Idempotent per week: a second run finds the week's row and stops.
 *
 * Auth: Vercel Cron bearer or a signed-in Helm session (authorizeCron).
 */

export const maxDuration = 120;

async function handle(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;
  if (!isServiceConfigured) {
    return NextResponse.json({ error: 'supabase service role not configured' }, { status: 500 });
  }
  try {
    return NextResponse.json(await draftWeeklyCleaningReport());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'draft failed' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
