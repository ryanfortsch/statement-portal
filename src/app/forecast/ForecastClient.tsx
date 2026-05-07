'use client';

import { useMemo, useState } from 'react';
import {
  calcYear,
  getYearConfig,
  fmtDollar,
  fmtNum,
  MONTH_LABELS,
  type ForecastYear,
  type YearResult,
} from '@/lib/forecast-model';
import {
  ACTUALS_2026,
  ACTUALS_2026_THROUGH_MONTH,
} from '@/lib/forecast-actuals';
import type { SmartForecast } from '@/lib/forecast-smart';

type Props = {
  smart2026: SmartForecast | null;
  smart2027: SmartForecast | null;
  smart2028: SmartForecast | null;
};

export function ForecastClient({ smart2026, smart2027, smart2028 }: Props) {
  // Independent per-year state. Earlier years' additions roll forward as
  // full-year actives in later years; the slider for each year only
  // controls THAT year's incremental adds.
  const [numNew2026, setNumNew2026] = useState<number>(3);
  const [numNew2027, setNumNew2027] = useState<number>(3);
  const [numNew2028, setNumNew2028] = useState<number>(3);
  const [yearKey, setYearKey] = useState<ForecastYear>(2026);

  // The slider value that drives this year's calc.
  const numNew =
    yearKey === 2026 ? numNew2026 :
    yearKey === 2027 ? numNew2027 :
    numNew2028;
  const setNumNew =
    yearKey === 2026 ? setNumNew2026 :
    yearKey === 2027 ? setNumNew2027 :
    setNumNew2028;

  // Properties added in PRIOR years that should roll forward as full-year
  // actives this year.
  const rolledForward =
    yearKey === 2026 ? 0 :
    yearKey === 2027 ? numNew2026 :
    /* 2028 */ numNew2026 + numNew2027;

  const yearConfig = useMemo(
    () => getYearConfig(yearKey, rolledForward),
    [yearKey, rolledForward]
  );
  // Substitute bank-derived actuals for completed 2026 months (Jan-Apr).
  // 2027 is fully projected.
  const actualsForYear = yearKey === 2026 ? ACTUALS_2026 : undefined;
  const actualsThrough = yearKey === 2026 ? ACTUALS_2026_THROUGH_MONTH : undefined;

  // Smart Forecast → forward-month override map (month-of-year → mgmt fee).
  // Sums projected RT mgmt fee across all properties for each forward month.
  const smartOverride = useMemo(() => {
    const data =
      yearKey === 2026 ? smart2026 :
      yearKey === 2027 ? smart2027 :
      smart2028;
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
  }, [smart2026, smart2027, smart2028, yearKey]);

  /**
   * Calibration factor for 2027: ratio of (2026's actual+smart total)
   * to (2026's seasonality-only total) for rev_current. Captures the
   * "conservative contracted fees vs reality" gap and forwards it.
   *
   * For 2026 itself this is undefined — the year already gets calibrated
   * directly via smart override on a per-month basis.
   */
  const smart2026OverrideForCalibration = useMemo(() => {
    if (!smart2026) return undefined;
    const map = new Map<number, number>();
    for (const ym of smart2026.months) {
      const [y, m] = ym.split('-').map((s) => parseInt(s, 10));
      if (y !== 2026) continue;
      let total = 0;
      for (const p of smart2026.properties) {
        const cell = p.monthly.find((c) => c.month === ym);
        if (cell) total += cell.projectedMgmtFee;
      }
      if (total > 0) map.set(m, total);
    }
    return map;
  }, [smart2026]);

  const calibrationFactor = useMemo(() => {
    if (yearKey === 2026) return undefined; // 2026 calibrates per-month via smart override directly
    // With smart override → calibrated 2026 rev_current
    const calibrated = calcYear(0, 2026, ACTUALS_2026, ACTUALS_2026_THROUGH_MONTH, smart2026OverrideForCalibration);
    // Without smart override → seasonality-only 2026 rev_current
    const heuristic = calcYear(0, 2026, ACTUALS_2026, ACTUALS_2026_THROUGH_MONTH, undefined);
    if (heuristic.totals.rev_current <= 0) return undefined;
    const factor = calibrated.totals.rev_current / heuristic.totals.rev_current;
    // Sanity bounds — never less than 1 (don't project DOWN), and cap at
    // 3× to guard against weird inputs.
    return Math.min(3, Math.max(1, factor));
  }, [yearKey, smart2026OverrideForCalibration]);

  const year = useMemo(
    () => calcYear(numNew, yearKey, actualsForYear, actualsThrough, smartOverride, calibrationFactor, rolledForward),
    [numNew, yearKey, actualsForYear, actualsThrough, smartOverride, calibrationFactor, rolledForward]
  );

  /** Switch year. Per-year slider state is independent so no clamping needed. */
  const setYearKeyClamped = (y: ForecastYear) => {
    setYearKey(y);
  };

  const springTrough = Math.min(...year.cumulative.slice(0, 6), 0);
  const posMonths = year.monthly.filter((r) => r.net_business > 0);
  // Total managed = current properties + presigned in this year + N new
  const totalManaged = yearConfig.current.length + yearConfig.presigned.length + numNew;

  return (
    <>
      <ScenarioControl
        yearKey={yearKey}
        setYearKey={setYearKeyClamped}
        numNew2026={numNew2026}
        setNumNew2026={setNumNew2026}
        numNew2027={numNew2027}
        setNumNew2027={setNumNew2027}
        numNew2028={numNew2028}
        setNumNew2028={setNumNew2028}
      />

      {/* Headline metrics */}
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 28, width: '100%' }}
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
      </section>

      {/* Monthly P&L — the centerpiece */}
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 32, width: '100%' }}
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

      {/* Per-property forward booking detail */}
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 32, width: '100%' }}
      >
        <SectionTitle
          title="Per-property forecast"
          tag="forward bookings × Gloucester pacing × per-property fee %"
        />
        <SmartForecastPanel
          data={
            yearKey === 2026 ? smart2026 :
            yearKey === 2027 ? smart2027 :
            smart2028
          }
        />
      </section>

      {/* Notes & Methodology — single bottom block */}
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 64, width: '100%' }}
      >
        <SectionTitle title="Notes & Methodology" tag={`assumptions for ${yearKey}`} />
        <Assumptions yearKey={yearKey} />
      </section>

      <style jsx>{`
        @media (max-width: 720px) {
          .rt-forecast-kpi {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
      `}</style>
    </>
  );
}

