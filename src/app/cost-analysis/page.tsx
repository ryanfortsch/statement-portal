import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { FinancialsTabs } from '@/components/FinancialsTabs';
import { getCostAnalysis, compareSameProperties } from '@/lib/cost-analysis';

export const dynamic = 'force-dynamic';

function monthLabel(m: string): string {
  const d = new Date(m + '-01T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
function monthShort(m: string): string {
  const d = new Date(m + '-01T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short' });
}
function fmt(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtCompact(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export default async function CostAnalysisPage() {
  const ca = await getCostAnalysis();
  const months = ca.months;
  const latest = months[months.length - 1];
  const prior = months.length >= 2 ? months[months.length - 2] : null;
  const comparison = prior ? compareSameProperties(ca, prior, latest) : null;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="financials" />
      <FinancialsTabs current="cost-analysis" />

      <HelmHero
        eyebrow="Helm · Financials"
        title="Cost"
        emphasis="analysis."
        description="All-in housekeeping cost -- cleaning (Cape Ann Elite) and linens (Nor'East Cleaners) -- by property and month, normalized per turnover so the May 2026 vendor split is an apples-to-apples read."
        paddingTop={40}
        paddingBottom={20}
      />

      {months.length === 0 ? (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 60 }}>
          <div style={{ padding: 24, background: 'var(--paper-2)', border: '1px solid var(--rule)', fontSize: 13, color: 'var(--ink-3)' }}>
            No statement data yet. Cost analysis populates from ingested monthly statements.
          </div>
        </section>
      ) : (
        <>
          {/* Latest-month split */}
          <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>{latest ? monthLabel(latest) : ''} · housekeeping</div>
            <div
              style={{
                borderTop: '1px solid var(--ink)',
                borderBottom: '1px solid var(--ink)',
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
              }}
            >
              {(() => {
                const t = latest ? ca.byMonth[latest] : undefined;
                if (!t) return null;
                return (
                  <>
                    <CostStat label="All-in cleaning" value={fmtCompact(t.allIn)} sub={`${t.turnovers} turnovers`} />
                    <CostStat label="Cleaning (CAE)" value={fmtCompact(t.cleaning)} sub="Cape Ann Elite" />
                    <CostStat label="Linens (Nor'East)" value={fmtCompact(t.linens)} sub={ca.hasLinenData ? 'tagged from bank' : 'not yet ingested'} accent={t.linens > 0} />
                    <CostStat label="Per turnover" value={t.allInPerTurn != null ? fmt(t.allInPerTurn) : '—'} sub="all-in / turnover" last />
                  </>
                );
              })()}
            </div>
          </section>

          {/* Before / after, same-property */}
          {comparison && comparison.rows.length > 0 && (
            <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Same-property comparison</div>
              <h2 className="font-serif" style={{ fontSize: 20, fontWeight: 500, margin: '0 0 4px' }}>
                {monthLabel(comparison.monthA)} vs <em style={{ color: 'var(--tide-deep)' }}>{monthLabel(comparison.monthB)}</em>
              </h2>
              <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 16px', maxWidth: 640, lineHeight: 1.5 }}>
                Only properties with a statement in both months, so the average reflects the same set.
                {comparison.rows.length} propert{comparison.rows.length === 1 ? 'y' : 'ies'} qualify.
              </p>

              <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Property</th>
                    <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>{monthShort(comparison.monthA)} all-in</th>
                    <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>{monthShort(comparison.monthA)} /turn</th>
                    <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>{monthShort(comparison.monthB)} all-in</th>
                    <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>{monthShort(comparison.monthB)} /turn</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.rows.map((r) => {
                    const aPer = r.aTurns > 0 ? r.aAllIn / r.aTurns : null;
                    const bPer = r.bTurns > 0 ? r.bAllIn / r.bTurns : null;
                    return (
                      <tr key={r.propertyId} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                        <td style={{ padding: '8px 6px', color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontWeight: 500 }}>{r.propertyName}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--ink-3)' }}>{fmt(r.aAllIn)}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--ink-3)' }}>{aPer != null ? fmt(aPer) : '—'}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--ink)' }}>{fmt(r.bAllIn)}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--ink)' }}>{bPer != null ? fmt(bPer) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '1.5px solid var(--ink)', fontWeight: 600 }}>
                    <td style={{ padding: '10px 6px' }}>Average per property</td>
                    <td style={{ padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--font-fraunces)' }}>{fmt(comparison.avg.aPerProperty)}</td>
                    <td />
                    <td style={{ padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--font-fraunces)' }}>{fmt(comparison.avg.bPerProperty)}</td>
                    <td />
                  </tr>
                  <tr style={{ fontWeight: 600 }}>
                    <td style={{ padding: '4px 6px 10px' }}>Average per turnover</td>
                    <td style={{ padding: '4px 6px 10px', textAlign: 'right' }} />
                    <td style={{ padding: '4px 6px 10px', textAlign: 'right', fontFamily: 'var(--font-fraunces)' }}>{comparison.avg.aPerTurn != null ? fmt(comparison.avg.aPerTurn) : '—'}</td>
                    <td />
                    <td style={{ padding: '4px 6px 10px', textAlign: 'right', fontFamily: 'var(--font-fraunces)' }}>{comparison.avg.bPerTurn != null ? fmt(comparison.avg.bPerTurn) : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </section>
          )}

          {/* Property x month grid: all-in per turnover */}
          <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 48 }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>All-in cleaning per turnover · by property</div>
            <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Property</th>
                  {months.map(m => (
                    <th key={m} style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>{monthShort(m)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ca.properties.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                    <td style={{ padding: '8px 6px', color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontWeight: 500 }}>{p.name}</td>
                    {months.map(m => {
                      const cell = ca.cells.find(c => c.propertyId === p.id && c.month === m);
                      return (
                        <td key={m} style={{ padding: '8px 6px', textAlign: 'right', color: cell ? 'var(--ink)' : 'var(--ink-4)' }}>
                          {cell && cell.allInPerTurn != null ? fmt(cell.allInPerTurn) : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Caveats */}
          <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
            <div style={{ padding: '12px 14px', borderLeft: '2px solid var(--signal)', background: 'var(--paper-2)', fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 720 }}>
              <strong style={{ color: 'var(--ink-2)' }}>Reading this:</strong> before May 2026, Cape Ann Elite bundled cleaning + linens into one invoice, so the &ldquo;before&rdquo; all-in can&apos;t be split. The honest comparison is total all-in per turnover.
              {!ca.hasLinenData && ' Nor’East linen charges aren’t tagged in the data yet — run the cleaning-vendor migration and re-ingest the affected months to populate the cleaning-vs-linen split.'}
              {' '}The current month is partial until it closes, so its per-turnover figure will keep moving.
            </div>
          </section>
        </>
      )}

      <HelmFooter right={latest ? `Latest: ${monthLabel(latest)}` : undefined} />
    </div>
  );
}

function CostStat({ label, value, sub, accent, last }: { label: string; value: string; sub?: string; accent?: boolean; last?: boolean }) {
  return (
    <div style={{ padding: '18px 20px', borderRight: last ? 'none' : '1px solid var(--rule)' }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div className="font-serif tabular-nums" style={{ fontSize: 26, fontWeight: 400, color: accent ? 'var(--signal)' : 'var(--ink)', lineHeight: 1.05 }}>{value}</div>
      {sub && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)' }}>{sub}</div>}
    </div>
  );
}
