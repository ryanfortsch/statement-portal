import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { hostForSession } from '@/lib/partner-host-db';
import { HOST_SESSION_HEADER } from '@/lib/partner-host';
import { hostPost, hostThread } from '@/lib/partner-messages-db';

/**
 * GET  /api/pms/host/messages/<request id>   one request's conversation, as the host reads it
 * POST /api/pms/host/messages/<request id>   the host writes in it
 *
 *   GET  -> 200 {ok, request, messages:[...], can_post, closed_line}
 *           Opening it marks what was written to the host read.
 *   POST {body}
 *        -> 200 {ok, message, emailed}   the guest is emailed with a link
 *        -> 400 {error:'invalid'}         nothing to send
 *        -> 409 {error:'refused', detail} the conversation is closed, or too many in an hour
 *   404 not a request at one of their homes; 401 {error:'signed_out'} no live session
 *
 * The request id is in the path and is not a secret. The session token is
 * the x-host-session header (src/lib/partner-host.ts), never a query string. Before the
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
    const session = await hostForSession(req.headers.get(HOST_SESSION_HEADER));
    if (!session) return signedOut();
    const t = await hostThread(session, (await ctx.params).id);
    if (!t.ok) return notFound();
    return NextResponse.json(
      { ok: true, request: t.view, messages: t.messages, can_post: t.can_post, closed_line: t.closed_line },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[pms/host/messages] read failed:', err instanceof Error ? err.message : String(err));
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
    const session = await hostForSession(req.headers.get(HOST_SESSION_HEADER));
    if (!session) return signedOut();
    const r = await hostPost(session, (await ctx.params).id, body.body);
    if (r.ok) return NextResponse.json({ ok: true, message: r.message, emailed: r.emailed });
    if (r.notFound) return notFound();
    if (r.invalid) return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
    return NextResponse.json({ ok: false, error: 'refused', detail: r.reason }, { status: 409 });
  } catch (err) {
    console.error('[pms/host/messages] write failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
