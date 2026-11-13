import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { tripForSession } from '@/lib/guest-trips-db';
import { TRIP_SESSION_HEADER } from '@/lib/guest-trips';
import { guestPost, guestThread } from '@/lib/partner-messages-db';

/**
 * GET  /api/pms/trips/messages/<request id>   one request's conversation, as the guest reads it
 * POST /api/pms/trips/messages/<request id>   the guest writes in it
 *
 *   GET  -> 200 {ok, trip, messages:[...], can_post, closed_line}
 *           Opening it marks what was written to the guest read.
 *   POST {body}
 *        -> 200 {ok, message, emailed}   the host is emailed with a link
 *        -> 400 {error:'invalid'}         nothing to send
 *        -> 409 {error:'refused', detail} the conversation is closed, or too many in an hour
 *   404 not a request made with their email; 401 {error:'signed_out'} no live session
 *
 * The request id is in the path and is not a secret. The session token is
 * the x-trip-session header (src/lib/guest-trips.ts), never a query string. Before the
 * stay is booked, contact in a message is hidden before it is stored
 * (src/lib/partner-messages.ts). Auth: x-stay-concierge-key header.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Ctx = { params: Promise<{ id: string }> };

const signedOut = () => NextResponse.json({ ok: false, error: 'signed_out' }, { status: 401 });
const notFound = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

export async function GET(req: Request, ctx: Ctx) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  try {
    const session = await tripForSession(req.headers.get(TRIP_SESSION_HEADER));
    if (!session) return signedOut();
    const t = await guestThread(session, (await ctx.params).id);
    if (!t.ok) return notFound();
    return NextResponse.json(
      { ok: true, trip: t.view, messages: t.messages, can_post: t.can_post, closed_line: t.closed_line },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[pms/trips/messages] read failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = ((await req.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  try {
    const session = await tripForSession(req.headers.get(TRIP_SESSION_HEADER));
    if (!session) return signedOut();
    const r = await guestPost(session, (await ctx.params).id, body.body);
    if (r.ok) return NextResponse.json({ ok: true, message: r.message, emailed: r.emailed });
    if (r.notFound) return notFound();
    if (r.invalid) return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
    return NextResponse.json({ ok: false, error: 'refused', detail: r.reason }, { status: 409 });
  } catch (err) {
    console.error('[pms/trips/messages] write failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
