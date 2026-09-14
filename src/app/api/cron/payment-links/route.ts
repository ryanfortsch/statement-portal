import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { sweepPaymentLinkStatus } from '@/lib/payment-links';

/**
 * Paid sweep for guest payment links.
 *
 * GET or POST /api/cron/payment-links, every 15 minutes (vercel.json).
 *
 * Every open link minted in the last 45 days gets one read against the
 * property's own Stripe account (checkout sessions for that link). A paid
 * session stamps payment_link_requests.paid_at, which is what turns the
 * home feed's "Jimmy hasn't paid yet" into "Jimmy paid $223.40" and what
 * the /messaging/send ledger renders. Nothing is texted or emailed: Helm is
 * the surface, per the team-notification policy.
 *
 * The concierge runs its own 15-minute poll through the bridge's
 * ?status_key= lookup for the links it minted, and that lookup stamps the
 * same column, so the two sweeps agree by construction.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function handle(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;
  try {
    const summary = await sweepPaymentLinkStatus();
    return NextResponse.json({ ok: true, ...summary, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
