import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { reservationMoney } from '@/lib/pms-bridge';

/**
 * GET /api/pms/reservations/<id>
 *
 * Money and status read-back for one Helm booking, the replacement for the
 * concierge's getReservationMoney against Guesty. The id is bookings.id or
 * the HELM- confirmation code.
 *
 *   -> {reservation: Booking, finance: BookingFinance|null, pick: ReservationPick}
 *   404 when neither matches.
 *
 * Auth: x-stay-concierge-key header only.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    const r = await reservationMoney(decodeURIComponent(id ?? ''));
    if (!r) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    console.error('[pms/reservations/id] GET failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
