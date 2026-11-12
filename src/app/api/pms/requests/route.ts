import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { createBookingRequest, requestFailureStatus } from '@/lib/booking-requests-db';
import { toPublicRequest } from '@/lib/booking-requests';

/**
 * POST /api/pms/requests
 *
 * A guest's request to stay at a partner home, from staycapeann.com. The host
 * answers within 24 hours; the owners work it at /guests/requests.
 *
 *   {request_key, property_id, check_in, check_out, guests,
 *    guest:{first_name, last_name, email, phone?}, message?,
 *    quoted_total_cents?,
 *    hold?:{stripe_account_id, payment_intent_id, amount_cents, fee_cents}}
 *   -> 201 {ok, created:true,  request:{id, status, respond_by, hold_status, payment_intent_id, ...}}
 *   -> 200 {ok, created:false, request}   the same request_key again
 *
 *   409 {error:'books_instantly'}   a home we run: book it through /api/pms/reservations
 *   409 {error:'unavailable', blockedNights, reservedNights}
 *   409 {error:'quote_drift', quoted_total_cents, current_total_cents}
 *   409 {error:'hold_required'}     the home takes cards; place a hold first
 *   409 {error:'hold_mismatch', detail}  the hold is not the home's account, total or fee
 *   422 {error:'terms', violations}
 *   404 unknown property; 400 validation; 503 not configured
 *
 * Helm prices the stay itself (quoteForBridge, channel 'sca') and stores
 * that quote. quoted_total_cents is only what the guest was shown, so a
 * price that moved comes back as a question instead of a different total.
 * The hold is the site's: it placed it on the host's Stripe account before
 * posting, releases it on any refusal, and releases or charges it later on
 * Helm's word (/api/pms/requests/settle). A repeated key returns the request
 * already on file; if its payment_intent_id is not the one just posted, the
 * site releases its own. Auth: x-stay-concierge-key header only.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid', detail: 'body must be JSON' }, { status: 400 });
  }

  try {
    const r = await createBookingRequest(body);
    if (!r.ok) return NextResponse.json(r, { status: requestFailureStatus(r) });
    return NextResponse.json(
      { ok: true, created: r.created, request: toPublicRequest(r.request, new Date()) },
      { status: r.created ? 201 : 200 },
    );
  } catch (err) {
    console.error('[pms/requests] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
