import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { recordSettlement, settlementQueue } from '@/lib/partner-payments-db';
import { validateSettleReport } from '@/lib/partner-payments';

/**
 * GET /api/pms/requests/settle
 *
 * What staycapeann.com should do with the card holds on booking requests,
 * read every minute by its settle cron:
 *
 *   -> {ok, actions:[{request_key, action:'capture'|'release', stripe_account_id,
 *                     payment_intent_id, amount_cents}],
 *       holds:[{request_key, payment_intent_id, stripe_account_id}],
 *       accounts:[{property_id, stripe_account_id}]}
 *
 * capture: the host said yes. release: declined, withdrawn, or the clock ran
 * out. holds is every live hold Helm recorded, so the site can release one it
 * placed that Helm never took (a post that failed after the hold). accounts
 * is every host's connected account, for the site to refresh their status.
 *
 * POST /api/pms/requests/settle
 *
 *   {request_key, payment_intent_id, outcome:'captured'|'released'|'capture_failed',
 *    charge_id?, amount_cents?, detail?}
 *   -> {ok, applied, emailed}
 *
 * What the site did. Forward only (recordSettlement): a repeat is applied:
 * false. A capture emails the guest their confirmation.
 *
 * Helm makes no Stripe call here or anywhere. Auth: x-stay-concierge-key
 * header only.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  try {
    return NextResponse.json({ ok: true, ...(await settlementQueue()) });
  } catch (err) {
    console.error('[pms/requests/settle] GET failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid', detail: 'body must be JSON' }, { status: 400 });
  }
  const v = validateSettleReport(body);
  if (!v.ok) return NextResponse.json({ ok: false, error: 'invalid', detail: v.detail }, { status: 400 });
  try {
    const r = await recordSettlement(v.report);
    if (!r.ok) {
      const status = r.reason === 'not_found' ? 404 : r.reason === 'mismatch' ? 409 : 503;
      return NextResponse.json({ ok: false, error: r.reason, detail: r.detail ?? null }, { status });
    }
    return NextResponse.json({ ok: true, applied: r.applied, emailed: r.emailed });
  } catch (err) {
    console.error('[pms/requests/settle] POST failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
