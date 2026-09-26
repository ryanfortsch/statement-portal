import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { cancelReservationFromBridge, confirmReservationFromBridge, bridgeStatus } from '@/lib/pms-bridge';

/**
 * PUT /api/pms/reservations/<id>/status
 *
 * Soft cancel (a capture that failed on staycapeann.com, a full-refund
 * webhook, a guest who called) or confirm a pending row. Both run through
 * the locked writer; nothing is ever hard-deleted from here.
 *
 *   {status:'cancelled'|'confirmed', reason?, actor?}
 *   -> {ok:true, reservation, changed}
 *   409 {error:'booking_overlap', conflict} when confirming onto sold nights
 *   409 calendar_authority_guesty; 404 unknown id; 400 validation
 *
 * The id is bookings.id or the HELM- code. Auth: x-stay-concierge-key header only.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  const { id } = await ctx.params;

  let body: { status?: unknown; reason?: unknown; actor?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid', detail: 'body must be JSON' }, { status: 400 });
  }
  const status = typeof body?.status === 'string' ? body.status : '';
  if (status !== 'cancelled' && status !== 'confirmed') {
    return NextResponse.json({ ok: false, error: 'invalid', detail: "status must be 'cancelled' or 'confirmed'" }, { status: 400 });
  }
  const reason = typeof body.reason === 'string' ? body.reason : null;
  const actor = typeof body.actor === 'string' ? body.actor : null;

  try {
    const key = decodeURIComponent(id ?? '');
    const r =
      status === 'cancelled'
        ? await cancelReservationFromBridge(key, { reason, actor })
        : await confirmReservationFromBridge(key, { actor });
    if (!r.ok) return NextResponse.json(r, { status: bridgeStatus(r.error) });
    return NextResponse.json({ ok: true, reservation: r.reservation, changed: r.changed });
  } catch (err) {
    console.error('[pms/reservations/id/status] PUT failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
