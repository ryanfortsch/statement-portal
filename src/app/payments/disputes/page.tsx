import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { FinancialsTabs } from '@/components/FinancialsTabs';
import { StripeTabs } from '@/components/StripeTabs';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { isOwnerSession } from '@/lib/helm-access-server';
import { getActivePropertiesForStatements } from '@/lib/properties-server';
import { loadAllDisputes, loadCheckoutTerms } from '@/lib/stripe-disputes';
import {
  daysLeft,
  disputePacketPath,
  disputeStatusWords,
  needsResponse,
  sortDisputes,
  type CheckoutTermsState,
} from '@/lib/stripe-disputes-core';
import { money } from '@/lib/dispute-packet-core';

/**
 * Card disputes across every home's own Stripe account (2026-11-06): the
 * ones waiting on our evidence first, soonest deadline first, each linking
 * its packet. Below, whether each home's payment page asks the guest to
 * accept terms, since an account with no Terms of service URL in Stripe
 * drops the checkbox silently.
 *
 * Read-only: Stripe GETs and Supabase selects. Owners only (the path sits
 * behind /payments/disputes in OWNER_PATH_PREFIXES; the page checks again).
 * The daily /api/cron/stripe-disputes run files each open one as a to-do.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

const cell: React.CSSProperties = { padding: '8px 12px 8px 0', borderBottom: '1px solid var(--rule)', verticalAlign: 'top' };
const quiet: React.CSSProperties = { color: 'var(--ink-3)', fontSize: 13 };
const h2: React.CSSProperties = { fontFamily: 'var(--font-serif)', fontSize: 22, margin: '36px 0 10px' };

const TERMS_WORDS: Record<CheckoutTermsState, { text: string; color: string }> = {
  required: { text: 'Guest must accept terms', color: 'var(--tide-deep)' },
  refused: { text: 'No terms checkbox: set a Terms of service URL in Stripe', color: 'var(--signal)' },
  no_recent_link: { text: 'No payment link since Oct 20 to check', color: 'var(--ink-3)' },
  unread: { text: 'Could not read', color: 'var(--ink-3)' },
};

function todayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export default async function DisputesPage() {
  if (!(await isOwnerSession())) notFound();
  const [{ disputes, unread }, terms, fleet] = await Promise.all([
    loadAllDisputes(),
    loadCheckoutTerms(),
    getActivePropertiesForStatements(),
  ]);
  const name = (id: string) => fleet.find((p) => p.id === id)?.name || id.replace(/_/g, ' ');
  const today = todayET();
  const sorted = sortDisputes(disputes);
  const open = sorted.filter((d) => needsResponse(d.status));

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <FinancialsTabs current="payments" />
      <HelmHero
        plain
        eyebrow="Stripe · read-only"
        title="Card disputes"
        line={
          open.length
            ? `${open.length} waiting on our evidence. Answer the reason code, before the deadline.`
            : 'Nothing waiting on our evidence.'
        }
      />
      <StripeTabs current="disputes" />
      <section className="max-w-[1100px] mx-auto px-10 w-full" style={{ paddingBottom: 56 }}>
        <p style={{ ...quiet, margin: '0 0 16px' }}>
          The last 120 days, from each home&apos;s own Stripe account. Each one waiting on us is also a to-do, due the day
          Stripe stops taking evidence. Helm submits nothing: open the packet, save it as a PDF and upload it in Stripe.
        </p>

        {sorted.length === 0 ? (
          <p style={quiet}>No disputes in the last 120 days on the accounts Helm could read.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                {['Home', 'Amount', 'Reason', 'Status', 'Evidence due', ''].map((h) => (
                  <th key={h} className="eyebrow" style={{ ...cell, color: 'var(--ink-3)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => {
                const waiting = needsResponse(d.status);
                const left = waiting ? daysLeft(d.dueBy, today) : null;
                return (
                  <tr key={d.disputeId}>
                    <td style={cell}>{name(d.propertyId)}</td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>{money(d.amountCents)}</td>
                    <td style={cell}>{(d.reason || '-').replace(/_/g, ' ')}</td>
                    <td style={{ ...cell, color: waiting ? 'var(--signal)' : undefined }}>{disputeStatusWords(d.status)}</td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                      {waiting && d.dueBy ? (
                        <>
                          {d.dueBy}
                          {left !== null && (
                            <div style={{ ...quiet, color: left <= 3 ? 'var(--signal)' : undefined }}>
                              {left < 0 ? 'past' : left === 0 ? 'today' : `${left} day${left === 1 ? '' : 's'} left`}
                            </div>
                          )}
                        </>
                      ) : (
                        <span style={quiet}>opened {d.openedOn || '-'}</span>
                      )}
                    </td>
                    <td style={cell}>
                      {d.chargeId && (
                        <Link href={disputePacketPath(d)} style={{ color: 'var(--tide-deep)' }}>
                          Packet
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {unread.length > 0 && (
          <p style={{ color: 'var(--signal)', fontSize: 13, marginTop: 12 }}>
            Could not read disputes for {unread.map((u) => name(u.propertyId)).join(', ')}. Their Stripe keys need
            Disputes: Read. Until then a dispute there shows only in Stripe.
          </p>
        )}

        <h2 style={h2}>Terms at checkout</h2>
        <p style={{ ...quiet, margin: '0 0 12px' }}>
          Since Oct 20 every payment link asks the guest to tick &ldquo;I agree to the terms&rdquo;, which is what a
          bank accepts as consent. Stripe drops the checkbox when the account has no Terms of service URL (Stripe,
          Settings, Public details), so the newest link per home is checked here.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <tbody>
            {[...terms]
              .sort((a, b) => name(a.propertyId).localeCompare(name(b.propertyId)))
              .map((t) => (
                <tr key={t.propertyId}>
                  <td style={{ ...cell, width: 220 }}>{name(t.propertyId)}</td>
                  <td style={{ ...cell, color: TERMS_WORDS[t.state].color }}>
                    {TERMS_WORDS[t.state].text}
                    {t.linkCreatedAt && <span style={quiet}> · newest link {t.linkCreatedAt.slice(0, 10)}</span>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
      <HelmFooter module="Card disputes" right="Read-only · nothing is sent to Stripe" />
    </div>
  );
}
