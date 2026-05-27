import { createClient } from '@supabase/supabase-js';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { FinancialsTabs } from '@/components/FinancialsTabs';
import {
  LLC_ENTITIES,
  CHART_OF_ACCOUNTS,
  accountsListForEntity,
  currentQuarter,
  BOOKS_PROPERTY_LABELS,
  type CoaAccount,
  type CoaType,
} from '@/lib/books';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder');

/**
 * Per-entity transaction counts. Tolerates the ledger_transactions table
 * not existing yet (migration not run) -- the page renders the entity
 * structure + chart of accounts regardless, with a "run the migration"
 * nudge.
 */
async function getEntityLedgerCounts(): Promise<{ byEntity: Record<string, { total: number; unreviewed: number }>; tableReady: boolean }> {
  try {
    const { data, error } = await supabase
      .from('ledger_transactions')
      .select('entity_id, reviewed');
    if (error) {
      const missing = error.code === 'PGRST205' || /does not exist|relation|Could not find the table/i.test(error.message || '');
      return { byEntity: {}, tableReady: !missing };
    }
    const byEntity: Record<string, { total: number; unreviewed: number }> = {};
    for (const row of (data || []) as { entity_id: string; reviewed: boolean }[]) {
      const e = (byEntity[row.entity_id] ||= { total: 0, unreviewed: 0 });
      e.total += 1;
      if (!row.reviewed) e.unreviewed += 1;
    }
    return { byEntity, tableReady: true };
  } catch {
    return { byEntity: {}, tableReady: false };
  }
}

const TYPE_LABEL: Record<CoaType, string> = {
  income: 'Income',
  expense: 'Expenses',
  cogs: 'Cost of Goods',
  equity: 'Equity',
  other_income: 'Other Income (Pass-Through)',
  other_expense: 'Other Expense (Pass-Through)',
};
const TYPE_ORDER: CoaType[] = ['income', 'cogs', 'expense', 'other_income', 'other_expense', 'equity'];

/**
 * Build a depth map for the chart so children render indented under their
 * parents. Lookup is by key + entity_id; parents may live at NULL entity
 * (shared) while a child is entity-specific.
 */
function buildAccountTree(accounts: CoaAccount[]) {
  const byKey = new Map<string, CoaAccount>();
  for (const a of accounts) byKey.set(a.key, a);
  const depth = new Map<string, number>();
  function depthOf(key: string): number {
    if (depth.has(key)) return depth.get(key)!;
    const a = byKey.get(key);
    if (!a || !a.parent_key) { depth.set(key, 0); return 0; }
    const d = depthOf(a.parent_key) + 1;
    depth.set(key, d);
    return d;
  }
  return { depthOf };
}

