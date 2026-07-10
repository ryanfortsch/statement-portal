import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  AGREEMENT_KIND_LABEL,
  AGREEMENT_STATUS_LABEL,
  agreementStatus,
  type GuestAgreementRow,
} from '@/lib/agreement-types';
import { fmtAgreementMoney } from '@/lib/agreement-base';

/**
 * The Agreements tab of the Guests section: every bespoke Stay Cape Ann
 * rental agreement, newest first, with lifecycle chips. Row click goes to
 * the detail page (signing link, send, countersign).
 */
export async function AgreementsTab() {
  const { data } = await supabaseAdmin
    .from('guest_agreements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  const agreements = (data ?? []) as GuestAgreementRow[];

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 96 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          {agreements.length === 0
            ? 'No agreements yet.'
            : `${agreements.length} agreement${agreements.length === 1 ? '' : 's'}`}
        </div>
        <Link
          href="/guests/agreements/new"
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
          + New agreement
        </Link>
      </div>

      {agreements.length === 0 ? (
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
          Bespoke rental agreements for direct and mid-term stays, issued under the Stay Cape Ann brand
          with the Rising Tide affiliation line. Create one, send the guest their signing link, and the
          countersigned PDF lands back here and in Drive.
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {agreements.map((a) => {
            const status = agreementStatus(a);
            return (
              <Link
                key={a.id}
                href={`/guests/agreements/${a.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.4fr 1.2fr 1fr 0.7fr 0.6fr',
                  gap: 16,
                  alignItems: 'baseline',
                  padding: '13px 4px',
                  borderBottom: '1px solid var(--rule)',
                  textDecoration: 'none',
                  color: 'var(--ink)',
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 500 }}>{a.property_address}</span>
                <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{a.guest_name}</span>
                <span className="tabular-nums" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                  {fmtShortDate(a.stay_start)} – {fmtShortDate(a.stay_end)}
                </span>
                <span className="tabular-nums" style={{ fontSize: 13 }}>
                  {fmtAgreementMoney(a.rental_fee)}
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
                    {AGREEMENT_STATUS_LABEL[status]}
                  </span>
                  <span style={{ display: 'block', fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>
                    {AGREEMENT_KIND_LABEL[a.kind]}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function statusColor(status: ReturnType<typeof agreementStatus>): string {
  switch (status) {
    case 'executed': return '#1d6b46';
    case 'signed': return 'var(--signal)';
    case 'sent': return 'var(--ink)';
    case 'voided': return 'var(--ink-4)';
    default: return 'var(--ink-3)';
  }
}

function fmtShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}
