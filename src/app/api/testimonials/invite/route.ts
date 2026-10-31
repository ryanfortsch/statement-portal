import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { parseInvite } from '@/lib/guest-testimonials';
import { dbErrorCode, dbErrorText, inviteTestimonial, propertyExists, testimonialFormUrl } from '@/lib/guest-testimonials-store';

/**
 * POST /api/testimonials/invite
 *
 * stay-concierge mints the form link a direct guest's review ask carries
 * (review_requests.py, stellar stays only). Body:
 *   { reservation_id, property_id, guest_first?, check_in?, check_out?, channel? }
 * Answer: { ok: true, token, url, status }. Idempotent per reservation: the
 * same stay always gets the same link.
 *
 * Auth: STAY_CONCIERGE_KEY in the x-stay-concierge-key header, never a query
 * string. Allowlisted in src/proxy.ts PUBLIC_API_PREFIXES.
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
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 });
  }
  const parsed = parseInvite(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: `bad_${parsed.error}` }, { status: 400 });

  try {
    if (!(await propertyExists(parsed.value.property_id))) {
      return NextResponse.json({ ok: false, error: 'unknown_property' }, { status: 404 });
    }
    const row = await inviteTestimonial(parsed.value);
    return NextResponse.json({ ok: true, token: row.token, url: testimonialFormUrl(row.token), status: row.status });
  } catch (err) {
    console.error('[testimonials] invite failed:', dbErrorText(err));
    return NextResponse.json({ ok: false, error: 'unavailable', code: dbErrorCode(err) }, { status: 503 });
  }
}
