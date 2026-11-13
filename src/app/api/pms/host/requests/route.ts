import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { hostDecide, hostForSession, listHostRequests } from '@/lib/partner-host-db';
import { HOST_SESSION_HEADER } from '@/lib/partner-host';

/**
 * GET  /api/pms/host/requests   a host's homes and their booking requests
 * POST /api/pms/host/requests   the host's answer to one
 *
 *   GET  -> 200 {ok, host:{email, name}, homes:[{id, title}], requests:[...]}
 *   POST {id, decision:'accept'|'decline', reason?}
 *        -> 200 {ok, request}
 *        -> 409 {error:'refused', detail}   closed, no card on hold, the
 *                                           nights are taken, a calendar
 *                                           could not be read: Accept's own
 *                                           sentences
 *        -> 404 not one of their requests
 *   401 {error:'signed_out'}   no live session
 *
 * The session token is the x-host-session header (src/lib/partner-host.ts),
 * never a query string. A host's answer goes through the office's own
 * writers, recorded as host:<email>. Auth: x-stay-concierge-key header.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const signedOut = () => NextResponse.json({ ok: false, error: 'signed_out' }, { status: 401 });

export async function GET(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  try {
    const session = await hostForSession(req.headers.get(HOST_SESSION_HEADER));
    if (!session) return signedOut();
    const requests = await listHostRequests(session);
    return NextResponse.json(
      { ok: true, host: { email: session.email, name: session.hostName }, homes: session.homes, requests },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[pms/host/requests] read failed:', err instanceof Error ? err.message : String(err));
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
  const decision = body.decision === 'accept' ? 'accept' : body.decision === 'decline' ? 'decline' : null;
  if (!decision) return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : '';
  try {
    const session = await hostForSession(req.headers.get(HOST_SESSION_HEADER));
    if (!session) return signedOut();
    const r = await hostDecide(session, body.id, decision, reason);
    if (r.ok) return NextResponse.json({ ok: true, request: r.request });
    if (r.notFound) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: false, error: 'refused', detail: r.reason }, { status: 409 });
  } catch (err) {
    console.error('[pms/host/requests] decide failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
