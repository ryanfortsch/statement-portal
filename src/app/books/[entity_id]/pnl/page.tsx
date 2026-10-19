import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { FinancialsTabs } from '@/components/FinancialsTabs';
import { EmptyState } from '@/components/EmptyState';
import { LLC_ENTITIES } from '@/lib/books';
import { MONTH_NAMES, outsideKind, parsePnlYear, pnlStatusLine, type PnlLine, type PnlReport, type PnlSubtotal } from '@/lib/books-pnl';
import { loadPnl } from '@/lib/books-pnl-db';
import { buttonClass } from '@/lib/button-class';

export const dynamic = 'force-dynamic';

/**
 * One LLC's cash-basis profit and loss for a year, by month, from its
 * ledger (src/lib/books-pnl.ts holds the rules). The download is what goes
 * to the CPA. Until every row is reviewed the report says it is a draft
 * and how many rows are left.
 */

const FIRST_YEAR = 2025;

function money(cents: number): string {
  const d = Math.round(cents / 100);
  if (d === 0) return '0';
  const s = Math.abs(d).toLocaleString('en-US');
  return d < 0 ? `(${s})` : s;
}

const cellStyle = { padding: '5px 6px', textAlign: 'right' as const, whiteSpace: 'nowrap' as const };

function AmountCells({ months, total, blankZero, bold }: { months: number[]; total: number; blankZero: boolean; bold?: boolean }) {
  return (
    <>
      {months.map((c, i) => (
        <td key={i} style={{ ...cellStyle, color: c < 0 ? 'var(--signal)' : undefined }}>
          {blankZero && c === 0 ? '' : money(c)}
        </td>
      ))}
      <td style={{ ...cellStyle, fontWeight: bold ? 600 : 500, color: total < 0 ? 'var(--signal)' : undefined }}>{money(total)}</td>
    </>
  );
}

function LineRow({ line }: { line: PnlLine }) {
  const pad = 8 + line.depth * 16;
  const isTotal = line.kind === 'total';
  return (
    <tr style={{ borderTop: isTotal ? '1px solid var(--rule)' : undefined }}>
      <td style={{
        padding: '5px 6px', paddingLeft: pad,
        fontWeight: isTotal ? 600 : 400,
        color: line.uncategorized ? 'var(--signal)' : 'var(--ink)',
      }}>
        {line.name}
      </td>
      {line.heading ? <td colSpan={13} /> : <AmountCells months={line.months} total={line.total} blankZero={!isTotal} bold={isTotal} />}
    </tr>
  );
}

function SubtotalRow({ label, s, strong }: { label: string; s: PnlSubtotal; strong?: boolean }) {
  return (
    <tr style={{ borderTop: strong ? '2px solid var(--ink)' : '1px solid var(--ink)', background: strong ? 'var(--paper-2)' : undefined }}>
      <td style={{ padding: '7px 6px', fontWeight: 600 }}>{label}</td>
      <AmountCells months={s.months} total={s.total} blankZero={false} bold />
    </tr>
  );
}

function PnlTable({ report }: { report: PnlReport }) {
  const byId = Object.fromEntries(report.sections.map((s) => [s.id, s]));
  const hasCogs = byId.cogs.lines.length > 0;
  const hasOther = byId.other_income.lines.length > 0 || byId.other_expense.lines.length > 0;
  const section = (id: string, always: boolean) => {
    const sec = byId[id];
    if (!always && sec.lines.length === 0) return null;
    return (
      <tbody key={id}>
        <tr>
          <td colSpan={14} className="eyebrow" style={{ padding: '16px 6px 4px' }}>{sec.title}</td>
        </tr>
        {sec.lines.length === 0 && (
          <tr><td colSpan={14} style={{ padding: '4px 8px', color: 'var(--ink-4)' }}>Nothing filed here.</td></tr>
        )}
        {sec.lines.map((l: PnlLine, i: number) => <LineRow key={`${l.key}-${l.kind}-${i}`} line={l} />)}
        <SubtotalRow label={`Total ${sec.title}`} s={sec} />
      </tbody>
    );
  };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 980 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--ink)' }}>
            <th style={{ textAlign: 'left', padding: '6px', fontWeight: 500, color: 'var(--ink-3)' }}>{report.year}</th>
            {MONTH_NAMES.map((m) => (
              <th key={m} style={{ ...cellStyle, fontWeight: 500, color: 'var(--ink-3)' }}>{m}</th>
            ))}
            <th style={{ ...cellStyle, fontWeight: 600 }}>Total</th>
          </tr>
        </thead>
        {section('income', true)}
        {hasCogs && section('cogs', false)}
        {hasCogs && <tbody><SubtotalRow label="Gross profit" s={report.gross_profit} /></tbody>}
        {section('expense', true)}
        {hasOther && <tbody><SubtotalRow label="Net operating income" s={report.net_operating_income} /></tbody>}
        {hasOther && section('other_income', false)}
        {hasOther && section('other_expense', false)}
        {hasOther && <tbody><SubtotalRow label="Net other income" s={report.net_other_income} /></tbody>}
        <tbody><SubtotalRow label="Net income" s={report.net_income} strong /></tbody>
      </table>
    </div>
  );
}

