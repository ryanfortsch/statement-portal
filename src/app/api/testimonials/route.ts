import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { approvedTestimonials, dbErrorCode, dbErrorText, propertyForGuestyListing } from '@/lib/guest-testimonials-store';

/**
 * GET /api/testimonials?listing=<guesty listing id>   or   ?property=<helm id>
 *
 * The approved testimonials for one home, in the shape staycapeann.com's
 * ReviewsSection renders ({ name, date, rating, text }), newest stay first.
 * The listing page shows them ahead of the live Guesty reviews. A listing
 * Helm cannot place answers an empty list, never an error: the page must
 * render with Guesty's reviews alone.
 *
 * Auth: STAY_CONCIERGE_KEY in the x-stay-concierge-key header, never a query
 * string. Allowlisted in src/proxy.ts PUBLIC_API_PREFIXES.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export async function GET(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const listing = (url.searchParams.get('listing') || '').trim();
  const property = (url.searchParams.get('property') || '').trim();
  if ((listing && !ID_RE.test(listing)) || (property && !ID_RE.test(property)) || (!listing && !property)) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }
  try {
    const propertyId = property || (await propertyForGuestyListing(listing));
    if (!propertyId) return NextResponse.json({ ok: true, testimonials: [] });
    return NextResponse.json({ ok: true, property_id: propertyId, testimonials: await approvedTestimonials(propertyId) });
  } catch (err) {
    console.error('[testimonials] list failed:', dbErrorText(err));
    return NextResponse.json({ ok: false, error: 'unavailable', code: dbErrorCode(err) }, { status: 503 });
  }
}
