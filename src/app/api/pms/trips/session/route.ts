import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { endTripSession, startTripSession } from '@/lib/guest-trips-db';
import { TRIP_SESSION_HEADER } from '@/lib/guest-trips';

/**
 * POST   /api/pms/trips/session   a guest's email and code for a session
 * DELETE /api/pms/trips/session   sign out
 *
 *   POST {email, code}
 *     -> 200 {ok:true, token, expires_at}   the site keeps the token in an
 *                                           httpOnly cookie
 *     -> 401 {error:'wrong_code' | 'expired' | 'too_many'}
 *     -> 400 {error:'invalid'}
 *   DELETE, the token in the x-trip-session header -> 200 {ok:true}
 *
 * Auth: x-stay-concierge-key header only. The session token rides in a
 * header too, never a query string.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = ((await req.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  try {
    const r = await startTripSession(body.email, body.code);
    if (r.ok) return NextResponse.json({ ok: true, token: r.token, expires_at: r.expires_at }, { headers: { 'Cache-Control': 'no-store' } });
    const status = r.reason === 'invalid' ? 400 : r.reason === 'not_configured' ? 503 : 401;
    return NextResponse.json({ ok: false, error: r.reason }, { status });
  } catch (err) {
    console.error('[pms/trips/session] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}

export async function DELETE(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  try {
    await endTripSession(req.headers.get(TRIP_SESSION_HEADER));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[pms/trips/session] sign out failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
