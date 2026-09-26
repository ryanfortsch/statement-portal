import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { quoteForBridge, bridgeStatus } from '@/lib/pms-bridge';

/**
 * POST /api/pms/quote
 *
 * Price a stay on a Helm-run home from its Helm rate plan (rate-plan.ts
 * over computeQuoteMoney, the one formula) and hand back a signed,
 * stateless quote id good for thirty minutes.
 *
 *   {property_id, check_in, check_out, guests, channel?: 'direct'|'sca'|'concierge'}
 *   -> {nights, subtotal, cleaningFee, extraGuestFee, taxes, total, currency,
 *       quoteId:'hq_...', ratePlanId:'helm', breakdown:{...cents}, violations:[]}
 *
 *   422 {error:'terms', violations}       min / max nights, notice, window, closed, occupancy
 *   409 {error:'unavailable', blockedNights, reservedNights}
 *   409 {error:'tax_jurisdiction_unknown'} a non Cape Ann home with no tax config row
 *   409 {error:'no_rate_plan'}             the home has no Helm rate plan yet
 *   409 {error:'calendar_authority_guesty'}
 *   404 unknown property; 400 validation
 *
 * The dollar fields are staycapeann.com's QuoteResult; the breakdown is
 * integer cents. Auth: x-stay-concierge-key header only.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;

  let body: { property_id?: unknown; check_in?: unknown; check_out?: unknown; guests?: unknown; channel?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid', detail: 'body must be JSON' }, { status: 400 });
  }
  const propertyId = typeof body?.property_id === 'string' ? body.property_id.trim() : '';
  if (!propertyId) return NextResponse.json({ ok: false, error: 'invalid', detail: 'property_id is required' }, { status: 400 });
  const guests = Number(body.guests ?? 1);
  const channel = typeof body.channel === 'string' && body.channel.trim() ? body.channel.trim().toLowerCase() : 'sca';

  try {
    const r = await quoteForBridge(propertyId, String(body.check_in ?? ''), String(body.check_out ?? ''), guests, channel);
    if (!r.ok) return NextResponse.json(r, { status: bridgeStatus(r.error) });
    return NextResponse.json({ ok: true, property_id: r.property.id, ...r.quote });
  } catch (err) {
    console.error('[pms/quote] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
