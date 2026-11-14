import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { hostForSession } from '@/lib/partner-host-db';
import { hostWithdrawListing } from '@/lib/partner-host-listing-db';
import { HOST_SESSION_HEADER } from '@/lib/partner-host';

/**
 * POST /api/pms/host/listing/withdraw   {property_id}
 *   -> 200 {ok, message}       the change waiting for the office is withdrawn
 *   404 {error:'not_found'}    not one of their homes
 *   422 {error:'invalid', detail}   nothing was waiting
 *   401 {error:'signed_out'}   no live session
 *   503 {error:'unavailable_service'}
 *
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
    const done = await hostWithdrawListing(session, body.property_id);
    if (!done.ok) {
      return done.notFound
        ? NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
        : NextResponse.json({ ok: false, error: 'invalid', detail: done.reason }, { status: 422 });
    }
    return NextResponse.json({ ok: true, message: done.message }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[pms/host/listing/withdraw] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
