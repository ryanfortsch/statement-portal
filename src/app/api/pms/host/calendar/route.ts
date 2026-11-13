import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { hostCalendar, hostForSession } from '@/lib/partner-host-db';
import { HOST_SESSION_HEADER } from '@/lib/partner-host';

/**
 * GET /api/pms/host/calendar   a host's homes, night by night, and the stays to come
 *
 *   -> 200 {ok, today, from, to, homes:[{id, title, listed, feeds, spans, stays}]}
 *        from/to   the first of this month (Eastern) to the first of the
 *                  month twelve later, exclusive
 *        spans     booked here, a request waiting, a stay or a block on the
 *                  host's own calendar (src/lib/partner-host-calendar.ts)
 *        feeds     each calendar of theirs Helm reads and when it last did;
 *                  never the link
 *        stays     booked here and not yet checked out, with the guest's
 *                  contact
 *   401 {error:'signed_out'}   no live session
 *
 * The session token is the x-host-session header, never a query string.
 * Auth: x-stay-concierge-key header.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  try {
    const session = await hostForSession(req.headers.get(HOST_SESSION_HEADER));
    if (!session) return NextResponse.json({ ok: false, error: 'signed_out' }, { status: 401 });
    const calendar = await hostCalendar(session);
    return NextResponse.json({ ok: true, ...calendar }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[pms/host/calendar] read failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
