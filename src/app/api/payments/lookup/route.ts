import { NextResponse } from 'next/server';
import { lookupPayments } from '@/lib/stripe-payments-lookup';
import { getActivePropertiesForStatements } from '@/lib/properties';

/**
 * GET /api/payments/lookup - what has actually been paid, from Stripe.
 *
 * The one place Helm answers "has this guest paid?" without opening
 * nineteen Stripe dashboards. Guesty cannot answer it: a Stay Cape Ann
 * booking is paid into the property's own Stripe account, so Guesty's
 * `totalPaid` is 0 for every one of them and reading it as fact has
 * already produced three wrong answers in a day (2026-09-20).
 *
 * Params (all optional):
 *   property_id   repeatable, or comma-separated. Omit for every key.
 *   email         exact payer email
 *   q             substring across description, payer name, email
 *   from, to      ISO days, inclusive. Defaults to the last 400 days.
 *   include_unsuccessful=1   also return failed / fully refunded charges
 *
 * READ-ONLY: GETs to Stripe, nothing else. No database write, no Stripe
 * write, no contact with statements, reservations, or payout math.
 *
 * Auth: Helm session, enforced by src/proxy.ts. This route is deliberately
 * NOT in PUBLIC_API_PREFIXES. No key is ever returned.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
// A fleet-wide scan is ~19 accounts x up to 10 pages, run in parallel.
export const maxDuration = 120;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const propertyIds = [
    ...searchParams.getAll('property_id').flatMap((v) => v.split(',')),
  ]
    .map((v) => v.trim())
    .filter(Boolean);

  const email = (searchParams.get('email') || '').trim();
  const text = (searchParams.get('q') || '').trim();
  const from = (searchParams.get('from') || '').trim();
  const to = (searchParams.get('to') || '').trim();

  for (const [label, value] of [['from', from], ['to', to]] as const) {
    if (value && !ISO_DAY.test(value)) {
      return NextResponse.json(
        { ok: false, error: `${label} must be a YYYY-MM-DD date.` },
        { status: 400 },
      );
    }
  }
  if (from && to && from > to) {
    return NextResponse.json({ ok: false, error: 'from is after to.' }, { status: 400 });
  }

  try {
    // The roster the caller believes it is searching, so a home with no
    // Stripe key comes back named in `unconfigured` instead of vanishing.
    const fleet = await getActivePropertiesForStatements();
    const result = await lookupPayments({
      propertyIds,
      rosterIds: fleet.map((p) => p.id),
      email: email || undefined,
      text: text || undefined,
      from: from || undefined,
      to: to || undefined,
      includeUnsuccessful: searchParams.get('include_unsuccessful') === '1',
    });
    // `ok` means the answer is complete. An account we could not read makes
    // it partial, and a caller must be able to tell that from "nothing was
    // paid" without digging a level down.
    return NextResponse.json({
      ok: !result.degraded,
      partial: result.degraded || undefined,
      ...result,
    });
  } catch (err) {
    // Never surface a key or a raw stack to the browser.
    console.error('[payments/lookup] failed:', (err as Error)?.message ?? err);
    return NextResponse.json(
      { ok: false, error: 'Could not read Stripe just now. Try again in a moment.' },
      { status: 502 },
    );
  }
}
