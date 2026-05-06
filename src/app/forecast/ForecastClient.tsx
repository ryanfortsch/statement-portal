'use client';

import { useMemo, useState } from 'react';
import {
  calcYear,
  getYearConfig,
  fmtDollar,
  fmtNum,
  fmtCompact,
  MONTH_LABELS,
  OFFICE_RENT_MONTHLY,
  SOFTWARE_MONTHLY,
  BOOKKEEPER_MONTHLY,
  INSURANCE_MONTHLY,
  ACCOUNTING_MONTHLY,
  BANK_FEES_MONTHLY,
  CC_OPERATING_MONTHLY,
  type ForecastYear,
  type MonthRow,
  type YearResult,
} from '@/lib/forecast-model';
import {
  ACTUALS_TRAILING_12MO,
  ACTUALS_INFLOWS_TRAILING_12MO,
  ACTUALS_INFLOWS_BY_MONTH,
  ACTUALS_WINDOW,
  ACTUALS_2026,
  ACTUALS_2026_THROUGH_MONTH,
  type ExpenseLine,
} from '@/lib/forecast-actuals';
import type { SmartForecast } from '@/lib/forecast-smart';

const SCENARIO_RANGE = [0, 1, 2, 3, 4, 5, 6] as const;

type Props = {
  smart2026: SmartForecast | null;
  smart2027: SmartForecast | null;
};

export function ForecastClient({ smart2026, smart2027 }: Props) {
  const [numNew, setNumNew] = useState<number>(3);
  const [yearKey, setYearKey] = useState<ForecastYear>(2026);

  const yearConfig = useMemo(() => getYearConfig(yearKey), [yearKey]);
  // Substitute bank-derived actuals for completed 2026 months (Jan-Apr).
  // 2027 is fully projected.
  const actualsForYear = yearKey === 2026 ? ACTUALS_2026 : undefined;
  const actualsThrough = yearKey === 2026 ? ACTUALS_2026_THROUGH_MONTH : undefined;

  // Smart Forecast → forward-month override map (month-of-year → mgmt fee).
  // Sums projected RT mgmt fee across all properties for each forward month.
  const smartOverride = useMemo(() => {
    const data = yearKey === 2026 ? smart2026 : smart2027;
    if (!data) return undefined;
    const map = new Map<number, number>();
    for (const ym of data.months) {
      const [y, m] = ym.split('-').map((s) => parseInt(s, 10));
      if (y !== yearKey) continue;
      let total = 0;
      for (const p of data.properties) {
        const cell = p.monthly.find((c) => c.month === ym);
        if (cell) total += cell.projectedMgmtFee;
      }
      if (total > 0) map.set(m, total);
    }
    return map;
  }, [smart2026, smart2027, yearKey]);

  const year = useMemo(
    () => calcYear(numNew, yearKey, actualsForYear, actualsThrough, smartOverride),
    [numNew, yearKey, actualsForYear, actualsThrough, smartOverride]
  );
  const scenarios = useMemo(
    () =>
      SCENARIO_RANGE.map((n) => ({
        n,
        year: calcYear(n, yearKey, actualsForYear, actualsThrough, smartOverride),
      })),
    [yearKey, actualsForYear, actualsThrough, smartOverride]
  );

  /** Switch year, clamping numNew to the new year's max if needed. */
  const setYearKeyClamped = (y: ForecastYear) => {
    const maxForYear = getYearConfig(y).newOrder.length;
    if (numNew > maxForYear) setNumNew(maxForYear);
    setYearKey(y);
  };

  const newStartMonthsLabel =
    year.newStartMonths.length === 0
      ? 'no new properties'
      : year.newStartMonths.map((m) => MONTH_LABELS[m - 1]).join(', ');

  const springTrough = Math.min(...year.cumulative.slice(0, 6), 0);
  const posMonths = year.monthly.filter((r) => r.net_business > 0);
  // Total managed = current properties + presigned in this year + N new
  const totalManaged = yearConfig.current.length + yearConfig.presigned.length + numNew;

  return (
    <>
      <ScenarioControl
        numNew={numNew}
        setNumNew={setNumNew}
        startMonths={newStartMonthsLabel}
        yearKey={yearKey}
        setYearKey={setYearKeyClamped}
        maxNew={yearConfig.newOrder.length}
      />

      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 36, width: '100%' }}
      >
        <KpiStrip
          year={year}
          numNew={numNew}
          totalManaged={totalManaged}
          springTrough={springTrough}
          posMonthsCount={posMonths.length}
          posMonthsLabel={posMonths.map((r) => MONTH_LABELS[r.month - 1]).join(', ')}
          yearKey={yearKey}
          currentCount={yearConfig.current.length}
          presignedCount={yearConfig.presigned.length}
        />

        <Banner
          numNew={numNew}
          newStartMonthsLabel={newStartMonthsLabel}
          totalManaged={totalManaged}
          netBusiness={year.totals.net_business}
          springTrough={springTrough}
          yearKey={yearKey}
          baseLine={
            yearKey === 2026
              ? '9 current + 5 pre-signed only'
              : '14 active properties'
          }
        />
      </section>

      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 36, width: '100%' }}
      >
        <SectionTitle title="Scenarios" tag="Click any to switch" />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            gap: 8,
            marginTop: 14,
          }}
          className="rt-forecast-scenarios"
        >
          {scenarios.map(({ n, year: y }) => (
            <ScenarioCard
              key={n}
              n={n}
              netBusiness={y.totals.net_business}
              active={n === numNew}
              onClick={() => setNumNew(n)}
            />
          ))}
        </div>
      </section>

      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 36, width: '100%' }}
      >
        <SectionTitle title="Monthly Net" tag="Revenue minus business expenses" />
        <CashFlowChart monthly={year.monthly} />
      </section>

      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 80, width: '100%' }}
      >
        <SectionTitle title="Monthly Detail" tag={String(yearKey)} />
        <div
          style={{
            border: '1px solid var(--rule)',
            background: 'var(--paper)',
            overflowX: 'auto',
          }}
        >
          <ForecastTable year={year} yearKey={yearKey} currentCount={yearConfig.current.length} presignedCount={yearConfig.presigned.length} />
        </div>
      </section>

      {yearKey === 2026 && (
        <section
          className="max-w-[1100px] mx-auto px-10"
          style={{ paddingBottom: 36, width: '100%' }}
        >
          <SectionTitle title="2026 actual mgmt fee" tag="By activity month · Chase ...5130 sweep on 1st weekday of next month" />
          <ActualsByMonth model={year} />
        </section>
      )}

      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 36, width: '100%' }}
      >
        <SectionTitle
          title="Smart forecast"
          tag={`Per-property · forward bookings × Gloucester pacing × each property's mgmt fee`}
        />
        <SmartForecastPanel data={yearKey === 2026 ? smart2026 : smart2027} />
      </section>

      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 36, width: '100%' }}
      >
        <SectionTitle title="Reality check" tag={`Trailing 12 mo · Chase ...5130 actuals (${ACTUALS_WINDOW.txCount} tx)`} />
        <RealityCheck />
      </section>

      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 80, width: '100%' }}
      >
        <SectionTitle title="Assumptions" tag={`What's baked in for ${yearKey}`} />
        <Assumptions yearKey={yearKey} />
      </section>

      <style jsx>{`
        @media (max-width: 720px) {
          .rt-forecast-scenarios {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
          .rt-forecast-kpi {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
      `}</style>
    </>
  );
}

