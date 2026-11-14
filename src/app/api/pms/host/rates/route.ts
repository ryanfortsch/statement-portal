import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { hostForSession, hostRates, hostSavePlan } from '@/lib/partner-host-db';
import { HOST_SESSION_HEADER } from '@/lib/partner-host';

/**
 * GET  /api/pms/host/rates
 *   -> 200 {ok, today, homes: [{id, title, plan, seasons}]}
 *   each of the host's homes: the nightly price, weekend price, minimum stay
 *   and cleaning fee, and the seasons from today on (src/lib/partner-host-rates.ts)
 *
 * POST /api/pms/host/rates   {property_id, base_cents, weekend_cents, min_nights, cleaning_cents}
 *   -> 200 {ok, message}       saved on the home's own rate plan, as the host
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
    return NextResponse.json({ ok: true, ...(await hostRates(session)) }, { headers: NO_STORE });
  } catch (err) {
    console.error('[pms/host/rates] read failed:', err instanceof Error ? err.message : String(err));
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
    const saved = await hostSavePlan(session, body.property_id, body);
    if (!saved.ok) {
      return saved.notFound
        ? NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
        : NextResponse.json({ ok: false, error: 'invalid', detail: saved.reason }, { status: 422 });
    }
    return NextResponse.json({ ok: true, message: saved.message }, { headers: NO_STORE });
  } catch (err) {
    console.error('[pms/host/rates] save failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
