import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { authorizeCron } from '@/lib/cron-auth';
import { operatingDate } from '@/lib/operating-date';
import { expireStaleProposals } from '@/lib/schedule-proposal-expiry';
import { expireStaleInquiries, EXPIRED_INQUIRY_REASON, INQUIRY_EXPIRY_ACTOR } from '@/lib/inquiry-expiry';
import { cancelBooking } from '@/lib/bookings-write';

/**
 * GET /api/cron/expire-queues: nightly, after midnight Eastern.
 *
 * The queues that drain on their own once their moment has passed. Each rule
 * lives in its own src/lib module and its page runs the same rule on load;
 * this is the pass for the lists nobody opens.
 *
 * - Checkout proposals whose stay has ended are dismissed with a note
 *   (src/lib/schedule-proposal-expiry.ts). Restorable from the schedule.
 * - Helm's own direct inquiries whose check-in has passed close as
 *   cancelled, reason 'expired', through the locked writer, with no email
 *   (src/lib/inquiry-expiry.ts). A feed's inquiries are left to the feed;
 *   /channels folds every expired one either way.
 *
 * Nothing here deletes a row. Each step reports its own failure and the
 * others still run.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  const today = operatingDate();
  const result: Record<string, unknown> = { today };

  try {
    result.proposals = await expireStaleProposals(supabase, today);
  } catch (err) {
    result.proposals = { error: err instanceof Error ? err.message : String(err) };
  }

  try {
    result.inquiries = await expireStaleInquiries(supabase, today, (id) =>
      cancelBooking(id, { reason: EXPIRED_INQUIRY_REASON, actor: INQUIRY_EXPIRY_ACTOR }),
    );
  } catch (err) {
    result.inquiries = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json({ ok: true, ...result });
}
