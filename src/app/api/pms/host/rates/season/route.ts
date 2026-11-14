import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { hostForSession, hostSaveSeason } from '@/lib/partner-host-db';
import { HOST_SESSION_HEADER } from '@/lib/partner-host';

/**
 * POST /api/pms/host/rates/season
 *   {property_id, from, to, nightly_cents?, min_nights?}   a price and / or a
 *                                                          minimum across the nights
 *   {property_id, from, to, clear: true}                   those nights back to the plan
 *   (from and to are the first and the last night, inclusive)
 *
 *   -> 200 {ok, message}
 *   404 {error:'not_found'}    not one of their homes
 *   422 {error:'invalid', detail}
 *   401 {error:'signed_out'}   no live session
 *   503 {error:'unavailable_service'}
 *
 * Read-merge-write on the home's day rows (src/lib/partner-host-rates.ts):
 * the office's closed, arrival and departure flags and notes stay as they are.
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
    const saved = await hostSaveSeason(session, body.property_id, body);
    if (!saved.ok) {
      return saved.notFound
        ? NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
        : NextResponse.json({ ok: false, error: 'invalid', detail: saved.reason }, { status: 422 });
    }
    return NextResponse.json({ ok: true, message: saved.message }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[pms/host/rates/season] save failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
