import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { FinancialsTabs } from '@/components/FinancialsTabs';
import { EmptyState } from '@/components/EmptyState';
import { SubmitButton } from '@/components/SubmitButton';
import { LLC_ENTITIES, coaAccountFor } from '@/lib/books';
import { parsePnlYear, toCents } from '@/lib/books-pnl';
import {
  bankCheckWords,
  bsDateLabel,
  bsStatusLine,
  journalAccountsFor,
  openingLinesFor,
  type BalanceSheet,
  type BsLine,
  type OpeningLine,
} from '@/lib/books-balance-sheet';
import { loadBalanceSheet } from '@/lib/books-balance-sheet-db';
import { buttonClass } from '@/lib/button-class';
import { addJournalEntry, deleteJournalEntry, saveOpeningBalances } from './actions';

export const dynamic = 'force-dynamic';

/**
 * One LLC's cash-basis balance sheet at December 31, beside the year
 * before (src/lib/books-balance-sheet.ts holds the rules). The opening
 * figures and the year-end journal entries are entered here; the download
 * is what goes to the CPA. The sheet balances by construction, so what it
 * checks is each bank account against Chase's own Balance column and that
 * every account has an opening figure.
 */

const FIRST_YEAR = 2025;

function money(cents: number | null): string {
  if (cents == null) return '';
  const d = Math.round(cents / 100);
  if (d === 0) return '0';
  const s = Math.abs(d).toLocaleString('en-US');
  return d < 0 ? `(${s})` : s;
}

