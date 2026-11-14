import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { hostForSession } from '@/lib/partner-host-db';
import { hostListing, hostProposeListing } from '@/lib/partner-host-listing-db';
import { HOST_SESSION_HEADER } from '@/lib/partner-host';

/**
 * GET  /api/pms/host/listing
 *   -> 200 {ok, homes: [{id, title, live, pending, last}]}
 *   each of the host's homes: its words as guests read them (title, tagline,
 *   highlights, about, neighborhood), a change waiting for the office, and
 *   the office's last answer (src/lib/partner-host-listing.ts)
 *
 * POST /api/pms/host/listing   {property_id, title, tagline, highlights, about, neighborhood, note}
 *   -> 200 {ok, message}       sent to the office; nothing reaches the site before it is approved
 *   404 {error:'not_found'}    not one of their homes
 *   422 {error:'invalid', detail}
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
    return NextResponse.json({ ok: true, homes: await hostListing(session) }, { headers: NO_STORE });
  } catch (err) {
    console.error('[pms/host/listing] read failed:', err instanceof Error ? err.message : String(err));
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
    const sent = await hostProposeListing(session, body.property_id, body);
    if (!sent.ok) {
      return sent.notFound
        ? NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
        : NextResponse.json({ ok: false, error: 'invalid', detail: sent.reason }, { status: 422 });
    }
    return NextResponse.json({ ok: true, message: sent.message }, { headers: NO_STORE });
  } catch (err) {
    console.error('[pms/host/listing] send failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