function SmartForecastPanel({ data }: { data: SmartForecast | null }) {
  const fmtUsd = (n: number) =>
    n === 0 ? '—' : `$${Math.round(n).toLocaleString()}`;
  const fmtUsdCents = (n: number) =>
    n === 0 ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (!data) {
    return (
      <div
        style={{
          marginTop: 14,
          border: '1px solid var(--rule)',
          background: 'var(--paper)',
          padding: '24px',
          color: 'var(--ink-3)',
          fontSize: 13,
          fontStyle: 'italic',
        }}
      >
        Smart forecast unavailable. Either Supabase isn&apos;t configured, the
        guesty_reservations table is empty, or the live fetch failed (see
        server logs). Falls back gracefully — the seasonality-based projection
        still works.
      </div>
    );
  }

  if (data.months.length === 0) {
    return (
      <div
        style={{
          marginTop: 14,
          border: '1px solid var(--rule)',
          background: 'var(--paper)',
          padding: '24px',
          color: 'var(--ink-3)',
          fontSize: 13,
        }}
      >
        No forward months remaining for this year.
      </div>
    );
  }

  // Format a YYYY-MM as "Jul 26" for compact column headers.
  const fmtMonth = (ym: string) => {
    const [, m] = ym.split('-');
    return MONTH_LABELS[parseInt(m, 10) - 1];
  };

  return (
    <div
      style={{
        marginTop: 14,
        border: '1px solid var(--rule)',
        background: 'var(--paper)',
        overflowX: 'auto',
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 11.5,
          background: 'var(--paper)',
        }}
      >
        <thead>
          <tr>
            <Th first>&nbsp;</Th>
            <Th>Fee %</Th>
            {data.months.map((m) => (
              <Th key={m}>{fmtMonth(m)}</Th>
            ))}
            <Th totals>Mgmt fee</Th>
          </tr>
        </thead>
        <tbody>
          {/* Pacing row — portfolio-level current vs historical. */}
          <tr style={{ background: 'rgba(58, 107, 74, 0.04)' }}>
            <td style={labelCellStyle({ fontWeight: 600, color: 'var(--ink-2)' })}>
              Portfolio pacing
            </td>
            <td style={cellStyle({ color: 'var(--ink-4)' })}>—</td>
            {data.monthInputs.map((mi) => (
              <td
                key={mi.month}
                style={cellStyle({
                  color: mi.pacingPct < mi.historicalAvgPct ? 'var(--ink-2)' : 'var(--positive)',
                  fontSize: 10,
                })}
              >
                {mi.pacingPct.toFixed(0)}% / {mi.historicalAvgPct.toFixed(0)}%
              </td>
            ))}
            <td style={cellStyle({ color: 'var(--ink-4)' })}>—</td>
          </tr>
          {/* Multiplier row */}
          <tr>
            <td style={labelCellStyle({ fontWeight: 500, color: 'var(--ink-3)', fontStyle: 'italic' })}>
              ↳ projection multiplier
            </td>
            <td style={cellStyle({ color: 'var(--ink-4)' })}>—</td>
            {data.monthInputs.map((mi) => (
              <td
                key={mi.month}
                style={cellStyle({
                  color: 'var(--ink-3)',
                  fontStyle: 'italic',
                  fontSize: 10,
                })}
              >
                {mi.multiplier > 1 ? `${mi.multiplier.toFixed(1)}×` : '1×'}
              </td>
            ))}
            <td style={cellStyle({ color: 'var(--ink-4)' })}>—</td>
          </tr>

          <SectionRow label="Booked revenue (already on the books)" />
          {data.properties.map((p) => (
            <tr key={`booked-${p.property.id}`}>
              <td style={labelCellStyle({ color: 'var(--ink-2)' })}>{p.property.name}</td>
              <td style={cellStyle({ color: 'var(--ink-3)' })}>
                {p.property.mgmtFeePct != null ? `${p.property.mgmtFeePct}%` : '—'}
              </td>
              {p.monthly.map((m) => (
                <td key={m.month} style={cellStyle({ color: m.bookedRevenue === 0 ? 'var(--ink-4)' : 'var(--ink)', opacity: m.bookedRevenue === 0 ? 0.4 : 1 })}>
                  {fmtUsd(m.bookedRevenue)}
                </td>
              ))}
              <td style={cellStyle({ fontWeight: 600, background: 'var(--paper-2)' })}>
                {fmtUsd(p.totals.bookedRevenue)}
              </td>
            </tr>
          ))}

          <SectionRow label="Projected gross (booked × multiplier)" />
          {data.properties.map((p) => (
            <tr key={`proj-${p.property.id}`}>
              <td style={labelCellStyle({ color: 'var(--ink-2)' })}>{p.property.name}</td>
              <td style={cellStyle({ color: 'var(--ink-3)' })}>
                {p.property.mgmtFeePct != null ? `${p.property.mgmtFeePct}%` : '—'}
              </td>
              {p.monthly.map((m) => (
                <td key={m.month} style={cellStyle({ color: m.projectedGross === 0 ? 'var(--ink-4)' : 'var(--ink)', opacity: m.projectedGross === 0 ? 0.4 : 1 })}>
                  {fmtUsd(m.projectedGross)}
                </td>
              ))}
              <td style={cellStyle({ fontWeight: 600, background: 'var(--paper-2)' })}>
                {fmtUsd(p.totals.projectedGross)}
              </td>
            </tr>
          ))}

          <SectionRow label="Projected RT mgmt fee (gross × fee %)" tag="this is what hits the operating account" />
          {data.properties.map((p) => (
            <tr key={`fee-${p.property.id}`} style={{ background: 'rgba(200, 90, 58, 0.03)' }}>
              <td style={labelCellStyle({ color: 'var(--ink-2)', fontWeight: 500 })}>{p.property.name}</td>
              <td style={cellStyle({ color: 'var(--signal)', fontWeight: 600 })}>
                {p.property.mgmtFeePct != null ? `${p.property.mgmtFeePct}%` : '—'}
              </td>
              {p.monthly.map((m) => (
                <td
                  key={m.month}
                  style={cellStyle({
                    color: m.projectedMgmtFee === 0 ? 'var(--ink-4)' : 'var(--positive)',
                    opacity: m.projectedMgmtFee === 0 ? 0.4 : 1,
                    fontWeight: m.projectedMgmtFee > 0 ? 600 : 400,
                  })}
                >
                  {fmtUsd(m.projectedMgmtFee)}
                </td>
              ))}
              <td
                style={cellStyle({
                  fontWeight: 700,
                  color: 'var(--positive)',
                  background: 'rgba(58, 107, 74, 0.08)',
                })}
              >
                {fmtUsdCents(p.totals.projectedMgmtFee)}
              </td>
            </tr>
          ))}

          {/* Total row */}
          <tr>
            <td
              style={labelCellStyle({
                background: 'var(--ink)',
                color: 'var(--paper)',
                fontWeight: 700,
              })}
            >
              ◆ Portfolio mgmt fee
            </td>
            <td
              style={cellStyle({
                background: 'var(--ink)',
                color: 'var(--paper)',
                fontWeight: 700,
              })}
            >
              —
            </td>
            {data.months.map((ym) => {
              const sum = data.properties.reduce((s, p) => {
                const cell = p.monthly.find((mm) => mm.month === ym);
                return s + (cell?.projectedMgmtFee ?? 0);
              }, 0);
              return (
                <td
                  key={ym}
                  style={cellStyle({
                    background: 'var(--ink)',
                    color: '#9bd1ad',
                    fontWeight: 600,
                  })}
                >
                  {fmtUsd(sum)}
                </td>
              );
            })}
            <td
              style={cellStyle({
                background: 'var(--ink-2)',
                color: '#9bd1ad',
                fontWeight: 700,
              })}
            >
              {fmtUsdCents(data.totals.projectedMgmtFee)}
            </td>
          </tr>
        </tbody>
      </table>

      <div
        style={{
          padding: '12px 18px',
          fontSize: 11,
          lineHeight: 1.55,
          color: 'var(--ink-3)',
          borderTop: '1px solid var(--rule)',
          background: 'var(--paper-2)',
        }}
      >
        <strong style={{ color: 'var(--ink-2)' }}>How this works:</strong>{' '}
        Every active reservation in <code>guesty_reservations</code> with check-in in a
        forward month contributes its pro-rated revenue. Portfolio pacing = booked
        nights ÷ (days × active properties). Projection multiplier = Gloucester
        historical avg occupancy ÷ portfolio pacing (4-yr post-pandemic baseline,
        floored at 1×). Each property&apos;s gross is then multiplied by its own
        management fee percentage.
      </div>
    </div>
  );
}