function exact(cents: number): string {
  const s = (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `-$${s}` : `$${s}`;
}

const cellStyle = { padding: '5px 8px', textAlign: 'right' as const, whiteSpace: 'nowrap' as const, width: 130 };
const inputStyle = {
  padding: '6px 8px',
  fontSize: 13,
  border: '1px solid var(--rule)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  borderRadius: 4,
};

function Amount({ cents, bold }: { cents: number | null; bold?: boolean }) {
  return (
    <td style={{ ...cellStyle, fontWeight: bold ? 600 : 400, color: cents != null && cents < 0 ? 'var(--signal)' : undefined }}>
      {money(cents)}
    </td>
  );
}

function LineRow({ line, base, two }: { line: BsLine; base: number; two: boolean }) {
  const isTotal = line.kind === 'total';
  return (
    <tr style={{ borderTop: isTotal ? '1px solid var(--rule)' : undefined }}>
      <td style={{ padding: '5px 8px', paddingLeft: 8 + (base + line.depth) * 16, fontWeight: isTotal ? 600 : 400 }}>{line.name}</td>
      {line.heading ? (
        <td colSpan={two ? 2 : 1} />
      ) : (
        <>
          {two && <Amount cents={line.prior} bold={isTotal} />}
          <Amount cents={line.current} bold={isTotal} />
        </>
      )}
    </tr>
  );
}

function TotalRow({ label, prior, current, two, strong }: { label: string; prior: number | null; current: number; two: boolean; strong?: boolean }) {
  return (
    <tr style={{ borderTop: strong ? '2px solid var(--ink)' : '1px solid var(--ink)', background: strong ? 'var(--paper-2)' : undefined }}>
      <td style={{ padding: '7px 8px', fontWeight: 600 }}>{label}</td>
      {two && <Amount cents={prior} bold />}
      <Amount cents={current} bold />
    </tr>
  );
}

function SheetTable({ bs }: { bs: BalanceSheet }) {
  const two = !!bs.dates.prior;
  const span = two ? 3 : 2;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 13, maxWidth: 720 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--ink)' }}>
            <th />
            {two && <th style={{ ...cellStyle, fontWeight: 500, color: 'var(--ink-3)' }}>{bsDateLabel(bs.dates.prior!)}</th>}
            <th style={{ ...cellStyle, fontWeight: 600 }}>{bsDateLabel(bs.dates.current)}</th>
          </tr>
        </thead>
        {bs.sections.map((s) => (
          <tbody key={s.id}>
            <tr>
              <td colSpan={span} className="eyebrow" style={{ padding: '18px 8px 4px' }}>{s.title}</td>
            </tr>
            {s.groups.map((g) => {
              const titled = s.id !== 'equity';
              return [
                titled && (
                  <tr key={`${g.id}-title`}>
                    <td colSpan={span} style={{ padding: '8px 8px 2px', color: 'var(--ink-3)', fontSize: 12 }}>{g.title}</td>
                  </tr>
                ),
                ...g.lines.map((l, i) => <LineRow key={`${g.id}-${l.id}-${l.kind}-${i}`} line={l} base={titled ? 1 : 0} two={two} />),
                g.lines.length === 0 && (
                  <tr key={`${g.id}-none`}>
                    <td colSpan={span} style={{ padding: '4px 24px', color: 'var(--ink-4)' }}>None on file.</td>
                  </tr>
                ),
                titled && <TotalRow key={`${g.id}-total`} label={`Total ${g.title.toLowerCase()}`} prior={g.prior} current={g.current} two={two} />,
              ];
            })}
            <TotalRow label={`Total ${s.title.toLowerCase()}`} prior={s.prior} current={s.current} two={two} strong={s.id === 'assets'} />
            {s.id === 'equity' && (
              <TotalRow
                label="Total liabilities and equity"
                prior={bs.total_liabilities_and_equity.prior}
                current={bs.total_liabilities_and_equity.current}
                two={two}
                strong
              />
            )}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function Checks({ bs }: { bs: BalanceSheet }) {
  const intercompany = bs.sections[2].groups[0].lines.find((l) => l.id === 'coa:intercompany_due' && l.kind === 'account');
  return (
    <div style={{ marginTop: 32 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Checks</div>
      {!bs.balanced && (
        <p style={{ fontSize: 13, color: 'var(--signal)', margin: '0 0 8px' }}>
          Assets do not equal liabilities and equity. Ask Ryan: this is a bug, not a bookkeeping error.
        </p>
      )}
      {bs.bank_checks.length > 0 && (
        <table className="tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 560, marginBottom: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--ink)', color: 'var(--ink-3)' }}>
              <th style={{ textAlign: 'left', padding: 6, fontWeight: 500 }}>Bank account</th>
              <th style={{ textAlign: 'left', padding: 6, fontWeight: 500 }}>Last day on file</th>
              <th style={{ ...cellStyle, width: undefined, fontWeight: 500 }}>Helm</th>
              <th style={{ ...cellStyle, width: undefined, fontWeight: 500 }}>Chase</th>
              <th style={{ textAlign: 'left', padding: 6, fontWeight: 500 }} />
            </tr>
          </thead>
          <tbody>
            {bs.bank_checks.map((c) => (
              <tr key={c.account_id} style={{ borderTop: '1px solid var(--rule)' }}>
                <td style={{ padding: 6 }}>{c.name}</td>
                <td style={{ padding: 6, color: 'var(--ink-3)' }}>{c.date ? bsDateLabel(c.date) : ''}</td>
                <td style={{ ...cellStyle, width: undefined }}>{c.helm == null ? '' : exact(c.helm)}</td>
                <td style={{ ...cellStyle, width: undefined }}>{c.chase == null ? '' : exact(c.chase)}</td>
                <td style={{ padding: 6, color: c.status === 'match' ? 'var(--positive)' : c.status === 'mismatch' ? 'var(--signal)' : 'var(--ink-3)' }}>
                  {bankCheckWords(c)}
                  {c.status === 'mismatch' && c.helm != null && c.chase != null && `, off by ${exact(c.helm - c.chase)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ul style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
        {bs.bank_checks.some((c) => c.status === 'mismatch') && (
          <li>A bank account off from Chase means its opening figure is wrong or some months are not uploaded yet.</li>
        )}
        {bs.missing_openings.map((m) => (
          <li key={m.id}>
            {m.name}: {m.why === 'postings' ? 'has postings since the books opened but no opening figure.' : 'no opening figure yet.'}
          </li>
        ))}
        {bs.trust_gap != null && bs.trust_gap !== 0 && (
          <li>
            The trust accounts hold {exact(bs.trust_gap)} more than is owed to owners: Rising Tide money left in them, or a row filed to the wrong side.
          </li>
        )}
        {intercompany && intercompany.current !== 0 && (
          <li>
            Intercompany is {exact(intercompany.current)}. Transfers and card payoffs between this LLC&apos;s own accounts net to zero once both sides are uploaded,
            so the rest is money to or from another LLC, or a side not uploaded yet.
          </li>
        )}
      </ul>
    </div>
  );
}

function EquityForYear({ bs }: { bs: BalanceSheet }) {
  const e = bs.equity;
  if (!e || !bs.dates.prior) return null;
  const rows: [string, number][] = [
    [`Equity, ${bsDateLabel(bs.dates.prior)}`, e.beginning],
    ['Contributions', e.contributions],
    ['Distributions', e.distributions],
    ['Net income', e.net_income],
    ...(e.other !== 0 ? [['Other equity movements (intercompany, transfers)', e.other] as [string, number]] : []),
  ];
  return (
    <div style={{ marginTop: 28 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>Equity for {bs.year}</div>
      <table className="tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 420 }}>
        <tbody>
          {rows.map(([label, cents]) => (
            <tr key={label}>
              <td style={{ padding: '4px 8px' }}>{label}</td>
              <Amount cents={cents} />
            </tr>
          ))}
          <tr style={{ borderTop: '1px solid var(--ink)' }}>
            <td style={{ padding: '6px 8px', fontWeight: 600 }}>Equity, {bsDateLabel(bs.dates.current)}</td>
            <Amount cents={e.ending} bold />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function OpeningForm({
  entityId,
  year,
  openingDate,
  saved,
  lines,
  amounts,
  hints,
}: {
  entityId: string;
  year: number;
  openingDate: string;
  saved: boolean;
  lines: OpeningLine[];
  amounts: Map<string, number>;
  hints: Map<string, { date: string; cents: number }>;
}) {
  const groups = [...new Set(lines.map((l) => l.group))];
  return (
    <details id="opening" open={!saved} style={{ marginTop: 36, borderTop: '1px solid var(--rule)', paddingTop: 16 }}>
      <summary style={{ cursor: 'pointer', fontSize: 15, fontWeight: 600 }}>Opening balances</summary>
      <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '8px 0 14px', maxWidth: 640 }}>
        Each figure as its statement shows it on the opening date. Opening balance equity is whatever makes them balance; leave a line blank if it has no figure yet.
      </p>
      <form action={saveOpeningBalances}>
        <input type="hidden" name="entity_id" value={entityId} />
        <input type="hidden" name="year" value={year} />
        <label style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 13, marginBottom: 14 }}>
          As of
          <input type="date" name="opening_date" defaultValue={openingDate} required style={inputStyle} />
        </label>
        {groups.map((g) => (
          <div key={g} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>{g}</div>
            {lines
              .filter((l) => l.group === g)
              .map((l) => {
                const have = amounts.get(l.id);
                const hint = hints.get(l.id);
                return (
                  <div key={l.id} className="flex flex-wrap items-baseline" style={{ gap: '4px 12px', padding: '4px 0' }}>
                    <label htmlFor={`ob-${l.id}`} style={{ width: 260, fontSize: 13 }}>{l.name}</label>
                    <input
                      id={`ob-${l.id}`}
                      name={l.id}
                      inputMode="decimal"
                      defaultValue={have == null ? '' : (have / 100).toFixed(2)}
                      style={{ ...inputStyle, width: 140, textAlign: 'right' }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>
                      {l.help}
                      {hint && (
                        <span style={{ color: have != null && have !== hint.cents ? 'var(--signal)' : 'var(--ink-3)' }}>
                          {' · '}Chase shows {exact(hint.cents)} before the first row on file ({bsDateLabel(hint.date)})
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
          </div>
        ))}
        <SubmitButton label="Save opening balances" busyLabel="Saving" className={buttonClass('primary', 'sm')} />
      </form>
    </details>
  );
}

function JournalSection({
  entityId,
  year,
  entries,
}: {
  entityId: string;
  year: number;
  entries: { id: string; entry_date: string; debit_key: string; credit_key: string; amount: number | string; memo: string }[];
}) {
  const accounts = journalAccountsFor(entityId);
  const TYPE_WORD: Record<string, string> = {
    income: 'Income', cogs: 'Cost of goods', expense: 'Expense', other_income: 'Other income',
    other_expense: 'Other expense', asset: 'Asset', liability: 'Liability', equity: 'Equity',
  };
  const types = ['asset', 'liability', 'equity', 'income', 'cogs', 'expense', 'other_income', 'other_expense'];
  const options = (
    <>
      <option value="">Choose an account</option>
      {types.map((t) => {
        const list = accounts.filter((a) => a.type === t);
        if (list.length === 0) return null;
        return (
          <optgroup key={t} label={TYPE_WORD[t]}>
            {list.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
          </optgroup>
        );
      })}
    </>
  );
  const name = (k: string) => coaAccountFor(entityId, k)?.name ?? k;
  return (
    <section id="journal" style={{ marginTop: 36, borderTop: '1px solid var(--rule)', paddingTop: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>Year-end journal entries</div>
      <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '8px 0 12px', maxWidth: 680 }}>
        For what the bank does not show. They count on the P&amp;L and the balance sheet alike.
      </p>
      {entries.length > 0 ? (
        <table className="tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', maxWidth: 900, marginBottom: 16 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--ink)', color: 'var(--ink-3)' }}>
              {['Date', 'Debit', 'Credit', 'Amount', 'Memo', ''].map((h) => (
                <th key={h} style={{ textAlign: h === 'Amount' ? 'right' : 'left', padding: 6, fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} style={{ borderTop: '1px solid var(--rule)' }}>
                <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{bsDateLabel(e.entry_date)}</td>
                <td style={{ padding: 6 }}>{name(e.debit_key)}</td>
                <td style={{ padding: 6 }}>{name(e.credit_key)}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{exact(Math.abs(toCents(e.amount)))}</td>
                <td style={{ padding: 6, color: 'var(--ink-2)' }}>{e.memo}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>
                  <form action={deleteJournalEntry}>
                    <input type="hidden" name="entity_id" value={entityId} />
                    <input type="hidden" name="year" value={year} />
                    <input type="hidden" name="id" value={e.id} />
                    <SubmitButton
                      label="Delete"
                      busyLabel="Deleting"
                      spinnerTone="ink"
                      className={buttonClass('quiet', 'sm')}
                      confirm="Delete this journal entry? It leaves the P&L and the balance sheet."
                    />
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--ink-4)', margin: '0 0 14px' }}>None for {year}.</p>
      )}
      <form action={addJournalEntry} className="flex flex-wrap items-end" style={{ gap: 10 }}>
        <input type="hidden" name="entity_id" value={entityId} />
        <input type="hidden" name="year" value={year} />
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--ink-3)' }}>
          Date
          <input type="date" name="entry_date" defaultValue={`${year}-12-31`} required style={inputStyle} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--ink-3)' }}>
          Debit
          <select name="debit_key" required defaultValue="" style={{ ...inputStyle, maxWidth: 240 }}>{options}</select>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--ink-3)' }}>
          Credit
          <select name="credit_key" required defaultValue="" style={{ ...inputStyle, maxWidth: 240 }}>{options}</select>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--ink-3)' }}>
          Amount
          <input name="amount" inputMode="decimal" required placeholder="0.00" style={{ ...inputStyle, width: 120, textAlign: 'right' }} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--ink-3)', flex: '1 1 220px' }}>
          Memo
          <input name="memo" required maxLength={300} placeholder="What it is for" style={{ ...inputStyle, width: '100%' }} />
        </label>
        <SubmitButton label="Add entry" busyLabel="Adding" className={buttonClass('secondary', 'sm')} spinnerTone="ink" />
      </form>
      <ul style={{ fontSize: 12, color: 'var(--ink-3)', margin: '14px 0 0', paddingLeft: 18, lineHeight: 1.7, maxWidth: 760 }}>
        <li>Mortgage payments filed to the mortgage: debit the mortgage interest account, credit the mortgage, for the 1098&apos;s interest.</li>
        <li>A loan a partner paid personally: debit the loan, credit Owner / Partner Contributions.</li>
        <li>The CPA&apos;s depreciation: debit Depreciation, credit Accumulated Depreciation.</li>
      </ul>
    </section>
  );
}

export default async function BooksBalanceSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity_id: string }>;
  searchParams: Promise<{ year?: string | string[]; saved?: string; error?: string }>;
}) {
  const { entity_id } = await params;
  const entity = LLC_ENTITIES[entity_id];
  if (!entity) notFound();
  const sp = await searchParams;
  const thisYear = new Date().getUTCFullYear();
  const year = parsePnlYear(sp.year, thisYear);
  const years = Array.from({ length: thisYear - FIRST_YEAR + 1 }, (_, i) => thisYear - i);
  const entities = Object.values(LLC_ENTITIES).sort((a, b) => a.sort - b.sort);
  const load = await loadBalanceSheet(entity_id, year);
  const exportHref = (format: 'xlsx' | 'csv') => `/api/books/balance-sheet-export?entity=${entity_id}&year=${year}&format=${format}`;

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
  const flash = sp.error
    ? { tone: 'var(--signal)', text: sp.error.slice(0, 240) }
    : sp.saved === 'opening'
      ? { tone: 'var(--positive)', text: 'Opening balances saved.' }
      : sp.saved === 'entry'
        ? { tone: 'var(--positive)', text: 'Journal entry added.' }
        : sp.saved === 'deleted'
          ? { tone: 'var(--positive)', text: 'Journal entry deleted.' }
          : null;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <FinancialsTabs current="books" />

      <HelmHero plain eyebrow={`Helm · LLC Accounting · ${entity.short}`} title="Balance sheet" paddingTop={28} paddingBottom={16} />

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 4 }}>
        <nav aria-label="Entities" className="flex items-baseline flex-wrap" style={{ gap: '10px 22px', paddingBottom: 6 }}>
          {entities.map((e) => (
            <Link key={e.id} href={`/books/${e.id}/balance-sheet?year=${year}`} aria-current={e.id === entity_id ? 'page' : undefined} style={linkStyle(e.id === entity_id)}>
              {e.short}
            </Link>
          ))}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 14 }}>
            {years.map((y) => (
              <Link key={y} href={`/books/${entity_id}/balance-sheet?year=${y}`} aria-current={y === year ? 'page' : undefined} style={linkStyle(y === year)}>
                {y}
              </Link>
            ))}
          </span>
        </nav>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 18, paddingBottom: 40, flex: 1 }}>
        {flash && <div style={{ fontSize: 13, color: flash.tone, fontWeight: 500, marginBottom: 12 }}>{flash.text}</div>}
        {!load.ready ? (
          <EmptyState action={{ label: 'Open the ledger', href: `/books/${entity_id}` }}>
            {load.reason === 'tables_missing'
              ? 'Ask Ryan: the balance sheet is not switched on yet, so there is nothing to report.'
              : 'The books could not be read just now. Reload to try again.'}
          </EmptyState>
        ) : (
          <>
            <div className="flex items-baseline flex-wrap" style={{ gap: '10px 18px', marginBottom: 14 }}>
              {load.sheet && (
                <div style={{ fontSize: 13, color: load.sheet.final ? 'var(--positive)' : 'var(--signal)', fontWeight: 500 }}>
                  {bsStatusLine(load.sheet)}
                </div>
              )}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <Link href={`/books/${entity_id}/pnl?year=${year}`} style={{ fontSize: 12, color: 'var(--ink-3)', marginRight: 6 }}>Profit and loss →</Link>
                {load.openingSaved && load.sheet && (
                  <>
                    <a href={exportHref('xlsx')} className={buttonClass('primary', 'sm')}>Download for the CPA</a>
                    <a href={exportHref('csv')} className={buttonClass('quiet', 'sm')}>CSV</a>
                  </>
                )}
              </span>
            </div>
            {!load.openingSaved && (
              <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: '0 0 14px', maxWidth: 680 }}>
                No opening balances saved yet, so this is a preview: every account starts at zero on {bsDateLabel(load.openingDate)}.
                Enter them <a href="#opening" style={{ textDecoration: 'underline' }}>below</a>.
              </p>
            )}

            {!load.sheet ? (
              <EmptyState action={{ label: `See ${Number(load.openingDate.slice(0, 4))}`, href: `/books/${entity_id}/balance-sheet?year=${load.openingDate.slice(0, 4)}` }}>
                The books open on {bsDateLabel(load.openingDate)}, after December 31, {year}.
              </EmptyState>
            ) : (
              <>
                <SheetTable bs={load.sheet} />
                <EquityForYear bs={load.sheet} />
                <Checks bs={load.sheet} />
              </>
            )}

            <OpeningForm
              entityId={entity_id}
              year={year}
              openingDate={load.openingDate}
              saved={load.openingSaved && (load.sheet?.missing_openings.every((m) => m.why === 'postings') ?? true)}
              lines={openingLinesFor(entity_id, load.accounts)}
              amounts={new Map(load.openings.map((o) => [o.account_id ? `acct:${o.account_id}` : `coa:${o.category_key}`, toCents(o.amount)]))}
              hints={new Map((load.sheet?.opening_hints ?? []).map((h) => [`acct:${h.account_id}`, { date: h.date, cents: h.chase_before }]))}
            />
            <JournalSection
              entityId={entity_id}
              year={year}
              entries={load.journal.filter((e) => e.entry_date >= `${year}-01-01` && e.entry_date <= `${year}-12-31`)}
            />
          </>
        )}
      </section>

      <HelmFooter module="LLC Accounting" />
    </div>
  );
}
