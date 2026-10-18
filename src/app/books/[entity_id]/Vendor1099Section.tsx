import { Vendor1099Table } from './Vendor1099Table';
import { IRS_1099_THRESHOLD, type Vendor1099Report } from '@/lib/vendor-1099';

/**
 * Year-end 1099 candidates on the Rising Tide ledger: every vendor paid over
 * $600 this year across cleaning, repairs and the company card and operating
 * account, with the W-9 tick. Moved from Cost Analysis on 2026-10-18; the
 * report (src/lib/vendor-1099.ts) is unchanged.
 */
function fmtWhole(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function Vendor1099Section({ report }: { report: Vendor1099Report }) {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div className="eyebrow">1099 candidates · {report.year}</div>
        <div style={{ fontSize: 10, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
          IRS threshold: ${IRS_1099_THRESHOLD} YTD
        </div>
      </div>
      {report.totals.vendors === 0 ? (
        <div style={{ padding: 18, background: 'var(--paper-2)', border: '1px solid var(--rule)', fontSize: 12, color: 'var(--ink-3)' }}>
          No vendor payments yet this year across cleaning, repairs, or the card and operating account.
        </div>
      ) : (
        <>
          <div
            className="rt-helm-stat-strip"
            style={{
              borderTop: '1px solid var(--ink)',
              borderBottom: '1px solid var(--ink)',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              marginBottom: 18,
            }}
          >
            <Stat label="Vendors paid" value={String(report.totals.vendors)} sub="any amount" />
            <Stat label="Over $600 YTD" value={String(report.totals.over600)} sub="1099 candidates" />
            <Stat label="Without W-9" value={String(report.totals.over600WithoutW9)} sub="to collect" accent={report.totals.over600WithoutW9 > 0} />
            <Stat label="Spend over $600" value={fmtWhole(report.totals.spendOver600)} sub={`${report.year} YTD`} last />
          </div>
          <Vendor1099Table rows={report.rows} />
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 720 }}>
            Payroll is left out (wages get a W-2). Tick W-9 on file once it is in QuickBooks; a corporation needs no 1099.
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, sub, accent, last }: { label: string; value: string; sub?: string; accent?: boolean; last?: boolean }) {
  return (
    <div className="rt-helm-stat" style={{ padding: '18px 20px', borderRight: last ? 'none' : '1px solid var(--rule)' }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div className="font-serif tabular-nums" style={{ fontSize: 26, fontWeight: 400, color: accent ? 'var(--signal)' : 'var(--ink)', lineHeight: 1.05 }}>{value}</div>
      {sub && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)' }}>{sub}</div>}
    </div>
  );
}
