import { Section } from '@/components/Section';
import { listRecentPaymentLinks, loadPropertyNameMap, type PaymentLinkRow } from '@/lib/payment-links';
import {
  ageLabel,
  explainPaidCheckError,
  money,
  paymentLinkStatus,
  prettyPhone,
  stripeKeyFixUrl,
  type PaymentLinkStatus,
} from '@/lib/payment-links-text';
import { PaymentLinkActions } from './PaymentLinkActions';

/**
 * Every guest payment link from the last 30 days, whichever side minted it
 * (the concierge's reactive add-on cards or the panel above), with where it
 * stands: not sent, waiting, unpaid past a day, can't check (the property's
 * Stripe key lacks Checkout Sessions read), paid, cancelled. This is the
 * answer to "did they pay?", read from payment_link_requests, which the paid
 * sweep stamps every 15 minutes. Check now asks Stripe this second.
 */
export async function PaymentLinksLedger() {
  const [rows, names] = await Promise.all([
    listRecentPaymentLinks({ days: 30, limit: 40 }),
    loadPropertyNameMap(),
  ]);
  const open = rows.filter((r) => !r.paid_at && !r.deactivated_at).length;
  const paid = rows.filter((r) => !!r.paid_at).length;
  const bits = [open > 0 ? `${open} open` : null, paid > 0 ? `${paid} paid` : null].filter(Boolean);
  const eyebrow = bits.length > 0 ? bits.join(' · ') : 'last 30 days';

  return (
    <Section id="payment-links" title="Payment links" eyebrow={eyebrow} paddingTop={36}>
      {rows.length === 0 ? (
        <div style={{ borderTop: '1px solid var(--rule)', padding: '16px 0', fontSize: 13, color: 'var(--ink-3)' }}>
          No payment links in the last 30 days. Pick a stay above and open <b>Payment link</b> to charge a guest
          for a late checkout, a pet, or an extra night. Links the AI mints from guest asks show here too.
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {rows.map((r) => (
            <LedgerRow
              key={r.request_key}
              row={r}
              propertyName={names.get(r.property_id) ?? r.property_id}
              status={paymentLinkStatus(r)}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function LedgerRow({
  row,
  propertyName,
  status,
}: {
  row: PaymentLinkRow;
  propertyName: string;
  status: PaymentLinkStatus;
}) {
  const closed = status === 'paid' || status === 'cancelled';
  const who = row.guest_name || 'Guest';
  const meta: string[] = [];
  meta.push(
    row.source === 'helm'
      ? `made ${ageLabel(row.created_at)}${row.created_by ? ` by ${row.created_by.split('@')[0]}` : ''}`
      : `from a guest ask ${ageLabel(row.created_at)}`,
  );
  if (row.sent_via === 'sms') meta.push(`texted ${prettyPhone(row.guest_phone)}`);
  else if (row.sent_via === 'copied') meta.push('copied to send by hand');
  if (row.nudge_count > 0) meta.push(`nudged ${row.nudge_count}x, last ${ageLabel(row.nudged_at)}`);
  if (row.paid_check_error && !closed) meta.push(`can't check: ${explainPaidCheckError(row.paid_check_error)}`);
  else if (row.paid_checked_at && !closed) meta.push(`checked ${ageLabel(row.paid_checked_at)}`);
  const fixUrl = row.paid_check_error && !closed ? stripeKeyFixUrl(row.paid_check_error) : '';

  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        padding: '14px 0',
        borderBottom: '1px solid var(--rule)',
        alignItems: 'flex-start',
        opacity: status === 'cancelled' ? 0.55 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="font-serif" style={{ fontSize: 16, fontWeight: 500, letterSpacing: '-0.01em' }}>
            {who}
          </span>
          <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{row.label}</span>
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{propertyName}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{money(row.amount_cents)}</span>
          <StatusChip status={status} row={row} />
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.02em' }}>
          {meta.join(' · ')}
          {fixUrl && (
            <>
              {' · '}
              <a
                href={fixUrl}
                target="_blank"
                rel="noreferrer"
                title={row.paid_check_error}
                style={{ color: 'var(--signal)', textDecoration: 'none', fontWeight: 600 }}
              >
                Fix the key in Stripe →
              </a>
            </>
          )}
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>
        <PaymentLinkActions
          requestKey={row.request_key}
          url={row.url}
          closed={closed}
          markCopied={row.source === 'helm' && !row.sent_via}
        />
      </div>
    </div>
  );
}

function StatusChip({ status, row }: { status: PaymentLinkStatus; row: PaymentLinkRow }) {
  const tone =
    status === 'paid'
      ? 'var(--go, #2e7d32)'
      : status === 'overdue' || status === 'unsent' || status === 'unverified'
        ? 'var(--signal)'
        : status === 'cancelled'
          ? 'var(--ink-4)'
          : 'var(--ink-3)';
  const text =
    status === 'paid'
      ? `Paid ${ageLabel(row.paid_at)}`
      : status === 'overdue'
        ? `Unpaid · ${row.sent_at ? 'sent' : 'made'} ${ageLabel(row.sent_at || row.created_at)}`
        : status === 'unverified'
          ? "Can't check"
          : status === 'waiting'
            ? 'Sent · waiting'
            : status === 'unsent'
              ? 'Not sent yet'
              : 'Cancelled';
  return (
    <span
      title={status === 'paid' && row.paid_at ? `Paid ${new Date(row.paid_at).toLocaleString()}` : undefined}
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        border: `1px solid ${tone}`,
        color: tone,
        padding: '1px 7px',
      }}
    >
      {text}
    </span>
  );
}
