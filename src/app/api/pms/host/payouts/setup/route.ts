import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { hostForSession, hostSetupLink } from '@/lib/partner-host-db';
import { HOST_SESSION_HEADER } from '@/lib/partner-host';

/**
 * POST /api/pms/host/payouts/setup   {property_id}
 *   a fresh Stripe setup link for one of the host's homes
 *
 *   -> 200 {ok, token}          staycapeann.com sends the host to
 *                               /host/payments/<token>, its own setup page
 *   404 {error:'not_found'}     not one of their homes
 *   409 {error:'refused', detail}
 *   401 {error:'signed_out'}    no live session
 *
 * The office's makeSetupLink, recorded as the host; the home's earlier link
 * stops working. The token is answered once, in the body, and never logged.
 * Auth: x-stay-concierge-key header; the session is x-host-session.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  try {
    const session = await hostForSession(req.headers.get(HOST_SESSION_HEADER));
    if (!session) return NextResponse.json({ ok: false, error: 'signed_out' }, { status: 401 });
    const body = (await req.json().catch(() => ({}))) as { property_id?: unknown };
    const made = await hostSetupLink(session, body.property_id);
    if (!made.ok) {
      return made.notFound
        ? NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
        : NextResponse.json({ ok: false, error: 'refused', detail: made.reason }, { status: 409 });
    }
    return NextResponse.json({ ok: true, token: made.token }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[pms/host/payouts/setup] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