function ActualsByMonth({ model }: { model: YearResult }) {
  // Chase sweeps the prior month's mgmt fees on the first weekday of the
  // next month. So a transfer posted "May 4" represents APRIL activity, not
  // May. We display by activity month — what most people mean when they
  // ask "how much did we make in April".
  const fmtCents = (n: number) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const byPosting = new Map(ACTUALS_INFLOWS_BY_MONTH.map((r) => [r.month, r]));

  // Activity month → posting month for the mgmt fee sweep.
  const activityRows: Array<{
    activityMonth: string; // YYYY-MM
    postingMonth: string;  // YYYY-MM
    mgmtFee: number;
    isPartial: boolean;
  }> = [
    { activityMonth: '2026-01', postingMonth: '2026-02', mgmtFee: 0, isPartial: false },
    { activityMonth: '2026-02', postingMonth: '2026-03', mgmtFee: 0, isPartial: false },
    { activityMonth: '2026-03', postingMonth: '2026-04', mgmtFee: 0, isPartial: false },
    { activityMonth: '2026-04', postingMonth: '2026-05', mgmtFee: 0, isPartial: false },
  ].map((r) => {
    const post = byPosting.get(r.postingMonth);
    return {
      ...r,
      mgmtFee: post?.mgmtFeeIn ?? 0,
      isPartial: post?.isPartial ?? false,
    };
  });

  const totalActual = activityRows.reduce((s, r) => s + r.mgmtFee, 0);

  // Modeled mgmt fee revenue for Jan-Apr from the year's monthly array.
  // Months 1..4 = Jan..Apr inclusive.
  const modelByMonth: Record<string, number> = {};
  for (let i = 0; i < 4; i++) {
    const r = model.monthly[i];
    modelByMonth[`2026-${String(i + 1).padStart(2, '0')}`] = r.rev_current + r.rev_presigned + r.rev_new;
  }
  const totalModel = Object.values(modelByMonth).reduce((s, v) => s + v, 0);

  return (
    <div
      style={{
        marginTop: 14,
        border: '1px solid var(--rule)',
        background: 'var(--paper)',
        overflowX: 'auto',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: 'var(--paper)' }}>
        <thead>
          <tr>
            <th style={rcThStyle('left', 160)}>Activity month</th>
            <th style={rcThStyle('right', 150)}>Mgmt fee · actual</th>
            <th style={rcThStyle('right', 150)}>Mgmt fee · modeled</th>
            <th style={rcThStyle('right', 100)}>Variance</th>
            <th style={rcThStyle('left')}>Sweep</th>
          </tr>
        </thead>
        <tbody>
          {activityRows.map((r) => {
            const [, mm] = r.activityMonth.split('-');
            const monthName = MONTH_LABELS[parseInt(mm, 10) - 1];
            const [, pmm] = r.postingMonth.split('-');
            const postingMonthName = MONTH_LABELS[parseInt(pmm, 10) - 1];
            const modelVal = modelByMonth[r.activityMonth] ?? 0;
            const variance = r.mgmtFee - modelVal;
            const variancePct = modelVal > 0 ? (variance / modelVal) * 100 : null;
            return (
              <tr key={r.activityMonth}>
                <td style={rcCellStyle({ fontWeight: 500, color: 'var(--ink-2)', textAlign: 'left' })}>
                  {monthName} 2026
                </td>
                <td style={rcCellStyle({ fontFamily: 'var(--font-mono-dash), monospace', textAlign: 'right', fontWeight: 600 })}>
                  {fmtCents(r.mgmtFee)}
                  {r.isPartial && <span style={{ fontSize: 10, color: 'var(--ink-4)', fontStyle: 'italic', marginLeft: 6 }}>(partial)</span>}
                </td>
                <td style={rcCellStyle({ fontFamily: 'var(--font-mono-dash), monospace', textAlign: 'right', color: 'var(--ink-3)' })}>
                  {fmtCents(modelVal)}
                </td>
                <td style={rcCellStyle({ fontFamily: 'var(--font-mono-dash), monospace', textAlign: 'right', color: variance >= 0 ? 'var(--positive)' : 'var(--negative)' })}>
                  {variancePct != null ? `${variance >= 0 ? '+' : ''}${variancePct.toFixed(0)}%` : '—'}
                </td>
                <td style={rcCellStyle({ fontSize: 11, color: 'var(--ink-3)', textAlign: 'left' })}>
                  Posted early {postingMonthName}{r.isPartial ? ' (export through May 4)' : ''}
                </td>
              </tr>
            );
          })}
          <tr>
            <td style={rcCellStyle({ fontWeight: 700, color: 'var(--ink)', borderTop: '2px solid var(--ink)', textAlign: 'left' })}>
              Jan-Apr 2026 (YTD)
            </td>
            <td style={rcCellStyle({ fontFamily: 'var(--font-mono-dash), monospace', fontWeight: 700, textAlign: 'right', borderTop: '2px solid var(--ink)' })}>
              {fmtCents(totalActual)}
            </td>
            <td style={rcCellStyle({ fontFamily: 'var(--font-mono-dash), monospace', fontWeight: 700, textAlign: 'right', borderTop: '2px solid var(--ink)', color: 'var(--ink-3)' })}>
              {fmtCents(totalModel)}
            </td>
            <td style={rcCellStyle({ fontFamily: 'var(--font-mono-dash), monospace', fontWeight: 700, textAlign: 'right', borderTop: '2px solid var(--ink)', color: totalActual - totalModel >= 0 ? 'var(--positive)' : 'var(--negative)' })}>
              {totalModel > 0 ? `${totalActual - totalModel >= 0 ? '+' : ''}${(((totalActual - totalModel) / totalModel) * 100).toFixed(0)}%` : '—'}
            </td>
            <td style={rcCellStyle({ fontSize: 11, color: 'var(--ink-3)', borderTop: '2px solid var(--ink)', textAlign: 'left' })}>
              Sweep convention: Chase batches month-end fees on the 1st-2nd weekday of the next month.
              Apr 2026 = $7,869.23 swept May 4 (8 properties contributing).
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function RealityCheck() {
  // Compare each itemized model expense against the closest actuals line.
  // Model side: what we're projecting (clean monthly inputs).
  // Actual side: trailing-12-mo average and exact total from the bank.
  type Row = {
    label: string;
    modelMonthly: number | null;
    actualMonthly: number | null;
    actualTotal: number | null;
    note: string;
  };

  const findActual = (id: string): ExpenseLine | undefined =>
    ACTUALS_TRAILING_12MO.find((l) => l.id === id);

  const buildRow = (
    label: string,
    modelMonthly: number,
    actualId: string,
    note: string
  ): Row => {
    const a = findActual(actualId);
    return {
      label,
      modelMonthly,
      actualMonthly: a?.avgMonthly ?? null,
      actualTotal: a?.total12mo ?? null,
      note,
    };
  };

  const rows: Row[] = [
    buildRow('Office rent + dumpster', OFFICE_RENT_MONTHLY + 50, 'office_rent',
      '$750/mo rent started Mar 2026 + $50/mo dumpster (flat year-round).'),
    buildRow('Software / SaaS', SOFTWARE_MONTHLY, 'payroll_software',
      'Bank-visible Gusto fee only. Real total is higher — most SaaS is on the CC.'),
    buildRow('MH Partners (bookkeeper)', BOOKKEEPER_MONTHLY, 'mh_partners',
      "Outside bookkeeper retainer. ~$1K/mo through Apr, final $1,800 wrap-up in May 2026, then $0."),
    buildRow('Insurance (smoothed)', INSURANCE_MONTHLY, 'insurance',
      'Phillips Insurance $5,263.92 paid 03/02/2026 — annual policy.'),
    buildRow('Accounting (one-time)', 0, 'accounting',
      'MS Consultants $4,442.96 on 04/15/2026 was a one-time engagement, not recurring.'),
    buildRow('Bank fees', BANK_FEES_MONTHLY, 'bank_fees',
      'Stop payments + monthly service + returned checks (one $1,208.78 returned check Jan 2026).'),
    buildRow('Operating CC (Chase ...3878)', CC_OPERATING_MONTHLY, 'cc_main',
      'Range $3,054.42-$16,340.49/mo. Median used for the model. Decomposing the CC statement would sharpen this.'),
    buildRow('Payroll · Gusto runs', 0, 'payroll',
      'NET $12,403.25 + TAX $5,895.15. Gusto stopped Oct 2025. Replaced by hire line ($5K/mo from Oct 2026 in the model).'),
    buildRow('Maggie Butler (weekly Zelle)', 0, 'staff_zelle',
      'Stopped 12/03/2025. Folded into hire assumption.'),
    buildRow('MA DOR (state tax remit)', 0, 'state_tax',
      'Pass-through — owners owe this, RT remits. Out of model scope but visible.'),
    buildRow('Maintenance (Zelle)', 0, 'maintenance',
      'Ian Drometer + Tomer + Jason etc. Per-property and reimbursed via owner statements.'),
    buildRow('Subcontractors (Zelle)', 0, 'subcontractors',
      'One-off project work. Project-based, not modeled as recurring.'),
  ];

  const totalModelMonthly = rows.reduce((s, r) => s + (r.modelMonthly ?? 0), 0);
  const totalActualMonthly = rows.reduce((s, r) => s + Math.abs(r.actualMonthly ?? 0), 0);
  const totalActual12mo = rows.reduce((s, r) => s + Math.abs(r.actualTotal ?? 0), 0);

  // Precise USD with cents and thousands separators — used for actuals,
  // because the bank knows exactly. Model side keeps round numbers since
  // those are clean modeling inputs.
  const fmtCents = (n: number) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div
      style={{
        marginTop: 14,
        border: '1px solid var(--rule)',
        background: 'var(--paper)',
        overflowX: 'auto',
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12,
          background: 'var(--paper)',
        }}
      >
        <thead>
          <tr>
            <th style={rcThStyle('left', 240)}>Line</th>
            <th style={rcThStyle('right', 120)}>Model · monthly</th>
            <th style={rcThStyle('right', 130)}>Actual · 12-mo avg</th>
            <th style={rcThStyle('right', 140)}>Actual · 12-mo total</th>
            <th style={rcThStyle('left')}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const model = r.modelMonthly ?? 0;
            const actual = Math.abs(r.actualMonthly ?? 0);
            const actualTotal = Math.abs(r.actualTotal ?? 0);
            const delta = actual - model;
            const deltaPct = model > 0 ? (delta / model) * 100 : null;
            const deltaColor =
              !model || !actual ? 'var(--ink-4)' :
              Math.abs(deltaPct ?? 0) < 25 ? 'var(--positive)' :
              Math.abs(deltaPct ?? 0) < 75 ? 'var(--ink-3)' :
              'var(--negative)';
            return (
              <tr key={r.label}>
                <td style={rcCellStyle({ fontWeight: 500, color: 'var(--ink-2)', textAlign: 'left' })}>
                  {r.label}
                </td>
                <td style={rcCellStyle({ fontFamily: 'var(--font-mono-dash), monospace', textAlign: 'right' })}>
                  {model > 0 ? `$${model.toLocaleString()}` : <span style={{ color: 'var(--ink-4)' }}>—</span>}
                </td>
                <td style={rcCellStyle({ fontFamily: 'var(--font-mono-dash), monospace', textAlign: 'right', color: deltaColor })}>
                  {actual > 0 ? fmtCents(actual) : <span style={{ color: 'var(--ink-4)' }}>—</span>}
                </td>
                <td style={rcCellStyle({ fontFamily: 'var(--font-mono-dash), monospace', textAlign: 'right', color: 'var(--ink-2)' })}>
                  {actualTotal > 0 ? fmtCents(actualTotal) : <span style={{ color: 'var(--ink-4)' }}>—</span>}
                </td>
                <td style={rcCellStyle({ fontSize: 11, color: 'var(--ink-3)', textAlign: 'left' })}>
                  {r.note}
                </td>
              </tr>
            );
          })}
          <tr>
            <td style={rcCellStyle({ fontWeight: 700, color: 'var(--ink)', borderTop: '2px solid var(--ink)', textAlign: 'left' })}>
              Total
            </td>
            <td style={rcCellStyle({ fontFamily: 'var(--font-mono-dash), monospace', fontWeight: 700, textAlign: 'right', borderTop: '2px solid var(--ink)' })}>
              ${totalModelMonthly.toLocaleString()}
            </td>
            <td style={rcCellStyle({ fontFamily: 'var(--font-mono-dash), monospace', fontWeight: 700, textAlign: 'right', borderTop: '2px solid var(--ink)' })}>
              {fmtCents(totalActualMonthly)}
            </td>
            <td style={rcCellStyle({ fontFamily: 'var(--font-mono-dash), monospace', fontWeight: 700, textAlign: 'right', borderTop: '2px solid var(--ink)' })}>
              {fmtCents(totalActual12mo)}
            </td>
            <td style={rcCellStyle({ fontSize: 11, color: 'var(--ink-3)', borderTop: '2px solid var(--ink)', textAlign: 'left' })}>
              Mgmt fee inflows trailing 12-mo: {fmtCents(ACTUALS_INFLOWS_TRAILING_12MO.mgmt_fee_in)}. Plus {fmtCents(ACTUALS_INFLOWS_TRAILING_12MO.capital_infusion)} Fidelity capital infusion when ops needed cushion. Platform direct deposits are pass-through to owners and don't represent RT income.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function rcThStyle(align: 'left' | 'right', width?: number): React.CSSProperties {
  return {
    background: 'var(--ink)',
    color: 'var(--paper)',
    padding: '9px 12px',
    textAlign: align,
    fontWeight: 500,
    fontSize: 10,
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    width: width ? `${width}px` : 'auto',
  };
}

function rcCellStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    padding: '8px 12px',
    borderBottom: '1px solid var(--rule)',
    fontVariantNumeric: 'tabular-nums',
    verticalAlign: 'top',
    ...extra,
  };
}

function Assumptions({ yearKey }: { yearKey: ForecastYear }) {
  const items2026: Array<{ label: string; value: string }> = [
    { label: 'Current portfolio', value: '9 properties already managed (fees $18.7K-$44K/yr)' },
    { label: 'Pre-signed', value: '5 contracts at $25K/yr — 2 May (incl. 79 Main St), 3 June (incl. 16 Waterman)' },
    { label: 'New mandates', value: '$25K/yr each, Cape Ann seasonality, default 3 sprinkled Jul · Sep · Nov' },
    { label: 'Office', value: '$750/mo rent from March + $50/mo dumpster (flat year-round)' },
    { label: 'Software / SaaS', value: '$200/mo (Gusto + buffer for AppFolio/Hospitable on the CC)' },
    { label: 'MH Partners (bookkeeper)', value: '~$1K/mo Jan-Apr + $1,800 final wrap-up in May, then $0 (engagement ends)' },
    { label: 'Insurance', value: '$440/mo smoothed (Phillips $5,264/yr, paid March)' },
    { label: 'Accounting', value: 'One-time MS Consultants $4,443 in April; $0 going forward' },
    { label: 'Bank fees', value: '$100/mo (stop payments, service fees, returned checks)' },
    { label: 'Operating CC', value: '$5,900/mo median Chase ...3878 payment — software, supplies, marketing, partial property pass-through' },
    { label: 'New hire', value: '$5,000/mo from October (replaces Maggie + Gusto runs)' },
    { label: 'Onboarding', value: '$3,000 one-time per new contract, paid the start month' },
    { label: 'Excludes', value: 'RT-owned units (3 Locust, Lighthouse Point, 65 Calderwood), personal owner draw, healthcare, ATM/debit-card personal, federal/state taxes, capex, distributions' },
  ];
  const items2027: Array<{ label: string; value: string }> = [
    { label: 'Active portfolio (Jan 1)', value: '14 properties full-year (9 original + 5 ex-presigned including 79 Main, 16 Waterman)' },
    { label: 'New mandates', value: '$25K/yr each, default 3 sprinkled Mar · Jun · Sep' },
    { label: 'Office', value: '$750/mo rent all year + $50/mo dumpster' },
    { label: 'Software / SaaS', value: '$200/mo' },
    { label: 'MH Partners (bookkeeper)', value: '$0 — engagement ended May 2026' },
    { label: 'Insurance', value: '$440/mo smoothed' },
    { label: 'Accounting', value: '$0 (no recurring engagement)' },
    { label: 'Bank fees', value: '$100/mo' },
    { label: 'Operating CC', value: '$5,900/mo (carried over from 2026 actuals — needs re-calibration with 2026 actual data once the year is closed)' },
    { label: 'Hire continues', value: '$5,000/mo all year ($60K) — assumes the Oct 2026 hire stays' },
    { label: 'Onboarding', value: '$3,000 one-time per new contract' },
    { label: 'Excludes', value: 'RT-owned units, personal draw, healthcare, taxes, capex, distributions' },
  ];
  const items = yearKey === 2026 ? items2026 : items2027;
  return (
    <div
      style={{
        marginTop: 14,
        border: '1px solid var(--rule)',
        background: 'var(--paper)',
        padding: '4px 0',
      }}
    >
      {items.map((it, i) => (
        <div
          key={it.label}
          style={{
            display: 'grid',
            gridTemplateColumns: '180px 1fr',
            gap: 24,
            padding: '10px 18px',
            borderBottom: i === items.length - 1 ? 'none' : '1px dotted var(--rule)',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <span className="eyebrow" style={{ paddingTop: 2 }}>
            {it.label}
          </span>
          <span style={{ color: 'var(--ink-2)' }}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Control */

function ScenarioControl({
  numNew,
  setNumNew,
  startMonths,
  yearKey,
  setYearKey,
  maxNew,
}: {
  numNew: number;
  setNumNew: (n: number) => void;
  startMonths: string;
  yearKey: ForecastYear;
  setYearKey: (y: ForecastYear) => void;
  maxNew: number;
}) {
  const subLabel =
    yearKey === 2026
      ? 'beyond 9 current + 5 pre-signed'
      : 'beyond the 14 active by Jan 2027';
  return (
    <section
      className="max-w-[1100px] mx-auto px-10"
      style={{
        paddingTop: 8,
        paddingBottom: 28,
        width: '100%',
      }}
    >
      <div
        style={{
          background: 'var(--ink)',
          color: 'var(--paper)',
          borderRadius: 2,
          padding: '20px 24px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 24,
        }}
      >
        {/* Year toggle */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 0 auto' }}>
          <div
            className="font-mono"
            style={{
              fontSize: 10,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-4)',
            }}
          >
            Forecast year
          </div>
          <div style={{ display: 'flex', gap: 0 }}>
            <YearTab year={2026} active={yearKey === 2026} onClick={() => setYearKey(2026)} />
            <YearTab year={2027} active={yearKey === 2027} onClick={() => setYearKey(2027)} />
          </div>
        </div>

        <div style={{ flex: '0 0 auto', minWidth: 130 }}>
          <div
            className="font-mono"
            style={{
              fontSize: 10,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-4)',
              marginBottom: 4,
            }}
          >
            New props in {yearKey}
          </div>
          <div style={{ fontSize: 11, color: 'var(--paper-2)', opacity: 0.7 }}>
            {subLabel}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            type="button"
            onClick={() => setNumNew(numNew - 1)}
            aria-label="Decrease new properties"
            style={stepperStyle}
          >
            −
          </button>
          <div
            className="font-serif tabular-nums"
            style={{
              fontSize: 36,
              minWidth: 48,
              textAlign: 'center',
              color: 'var(--paper)',
              lineHeight: 1,
            }}
          >
            {numNew}
          </div>
          <button
            type="button"
            onClick={() => setNumNew(numNew + 1)}
            aria-label="Increase new properties"
            style={stepperStyle}
          >
            +
          </button>
        </div>

        <input
          type="range"
          min={0}
          max={maxNew}
          value={numNew}
          onChange={(e) => setNumNew(+e.target.value)}
          aria-label="Number of new properties"
          style={{
            flex: '1 1 200px',
            maxWidth: 320,
            accentColor: 'var(--signal)',
          }}
        />

        <div
          className="font-mono"
          style={{
            fontSize: 11,
            color: 'var(--paper-2)',
            opacity: 0.7,
            letterSpacing: '.04em',
          }}
        >
          {numNew > 0 ? `→ ${startMonths}` : startMonths}
        </div>
      </div>
    </section>
  );
}

function YearTab({
  year,
  active,
  onClick,
}: {
  year: ForecastYear;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? 'var(--signal)' : 'transparent',
        color: active ? 'var(--paper)' : 'var(--paper-2)',
        border: '1px solid',
        borderColor: active ? 'var(--signal)' : 'var(--ink-3)',
        padding: '6px 14px',
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: '.04em',
        cursor: 'pointer',
        transition: 'all .15s',
      }}
    >
      {year}
    </button>
  );
}

const stepperStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: '50%',
  border: '1px solid var(--ink-3)',
  background: 'transparent',
  color: 'var(--paper-2)',
  fontSize: 18,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all .15s',
};

/* -------------------------------------------------------------------- KPI */

function KpiStrip({
  year,
  numNew,
  totalManaged,
  springTrough,
  posMonthsCount,
  posMonthsLabel,
  yearKey,
  currentCount,
  presignedCount,
}: {
  year: YearResult;
  numNew: number;
  totalManaged: number;
  springTrough: number;
  posMonthsCount: number;
  posMonthsLabel: string;
  yearKey: ForecastYear;
  currentCount: number;
  presignedCount: number;
}) {
  const { totals } = year;
  const portfolioBreakdown =
    yearKey === 2026
      ? `${currentCount} current + ${presignedCount} pre-signed + ${numNew} new`
      : `${currentCount} active + ${numNew} new`;
  const revBreakdown =
    yearKey === 2026
      ? `cur ${fmtCompactSimple(totals.rev_current)} · pre ${fmtCompactSimple(totals.rev_presigned)} · new ${fmtCompactSimple(totals.rev_new)}`
      : `active ${fmtCompactSimple(totals.rev_current)} · new ${fmtCompactSimple(totals.rev_new)}`;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 0,
        borderTop: '1px solid var(--ink)',
        borderBottom: '1px solid var(--ink)',
      }}
      className="rt-forecast-kpi"
    >
      <KpiCell
        label="Net business income"
        value={fmtDollar(totals.net_business)}
        valueAccent={totals.net_business >= 0 ? 'positive' : 'negative'}
        sub={totals.net_business >= 0 ? 'Year ends in the black' : 'Year ends in deficit'}
      />
      <KpiCell
        label="Total revenue"
        value={fmtDollar(totals.rev_total)}
        sub={revBreakdown}
      />
      <KpiCell
        label="Total expenses"
        value={fmtDollar(totals.exp_total)}
        sub="Corp + office + hire + onboarding"
        last
      />
      <KpiCell
        label="Managed at year-end"
        value={String(totalManaged)}
        sub={portfolioBreakdown}
        topBorder
        valueAccent="signal"
      />
      <KpiCell
        label="Peak spring crunch"
        value={springTrough >= 0 ? '$0' : fmtDollar(springTrough)}
        sub="End of May cumulative deficit"
        topBorder
      />
      <KpiCell
        label="Net-positive months"
        value={`${posMonthsCount}`}
        sub={posMonthsCount === 0 ? 'No surplus months' : posMonthsLabel}
        topBorder
        last
      />
    </div>
  );
}

