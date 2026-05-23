import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { FinancialsTabs } from '@/components/FinancialsTabs';
import { OverheadUpload } from '@/components/OverheadUpload';
import { getCostAnalysis, compareSameProperties, getOverhead } from '@/lib/cost-analysis';

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
  const [ca, overhead] = await Promise.all([getCostAnalysis(), getOverhead()]);
  const months = ca.months;
  // Overhead trend: show the most recent 6 months so the table stays scannable.
  const ohMonths = overhead.months.slice(-6);
  const ohLatest = overhead.months[overhead.months.length - 1];
  const ohPrior = overhead.months.length >= 2 ? overhead.months[overhead.months.length - 2] : null;
  const ohLatestTotal = ohLatest ? overhead.byMonthTotal[ohLatest] : 0;
  const ohPriorTotal = ohPrior ? overhead.byMonthTotal[ohPrior] : 0;
  const ohDelta = ohLatest && ohPrior ? ohLatestTotal - ohPriorTotal : null;
  const ohDeltaPct = ohDelta != null && ohPriorTotal > 0 ? (ohDelta / ohPriorTotal) * 100 : null;
  // Staleness for the upload nudge -- days-old is computed in getOverhead()
  // (the lib, not render) so nothing impure runs during component render.
  const ohDaysOld = overhead.daysSinceLatest;
  const ohStale = ohDaysOld != null && ohDaysOld > 35;
  const ohHint = overhead.latestTxnDate == null
    ? 'No overhead data yet — upload the card + operating exports.'
    : `Data through ${new Date(overhead.latestTxnDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${ohStale ? ` — ${ohDaysOld} days old. Upload this month's exports.` : '.'}`;
  const latest = months[months.length - 1];
  const prior = months.length >= 2 ? months[months.length - 2] : null;
  const comparison = prior ? compareSameProperties(ca, prior, latest) : null;

  const latestT = latest ? ca.byMonth[latest] : undefined;
  const priorT = prior ? ca.byMonth[prior] : undefined;
  const totalDelta = latestT && priorT ? latestT.operating - priorT.operating : null;
  const totalDeltaPct = totalDelta != null && priorT && priorT.operating > 0
    ? (totalDelta / priorT.operating) * 100 : null;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="financials" />
      <FinancialsTabs current="cost-analysis" />

      <HelmHero
        eyebrow="Helm · Financials"
        title="Cost"
        emphasis="analysis."
        description="Rising Tide overhead (software, marketing, insurance, supplies) plus per-property operating cost (cleaning, linens, repairs) per turnover -- by month, so you can see what's moving."
        paddingTop={40}
        paddingBottom={20}
      />

      {/* ── RISING TIDE OVERHEAD ── company-wide costs (card + operating),
          independent of per-property statements. */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Rising Tide overhead</div>
        <OverheadUpload hint={ohHint} stale={ohStale} />
        {!overhead.hasData ? (
          <div style={{ padding: 18, background: 'var(--paper-2)', border: '1px solid var(--rule)', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            No overhead loaded yet. Upload the Chase corporate-card (*3878) and operating-account (*5130) CSV exports above — personal/gray spend and internal transfers are dropped automatically, leaving real business overhead by category.
          </div>
        ) : (
          <>
            <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <CostStat
                label={`${ohLatest ? monthLabel(ohLatest) : ''} overhead`}
                value={fmtCompact(ohLatestTotal)}
                sub={ohDelta != null ? `${ohDelta >= 0 ? '▲' : '▼'} ${fmtCompact(Math.abs(ohDelta))}${ohDeltaPct != null ? ` (${ohDeltaPct >= 0 ? '+' : ''}${ohDeltaPct.toFixed(0)}%)` : ''} vs ${ohPrior ? monthShort(ohPrior) : 'prior'}` : 'business overhead'}
                accent={ohDelta != null && ohDelta > 0}
              />
              <CostStat
                label="Trailing 12-mo"
                value={fmtCompact(overhead.months.slice(-12).reduce((s, m) => s + (overhead.byMonthTotal[m] || 0), 0))}
                sub={`${Math.min(overhead.months.length, 12)} months`}
              />
              <CostStat label="Categories" value={String(overhead.categories.length)} sub="business buckets" last />
            </div>

            <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12, marginTop: 20 }}>
              <thead>
                <tr style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Category</th>
                  {ohMonths.map(m => (
                    <th key={m} style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>{monthShort(m)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overhead.categories.map(cat => (
                  <tr key={cat} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                    <td style={{ padding: '8px 6px', color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontWeight: 500 }}>{cat}</td>
                    {ohMonths.map(m => {
                      const v = overhead.byMonthCategory[m]?.[cat];
                      return (
                        <td key={m} style={{ padding: '8px 6px', textAlign: 'right', color: v ? 'var(--ink)' : 'var(--ink-4)' }}>
                          {v ? fmtCompact(v) : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr style={{ borderTop: '1.5px solid var(--ink)', fontWeight: 600 }}>
                  <td style={{ padding: '10px 6px' }}>Total</td>
                  {ohMonths.map(m => (
                    <td key={m} style={{ padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--font-fraunces)' }}>
                      {fmtCompact(overhead.byMonthTotal[m] || 0)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 10, maxWidth: 720, lineHeight: 1.5 }}>
              Card (*3878) + operating (*5130). Personal/gray spend (gas, meals) and internal transfers are excluded, so this is real business overhead only. The current month fills in as charges post.
            </p>
          </>
        )}
      </section>

      {months.length === 0 ? (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 60 }}>
          <div style={{ padding: 24, background: 'var(--paper-2)', border: '1px solid var(--rule)', fontSize: 13, color: 'var(--ink-3)' }}>
            No statement data yet. Cost analysis populates from ingested monthly statements.
          </div>
        </section>
      ) : (
        <>
          {/* This month at a glance: total operating cost + trend vs last month */}
          <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 12 }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>{latest ? monthLabel(latest) : ''} · operating cost</div>
            <div
              style={{
                borderTop: '1px solid var(--ink)',
                borderBottom: '1px solid var(--ink)',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
              }}
            >
              {latestT && (
                <>
                  <CostStat
                    label="Total operating"
                    value={fmtCompact(latestT.operating)}
                    sub={
                      totalDelta != null
                        ? `${totalDelta >= 0 ? '▲' : '▼'} ${fmtCompact(Math.abs(totalDelta))}${totalDeltaPct != null ? ` (${totalDeltaPct >= 0 ? '+' : ''}${totalDeltaPct.toFixed(0)}%)` : ''} vs ${prior ? monthShort(prior) : 'prior'}`
                        : 'cleaning + linens + repairs'
                    }
                    accent={totalDelta != null && totalDelta > 0}
                  />
                  <CostStat label="Per turnover" value={latestT.operatingPerTurn != null ? fmt(latestT.operatingPerTurn) : '—'} sub={`${latestT.turnovers} turnovers`} />
                  <CostStat label="Properties" value={String(ca.cells.filter(c => c.month === latest && c.operating > 0).length)} sub="with cost this month" last />
                </>
              )}
            </div>
          </section>

          {/* Category split for the latest month */}
          {latestT && (
            <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 32, paddingTop: 14 }}>
                <CatLine label="Cleaning (Cape Ann Elite)" value={fmt(latestT.cleaning)} prior={priorT?.cleaning} />
                <CatLine label="Linens (Nor'East)" value={fmt(latestT.linens)} prior={priorT?.linens} />
                <CatLine label="Repairs" value={fmt(latestT.repairs)} prior={priorT?.repairs} />
              </div>
            </section>
          )}

          {/* Per-property, per-turnover grid */}
          <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 48 }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>Operating cost per turnover · by property</div>
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
                          {cell && cell.operatingPerTurn != null ? fmt(cell.operatingPerTurn) : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {latestT && (
                  <tr style={{ borderTop: '1.5px solid var(--ink)', fontWeight: 600 }}>
                    <td style={{ padding: '10px 6px' }}>Portfolio /turn</td>
                    {months.map(m => {
                      const t = ca.byMonth[m];
                      return (
                        <td key={m} style={{ padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--font-fraunces)' }}>
                          {t && t.operatingPerTurn != null ? fmt(t.operatingPerTurn) : '—'}
                        </td>
                      );
                    })}
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {/* Same-property before/after */}
          {comparison && comparison.rows.length > 0 && (
            <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 40 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Same-property comparison</div>
              <h2 className="font-serif" style={{ fontSize: 20, fontWeight: 500, margin: '0 0 4px' }}>
                {monthLabel(comparison.monthA)} vs <em style={{ color: 'var(--tide-deep)' }}>{monthLabel(comparison.monthB)}</em>
              </h2>
              <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 16px', maxWidth: 640, lineHeight: 1.5 }}>
                Operating cost on the {comparison.rows.length} propert{comparison.rows.length === 1 ? 'y' : 'ies'} with a statement in both months, so the average reflects the same set.
              </p>

              <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Property</th>
                    <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>{monthShort(comparison.monthA)} total</th>
                    <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>{monthShort(comparison.monthA)} /turn</th>
                    <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>{monthShort(comparison.monthB)} total</th>
                    <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>{monthShort(comparison.monthB)} /turn</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.rows.map((r) => {
                    const aPer = r.aTurns > 0 ? r.aOperating / r.aTurns : null;
                    const bPer = r.bTurns > 0 ? r.bOperating / r.bTurns : null;
                    return (
                      <tr key={r.propertyId} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                        <td style={{ padding: '8px 6px', color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontWeight: 500 }}>{r.propertyName}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--ink-3)' }}>{fmt(r.aOperating)}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--ink-3)' }}>{aPer != null ? fmt(aPer) : '—'}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--ink)' }}>{fmt(r.bOperating)}</td>
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
                    <td />
                    <td style={{ padding: '4px 6px 10px', textAlign: 'right', fontFamily: 'var(--font-fraunces)' }}>{comparison.avg.aPerTurn != null ? fmt(comparison.avg.aPerTurn) : '—'}</td>
                    <td />
                    <td style={{ padding: '4px 6px 10px', textAlign: 'right', fontFamily: 'var(--font-fraunces)' }}>{comparison.avg.bPerTurn != null ? fmt(comparison.avg.bPerTurn) : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </section>
          )}

          {/* Caveats */}
          <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
            <div style={{ padding: '12px 14px', borderLeft: '2px solid var(--signal)', background: 'var(--paper-2)', fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 720 }}>
              <strong style={{ color: 'var(--ink-2)' }}>Scope:</strong> per-property operating cost is cleaning + linens + repairs (the cost to run each property); management fee is excluded since it&apos;s RT revenue. Rising Tide overhead above is company-wide (card + operating account).
              {!ca.hasLinenData && ' Nor’East linens aren’t tagged in the data yet — re-ingest the affected months to populate the cleaning-vs-linen split.'}
              {' '}The current month is partial until it closes, so its per-turnover figure keeps moving.
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

/** A single cost-category line with the month figure and an optional
 *  vs-prior-month delta underneath. */
function CatLine({ label, value, prior }: { label: string; value: string; prior?: number }) {
  const current = Number(value.replace(/[$,]/g, ''));
  const delta = prior != null ? current - prior : null;
  return (
    <div className="flex items-baseline justify-between" style={{ padding: '8px 0', borderBottom: '1px dotted var(--rule)' }}>
      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{label}</span>
      <span style={{ textAlign: 'right' }}>
        <span className="font-serif tabular-nums" style={{ fontSize: 13, color: 'var(--ink)' }}>{value}</span>
        {delta != null && Math.abs(delta) >= 0.01 && (
          <span style={{ marginLeft: 8, fontSize: 10, color: delta > 0 ? 'var(--signal)' : 'var(--positive)' }}>
            {delta > 0 ? '▲' : '▼'} {fmtCompact(Math.abs(delta))}
          </span>
        )}
      </span>
    </div>
  );
}