function SmartForecastPanel({ data }: { data: SmartForecast | null }) {
  // All values shown with cents — no rounding in financials.
  const fmtUsd = (n: number) =>
    n === 0
      ? '—'
      : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // Same as fmtUsd; alias kept for the FY/portfolio total cells.
  const fmtUsdCents = fmtUsd;

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
                {mi.pacingPct.toFixed(1)}% / {mi.historicalAvgPct.toFixed(1)}%
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
    { label: 'Insurance', value: 'Phillips $5,263.92 paid as a lump sum in March; $0 every other month' },
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
    { label: 'Insurance', value: 'Phillips ~$5,264 lump sum in March (annual renewal); $0 every other month' },
    { label: 'Accounting', value: '$0 (no recurring engagement)' },
    { label: 'Bank fees', value: '$100/mo' },
    { label: 'Operating CC', value: '$5,900/mo (carried over from 2026 actuals — needs re-calibration with 2026 actual data once the year is closed)' },
    { label: 'Hire continues', value: '$5,000/mo all year ($60K) — assumes the Oct 2026 hire stays' },
    { label: 'Onboarding', value: '$3,000 one-time per new contract' },
    { label: 'Excludes', value: 'RT-owned units, personal draw, healthcare, taxes, capex, distributions' },
  ];
  const items2028: Array<{ label: string; value: string }> = [
    { label: 'Active portfolio (Jan 1)', value: '14 properties from 2027 baseline + everything added 2026/2027 rolled forward as full-year actives' },
    { label: 'New mandates', value: '$25K/yr each, default 3 sprinkled Mar · Jun · Sep' },
    { label: 'Office', value: '$750/mo rent all year + $50/mo dumpster' },
    { label: 'Software / SaaS', value: '$200/mo' },
    { label: 'MH Partners (bookkeeper)', value: '$0 — long retired' },
    { label: 'Insurance', value: 'Phillips ~$5,264 lump in March' },
    { label: 'Accounting', value: '$0' },
    { label: 'Bank fees', value: '$100/mo' },
    { label: 'Operating CC', value: '$5,900/mo (still using 2026-calibrated value; revisit when 2026/2027 actuals are closed)' },
    { label: 'Hire continues', value: '$5,000/mo all year ($60K)' },
    { label: 'Onboarding', value: '$3,000 one-time per new contract' },
    { label: 'Excludes', value: 'RT-owned units, personal draw, healthcare, taxes, capex, distributions' },
  ];
  const items =
    yearKey === 2026 ? items2026 :
    yearKey === 2027 ? items2027 :
    items2028;
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
  yearKey,
  setYearKey,
  numNew2026,
  setNumNew2026,
  numNew2027,
  setNumNew2027,
  numNew2028,
  setNumNew2028,
}: {
  yearKey: ForecastYear;
  setYearKey: (y: ForecastYear) => void;
  numNew2026: number;
  setNumNew2026: (n: number) => void;
  numNew2027: number;
  setNumNew2027: (n: number) => void;
  numNew2028: number;
  setNumNew2028: (n: number) => void;
}) {
  // Show prior-year sliders too — earlier additions roll forward as
  // full-year actives, and the user often wants to dial them in alongside
  // the current year's adds.
  const showRow2027 = yearKey === 2027 || yearKey === 2028;
  const showRow2028 = yearKey === 2028;
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
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Year toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
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
            <YearTab year={2028} active={yearKey === 2028} onClick={() => setYearKey(2028)} />
          </div>
        </div>

        {/* Sliders — current year + any prior years */}
        <NumNewRow
          year={2026}
          n={numNew2026}
          setN={setNumNew2026}
          newOrder={getYearConfig(2026).newOrder}
          isActiveYear={yearKey === 2026}
          subLabel="beyond 9 current + 5 pre-signed"
        />
        {showRow2027 && (
          <NumNewRow
            year={2027}
            n={numNew2027}
            setN={setNumNew2027}
            newOrder={getYearConfig(2027).newOrder}
            isActiveYear={yearKey === 2027}
            subLabel={`beyond 14 active + ${numNew2026} rolled fwd`}
          />
        )}
        {showRow2028 && (
          <NumNewRow
            year={2028}
            n={numNew2028}
            setN={setNumNew2028}
            newOrder={getYearConfig(2028).newOrder}
            isActiveYear={yearKey === 2028}
            subLabel={`beyond 14 active + ${numNew2026 + numNew2027} rolled fwd`}
          />
        )}
      </div>
    </section>
  );
}