function fmtCompactSimple(n: number): string {
  return `$${Math.round(n / 1000)}K`;
}

function KpiCell({
  label,
  value,
  sub,
  valueAccent,
  topBorder,
  last,
}: {
  label: string;
  value: string;
  sub?: string;
  valueAccent?: 'positive' | 'negative' | 'signal';
  topBorder?: boolean;
  last?: boolean;
}) {
  const valueColor =
    valueAccent === 'positive'
      ? 'var(--positive)'
      : valueAccent === 'negative'
        ? 'var(--negative)'
        : valueAccent === 'signal'
          ? 'var(--signal)'
          : 'var(--ink)';

  return (
    <div
      style={{
        padding: '20px 22px',
        borderRight: last ? 'none' : '1px solid var(--rule)',
        borderTop: topBorder ? '1px solid var(--rule)' : 'none',
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div
        className="font-serif tabular-nums"
        style={{
          fontSize: 28,
          fontWeight: 400,
          lineHeight: 1.05,
          color: valueColor,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: 'var(--ink-3)',
            lineHeight: 1.4,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Banner */

function Banner({
  numNew,
  newStartMonthsLabel,
  totalManaged,
  netBusiness,
  springTrough,
  yearKey,
  baseLine,
}: {
  numNew: number;
  newStartMonthsLabel: string;
  totalManaged: number;
  netBusiness: number;
  springTrough: number;
  yearKey: ForecastYear;
  baseLine: string;
}) {
  return (
    <div
      style={{
        marginTop: 20,
        padding: '12px 16px',
        borderLeft: '3px solid var(--positive)',
        background: 'rgba(58, 107, 74, 0.06)',
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--ink-2)',
      }}
    >
      {numNew === 0 ? (
        <>
          <strong style={{ color: 'var(--ink)' }}>{yearKey} · no new properties:</strong>{' '}
          running on {baseLine}. Net business:{' '}
          <strong style={{ color: 'var(--ink)' }}>{fmtDollar(netBusiness)}</strong>.
        </>
      ) : (
        <>
          <strong style={{ color: 'var(--ink)' }}>
            {yearKey} · +{numNew} new {numNew === 1 ? 'property' : 'properties'}
          </strong>{' '}
          onboarded in {newStartMonthsLabel}. {totalManaged} managed properties by year-end.
          Net business:{' '}
          <strong style={{ color: 'var(--ink)' }}>{fmtDollar(netBusiness)}</strong>. Spring crunch:{' '}
          <strong style={{ color: 'var(--ink)' }}>
            {springTrough >= 0 ? 'none' : fmtDollar(springTrough)}
          </strong>
          .
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- Section title */

function SectionTitle({ title, tag }: { title: string; tag?: string }) {
  return (
    <div
      className="rule-bottom"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        paddingBottom: 8,
        marginBottom: 4,
      }}
    >
      <h2
        className="font-serif"
        style={{
          fontSize: 22,
          fontWeight: 400,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
          margin: 0,
        }}
      >
        {title}
      </h2>
      {tag && <span className="eyebrow">{tag}</span>}
    </div>
  );
}

/* ------------------------------------------------------------ Scenarios */

function ScenarioCard({
  n,
  netBusiness,
  active,
  onClick,
}: {
  n: number;
  netBusiness: number;
  active: boolean;
  onClick: () => void;
}) {
  const positive = netBusiness >= 0;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? 'rgba(200, 90, 58, 0.08)' : 'var(--paper)',
        border: active ? '2px solid var(--signal)' : '1px solid var(--rule)',
        padding: active ? '13px 12px' : '14px 13px',
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'all .15s',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <span className="eyebrow">+{n} new</span>
      <span
        className="font-serif tabular-nums"
        style={{
          fontSize: 22,
          fontWeight: 400,
          color: positive ? 'var(--positive)' : 'var(--negative)',
          lineHeight: 1,
          marginTop: 2,
        }}
      >
        {fmtDollar(netBusiness)}
      </span>
      <span
        className="font-mono"
        style={{
          fontSize: 9,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
          marginTop: 2,
        }}
      >
        {n + 12} mgmt props
      </span>
    </button>
  );
}

/* ----------------------------------------------------------------- Chart */

function CashFlowChart({ monthly }: { monthly: MonthRow[] }) {
  const HEIGHT = 220;
  const nets = monthly.map((r) => r.net_business);
  const maxPos = Math.max(0, ...nets);
  const maxNeg = Math.max(0, ...nets.map((x) => -x));
  const total = maxPos + maxNeg;
  const zeroPx = total > 0 ? Math.round((maxNeg / total) * HEIGHT) : Math.floor(HEIGHT / 2);

  return (
    <div
      style={{
        border: '1px solid var(--rule)',
        background: 'var(--paper)',
        padding: '24px 24px 18px',
        marginTop: 14,
      }}
    >
      <div
        style={{
          position: 'relative',
          paddingRight: 36,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            height: HEIGHT,
            gap: 4,
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              height: 1,
              background: 'var(--rule)',
              bottom: zeroPx,
              zIndex: 1,
            }}
          />
          {monthly.map((r, i) => {
            const isPos = r.net_business >= 0;
            const barPx = total > 0
              ? Math.max(2, Math.round((Math.abs(r.net_business) / total) * HEIGHT))
              : 2;
            const color = isPos ? 'var(--positive)' : 'var(--negative)';
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  position: 'relative',
                  height: HEIGHT,
                }}
              >
                {isPos ? (
                  <>
                    <div style={{ flex: `0 0 ${HEIGHT - zeroPx - barPx}px` }} />
                    <div
                      style={{
                        height: barPx,
                        background: color,
                        borderRadius: '2px 2px 0 0',
                        transition: 'height .25s ease',
                      }}
                    />
                  </>
                ) : (
                  <>
                    <div style={{ flex: `0 0 ${HEIGHT - zeroPx}px` }} />
                    <div
                      style={{
                        height: barPx,
                        background: color,
                        borderRadius: '2px 2px 0 0',
                        transition: 'height .25s ease',
                      }}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div
          style={{
            position: 'absolute',
            right: -2,
            bottom: zeroPx - 6,
            fontSize: 10,
            color: 'var(--ink-4)',
            fontFamily: 'var(--font-mono-dash), monospace',
          }}
        >
          $0
        </div>
      </div>

      {/* labels under each bar */}
      <div style={{ display: 'flex', gap: 4, marginTop: 6, paddingRight: 36 }}>
        {monthly.map((r, i) => {
          const isPos = r.net_business >= 0;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <span
                className="font-mono"
                style={{
                  fontSize: 9,
                  color: isPos ? 'var(--positive)' : 'var(--negative)',
                  fontWeight: 600,
                  letterSpacing: '.02em',
                }}
              >
                {fmtCompact(r.net_business)}
              </span>
              <span
                className="font-mono"
                style={{
                  fontSize: 9,
                  color: 'var(--ink-4)',
                  letterSpacing: '.06em',
                  textTransform: 'uppercase',
                }}
              >
                {MONTH_LABELS[i]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Table */

function ForecastTable({
  year,
  yearKey,
  currentCount,
  presignedCount,
}: {
  year: YearResult;
  yearKey: ForecastYear;
  currentCount: number;
  presignedCount: number;
}) {
  const { monthly, cumulative, totals } = year;
  // For 2026 forward months, rev_current is the Smart Forecast total
  // (real Guesty bookings × Gloucester pacing × per-property fee). For
  // past months (Jan-Apr) it's the bank actual. The seasonality
  // heuristic only kicks in if Smart Forecast data is unavailable.
  const currentLabel =
    yearKey === 2026
      ? `Current 9 + presigned (smart forecast)`
      : `${currentCount} active properties (smart forecast)`;
  const presignedLabel = '5 pre-signed (May · Jun) [folded into Current row when smart data exists]';

  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 11.5,
        background: 'var(--paper)',
      }}
    >
      <thead>
        <tr>
          <Th first>&nbsp;</Th>
          {MONTH_LABELS.map((m, i) => (
            <Th key={m} actual={monthly[i]?.is_actual}>{m}</Th>
          ))}
          <Th totals>FY</Th>
        </tr>
      </thead>
      <tbody>
        <SectionRow label="Revenue" />
        <DataRow label={currentLabel} values={monthly.map((r) => r.rev_current)} fy={totals.rev_current} />
        {presignedCount > 0 && (
          <DataRow label={presignedLabel} values={monthly.map((r) => r.rev_presigned)} fy={totals.rev_presigned} />
        )}
        <DataRow label="N new properties" values={monthly.map((r) => r.rev_new)} fy={totals.rev_new} highlight />
        <TotalRow label="Total revenue" values={monthly.map((r) => r.rev_total)} fy={totals.rev_total} />

        <SectionRow label="Expenses" tag="calibrated to Chase ...5130 actuals" />
        <DataRow label="Office + dumpster (from Mar)" values={monthly.map((r) => r.exp_office)} fy={monthly.reduce((a, r) => a + r.exp_office, 0)} />
        <DataRow label="Software / SaaS ($200/mo)" values={monthly.map((r) => r.exp_software)} fy={monthly.reduce((a, r) => a + r.exp_software, 0)} />
        <DataRow label="MH Partners bookkeeper (ends May $1.8K)" values={monthly.map((r) => r.exp_debt)} fy={monthly.reduce((a, r) => a + r.exp_debt, 0)} />
        <DataRow label="Insurance · Phillips (smoothed)" values={monthly.map((r) => r.exp_insurance)} fy={monthly.reduce((a, r) => a + r.exp_insurance, 0)} />
        <DataRow label="Accounting (MS Consultants · one-time)" values={monthly.map((r) => r.exp_accounting)} fy={monthly.reduce((a, r) => a + r.exp_accounting, 0)} />
        <DataRow label="Bank fees" values={monthly.map((r) => r.exp_bank)} fy={monthly.reduce((a, r) => a + r.exp_bank, 0)} />
        <DataRow label="Operating CC pass-through" values={monthly.map((r) => r.exp_cc_ops)} fy={monthly.reduce((a, r) => a + r.exp_cc_ops, 0)} />
        <DataRow label="New hire ($5K/mo from Oct)" values={monthly.map((r) => r.exp_hire)} fy={monthly.reduce((a, r) => a + r.exp_hire, 0)} />
        <DataRow label="Onboarding · pre-signed" values={monthly.map((r) => r.exp_onboard_presigned)} fy={monthly.reduce((a, r) => a + r.exp_onboard_presigned, 0)} />
        <DataRow label="Onboarding · new" values={monthly.map((r) => r.exp_onboard_new)} fy={monthly.reduce((a, r) => a + r.exp_onboard_new, 0)} highlight />
        <SubtotalRow label="Total expenses" values={monthly.map((r) => r.exp_total)} fy={totals.exp_total} variant="expense" />

        <BottomLineRow label="Net business income" values={monthly.map((r) => r.net_business)} fy={totals.net_business} />
        <CumulativeRow label="Cumulative YTD" values={cumulative} />
      </tbody>
    </table>
  );
}

/* --------------------------------------------------- Table cell helpers */

function Th({
  children,
  first,
  totals,
  actual,
}: {
  children: React.ReactNode;
  first?: boolean;
  totals?: boolean;
  actual?: boolean;
}) {
  return (
    <th
      style={{
        background: totals ? 'var(--ink-2)' : 'var(--ink)',
        color: 'var(--paper)',
        padding: '9px 9px',
        textAlign: first ? 'left' : 'center',
        fontWeight: 500,
        fontSize: 10,
        letterSpacing: '.04em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        width: first ? 220 : 'auto',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <span>{children}</span>
        {actual && (
          <span
            style={{
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: '.1em',
              color: 'var(--signal-soft)',
            }}
          >
            ACT
          </span>
        )}
      </div>
    </th>
  );
}

function SectionRow({ label, tag }: { label: string; tag?: string }) {
  return (
    <tr>
      <td
        colSpan={14}
        style={{
          background: 'var(--paper-2)',
          color: 'var(--ink)',
          padding: '8px 12px',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '.08em',
          borderTop: '1px solid var(--rule)',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        {label}
        {tag && (
          <span
            style={{
              marginLeft: 10,
              fontWeight: 400,
              fontSize: 10,
              letterSpacing: '.06em',
              color: 'var(--ink-3)',
              textTransform: 'none',
              fontStyle: 'italic',
            }}
          >
            {tag}
          </span>
        )}
      </td>
    </tr>
  );
}

function cellStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    padding: '6px 9px',
    textAlign: 'right',
    borderBottom: '1px solid var(--rule)',
    fontFamily: 'var(--font-mono-dash), monospace',
    fontSize: 11,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    ...extra,
  };
}

function labelCellStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    padding: '6px 12px',
    textAlign: 'left',
    borderBottom: '1px solid var(--rule)',
    fontFamily: 'var(--font-inter), system-ui, sans-serif',
    fontSize: 11.5,
    color: 'var(--ink-3)',
    whiteSpace: 'nowrap',
    ...extra,
  };
}

function DataRow({
  label,
  values,
  fy,
  highlight,
  dim,
}: {
  label: string;
  values: number[];
  fy: number;
  highlight?: boolean;
  dim?: boolean;
}) {
  const rowBg = highlight ? 'rgba(200, 90, 58, 0.04)' : dim ? 'rgba(255, 252, 235, 0.5)' : 'transparent';
  return (
    <tr style={{ background: rowBg }}>
      <td style={labelCellStyle({ color: dim ? 'var(--ink-3)' : 'var(--ink-2)' })}>{label}</td>
      {values.map((v, i) => (
        <td key={i} style={cellStyle({ color: v === 0 ? 'var(--ink-4)' : 'var(--ink)', opacity: v === 0 ? 0.5 : 1 })}>
          {v === 0 ? '—' : fmtNum(v)}
        </td>
      ))}
      <td style={cellStyle({ fontWeight: 600, background: highlight ? 'rgba(200, 90, 58, 0.08)' : 'var(--paper-2)' })}>
        {fmtNum(fy)}
      </td>
    </tr>
  );
}

function TotalRow({ label, values, fy }: { label: string; values: number[]; fy: number }) {
  return (
    <tr>
      <td
        style={{
          ...labelCellStyle(),
          background: 'var(--ink)',
          color: 'var(--paper)',
          fontWeight: 600,
        }}
      >
        {label}
      </td>
      {values.map((v, i) => (
        <td
          key={i}
          style={cellStyle({
            background: 'var(--ink)',
            color: 'var(--paper)',
            fontWeight: 600,
          })}
        >
          {fmtNum(v)}
        </td>
      ))}
      <td
        style={cellStyle({
          background: 'var(--ink-2)',
          color: 'var(--paper)',
          fontWeight: 700,
        })}
      >
        {fmtNum(fy)}
      </td>
    </tr>
  );
}

function SubtotalRow({
  label,
  values,
  fy,
}: {
  label: string;
  values: number[];
  fy: number;
  variant?: 'expense';
}) {
  return (
    <tr style={{ background: 'rgba(138, 58, 46, 0.04)' }}>
      <td style={labelCellStyle({ fontWeight: 600, color: 'var(--ink)' })}>{label}</td>
      {values.map((v, i) => (
        <td key={i} style={cellStyle({ color: 'var(--ink)' })}>
          {fmtNum(v)}
        </td>
      ))}
      <td style={cellStyle({ fontWeight: 700, color: 'var(--ink)', background: 'rgba(138, 58, 46, 0.08)' })}>
        {fmtNum(fy)}
      </td>
    </tr>
  );
}

function BottomLineRow({ label, values, fy }: { label: string; values: number[]; fy: number }) {
  return (
    <tr>
      <td
        style={{
          ...labelCellStyle(),
          background: 'var(--ink)',
          color: 'var(--paper)',
          fontWeight: 700,
        }}
      >
        ◆ {label}
      </td>
      {values.map((v, i) => (
        <td
          key={i}
          style={cellStyle({
            background: 'var(--ink)',
            color: v >= 0 ? '#9bd1ad' : '#e0a397',
            fontWeight: 600,
          })}
        >
          {v >= 0 ? fmtNum(v) : `(${fmtNum(Math.abs(v))})`}
        </td>
      ))}
      <td
        style={cellStyle({
          background: 'var(--ink-2)',
          color: fy >= 0 ? '#b6dfc3' : '#ebb5aa',
          fontWeight: 700,
        })}
      >
        {fy >= 0 ? fmtNum(fy) : `(${fmtNum(Math.abs(fy))})`}
      </td>
    </tr>
  );
}

function CumulativeRow({ label, values }: { label: string; values: number[] }) {
  return (
    <tr style={{ background: 'var(--paper)' }}>
      <td
        style={labelCellStyle({
          color: 'var(--ink-4)',
          fontStyle: 'italic',
          fontSize: 10.5,
          borderBottom: 'none',
        })}
      >
        ↳ {label}
      </td>
      {values.map((v, i) => (
        <td
          key={i}
          style={cellStyle({
            color: v >= 0 ? 'var(--positive)' : 'var(--negative)',
            fontStyle: 'italic',
            fontSize: 10.5,
            opacity: 0.85,
            borderBottom: 'none',
          })}
        >
          {v >= 0 ? fmtNum(v) : `(${fmtNum(Math.abs(v))})`}
        </td>
      ))}
      <td style={cellStyle({ borderBottom: 'none', background: 'var(--paper)' })}></td>
    </tr>
  );
}
