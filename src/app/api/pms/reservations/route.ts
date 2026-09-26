import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { createReservationFromBridge, listReservationPicks, bridgeStatus, type CreateReservationInput } from '@/lib/pms-bridge';

/**
 * /api/pms/reservations
 *
 * POST: create a confirmed direct booking on a Helm-run home, the Helm
 * replacement for Guesty's POST /v1/reservations-v3. The write runs through
 * helm_create_booking under the property advisory lock (bookings-write.ts),
 * then the guest record, booking_finance (direct only), the automations
 * planner and the Helm calendar mirror.
 *
 *   {quote_id?, property_id, check_in, check_out, guests,
 *    guest:{first_name,last_name,email,phone},
 *    money?:{gross_cents, cleaning_cents, taxes_cents, stripe_fee_cents?,
 *            payout_cents?, stripe_payment_intent_id?, stripe_account_key?},
 *    source:'sca'|'concierge'|'operator', source_ref, notes?}
 *
 *   201 {reservationId, confirmationCode:'HELM-XXXXXX', check_in, check_out, total_cents}
 *   200 the same body when source_ref was already booked (idempotent)
 *   409 {error:'booking_overlap', conflict}
 *   409 {error:'quote_drift', quoted_total_cents, current_total_cents}
 *   409 {error:'unavailable', blockedNights} closed night or shut season
 *   410 {error:'quote_expired'}; 400 {error:'quote_invalid'} tampered or for another stay
 *   409 calendar_authority_guesty; 404 unknown property; 400 validation
 *
 * GET ?days=60&property_id=: ReservationPick rows for the concierge stay
 * picker over canonical confirmed / completed stays of Helm-run homes.
 *
 * Auth: x-stay-concierge-key header only.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const days = Number(url.searchParams.get('days') ?? 60);
  const propertyId = (url.searchParams.get('property_id') ?? '').trim() || null;
  try {
    const reservations = await listReservationPicks({ days: Number.isFinite(days) ? days : 60, propertyId });
    return NextResponse.json({ ok: true, reservations, count: reservations.length });
  } catch (err) {
    console.error('[pms/reservations] GET failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;

  let body: CreateReservationInput;
  try {
    body = (await req.json()) as CreateReservationInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid', detail: 'body must be JSON' }, { status: 400 });
  }

  try {
    const r = await createReservationFromBridge(body);
    if (!r.ok) return NextResponse.json(r, { status: bridgeStatus(r.error) });
    const b = r.reservation;
    return NextResponse.json(
      {
        ok: true,
        created: r.created,
        reservationId: b.id,
        confirmationCode: r.confirmationCode,
        property_id: b.property_id,
        check_in: b.check_in,
        check_out: b.check_out,
        status: b.status,
        total_cents: r.total_cents,
      },
      { status: r.created ? 201 : 200 },
    );
  } catch (err) {
    console.error('[pms/reservations] POST failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