/** One row in the dark control bar: a labeled slider + stepper for a year. */
function NumNewRow({
  year,
  n,
  setN,
  newOrder,
  isActiveYear,
  subLabel,
}: {
  year: ForecastYear;
  n: number;
  setN: (n: number) => void;
  newOrder: readonly number[];
  isActiveYear: boolean;
  subLabel: string;
}) {
  const startMonths =
    n === 0
      ? 'no new'
      : newOrder.slice(0, n).map((mm) => MONTH_LABELS[mm - 1]).join(', ');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        flexWrap: 'wrap',
        opacity: isActiveYear ? 1 : 0.78,
        borderLeft: isActiveYear ? '3px solid var(--signal)' : '3px solid transparent',
        paddingLeft: 12,
        marginLeft: -15,
      }}
    >
      <div style={{ flex: '0 0 auto', minWidth: 140 }}>
        <div
          className="font-mono"
          style={{
            fontSize: 10,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: isActiveYear ? 'var(--paper-2)' : 'var(--ink-4)',
          }}
        >
          New in {year}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--paper-2)', opacity: 0.6 }}>
          {subLabel}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={() => setN(Math.max(0, n - 1))}
          aria-label={`Decrease new properties in ${year}`}
          style={stepperStyle}
        >
          −
        </button>
        <div
          className="font-serif tabular-nums"
          style={{
            fontSize: 28,
            minWidth: 36,
            textAlign: 'center',
            color: 'var(--paper)',
            lineHeight: 1,
          }}
        >
          {n}
        </div>
        <button
          type="button"
          onClick={() => setN(Math.min(newOrder.length, n + 1))}
          aria-label={`Increase new properties in ${year}`}
          style={stepperStyle}
        >
          +
        </button>
      </div>

      <input
        type="range"
        min={0}
        max={newOrder.length}
        value={n}
        onChange={(e) => setN(+e.target.value)}
        aria-label={`Number of new properties in ${year}`}
        style={{
          flex: '1 1 180px',
          maxWidth: 280,
          accentColor: 'var(--signal)',
        }}
      />

      <div
        className="font-mono"
        style={{
          fontSize: 10.5,
          color: 'var(--paper-2)',
          opacity: 0.7,
          letterSpacing: '.04em',
        }}
      >
        {n > 0 ? `→ ${startMonths}` : startMonths}
      </div>
    </div>
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

