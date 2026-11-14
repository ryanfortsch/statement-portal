import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { submitPartnerApplication } from '@/lib/partner-applications-db';

/**
 * POST /api/pms/apply
 *
 * A host applies to list their home, from staycapeann.com/host/apply.
 *
 *   {name, email, phone, address, city, bedrooms, listed_on[], run_by, note}
 *     -> 200 {ok:true, message}   the same whether or not they applied before
 *   422 {error:'invalid', detail}  a sentence the host reads
 *   503 not configured
 *
 * Nothing is listed and nothing is sent; an owner reads it on
 * /guests/requests (src/lib/partner-applications-db.ts). Auth:
 * x-stay-concierge-key header only. No session: the applicant is not a host
 * yet.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid', detail: 'That did not come through. Try it again.' }, { status: 422, headers: NO_STORE });
  }
  try {
    const r = await submitPartnerApplication(body);
    if (r.ok) return NextResponse.json({ ok: true, message: r.message }, { headers: NO_STORE });
    if (r.invalid) return NextResponse.json({ ok: false, error: 'invalid', detail: r.reason }, { status: 422, headers: NO_STORE });
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503, headers: NO_STORE });
  } catch (err) {
    console.error('[pms/apply] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503, headers: NO_STORE });
  }
}
