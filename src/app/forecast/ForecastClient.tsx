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
import type { ProspectForecast } from '@/lib/forecast-prospects';
import type { StatementRevenueByMonth } from '@/lib/forecast-statement-actuals';

type Props = {
  smart2026: SmartForecast | null;
  smart2027: SmartForecast | null;
  smart2028: SmartForecast | null;
  prospects2026: ProspectForecast;
  prospects2027: ProspectForecast;
  prospects2028: ProspectForecast;
  /** Map keyed by YYYY-MM → total mgmt fee from property_statements. */
  statementRevenue: StatementRevenueByMonth;
};

export function ForecastClient({
  smart2026,
  smart2027,
  smart2028,
  prospects2026,
  prospects2027,
  prospects2028,
  statementRevenue,
}: Props) {
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

  const prospectsForYear =
    yearKey === 2026 ? prospects2026 :
    yearKey === 2027 ? prospects2027 :
    prospects2028;

  // Per-year statement actuals: month-of-year → mgmt fee. Only months
  // that have at least one reconciled property_statements row are present.
  const statementByMonthForYear = useMemo(() => {
    const map = new Map<number, number>();
    for (const [ym, value] of Object.entries(statementRevenue)) {
      const [y, m] = ym.split('-').map((s) => parseInt(s, 10));
      if (y === yearKey && value > 0) {
        map.set(m, value);
      }
    }
    return map;
  }, [statementRevenue, yearKey]);

  const year = useMemo(
    () => calcYear(
      numNew, yearKey, actualsForYear, actualsThrough, smartOverride,
      calibrationFactor, rolledForward, prospectsForYear.monthlyExpectedTotals,
      statementByMonthForYear,
    ),
    [numNew, yearKey, actualsForYear, actualsThrough, smartOverride, calibrationFactor, rolledForward, prospectsForYear, statementByMonthForYear]
  );

  /** Switch year. Per-year slider state is independent so no clamping needed. */
  const setYearKeyClamped = (y: ForecastYear) => {
    setYearKey(y);
  };

  const springTrough = Math.min(...year.cumulative.slice(0, 6), 0);
  // Total managed = current properties + prospects in this year + N new
  const totalManaged = yearConfig.current.length + prospectsForYear.totals.count + numNew;

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
        prospectsCount2026={prospects2026.totals.count}
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
          yearKey={yearKey}
          currentCount={yearConfig.current.length}
          prospectsCount={prospectsForYear.totals.count}
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
          <ForecastTable year={year} yearKey={yearKey} currentCount={yearConfig.current.length} />
        </div>
      </section>

      {/* Per-property forward booking detail */}
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 32, width: '100%' }}
      >
        <SectionTitle
          title="Mgmt fee · per property"
          tag="what RT actually keeps · per property × per month"
        />
        <SmartForecastPanel
          data={
            yearKey === 2026 ? smart2026 :
            yearKey === 2027 ? smart2027 :
            smart2028
          }
        />
      </section>

      {/* Prospect pipeline panel — what's in flight + each prospect's weighted contribution */}
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 32, width: '100%' }}
      >
        <SectionTitle
          title={`Prospect pipeline · ${yearKey}`}
          tag={`${prospectsForYear.totals.count} prospect${prospectsForYear.totals.count === 1 ? '' : 's'} · owner payout shown for prospects · RT mgmt fee weighted by close %`}
        />
        <ProspectsPanel data={prospectsForYear} yearKey={yearKey} />
      </section>

      {/* Notes & Methodology — collapsible bottom block */}
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 64, width: '100%' }}
      >
        <details
          style={{
            border: '1px solid var(--rule)',
            background: 'var(--paper)',
          }}
        >
          <summary
            style={{
              padding: '12px 16px',
              cursor: 'pointer',
              fontFamily: 'var(--font-inter), system-ui, sans-serif',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              color: 'var(--ink)',
              borderBottom: '1px solid var(--rule)',
              userSelect: 'none',
            }}
          >
            Notes & Methodology
            <span
              className="eyebrow"
              style={{ marginLeft: 12, letterSpacing: '.16em', fontWeight: 500 }}
            >
              assumptions for {yearKey}
            </span>
          </summary>
          <Assumptions yearKey={yearKey} />
        </details>
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
  // Whole dollars throughout — round to nearest dollar.
  const fmtUsd = (n: number) =>
    n === 0
      ? '—'
      : `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  // Alias kept for the FY/portfolio total cells.
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
            <Th totals>FY total</Th>
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

          <SectionRow
            label="Management fee · per property"
            tag="property's booked revenue × pacing-up multiplier × that property's mgmt fee %"
          />
          {data.properties.map((p) => (
            <tr key={`fee-${p.property.id}`} style={{ background: 'rgba(58, 107, 74, 0.03)' }}>
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
        Per property × per month, the projection takes the larger of:
        (a) <em>Pacing scale-up</em> — booked Guesty revenue × (Gloucester historical
        occupancy ÷ portfolio pacing for that month, floored at 1×); or
        (b) <em>Per-property fallback</em> — the property&apos;s revenue for the same
        month-of-year last year (from Guesty trailing 365), falling back to its
        annualized total × Gloucester seasonality share when last-year data is
        missing. Self-corrects to each property&apos;s real revenue seasonality
        (ADR + occupancy baked in), so properties with no October bookings yet
        still project a realistic October number.
        The mgmt fee column is gross × that property&apos;s fee %.
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

type AssumptionItem = { label: string; value: string };
type AssumptionSection = { heading: string; items: AssumptionItem[] };

/**
 * Live Prospects pipeline panel — one row per prospect. Owner payout (what
 * the prospect's deck shows them) sits next to RT mgmt fee (what RT keeps),
 * and the weighted column folds in close_likelihood_pct to give the
 * expected-value contribution that flows into the Monthly Detail table.
 */
function ProspectsPanel({
  data,
  yearKey,
}: {
  data: ProspectForecast;
  yearKey: ForecastYear;
}) {
  if (data.prospects.length === 0) {
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
        No active prospects in Helm. Add prospects via /prospects to feed the forecast.
      </div>
    );
  }

  const sorted = [...data.prospects].sort(
    (a, b) => b.annualExpectedMgmtFee - a.annualExpectedMgmtFee
  );

  const fmtPct = (n: number) => `${Math.round(n * 100)}%`;
  const fmtUsd = (n: number) =>
    `$${Math.round(n).toLocaleString('en-US')}`;

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
            <th style={pcThStyle('left', 220)}>Prospect</th>
            <th style={pcThStyle('left', 80)}>Market</th>
            <th style={pcThStyle('right', 90)}>Fee %</th>
            <th style={pcThStyle('right', 110)}>Close %</th>
            <th style={pcThStyle('right', 150)}>Owner payout (Y1)</th>
            <th style={pcThStyle('right', 140)}>RT mgmt fee · Y1</th>
            <th style={pcThStyle('right', 150)}>Weighted · {yearKey}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.prospectId}>
              <td style={pcCellStyle({ fontWeight: 500, color: 'var(--ink-2)', textAlign: 'left' })}>
                {p.name}
                {p.isClosed && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: '.1em',
                      color: 'var(--positive)',
                    }}
                  >
                    SIGNED
                  </span>
                )}
              </td>
              <td style={pcCellStyle({ color: 'var(--ink-3)', textAlign: 'left', fontSize: 11 })}>
                {p.market} · {p.bedrooms}BR
              </td>
              <td style={pcCellStyle({ color: 'var(--signal)', fontWeight: 600 })}>
                {fmtPct(p.mgmtFeePct)}
              </td>
              <td
                style={pcCellStyle({
                  color: p.closeProbability >= 0.66
                    ? 'var(--positive)'
                    : p.closeProbability <= 0.33
                    ? 'var(--ink-4)'
                    : 'var(--ink-3)',
                  fontWeight: 600,
                })}
              >
                {fmtPct(p.closeProbability)}
              </td>
              <td
                style={pcCellStyle({
                  fontFamily: 'var(--font-mono-dash), monospace',
                  color: 'var(--ink-2)',
                })}
              >
                {fmtUsd(p.ownerPayoutLow)}–{fmtUsd(p.ownerPayoutHigh)}
              </td>
              <td
                style={pcCellStyle({
                  fontFamily: 'var(--font-mono-dash), monospace',
                  color: 'var(--ink-3)',
                })}
              >
                {fmtUsd(p.annualMgmtFee)}
              </td>
              <td
                style={pcCellStyle({
                  fontFamily: 'var(--font-mono-dash), monospace',
                  color: 'var(--positive)',
                  fontWeight: 700,
                  background: 'rgba(58, 107, 74, 0.06)',
                })}
              >
                {fmtUsd(p.annualExpectedMgmtFee)}
              </td>
            </tr>
          ))}
          <tr>
            <td
              style={pcCellStyle({
                background: 'var(--ink)',
                color: 'var(--paper)',
                fontWeight: 700,
                textAlign: 'left',
              })}
              colSpan={6}
            >
              ◆ Pipeline total ({sorted.length} prospect{sorted.length === 1 ? '' : 's'})
            </td>
            <td
              style={pcCellStyle({
                background: 'var(--ink-2)',
                color: '#9bd1ad',
                fontWeight: 700,
                fontFamily: 'var(--font-mono-dash), monospace',
              })}
            >
              {fmtUsd(data.totals.expectedMgmtFee)}
            </td>
          </tr>
        </tbody>
      </table>
      <div
        style={{
          padding: '10px 16px',
          fontSize: 11,
          lineHeight: 1.55,
          color: 'var(--ink-3)',
          borderTop: '1px solid var(--rule)',
          background: 'var(--paper-2)',
        }}
      >
        <strong style={{ color: 'var(--ink-2)' }}>How weighting works:</strong>{' '}
        Each prospect&apos;s RT mgmt fee comes from their projection deck (home value × tier
        rate blended with AirDNA 3-yr average, × their mgmt-fee % rate). The weighted column
        multiplies by <code>close_likelihood_pct</code> (null defaults to 50%). Sum of the
        weighted column feeds the &ldquo;Prospects (weighted)&rdquo; row in the Monthly
        Detail table above.
      </div>
    </div>
  );
}

function pcThStyle(align: 'left' | 'right', width?: number): React.CSSProperties {
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

function pcCellStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    padding: '8px 12px',
    borderBottom: '1px solid var(--rule)',
    fontVariantNumeric: 'tabular-nums',
    verticalAlign: 'middle',
    textAlign: 'right',
    ...extra,
  };
}

function Assumptions({ yearKey }: { yearKey: ForecastYear }) {
  const sections =
    yearKey === 2026 ? sections2026 :
    yearKey === 2027 ? sections2027 :
    sections2028;

  return (
    <div
      style={{
        marginTop: 14,
        border: '1px solid var(--rule)',
        background: 'var(--paper)',
      }}
    >
      {sections.map((sec, si) => (
        <div key={sec.heading}>
          <div
            style={{
              padding: '10px 18px 6px',
              fontSize: 10,
              fontFamily: 'var(--font-inter), system-ui, sans-serif',
              fontWeight: 600,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              borderTop: si === 0 ? 'none' : '1px solid var(--rule)',
              background: 'var(--paper-2)',
            }}
          >
            {sec.heading}
          </div>
          {sec.items.map((it, i) => (
            <div
              key={it.label}
              style={{
                display: 'grid',
                gridTemplateColumns: '200px 1fr',
                gap: 24,
                padding: '10px 18px',
                borderBottom: i === sec.items.length - 1 ? 'none' : '1px dotted var(--rule)',
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
      ))}
    </div>
  );
}

const sections2026: AssumptionSection[] = [
  {
    heading: 'Portfolio',
    items: [
      { label: 'Current 9', value: 'Already managed as of Jan 2026 (annual fees $18.7K-$44K each)' },
      { label: 'Pre-signed 5', value: '$25K/yr each. 2 onboard May (Pre-signed #1 + 79 Main), 3 onboard June (Pre-signed #2/#3 + 16 Waterman). Use seasonality projection until they appear in Guesty.' },
      { label: 'New mandates', value: '$25K/yr each, Cape Ann seasonality. Default 3 sprinkled Jul · Sep · Nov via slider.' },
    ],
  },
  {
    heading: 'Recurring monthly',
    items: [
      { label: 'Office', value: '$750/mo rent + $50/mo dumpster = $800/mo' },
      { label: 'Software', value: '$200/mo (Gusto + buffer for AppFolio/Hospitable on the CC)' },
      { label: 'Bank fees', value: '$100/mo (stop payments, service fees, returned checks)' },
      { label: 'Operating CC', value: '$5,900/mo baseline at 9 active props. Scales 0.5× elasticity to active count.' },
    ],
  },
  {
    heading: 'Step changes & triggers',
    items: [
      { label: 'Mar 2026', value: 'Office costs begin. Lease started March 2026; before that the line is $0.' },
      { label: 'May 2026', value: 'Pre-signed onboardings: 2 contracts × $4K = $8K spike. Bookkeeper final wrap-up payment $1,800 (above the regular $1K).' },
      { label: 'Jun 2026', value: 'Pre-signed onboardings: 3 contracts × $4K = $12K spike. Bookkeeper drops to $0 (engagement ends).' },
      { label: 'Aug 2026', value: 'First hire begins at $5,000/mo.' },
      { label: 'When active ≥ 20', value: 'Second hire auto-triggers ($5K/mo more). Step function: month-by-month based on active count = current 9 + presigned + new started so far.' },
      { label: 'Each new month', value: '$4K onboarding charged. Property starts contributing revenue from that month forward.' },
      { label: 'CC scaling per month', value: 'CC = $5,900 × (1 + 0.5 × (active_count − 9) / 9). Examples: 14 active = $7,539/mo, 17 active = $8,194/mo, 20 active = $9,506/mo.' },
    ],
  },
  {
    heading: 'Periodic & one-time',
    items: [
      { label: 'Mar 2026', value: 'Phillips Insurance annual lump sum: $5,263.92 paid 03/02. $0 in every other month.' },
      { label: 'Apr 2026', value: 'MS Consultants one-time accounting engagement: $4,442.96 paid 04/15. Not recurring; $0 going forward.' },
    ],
  },
  {
    heading: 'Out of scope',
    items: [
      { label: 'Excluded', value: 'RT-owned units (3 Locust, Lighthouse Point, 65 Calderwood), personal owner draw, healthcare premium (paid from biz account but treated as personal), ATM/debit-card personal, federal/state taxes, capex, distributions.' },
    ],
  },
];

const sections2027: AssumptionSection[] = [
  {
    heading: 'Portfolio',
    items: [
      { label: 'Active (Jan 1)', value: '14 properties full-year: 9 original + 5 ex-presigned (incl. 79 Main, 16 Waterman) + however many new were added in 2026, all rolled forward as $25K/yr CA contracts.' },
      { label: 'New mandates', value: '$25K/yr each. Default 3 sprinkled Mar · Jun · Sep via slider.' },
    ],
  },
  {
    heading: 'Recurring monthly',
    items: [
      { label: 'Office', value: '$750/mo rent + $50/mo dumpster = $800/mo, full year' },
      { label: 'Software', value: '$200/mo' },
      { label: 'Bank fees', value: '$100/mo' },
      { label: 'Operating CC', value: '$5,900/mo baseline. Scales 0.5× with active count.' },
      { label: 'Hire', value: '$5,000/mo all year (Aug 2026 hire continues = $60K full year).' },
    ],
  },
  {
    heading: 'Step changes & triggers',
    items: [
      { label: 'When active ≥ 20', value: 'Second hire auto-triggers ($5K/mo more). With default scenarios (14 baseline + 3 rolled fwd from 2026 + 3 in 2027), portfolio crosses 20 in September 2027.' },
      { label: 'Each new month', value: '$4K onboarding charged. Adds to active count and bumps CC line.' },
      { label: 'CC scaling per month', value: '$5,900 × (1 + 0.5 × (active − 9) / 9). With 17-20+ active properties most of the year, CC runs $8K-$10K/mo.' },
    ],
  },
  {
    heading: 'Periodic & wind-down',
    items: [
      { label: 'Mar 2027', value: 'Phillips Insurance lump renewal (~$5,264, same as 2026 assumption).' },
      { label: 'Bookkeeper', value: '$0 — engagement ended May 2026.' },
      { label: 'Accounting', value: '$0 — MS Consultants was a one-time engagement.' },
    ],
  },
  {
    heading: 'Out of scope',
    items: [
      { label: 'Excluded', value: 'RT-owned units, personal draw, healthcare, taxes, capex, distributions.' },
    ],
  },
];

const sections2028: AssumptionSection[] = [
  {
    heading: 'Portfolio',
    items: [
      { label: 'Active (Jan 1)', value: '14 baseline properties + everything added in 2026 + everything added in 2027, all rolled forward as full-year $25K/yr CA contracts.' },
      { label: 'New mandates', value: '$25K/yr each. Default 3 sprinkled Mar · Jun · Sep via slider.' },
    ],
  },
  {
    heading: 'Recurring monthly',
    items: [
      { label: 'Office', value: '$800/mo (rent + dumpster), full year' },
      { label: 'Software', value: '$200/mo' },
      { label: 'Bank fees', value: '$100/mo' },
      { label: 'Operating CC', value: '$5,900/mo baseline. Scales 0.5× with active count. Likely $9K-$11K/mo at this portfolio size.' },
      { label: 'Hire', value: '$5,000/mo per hire all year. Second hire active throughout if portfolio is already over 20 props (very likely with rollovers).' },
    ],
  },
  {
    heading: 'Step changes & triggers',
    items: [
      { label: 'Each new month', value: '$4K onboarding charged.' },
      { label: 'CC scaling per month', value: 'Continuous: $5,900 × (1 + 0.5 × (active − 9) / 9).' },
    ],
  },
  {
    heading: 'Periodic',
    items: [
      { label: 'Mar 2028', value: 'Phillips Insurance lump renewal (~$5,264).' },
      { label: 'Bookkeeper / Accounting', value: '$0' },
    ],
  },
  {
    heading: 'Out of scope',
    items: [
      { label: 'Excluded', value: 'RT-owned units, personal draw, healthcare, taxes, capex, distributions.' },
    ],
  },
];

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
  prospectsCount2026,
}: {
  yearKey: ForecastYear;
  setYearKey: (y: ForecastYear) => void;
  numNew2026: number;
  setNumNew2026: (n: number) => void;
  numNew2027: number;
  setNumNew2027: (n: number) => void;
  numNew2028: number;
  setNumNew2028: (n: number) => void;
  prospectsCount2026: number;
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
          subLabel={`beyond 9 current + ${prospectsCount2026} prospect${prospectsCount2026 === 1 ? '' : 's'}`}
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
  yearKey,
  currentCount,
  prospectsCount,
}: {
  year: YearResult;
  numNew: number;
  totalManaged: number;
  springTrough: number;
  yearKey: ForecastYear;
  currentCount: number;
  prospectsCount: number;
}) {
  const { totals } = year;
  const portfolioBreakdown =
    yearKey === 2026
      ? `${currentCount} current + ${prospectsCount} prospects + ${numNew} new`
      : `${currentCount} active + ${numNew} new`;
  const revBreakdown =
    yearKey === 2026
      ? `cur ${fmtCompactSimple(totals.rev_current)} · prospects ${fmtCompactSimple(totals.rev_presigned)} · new ${fmtCompactSimple(totals.rev_new)}`
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
        label="Prospects pipeline"
        value={fmtDollar(totals.rev_presigned)}
        sub={`${prospectsCount} prospect${prospectsCount === 1 ? '' : 's'} · weighted mgmt fee from /prospects`}
        topBorder
        last
      />
    </div>
  );
}

/** Whole-dollar USD for inline KPI sub-text. */
function fmtCompactSimple(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
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
}: {
  year: YearResult;
  yearKey: ForecastYear;
  currentCount: number;
}) {
  const { monthly, cumulative, totals } = year;
  const currentLabel = yearKey === 2026 ? `Current 9` : `Active ${currentCount}`;
  const currentInfo =
    yearKey === 2026
      ? 'Past months (Jan-Apr) use bank actuals from Chase ...5130. Any reconciled month from property_statements overrides the projection automatically (the "ACT" badge marks those columns). Forward months without a closed statement use the Smart Forecast: Guesty bookings × Gloucester pacing × each property\'s actual mgmt fee %. Seasonality fallback only when Guesty is unavailable.'
      : `${currentCount} active properties full year. Each month uses statement actuals where Helm has reconciled the month, Smart Forecast where Guesty has bookings, and seasonality (scaled by the 2026 calibration factor) for everything else.`;
  const presignedLabel = 'Prospects (weighted)';
  const presignedInfo =
    'Live pipeline from Helm\'s /prospects module. Each prospect\'s projected year-1 mgmt fee × close_likelihood_pct, summed per month. Owner payout (what the prospect sees) shown in the Prospect pipeline panel below; this row is what RT actually keeps.';

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
        <DataRow label={presignedLabel} info={presignedInfo} values={monthly.map((r) => r.rev_presigned)} fy={totals.rev_presigned} />
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
          info="Monthly Chase ...3878 credit-card payment. Baseline $5,900/mo at 9 active properties (the 2025 portfolio). Scales at 0.5× elasticity to active property count: doubling the portfolio adds +50%, not +100%. Covers software, supplies, marketing, and some property-level pass-through."
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
          info="First hire at $5,000/mo joins August 2026. A second hire ($5K/mo more) is automatically added once active property count reaches 20 — a step function based on the portfolio size each month."
          values={monthly.map((r) => r.exp_hire)}
          fy={monthly.reduce((a, r) => a + r.exp_hire, 0)}
        />
        <DataRow
          label="Onboarding · presigned"
          info="$4,000 one-time per pre-signed contract, paid the month it goes live. Five contracts in 2026 (two in May, three in June) = $20K total. Zero in 2027 — those properties are already onboarded."
          values={monthly.map((r) => r.exp_onboard_presigned)}
          fy={monthly.reduce((a, r) => a + r.exp_onboard_presigned, 0)}
        />
        <DataRow
          label="Onboarding · new"
          info="$4,000 one-time per new contract added via the slider, paid its start month."
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
