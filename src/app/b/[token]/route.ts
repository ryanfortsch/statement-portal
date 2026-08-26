import { NextResponse, type NextRequest } from 'next/server';
import { fieldDb } from '@/lib/field-db';
import { resolveContractorByToken, startContractorSession } from '@/lib/field-auth';

/**
 * Short shoot-brief link: helm.risingtidestr.com/b/<16 hex>.
 *
 * The old brief link carried the contributor's portal token AND a url-encoded
 * ?next= with the shoot UUID — ~130 characters that phones wrapped mid-string
 * and linkified wrong, so two different briefs could open the same page. This
 * is one short path with no query string (the /c/<token> cleaner-link
 * pattern): resolve the shoot, mint the same contractor session the magic link
 * would, land on the brief.
 *
 * Auth is unchanged in kind — knowledge of a token on an RLS-locked table,
 * read through the service-role client — and an archived or expired
 * contributor still can't get a session.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const base = req.nextUrl.origin;
  const bad = NextResponse.redirect(new URL('/field?invalid=1', base));
  if (!/^[a-f0-9]{8,64}$/.test(token)) return bad;

  const { data } = await fieldDb()
    .from('creative_shoots')
    .select('id, contractor_id, status')
    .eq('brief_token', token)
    .maybeSingle();
  const shoot = data as { id: string; contractor_id: string; status: string } | null;
  if (!shoot || shoot.status === 'cancelled') return bad;

  // Same status/expiry rules as the magic link: go through the contributor's
  // own portal token rather than trusting the shoot row alone.
  const { data: cData } = await fieldDb()
    .from('contractors')
    .select('portal_token')
    .eq('id', shoot.contractor_id)
    .maybeSingle();
  const portalToken = (cData as { portal_token: string } | null)?.portal_token;
  const contractor = portalToken ? await resolveContractorByToken(portalToken) : null;
  if (!contractor) return bad;

  await startContractorSession(contractor.id, {
    ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
    userAgent: req.headers.get('user-agent'),
  });
  return NextResponse.redirect(new URL(`/field/shoot/${shoot.id}`, base));
}
