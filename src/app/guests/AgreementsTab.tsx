import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  AGREEMENT_GROUPS,
  AGREEMENT_KIND_LABEL,
  AGREEMENT_STATUS_LABEL,
  agreementGroup,
  agreementNextStep,
  agreementStatus,
  type GuestAgreementRow,
} from '@/lib/agreement-types';
import { fmtAgreementMoney } from '@/lib/agreement-base';

/**
 * The Agreements tab of the Growth strip: every bespoke Stay Cape Ann rental
 * agreement, grouped by whose hand it is in (Waiting on us, Waiting on
 * guest, Done; `agreementGroup`), newest first inside each. A row waiting on
 * us names its next step. Row click goes to the detail page (signing link,
 * send, countersign).
 */
export async function AgreementsTab() {
  const { data } = await supabaseAdmin
    .from('guest_agreements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  const agreements = (data ?? []) as GuestAgreementRow[];
  const groups = AGREEMENT_GROUPS.map((g) => ({
    ...g,
    rows: agreements.filter((a) => agreementGroup(agreementStatus(a)) === g.id),
  })).filter((g) => g.rows.length > 0);

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 96 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          {agreements.length === 0
            ? 'No agreements yet.'
            : agreements.length === 200
              ? 'Showing the newest 200 agreements'
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

      {groups.map((g) => (
        <div key={g.id} style={{ marginBottom: 36 }}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 10 }}>
            <h2 className="font-serif" style={{ fontSize: 20, fontWeight: 400, letterSpacing: '-0.01em', margin: 0 }}>{g.label}</h2>
            <span className="eyebrow">{g.rows.length}</span>
          </div>
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {g.rows.map((a) => <AgreementRow key={a.id} agreement={a} />)}
          </div>
        </div>
      ))}
    </section>
  );
}

function AgreementRow({ agreement: a }: { agreement: GuestAgreementRow }) {
  const status = agreementStatus(a);
  const next = agreementNextStep(status);
  return (
    <Link
      href={`/guests/agreements/${a.id}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '1.4fr 1.2fr 1fr 0.7fr 0.8fr',
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
        {fmtShortDate(a.stay_start)} to {fmtShortDate(a.stay_end)}
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
          {next ?? AGREEMENT_STATUS_LABEL[status]}
        </span>
        <span style={{ display: 'block', fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>
          {AGREEMENT_KIND_LABEL[a.kind]}
        </span>
      </span>
    </Link>
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
