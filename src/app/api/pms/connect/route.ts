import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { recordAccountStatus, recordStripeAccount, resolveSetupToken } from '@/lib/partner-payments-db';
import { ACCOUNT_ID, isSetupToken, validateAccountStatus } from '@/lib/partner-payments';

/**
 * POST /api/pms/connect
 *
 * A partner home's host connects their Stripe account on staycapeann.com, at
 * the setup link the office sent them (/host/payments/<token>). The site does
 * every Stripe call with the platform key; Helm keeps the record.
 *
 *   {action:'resolve', token}
 *     -> {ok, property_id, title, host_email, stripe_account_id, details_submitted, expires_at}
 *     404 {error:'not_found'}  unknown, replaced or expired link
 *   {action:'account', token, stripe_account_id}
 *     -> {ok, stripe_account_id}  the account on file (written once; a second
 *        report gets the first one back, and the site uses that)
 *   {action:'status', property_id, stripe_account_id, charges_enabled,
 *    payouts_enabled, details_submitted, requirements_due}
 *     -> {ok, recorded}           only for the account on file
 *
 * The token rides in the body, never a query string. Auth: x-stay-concierge-key
 * header only.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid', detail: 'body must be JSON' }, { status: 400 });
  }
  const action = body?.action;
  try {
    if (action === 'resolve') {
      if (!isSetupToken(body.token)) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
      const r = await resolveSetupToken(body.token);
      if (!r) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
      return NextResponse.json({ ok: true, ...r });
    }
    if (action === 'account') {
      if (!isSetupToken(body.token)) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
      if (typeof body.stripe_account_id !== 'string' || !ACCOUNT_ID.test(body.stripe_account_id)) {
        return NextResponse.json({ ok: false, error: 'invalid', detail: 'stripe_account_id is not a Stripe account id' }, { status: 400 });
      }
      const r = await recordStripeAccount(body.token, body.stripe_account_id);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.reason }, { status: r.reason === 'not_found' ? 404 : 409 });
      return NextResponse.json({ ok: true, stripe_account_id: r.stripe_account_id });
    }
    if (action === 'status') {
      const v = validateAccountStatus(body);
      if (!v.ok) return NextResponse.json({ ok: false, error: 'invalid', detail: v.detail }, { status: 400 });
      return NextResponse.json({ ok: true, recorded: await recordAccountStatus(v.report) });
    }
    return NextResponse.json({ ok: false, error: 'invalid', detail: "action must be 'resolve', 'account' or 'status'" }, { status: 400 });
  } catch (err) {
    console.error('[pms/connect] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