export default async function BooksPage() {
  const { byEntity, tableReady } = await getEntityLedgerCounts();
  const entities = Object.values(LLC_ENTITIES).sort((a, b) => a.sort - b.sort);
  const quarter = currentQuarter();

  // Group COA accounts by type for the shared structure preview.
  const { depthOf } = buildAccountTree(CHART_OF_ACCOUNTS);
  const coaByType = TYPE_ORDER.map((t) => ({
    type: t,
    label: TYPE_LABEL[t],
    accounts: CHART_OF_ACCOUNTS
      .filter((a) => a.type === t)
      .sort((a, b) => a.sort - b.sort),
  })).filter((g) => g.accounts.length > 0);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="financials" />
      <FinancialsTabs current="books" />

      <HelmHero
        eyebrow="Helm · Financials"
        title="LLC"
        emphasis="accounting."
        description="In-house bookkeeping for the three LLCs. The chart of accounts and bank inventory below are seeded from the QuickBooks exports — Phase 1b wires the transaction ingestion + AI categorizer next."
        paddingTop={40}
        paddingBottom={20}
      />

      {!tableReady && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 12 }}>
          <div style={{
            padding: '12px 14px',
            borderLeft: '2px solid var(--signal)',
            background: 'var(--paper-2)',
            fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5,
          }}>
            <strong style={{ color: 'var(--signal)' }}>Setup pending.</strong> Run <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>supabase-schema-books.sql</code> in the Supabase SQL editor to create the ledger tables. The entity structure + chart of accounts + bank inventory below render from <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>src/lib/books.ts</code> regardless.
          </div>
        </section>
      )}

      {/* ── ENTITIES with bank account inventory ── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 8, paddingBottom: 24 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Entities &middot; {quarter}</div>
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {entities.map((e) => {
            const counts = byEntity[e.id];
            const accts = accountsListForEntity(e.id);
            const banks = accts.filter((a) => a.kind === 'bank');
            const cards = accts.filter((a) => a.kind === 'credit_card');
            return (
              <div key={e.id} style={{
                padding: '20px 0',
                borderBottom: '1px solid var(--rule)',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'baseline' }}>
                  <div>
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
                        {e.name}
                      </h2>
                      <span style={{
                        fontSize: 9, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase',
                        color: e.kind === 'management' ? 'var(--tide-deep)' : 'var(--ink-4)',
                      }}>
                        {e.kind === 'management' ? 'Management Co' : 'Holding'}
                      </span>
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.5, maxWidth: 620 }}>{e.blurb}</p>
                    {e.property_ids.length > 0 && (
                      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-4)' }}>
                        <strong style={{ color: 'var(--ink-3)' }}>Owns:</strong>{' '}
                        {e.property_ids.map((pid, i) => (
                          <span key={pid} style={{ color: 'var(--ink-3)' }}>
                            {i > 0 ? ' · ' : ''}{BOOKS_PROPERTY_LABELS[pid] || pid}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="eyebrow">Transactions</div>
                    <div className="font-serif tabular-nums" style={{ fontSize: 26, fontWeight: 400, color: 'var(--ink)', marginTop: 4 }}>
                      {counts ? counts.total : '—'}
                    </div>
                    {counts && counts.unreviewed > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--signal)', marginTop: 2 }}>{counts.unreviewed} to review</div>
                    )}
                    {!counts && (
                      <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>none yet</div>
                    )}
                  </div>
                </div>

                {/* Bank + card list */}
                {(banks.length + cards.length) > 0 && (
                  <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', fontSize: 11 }}>
                    {banks.length > 0 && (
                      <>
                        <span style={{ color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '.14em', fontWeight: 600, fontSize: 9, alignSelf: 'baseline', paddingTop: 2 }}>
                          Bank · {banks.length}
                        </span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {banks.map((b) => (
                            <span key={`${b.entity_id}-${b.kind}-${b.last4}`} title={b.label} style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 10,
                              padding: '2px 7px',
                              border: '1px solid var(--rule)',
                              background: 'var(--paper-2)',
                              color: 'var(--ink-2)',
                            }}>
                              {b.institution} ⋯{b.last4}{b.property_id ? ` · ${b.label.replace(/\s*\(.+\)\s*$/, '')}` : (b.label ? ` · ${b.label}` : '')}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                    {cards.length > 0 && (
                      <>
                        <span style={{ color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '.14em', fontWeight: 600, fontSize: 9, alignSelf: 'baseline', paddingTop: 2 }}>
                          Cards · {cards.length}
                        </span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {cards.map((c) => (
                            <span key={`${c.entity_id}-${c.kind}-${c.last4}`} style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 10,
                              padding: '2px 7px',
                              border: '1px solid var(--rule)',
                              background: 'var(--paper-2)',
                              color: 'var(--ink-2)',
                            }}>
                              {c.institution} ⋯{c.last4} · {c.label}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── CHART OF ACCOUNTS (hierarchical) ── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 40, flex: 1 }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Chart of accounts</div>
        <p style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 16, maxWidth: 720, lineHeight: 1.5 }}>
          Hierarchical chart sourced from the QuickBooks exports (transaction detail + chart of accounts CSVs, 2026-05-27). Categories marked <em style={{ color: 'var(--tide-deep)' }}>pass-through</em> auto-populate from Statements module data in Phase 1c — the categorizer doesn&apos;t target them. Scope tags show which entities each category applies to.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 28 }}>
          {coaByType.map((g) => (
            <div key={g.type}>
              <div style={{
                fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase',
                color: g.type.startsWith('other_') ? 'var(--tide-deep)' : 'var(--signal)',
                marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--rule)',
              }}>
                {g.label}
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {g.accounts.map((a) => {
                  const d = depthOf(a.key);
                  const scopeBadge = a.scope === 'shared' ? null : a.scope.replace('_', ' ');
                  return (
                    <li key={a.key} style={{
                      padding: '4px 0',
                      paddingLeft: d * 14,
                      fontSize: 12,
                      color: a.pass_through ? 'var(--ink-3)' : 'var(--ink-2)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                      borderBottom: '1px dotted transparent',
                    }}>
                      <span style={{ fontWeight: d === 0 ? 500 : 400 }}>
                        {a.name}
                        {scopeBadge && (
                          <span style={{
                            marginLeft: 6,
                            fontSize: 8, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase',
                            color: 'var(--ink-4)',
                          }}>
                            {scopeBadge.replace('rising tide', 'RT').replace('goose ', 'G·')}
                          </span>
                        )}
                        {a.pass_through && (
                          <span style={{
                            marginLeft: 6,
                            fontSize: 8, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase',
                            color: 'var(--tide-deep)',
                          }}>
                            Pass-through
                          </span>
                        )}
                      </span>
                      {a.tax_hint && (
                        <span style={{ fontSize: 10, color: 'var(--ink-4)', textAlign: 'right', maxWidth: 160, flexShrink: 0 }}>{a.tax_hint}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <HelmFooter module="LLC Accounting" />
    </div>
  );
}
