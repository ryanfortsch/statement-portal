import Link from 'next/link';
import { listQuotes } from '@/lib/sca-quotes';
import {
  SCA_QUOTE_STATUS_LABEL,
  deriveQuoteStatus,
  displayTitle,
  fmtCents,
  type ScaQuoteStatus,
} from '@/lib/sca-quotes-types';

/**
 * The Quotes tab of the Guests section: every Stay Cape Ann custom quote,
 * newest first, with the lifecycle chip derived at read time (so an
 * expired quote reads as expired before the nightly cron catches it).
 * Row click goes to the detail page: guest link, send, accept, balance.
 */
export async function QuotesTab() {
  const quotes = await listQuotes();

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 96 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          {quotes.length === 0 ? 'No quotes yet.' : `${quotes.length} quote${quotes.length === 1 ? '' : 's'}`}
        </div>
        <Link
          href="/guests/quotes/new"
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: 'var(--paper)',
            background: 'var(--ink)',
            padding: '10px 18px',
            textDecoration: 'none',
          }}
        >
          + New quote
        </Link>
      </div>

      {quotes.length === 0 ? (
        <div
          style={{
            border: '1px solid var(--rule)',
            padding: '36px 32px',
            maxWidth: 640,
            fontSize: 13,
            lineHeight: 1.65,
            color: 'var(--ink-3)',
          }}
        >
          Custom quotes and booking requests for Stay Cape Ann. Compose the price here (a negotiated
          nightly, a longer stay, a deposit plan), send the guest their link, and they accept and pay on
          staycapeann.com. The reservation lands in Guesty at the quoted rate and the charge reaches the
          owner statement like any other direct booking.
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {quotes.map((q) => {
            const status = deriveQuoteStatus(q);
            const guest = `${q.guest_first_name} ${q.guest_last_name}`.trim() || 'No guest yet';
            return (
              <Link
                key={q.id}
                href={`/guests/quotes/${q.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.4fr 1.2fr 1fr 0.8fr 0.6fr',
                  gap: 16,
                  alignItems: 'baseline',
                  padding: '13px 4px',
                  borderBottom: '1px solid var(--rule)',
                  textDecoration: 'none',
                  color: 'var(--ink)',
                }}
              >
                <span>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{displayTitle(q.property_title)}</span>
                  {q.property_internal_name && (
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>{q.property_internal_name}</span>
                  )}
                </span>
                <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{guest}</span>
                <span className="tabular-nums" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                  {fmtRowDate(q.check_in)} to {fmtRowDate(q.check_out)}
                  <span style={{ color: 'var(--ink-4)' }}> · {q.nights}n</span>
                </span>
                <span>
                  <span className="tabular-nums" style={{ display: 'block', fontSize: 13 }}>{fmtCents(q.total_cents, q.currency)}</span>
                  {q.payment_plan === 'split' && q.deposit_cents != null && (
                    <span style={{ display: 'block', fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>
                      {depositHint(q.deposit_cents, q.total_cents)}
                    </span>
                  )}
                </span>
                <span style={{ textAlign: 'right' }}>
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: '.1em',
                      textTransform: 'uppercase',
                      fontWeight: 700,
                      color: statusColor(status),
                    }}
                  >
                    {SCA_QUOTE_STATUS_LABEL[status]}
                  </span>
                  {status === 'accepted' && q.payment_plan === 'split' && !q.balance_paid_at && (
                    <span style={{ display: 'block', fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>balance open</span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function statusColor(status: ScaQuoteStatus): string {
  switch (status) {
    case 'accepted': return '#1d6b46';
    case 'sent': return 'var(--ink)';
    case 'declined': return 'var(--signal)';
    case 'expired': return 'var(--ink-4)';
    case 'voided': return 'var(--ink-4)';
    default: return 'var(--ink-3)';
  }
}

function depositHint(deposit: number, total: number): string {
  const pct = total > 0 ? Math.round((deposit / total) * 100) : 0;
  return `${pct}% deposit`;
}

function fmtRowDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}
