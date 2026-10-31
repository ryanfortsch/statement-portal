import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { isTestimonialToken, parseSubmission } from '@/lib/guest-testimonials';
import {
  GOOGLE_REVIEW_URL,
  propertyTitle,
  submitTestimonial,
  testimonialByToken,
  toView,
} from '@/lib/guest-testimonials-store';

/**
 * GET  /api/testimonials/<token>   what the form page shows for one stay
 * POST /api/testimonials/<token>   the guest's testimonial
 *
 * The bridge staycapeann.com uses for /review/<token>. The view carries the
 * guest's first name, the home's title and the stay's dates, never the
 * reservation id; `google_review_url` is the Google Business Profile link the
 * thank-you page offers ('' until GOOGLE_REVIEW_URL is set). A token that is
 * not ours is 404 so the link reads as dead, not as an empty form.
 *
 * Auth: STAY_CONCIERGE_KEY in the x-stay-concierge-key header, never a query
 * string. Allowlisted in src/proxy.ts PUBLIC_API_PREFIXES.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;

  const { token } = await ctx.params;
  if (!isTestimonialToken(token)) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  try {
    const row = await testimonialByToken(token);
    if (!row) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    const title = await propertyTitle(row.property_id);
    return NextResponse.json({ ok: true, testimonial: toView(row, title), google_review_url: GOOGLE_REVIEW_URL });
  } catch (err) {
    console.error('[testimonials] read failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;

  const { token } = await ctx.params;
  if (!isTestimonialToken(token)) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 });
  }
  const parsed = parseSubmission(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  try {
    const result = await submitTestimonial(token, parsed.value);
    if (result === 'not_found') return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    if (result === 'already_submitted') {
      return NextResponse.json({ ok: false, error: 'already_submitted', google_review_url: GOOGLE_REVIEW_URL }, { status: 409 });
    }
    return NextResponse.json({ ok: true, status: 'submitted', google_review_url: GOOGLE_REVIEW_URL });
  } catch (err) {
    console.error('[testimonials] submit failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }
}
