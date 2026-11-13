import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { hostForSession, hostPayouts } from '@/lib/partner-host-db';
import { HOST_SESSION_HEADER } from '@/lib/partner-host';

/**
 * GET /api/pms/host/payouts   a host's money, for staycapeann.com/host/payouts
 *
 *   -> 200 {ok, homes, stays, years, dashboard_url}
 *        homes     each home's Stripe standing in the host's words, whether
 *                  they can start or finish with Stripe here, and our fee
 *        stays     every booked stay: what the guest paid, our fee, what
 *                  reaches the host before Stripe's card fee, and whether
 *                  the card was charged (src/lib/partner-host-payouts.ts)
 *        years     what Stripe charged, by the Eastern year of the charge
 *   401 {error:'signed_out'}   no live session
 *
 * The payouts themselves are in the host's own Stripe dashboard; Helm never
 * says a payout happened. The session token is the x-host-session header,
 * never a query string. Auth: x-stay-concierge-key header.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  try {
    const session = await hostForSession(req.headers.get(HOST_SESSION_HEADER));
    if (!session) return NextResponse.json({ ok: false, error: 'signed_out' }, { status: 401 });
    const payouts = await hostPayouts(session);
    return NextResponse.json({ ok: true, ...payouts }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[pms/host/payouts] read failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
