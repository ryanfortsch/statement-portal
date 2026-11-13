import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { guestWithdraw, listTrips, tripForSession } from '@/lib/guest-trips-db';
import { TRIP_SESSION_HEADER } from '@/lib/guest-trips';

/**
 * GET  /api/pms/trips   a guest's trips
 * POST /api/pms/trips   withdraw a request still waiting
 *
 *   GET  -> 200 {ok, email, today, trips:[...]}   src/lib/guest-trips.ts:
 *             a partner home's requests and the direct stays Helm holds,
 *             waiting first, then to come, closed, past
 *   POST {id, action:'withdraw'}
 *        -> 200 {ok, trip}
 *        -> 409 {error:'refused', detail}   already closed
 *        -> 404 not one of their requests
 *   401 {error:'signed_out'}   no live session
 *
 * The session token is the x-trip-session header, never a query string. A
 * withdrawal goes through the office's own writer, recorded as
 * guest:<email>. Auth: x-stay-concierge-key header.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const signedOut = () => NextResponse.json({ ok: false, error: 'signed_out' }, { status: 401 });

export async function GET(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  try {
    const session = await tripForSession(req.headers.get(TRIP_SESSION_HEADER));
    if (!session) return signedOut();
    const { today, trips } = await listTrips(session);
    return NextResponse.json({ ok: true, email: session.email, today, trips }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[pms/trips] read failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = ((await req.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  if (body.action !== 'withdraw') return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  try {
    const session = await tripForSession(req.headers.get(TRIP_SESSION_HEADER));
    if (!session) return signedOut();
    const r = await guestWithdraw(session, body.id);
    if (r.ok) return NextResponse.json({ ok: true, trip: r.trip });
    if (r.notFound) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: false, error: 'refused', detail: r.reason }, { status: 409 });
  } catch (err) {
    console.error('[pms/trips] withdraw failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
