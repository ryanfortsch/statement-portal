import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { guestAppLinkForReservation } from '@/lib/guest-app-stays-db';
import { parseLinkRequest } from '@/lib/guest-app-stays';

/**
 * POST /api/guest-app-links
 *
 * stay-concierge asks which guest app link a message to one reservation
 * should carry (the check-in message's {{guest_app_link}}). Body:
 *   { property_id | listing_id, check_in, check_out, reservation_id?, confirmation_code? }
 * Answer:
 *   { ok: true, kind: 'stay', url, opens_at, closes_at }  the stay's own link
 *   { ok: true, kind: 'home', url }                       the home's permanent link
 *   { ok: false, error: 'no_guest_app' } (404)            the home has no guest app
 *
 * 'stay' when Helm holds the stay: the home's one confirmed canonical stay
 * on exactly these dates, not naming a different reservation. Minting is
 * idempotent: the same stay always gets the same link. The answer never
 * carries a code; the stay page shows it inside its window, behind a tap.
 *
 * Why not /api/kb-facts: that feed is per home and the concierge writes it
 * into a knowledge base every guest of the home shares. A stay link opens
 * one stay's door code, so it must never sit in a shared KB. The home's
 * permanent link (no code) does ride kb-facts, as `guest_app_url`.
 *
 * Auth: STAY_CONCIERGE_KEY in the x-stay-concierge-key header, never a
 * query string. Allowlisted in src/proxy.ts PUBLIC_API_PREFIXES.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  if (!isServiceConfigured) return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });

  const parsed = parseLinkRequest(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ ok: false, error: `bad_${parsed.error}` }, { status: 400 });
  const { property, checkIn, checkOut, reservationId, confirmationCode } = parsed.value;

  try {
    // A Guesty listing id resolves through the registry's explicit mapping only.
    let propertyId = property;
    if (/^[a-f0-9]{24}$/i.test(property)) {
      const { data } = await supabaseAdmin.from('guesty_listings').select('property_id').eq('listing_id', property).maybeSingle();
      const mapped = (data as { property_id: string | null } | null)?.property_id;
      if (!mapped) return NextResponse.json({ ok: false, error: 'unknown_property' }, { status: 404 });
      propertyId = mapped;
    }

    const link = await guestAppLinkForReservation(
      { propertyId, checkIn, checkOut, reservationId, confirmationCode },
      'stay-concierge',
    );
    if (!link) return NextResponse.json({ ok: false, error: 'no_guest_app' }, { status: 404 });
    return link.kind === 'stay'
      ? NextResponse.json({ ok: true, kind: 'stay', url: link.url, opens_at: link.opensAt, closes_at: link.closesAt })
      : NextResponse.json({ ok: true, kind: 'home', url: link.url });
  } catch (err) {
    console.error('[guest-app-links] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }
}
