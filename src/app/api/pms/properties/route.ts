import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { describeFleetForBridge } from '@/lib/pms-bridge';

/**
 * GET /api/pms/properties?calendar_authority=helm|all
 *
 * The Helm-run fleet for staycapeann.com's listing registry and the
 * concierge fleet watch: for each home the rate plan, the quote-side tax
 * config, the guest-facing listing record in the site's own Listing shape
 * (toScaListing: content, photos hero-first, rooms and beds), the OTA
 * listing links and the iCal export URL. `all` widens to Guesty-run homes
 * too, each stamped with its calendar_authority, so a caller can see what
 * is coming without pricing it here.
 *
 * Nothing from property_access is read: no door code, no wifi password.
 * Auth: x-stay-concierge-key header only.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const authority = url.searchParams.get('calendar_authority') === 'all' ? 'all' : 'helm';
  try {
    const properties = await describeFleetForBridge(authority);
    return NextResponse.json({ ok: true, calendar_authority: authority, properties, count: properties.length });
  } catch (err) {
    console.error('[pms/properties] GET failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
