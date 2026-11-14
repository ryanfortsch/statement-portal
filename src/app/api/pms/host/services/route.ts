import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { hostForSession } from '@/lib/partner-host-db';
import { hostAskService, hostServices } from '@/lib/partner-host-services-db';
import { HOST_SESSION_HEADER } from '@/lib/partner-host';

/**
 * GET  /api/pms/host/services
 *   -> 200 {ok, homes: [{id, title, services: [{key, name, line, ask}]}]}
 *   each of the host's homes with every paid service we offer and the
 *   host's live ask on each: waiting, or answered with our reply
 *   (src/lib/partner-host-services.ts)
 *
 * POST /api/pms/host/services   {property_id, service, note}
 *   -> 200 {ok, message}       asked; an owner answers with the price by email
 *   404 {error:'not_found'}    not one of their homes
 *   422 {error:'invalid', detail}   no such service, a note too long, or asked already
 *
 *   401 {error:'signed_out'}   no live session
 *   503 {error:'unavailable_service'}
 *
 * Auth: x-stay-concierge-key header; the session is x-host-session.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  try {
    const session = await hostForSession(req.headers.get(HOST_SESSION_HEADER));
    if (!session) return NextResponse.json({ ok: false, error: 'signed_out' }, { status: 401 });
    return NextResponse.json({ ok: true, homes: await hostServices(session) }, { headers: NO_STORE });
  } catch (err) {
    console.error('[pms/host/services] read failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  try {
    const session = await hostForSession(req.headers.get(HOST_SESSION_HEADER));
    if (!session) return NextResponse.json({ ok: false, error: 'signed_out' }, { status: 401 });
    const body = (await req.json().catch(() => ({}))) as { property_id?: unknown };
    const asked = await hostAskService(session, body.property_id, body);
    if (!asked.ok) {
      return asked.notFound
        ? NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
        : NextResponse.json({ ok: false, error: 'invalid', detail: asked.reason }, { status: 422 });
    }
    return NextResponse.json({ ok: true, message: asked.message }, { headers: NO_STORE });
  } catch (err) {
    console.error('[pms/host/services] ask failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
