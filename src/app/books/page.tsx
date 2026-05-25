import { createClient } from '@supabase/supabase-js';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { FinancialsTabs } from '@/components/FinancialsTabs';
import {
  LLC_ENTITIES,
  STARTER_CHART_OF_ACCOUNTS,
  currentQuarter,
  type CoaType,
} from '@/lib/books';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder');

/**
 * Per-entity transaction counts for the current setup. Tolerates the
 * ledger_transactions table not existing yet (migration not run) -- the
 * page renders the entity structure + chart of accounts regardless, with
 * a "run the migration" nudge.
 */
async function getEntityLedgerCounts(): Promise<{ byEntity: Record<string, { total: number; unreviewed: number }>; tableReady: boolean }> {
  try {
    const { data, error } = await supabase
      .from('ledger_transactions')
      .select('entity_id, reviewed');
    if (error) {
      const missing = error.code === 'PGRST205' || /does not exist|relation|Could not find the table/i.test(error.message || '');
      return { byEntity: {}, tableReady: !missing ? true : false };
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
  other: 'Other',
};
const TYPE_ORDER: CoaType[] = ['income', 'expense', 'cogs', 'equity', 'other'];

export default async function BooksPage() {
  const { byEntity, tableReady } = await getEntityLedgerCounts();
  const entities = Object.values(LLC_ENTITIES).sort((a, b) => a.sort - b.sort);
  const quarter = currentQuarter();

  const coaByType = TYPE_ORDER.map((t) => ({
    type: t,
    label: TYPE_LABEL[t],
    accounts: STARTER_CHART_OF_ACCOUNTS.filter((a) => a.type === t).sort((a, b) => a.sort - b.sort),
  })).filter((g) => g.accounts.length > 0);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="financials" />
      <FinancialsTabs current="books" />

      <HelmHero
        eyebrow="Helm · Financials"
        title="LLC"
        emphasis="accounting."
        description="In-house bookkeeping for the three LLCs. Upload each entity's Chase bank + card exports per quarter, categorize against the chart of accounts, and produce the quarterly P&L and 1099 prep your CPA used to get from QuickBooks."
        paddingTop={40}
        paddingBottom={20}
      />

      {/* Setup nudge while the schema migration hasn't run */}
      {!tableReady && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 12 }}>
          <div style={{
            padding: '12px 14px',
            borderLeft: '2px solid var(--signal)',
            background: 'var(--paper-2)',
            fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5,
          }}>
            <strong style={{ color: 'var(--signal)' }}>Setup pending.</strong> Run <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>supabase-schema-books.sql</code> in the Supabase SQL editor to create the ledger tables. The entity structure and chart of accounts below are ready; transaction upload + categorization land in the next release.
          </div>
        </section>
      )}

      {/* ── ENTITIES ── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 8, paddingBottom: 24 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Entities &middot; {quarter}</div>
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {entities.map((e) => {
            const counts = byEntity[e.id];
            return (
              <div key={e.id} style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 24,
                alignItems: 'baseline',
                padding: '20px 0',
                borderBottom: '1px solid var(--rule)',
              }}>
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
                      Owns: {e.property_ids.map((pid) => (
                        <span key={pid} style={{ color: 'var(--ink-3)' }}>
                          {LLC_ENTITIES[e.id].property_ids.indexOf(pid) > 0 ? ' · ' : ''}{pid.replace(/_/g, ' ')}
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
            );
          })}
        </div>
      </section>

      {/* ── CHART OF ACCOUNTS ── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 40, flex: 1 }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Chart of accounts</div>
        <p style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 16, maxWidth: 620, lineHeight: 1.5 }}>
          Starter categories the AI will match transactions against. These get refined to match your real QuickBooks chart once that export is imported.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 24 }}>
          {coaByType.map((g) => (
            <div key={g.type}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--signal)', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--rule)' }}>
                {g.label}
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {g.accounts.map((a) => (
                  <li key={a.key} style={{ padding: '5px 0', fontSize: 13, color: 'var(--ink-2)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>{a.name}</span>
                    {a.tax_hint && (
                      <span style={{ fontSize: 10, color: 'var(--ink-4)', textAlign: 'right', maxWidth: 130 }}>{a.tax_hint}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <HelmFooter module="LLC Accounting" />
    </div>
  );
}
