import { NextResponse, type NextRequest } from 'next/server';
import { resolveContractorByToken, startContractorSession } from '@/lib/field-auth';

/**
 * Magic-link entry. Validates the per-contractor portal_token, mints a
 * session cookie, and drops the token from the URL by redirecting to the
 * clean /field home. A cookie can only be set from a route handler or server
 * action (not a page render), which is why this is a GET handler.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const base = req.nextUrl.origin;
  const contractor = await resolveContractorByToken(token);
  if (!contractor) {
    const next = req.nextUrl.searchParams.get('next');
    const q = next && next.startsWith('/field/') && !next.includes('..') ? `&next=${encodeURIComponent(next)}` : '';
    return NextResponse.redirect(new URL(`/field?invalid=1${q}`, base));
  }
  await startContractorSession(contractor.id, {
    ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
    userAgent: req.headers.get('user-agent'),
  });
  // Optional deep-link: a packet SMS/email routes through here so it works from
  // a cookieless browser (Quo's in-app browser, a new phone). Only ever an
  // internal /field/... path — never an absolute or traversing URL — so this
  // can't be turned into an open redirect.
  const next = req.nextUrl.searchParams.get('next');
  const dest =
    next && next.startsWith('/field/') && !next.startsWith('/field//') && !next.includes('..')
      ? next
      : '/field';
  return NextResponse.redirect(new URL(dest, base));
}