export default async function BooksPnlPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity_id: string }>;
  searchParams: Promise<{ year?: string | string[] }>;
}) {
  const { entity_id } = await params;
  const entity = LLC_ENTITIES[entity_id];
  if (!entity) notFound();
  const thisYear = new Date().getUTCFullYear();
  const year = parsePnlYear((await searchParams).year, thisYear);
  const years = Array.from({ length: thisYear - FIRST_YEAR + 1 }, (_, i) => thisYear - i);
  const entities = Object.values(LLC_ENTITIES).sort((a, b) => a.sort - b.sort);
  const load = await loadPnl(entity_id, year);
  const report = load.ready ? load.report : null;
  const exportHref = (format: 'xlsx' | 'csv') => `/api/books/pnl-export?entity=${entity_id}&year=${year}&format=${format}`;

  const linkStyle = (active: boolean) => ({
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    color: active ? 'var(--ink)' : 'var(--ink-3)',
    textDecoration: active ? 'underline' : 'none',
    textDecorationColor: 'var(--signal)',
    textDecorationThickness: 2,
    textUnderlineOffset: 7,
    whiteSpace: 'nowrap' as const,
  });

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <FinancialsTabs current="books" />

      <HelmHero plain eyebrow={`Helm · LLC Accounting · ${entity.short}`} title="Profit and loss" paddingTop={28} paddingBottom={16} />

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 4 }}>
        <nav aria-label="Entities" className="flex items-baseline flex-wrap" style={{ gap: '10px 22px', paddingBottom: 6 }}>
          {entities.map((e) => (
            <Link key={e.id} href={`/books/${e.id}/pnl?year=${year}`} aria-current={e.id === entity_id ? 'page' : undefined} style={linkStyle(e.id === entity_id)}>
              {e.short}
            </Link>
          ))}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 14 }}>
            {years.map((y) => (
              <Link key={y} href={`/books/${entity_id}/pnl?year=${y}`} aria-current={y === year ? 'page' : undefined} style={linkStyle(y === year)}>
                {y}
              </Link>
            ))}
          </span>
        </nav>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 18, paddingBottom: 40, flex: 1 }}>
        {!report ? (
          <EmptyState action={{ label: 'Open the ledger', href: `/books/${entity_id}` }}>
            {load.ready === false && load.reason === 'tables_missing'
              ? 'Ask Ryan: the ledger is not switched on yet, so there is nothing to report.'
              : 'The ledger could not be read just now. Reload to try again.'}
          </EmptyState>
        ) : (
          <>
            <div className="flex items-baseline flex-wrap" style={{ gap: '10px 18px', marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: report.final ? 'var(--positive)' : 'var(--signal)', fontWeight: 500 }}>
                {pnlStatusLine(report)}
              </div>
              {!report.final && report.counts.transactions > 0 && (
                <Link href={`/books/${entity_id}`} style={{ fontSize: 12, color: 'var(--ink-3)' }}>Review in the ledger →</Link>
              )}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <Link href={`/books/${entity_id}/balance-sheet?year=${year}`} style={{ fontSize: 12, color: 'var(--ink-3)', marginRight: 6 }}>Balance sheet →</Link>
                <a href={exportHref('xlsx')} className={buttonClass('primary', 'sm')}>Download for the CPA</a>
                <a href={exportHref('csv')} className={buttonClass('quiet', 'sm')}>CSV</a>
              </span>
            </div>
            {report.off_chart_keys.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 10 }}>
                Counted as uncategorized because the category is not on this entity&apos;s chart: {report.off_chart_keys.join(', ')}.
              </div>
            )}

            {report.counts.transactions === 0 ? (
              <EmptyState action={{ label: 'Upload a Chase CSV', href: `/books/${entity_id}` }}>
                Nothing on file for {year} yet.
              </EmptyState>
            ) : (
              <PnlTable report={report} />
            )}

            {report.outside.length > 0 && (
              <div style={{ marginTop: 28 }}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>Not in net income</div>
                <table className="tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 560 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--ink)', color: 'var(--ink-3)' }}>
                      <th style={{ textAlign: 'left', padding: 6, fontWeight: 500 }}>Account</th>
                      <th style={{ textAlign: 'left', padding: 6, fontWeight: 500 }}>Kind</th>
                      <th style={{ ...cellStyle, fontWeight: 500 }}>In</th>
                      <th style={{ ...cellStyle, fontWeight: 500 }}>Out</th>
                      <th style={{ ...cellStyle, fontWeight: 500 }}>Rows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.outside.map((o) => (
                      <tr key={o.key} style={{ borderTop: '1px solid var(--rule)' }}>
                        <td style={{ padding: 6 }}>{o.name}</td>
                        <td style={{ padding: 6, color: 'var(--ink-3)' }}>
                          {o.pass_through ? 'Owner trust' : outsideKind(o)}
                        </td>
                        <td style={cellStyle}>{money(o.money_in)}</td>
                        <td style={cellStyle}>{money(o.money_out)}</td>
                        <td style={{ ...cellStyle, color: 'var(--ink-3)' }}>{o.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <HelmFooter module="LLC Accounting" />
    </div>
  );
}
