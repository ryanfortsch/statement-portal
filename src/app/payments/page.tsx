import { HelmMasthead } from '@/components/HelmMasthead';
import { FinancialsTabs } from '@/components/FinancialsTabs';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { lookupPayments } from '@/lib/stripe-payments-lookup';
import { BUSINESS_TZ } from '@/lib/payments-lookup-core';
import { getActivePropertiesForStatements } from '@/lib/properties';
import { PaymentsSearchForm } from './PaymentsSearchForm';

/**
 * Payments: what has actually been paid, read live from the properties'
 * own Stripe accounts.
 *
 * Guesty cannot answer this. A Stay Cape Ann booking is paid into the
 * property's own Stripe account, so Guesty reports $0 paid on every one of
 * them, and reading that zero as fact produced three wrong answers in a
 * single day (2026-09-20), one of which released a hold. Before this page
 * the only honest answer meant opening nineteen Stripe dashboards by hand.
 *
 * Read-only: GETs to Stripe and nothing else. No statement, reservation or
 * payout figure is read or written here.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 120;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? '').trim();
}

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function day(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  // Cape Ann time, so an evening payment is not printed under tomorrow.
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: BUSINESS_TZ,
      });
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  // The live registry, not the 15-entry static const: a home missing from
  // that const would be unsearchable AND unreported, which is the failure
  // this page exists to prevent.
  const fleet = await getActivePropertiesForStatements();
  const names = new Map(fleet.map((p) => [p.id, p.name]));
  const propertyLabel = (id: string) => names.get(id) || id.replace(/_/g, ' ');
  const email = one(sp.email);
  const q = one(sp.q);
  const propertyId = one(sp.property_id);
  const from = one(sp.from);
  const to = one(sp.to);
  const includeUnsuccessful = one(sp.include_unsuccessful) === '1';

  // Only search once the operator has actually asked something: a bare page
  // load should not scan every account. A date range on its own is a real
  // question ("what came in last week"), so it counts.
  const asked = !!(email || q || propertyId || ISO_DAY.test(from) || ISO_DAY.test(to));
  const result = asked
    ? await lookupPayments({
        propertyIds: propertyId ? [propertyId] : [],
        rosterIds: fleet.map((p) => p.id),
        email: email || undefined,
        text: q || undefined,
        from: ISO_DAY.test(from) ? from : undefined,
        to: ISO_DAY.test(to) ? to : undefined,
        includeUnsuccessful,
      })
    : null;

  // One dated list, so sort across properties. Grouping by slug under date
  // headers reads as chronological and is not.
  const rows = (result?.properties ?? [])
    .flatMap((p) => p.rows)
    .sort((a, b) => (a.created < b.created ? 1 : -1));
  const errors = (result?.properties ?? []).filter((p) => p.error);
  const truncated = (result?.properties ?? []).filter((p) => p.truncated);
  // Only money we actually hold. A failed, uncaptured or charged-back row is
  // visible when asked for, but it is not a payment and must not be summed.
  const held = rows.filter((r) => r.paid);
  const total = held.reduce((s, r) => s + r.amount - r.refunded, 0);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <FinancialsTabs current="payments" />
      <HelmHero
        eyebrow="Helm · Money"
        title="What was"
        emphasis="actually paid."
        description="Read straight from each property's own Stripe account. Guesty shows $0 paid on every direct booking because the money never passes through it, so this is the only place that answers the question honestly."
      />

      <section className="max-w-[1100px] mx-auto px-10 w-full" style={{ paddingBottom: 56 }}>
        <PaymentsSearchForm
          properties={fleet.map((p) => ({ id: p.id, name: p.name }))}
          initial={{ email, q, propertyId, from, to, includeUnsuccessful }}
        />

        {!asked && (
          <p className="eyebrow" style={{ color: 'var(--ink-3)', marginTop: 28 }}>
            Search by the guest&apos;s email for the surest answer. A name or part of a
            description works too.
          </p>
        )}

        {result && (
          <>
            <div className="eyebrow" style={{ color: 'var(--ink-3)', margin: '28px 0 14px' }}>
              {held.length === 0
                ? result.searched.length === 0
                  ? 'Nothing was searched: no Stripe key is configured for any matching home'
                  : `No payments found across ${result.searched.length} account${result.searched.length === 1 ? '' : 's'}`
                : `${held.length} payment${held.length === 1 ? '' : 's'}, ${money(total, held[0].currency)} net of refunds, across ${result.searched.length} account${result.searched.length === 1 ? '' : 's'}`}
              {rows.length > held.length && ` · ${rows.length - held.length} not counted as paid`}
              {' · '}
              {day(result.window.from)} to {day(result.window.to)}
            </div>

            {result.degraded && held.length === 0 && (
              <p style={{ color: 'var(--signal)', fontSize: 13, marginBottom: 12 }}>
                At least one account could not be read, so this is not a
                complete answer. Treat it as unknown, not as unpaid.
              </p>
            )}

            {result.unconfigured.length > 0 && (
              <p style={{ color: 'var(--signal)', fontSize: 13, marginBottom: 12 }}>
                No Stripe key configured for {result.unconfigured.map(propertyLabel).join(', ')}.
                Nothing was searched there, so this is not the same as &ldquo;no payments&rdquo;.
              </p>
            )}
            {errors.length > 0 && (
              <p style={{ color: 'var(--signal)', fontSize: 13, marginBottom: 12 }}>
                Could not read {errors.map((e) => propertyLabel(e.property_id)).join(', ')}:{' '}
                {errors[0].error}
              </p>
            )}
            {truncated.length > 0 && (
              <p style={{ color: 'var(--signal)', fontSize: 13, marginBottom: 12 }}>
                {truncated.map((t) => propertyLabel(t.property_id)).join(', ')} had more charges
                than one scan reads. Narrow the dates to be sure of a complete answer.
              </p>
            )}

            {rows.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--rule)' }}>
                      {['Paid', 'Home', 'Guest', 'For', 'Amount', ''].map((h) => (
                        <th key={h} className="eyebrow" style={{ padding: '10px 12px 10px 0', color: 'var(--ink-3)' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} style={{ borderBottom: '1px solid var(--rule)' }}>
                        <td style={{ padding: '10px 12px 10px 0', whiteSpace: 'nowrap' }}>{day(r.created)}</td>
                        <td style={{ padding: '10px 12px 10px 0', whiteSpace: 'nowrap' }}>{propertyLabel(r.property_id)}</td>
                        <td style={{ padding: '10px 12px 10px 0' }}>
                          {r.name || '(no name)'}
                          <div style={{ color: 'var(--ink-3)', fontSize: 12 }}>{r.email}</div>
                        </td>
                        <td style={{ padding: '10px 12px 10px 0', color: 'var(--ink-2)' }}>{r.description || '-'}</td>
                        <td style={{ padding: '10px 12px 10px 0', whiteSpace: 'nowrap', fontWeight: 600 }}>
                          {money(r.amount, r.currency)}
                          {r.refunded > 0 && (
                            <div style={{ color: 'var(--signal)', fontSize: 12, fontWeight: 400 }}>
                              {money(r.refunded, r.currency)} refunded
                            </div>
                          )}
                          {!r.paid && (
                            <div style={{ color: 'var(--signal)', fontSize: 12, fontWeight: 400 }}>
                              {r.not_paid_reason || r.status}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px 0' }}>
                          {r.receipt_url && (
                            <a href={r.receipt_url} target="_blank" rel="noopener noreferrer" className="eyebrow" style={{ color: 'var(--signal)' }}>
                              Receipt
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <HelmFooter module="Money" right="Read-only · straight from Stripe" />
    </div>
  );
}
