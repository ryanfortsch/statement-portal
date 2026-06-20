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
    return NextResponse.redirect(new URL('/field?invalid=1', base));
  }
  await startContractorSession(contractor.id, {
    ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
    userAgent: req.headers.get('user-agent'),
  });
  return NextResponse.redirect(new URL('/field', base));
}