/** Precise USD with cents for inline KPI sub-text. */
function fmtCompactSimple(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  const currentLabel = yearKey === 2026 ? `Current 9` : `Active ${currentCount}`;
  const currentInfo =
    yearKey === 2026
      ? 'Past months (Jan-Apr) are bank actuals from Chase ...5130. Forward months use the Smart Forecast: real Guesty bookings × Gloucester pacing multiplier × each property\'s actual mgmt fee %. Falls back to seasonality if Guesty data is unavailable.'
      : `${currentCount} active properties full year (the original 9 + 5 ex-presigned + any rolled forward from prior years). Each month uses Smart Forecast where Guesty has bookings; otherwise seasonality scaled by the 2026 calibration factor (the smart-vs-heuristic gap learned from 2026) so future years reflect what the listings actually earn, not the conservative contracted fees.`;
  const presignedLabel = 'Pre-signed 5';
  const presignedInfo =
    'Five contracts signed but not yet onboarded: Pre-signed #1, #2, #3, 79 Main Street, 16 Waterman. Two go live in May, three in June. Uses seasonality projection because they are not yet listed in Guesty.';

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
        <DataRow label={currentLabel} info={currentInfo} values={monthly.map((r) => r.rev_current)} fy={totals.rev_current} />
        {presignedCount > 0 && (
          <DataRow label={presignedLabel} info={presignedInfo} values={monthly.map((r) => r.rev_presigned)} fy={totals.rev_presigned} />
        )}
        <DataRow
          label="New"
          info="Hypothetical new contracts added via the slider above. Uses Cape Ann seasonality at $25K/yr per property assumption. Each onboarding triggers a $3K cost in its start month."
          values={monthly.map((r) => r.rev_new)}
          fy={totals.rev_new}
          highlight
        />
        <TotalRow label="Total revenue" values={monthly.map((r) => r.rev_total)} fy={totals.rev_total} />

        <SectionRow label="Expenses" tag="grouped & sorted by size · calibrated to Chase ...5130 actuals" />

        <SubsectionRow label="Recurring monthly" />
        <DataRow
          label="Operating CC"
          info="Monthly Chase ...3878 credit-card payment. Median $5,900/mo over the trailing 12 months (range $3K-$16K). Covers software, supplies, marketing, and some property-level pass-through. Decomposing the CC statement would sharpen this further."
          values={monthly.map((r) => r.exp_cc_ops)}
          fy={monthly.reduce((a, r) => a + r.exp_cc_ops, 0)}
        />
        <DataRow
          label="Office"
          info="$750/mo rent at 85 Eastern Ave + $50/mo dumpster (flat year-round). Lease started March 2026."
          values={monthly.map((r) => r.exp_office)}
          fy={monthly.reduce((a, r) => a + r.exp_office, 0)}
        />
        <DataRow
          label="Software"
          info="$200/mo — Gusto payroll fee plus a buffer for AppFolio/Hospitable/other SaaS that lives on the operating CC."
          values={monthly.map((r) => r.exp_software)}
          fy={monthly.reduce((a, r) => a + r.exp_software, 0)}
        />
        <DataRow
          label="Bank fees"
          info="Stop payments, monthly service charges, returned-check fees. Trailing 12-mo actuals averaged ~$112/mo."
          values={monthly.map((r) => r.exp_bank)}
          fy={monthly.reduce((a, r) => a + r.exp_bank, 0)}
        />

        <SubsectionRow label="People & onboarding" />
        <DataRow
          label="New hire"
          info="$5,000/mo from October 2026 forward (full year in 2027 = $60K). Replaces the Maggie Butler weekly Zelle and the bi-weekly Gusto runs that ran through Q3 2025."
          values={monthly.map((r) => r.exp_hire)}
          fy={monthly.reduce((a, r) => a + r.exp_hire, 0)}
        />
        <DataRow
          label="Onboarding · presigned"
          info="$3,000 one-time per pre-signed contract, paid the month it goes live. Five contracts in 2026 (two in May, three in June) = $15K total. Zero in 2027 — those properties are already onboarded."
          values={monthly.map((r) => r.exp_onboard_presigned)}
          fy={monthly.reduce((a, r) => a + r.exp_onboard_presigned, 0)}
        />
        <DataRow
          label="Onboarding · new"
          info="$3,000 one-time per new contract added via the slider, paid its start month."
          values={monthly.map((r) => r.exp_onboard_new)}
          fy={monthly.reduce((a, r) => a + r.exp_onboard_new, 0)}
          highlight
        />

        <SubsectionRow label="Periodic & wind-down" />
        <DataRow
          label="Bookkeeper"
          info="MH Partners outside bookkeeper. ~$1,000/mo Jan-Apr 2026, $1,800 final wrap-up payment in May, then $0 — engagement ends."
          values={monthly.map((r) => r.exp_debt)}
          fy={monthly.reduce((a, r) => a + r.exp_debt, 0)}
        />
        <DataRow
          label="Insurance"
          info="Phillips Insurance annual policy paid as one lump sum in March. $5,263.92 in 2026; same renewal assumed for 2027."
          values={monthly.map((r) => r.exp_insurance)}
          fy={monthly.reduce((a, r) => a + r.exp_insurance, 0)}
        />
        <DataRow
          label="Accounting"
          info="MS Consultants $4,442.96 paid 4/15/2026 was a one-time engagement, not recurring. $0 going forward."
          values={monthly.map((r) => r.exp_accounting)}
          fy={monthly.reduce((a, r) => a + r.exp_accounting, 0)}
        />
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

/**
 * Lightweight subsection header inside a section. Smaller, indented,
 * smaller-caps. Used to group expense lines (recurring / people / lumpy).
 */
function SubsectionRow({ label }: { label: string }) {
  return (
    <tr>
      <td
        colSpan={14}
        style={{
          padding: '6px 12px 4px 22px',
          fontSize: 9.5,
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '.16em',
          color: 'var(--ink-4)',
          background: 'transparent',
          borderTop: '1px dotted var(--rule)',
        }}
      >
        {label}
      </td>
    </tr>
  );
}

/** Top-level section heading. Sans-serif uppercase letter-spaced — corporate. */
function SectionTitle({ title, tag }: { title: string; tag?: string }) {
  return (
    <div
      className="rule-bottom"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 14,
        paddingBottom: 8,
        marginBottom: 4,
      }}
    >
      <h2
        style={{
          fontFamily: 'var(--font-inter), system-ui, sans-serif',
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
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
  info,
  values,
  fy,
  highlight,
  dim,
}: {
  label: string;
  info?: string;
  values: number[];
  fy: number;
  highlight?: boolean;
  dim?: boolean;
}) {
  const rowBg = highlight ? 'rgba(200, 90, 58, 0.04)' : dim ? 'rgba(255, 252, 235, 0.5)' : 'transparent';
  return (
    <tr style={{ background: rowBg }}>
      <td style={labelCellStyle({ color: dim ? 'var(--ink-3)' : 'var(--ink-2)' })}>
        {label}
        {info && <InfoIcon text={info} />}
      </td>
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

/**
 * Small "ⓘ" icon next to a row label. Hover reveals a styled popover.
 * Pure CSS — no JS state, no positioning libraries.
 */
function InfoIcon({ text }: { text: string }) {
  return (
    <span className="rt-info-icon" aria-label={text}>
      <span className="rt-info-glyph">ⓘ</span>
      <span className="rt-info-pop" role="tooltip">{text}</span>
    </span>
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
