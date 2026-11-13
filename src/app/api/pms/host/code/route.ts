import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { requestHostCode } from '@/lib/partner-host-db';

/**
 * POST /api/pms/host/code
 *
 * A partner home's host asks staycapeann.com for a sign-in code.
 *
 *   {email} -> 200 {ok:true}   whether or not the email hosts a home, so
 *                              the form tells no one who our hosts are
 *   400 {error:'invalid'}      not an email
 *   503 not configured
 *
 * Helm emails the code itself (src/lib/partner-host-email.ts); the site
 * never sees it. Auth: x-stay-concierge-key header only.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = ((await req.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  try {
    const r = await requestHostCode(body.email);
    if (r.ok) return NextResponse.json({ ok: true });
    return NextResponse.json({ ok: false, error: r.reason }, { status: r.reason === 'invalid' ? 400 : 503 });
  } catch (err) {
    console.error('[pms/host/code] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
