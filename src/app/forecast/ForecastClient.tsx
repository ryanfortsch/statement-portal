'use client';

import Link from 'next/link';
import { opensIn } from '@/lib/forecast-operating-windows';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  calcYear,
  getYearConfig,
  fmtDollar,
  fmtNum,
  MONTH_LABELS,
  CC_OPERATING_BREAKDOWN,
  CURRENT_2026,
  NEW_PROPERTY_FEE,
  type ForecastYear,
  type ManagedProperty,
  type MonthRow,
  type YearResult,
} from '@/lib/forecast-model';
import { knownFromRoster, rosterFromRegistry } from '@/lib/forecast-roster';
import type { MonthlyActual } from '@/lib/forecast-actuals';
import type { SmartForecast } from '@/lib/forecast-smart';
import type { ProspectForecast } from '@/lib/forecast-prospects';
import type { StatementRevenueByMonth } from '@/lib/forecast-statement-actuals';
import { describeMonths, type YtdSummary } from '@/lib/forecast-fy-total';
import { describeMeasured, scenarioQuery, type ForecastScenario } from '@/lib/forecast-scenario';

const KNOWN_2026 = knownFromRoster(CURRENT_2026);

/**
 * The cost roster for a year from the smart feed's property list, or
 * undefined when smart is unavailable so the model keeps CURRENT_2026.
 */
function buildRoster(data: SmartForecast | null, year: ForecastYear): ManagedProperty[] | undefined {
  if (!data) return undefined;
  return rosterFromRegistry(
    data.properties.map((p) => ({
      id: p.property.id,
      name: p.property.name,
      isRtOwned: p.property.isRtOwned,
      activatedAt: p.property.activatedAt,
      projectedMgmtFee: year === 2026 ? 0 : p.totals.projectedMgmtFee,
    })),
    year,
    year === 2026 ? KNOWN_2026 : {},
    NEW_PROPERTY_FEE,
  );
}

type Props = {
  smart2026: SmartForecast | null;
  smart2027: SmartForecast | null;
  smart2028: SmartForecast | null;
  prospects2026: ProspectForecast;
  prospects2027: ProspectForecast;
  prospects2028: ProspectForecast;
  /** Map keyed by YYYY-MM → total mgmt fee from property_statements. */
  statementRevenue: StatementRevenueByMonth;
  /**
   * Year-to-date closed-statement management fee per year, the half of the
   * year the smart table's forward months cannot see. Built on the server so
   * the closed-month boundary is decided once rather than on each viewer's
   * clock.
   */
  ytdByYear: Record<ForecastYear, YtdSummary>;
  /**
   * 2026 bank actuals indexed by month-1 (sourced from overhead_expenses
   * via getActualsFromDb in page.tsx, falling back to hardcoded
   * ACTUALS_2026 when the DB is empty). Sparse holes are tolerated —
   * calcYear's truthiness check on `actuals[m - 1]` falls through.
   */
  bankActuals2026: readonly MonthlyActual[];
  /** Last 1-indexed calendar month with complete bank actuals. */
  bankActualsThrough2026: number;
  /** Year and sliders from the link (?year=&new=), read on the server for the first paint. */
  initialScenario: ForecastScenario;
};

export function ForecastClient({
  smart2026,
  smart2027,
  smart2028,
  prospects2026,
  prospects2027,
  prospects2028,
  statementRevenue,
  ytdByYear,
  bankActuals2026,
  bankActualsThrough2026,
  initialScenario,
}: Props) {
  // Independent per-year state. Earlier years' additions roll forward as
  // full-year actives in later years; the slider for each year only
  // controls THAT year's incremental adds. The starting values come from
  // the link, so a scenario can be shared; the defaults are 2026 and 3/3/3.
  const [numNew2026, setNumNew2026] = useState<number>(initialScenario.numNew[0]);
  const [numNew2027, setNumNew2027] = useState<number>(initialScenario.numNew[1]);
  const [numNew2028, setNumNew2028] = useState<number>(initialScenario.numNew[2]);
  const [yearKey, setYearKey] = useState<ForecastYear>(initialScenario.year);

  // Mirror the scenario into the address bar. The native history call, never
  // the router: a router navigation re-runs this page's server work (every
  // Guesty and statement read) for what is only a slider move. Replace, not
  // push, so dragging a slider does not fill the back button.
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const query = scenarioQuery({ year: yearKey, numNew: [numNew2026, numNew2027, numNew2028] });
    if (query !== search) window.history.replaceState(null, '', `${pathname}${query}${hash}`);
  }, [yearKey, numNew2026, numNew2027, numNew2028]);

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

  // Fleet average fee per earning home this year, from the smart forecast.
  // A home rolled forward from a prior year's slider is in its second season
  // and earns this rather than the first-year $25K. Undefined for 2026 (no
  // rollovers exist yet and the smart data there covers only the months
  // ahead) or when smart is unavailable, so the model keeps the constant.
  const matureFee = useMemo(() => {
    if (yearKey === 2026) return undefined;
    const data = yearKey === 2027 ? smart2027 : smart2028;
    if (!data) return undefined;
    const earning = data.properties.map((p) => p.totals.projectedMgmtFee).filter((v) => v > 0);
    if (earning.length === 0) return undefined;
    return earning.reduce((a, v) => a + v, 0) / earning.length;
  }, [smart2027, smart2028, yearKey]);

  // The homes the cost lines scale on, from Helm's registry via the smart
  // feed, so a home costs from the month it is activated rather than from
  // its first closed statement. 2026 keeps the statement-derived start
  // months and fees for the homes that predate activated_at; smart's 2026
  // fee covers only the months ahead, so it is not used as an annual one.
  const roster2026 = useMemo(() => buildRoster(smart2026, 2026), [smart2026]);
  const roster2027 = useMemo(() => buildRoster(smart2027, 2027), [smart2027]);
  const roster2028 = useMemo(() => buildRoster(smart2028, 2028), [smart2028]);
  const rosterForYear =
    yearKey === 2026 ? roster2026 :
    yearKey === 2027 ? roster2027 :
    roster2028;
  // How many homes each year starts with before its rollovers and new ones,
  // for the slider captions. 2026 is the same live count the KPI strip
  // prints for 2026; forward years have their offline homes already out.
  const base2026 = smart2026
    ? smart2026.properties.length
    : getYearConfig(2026, 0, opensIn, undefined, roster2026).current.length;
  const base2027 = getYearConfig(2027, 0, opensIn, undefined, roster2027).current.length;
  const base2028 = getYearConfig(2028, 0, opensIn, undefined, roster2028).current.length;

  const yearConfig = useMemo(
    () => getYearConfig(yearKey, rolledForward, opensIn, matureFee, rosterForYear),
    [yearKey, rolledForward, matureFee, rosterForYear]
  );
  // Substitute bank-derived actuals for completed 2026 months. The data
  // comes from the parent (page.tsx) — either the live overhead_expenses
  // table (refreshed by uploads under Actuals) or the hardcoded fallback.
  // 2027 is fully projected.
  const actualsForYear = yearKey === 2026 ? bankActuals2026 : undefined;
  const actualsThrough = yearKey === 2026 ? bankActualsThrough2026 : undefined;

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
    const calibrated = calcYear(0, 2026, bankActuals2026, bankActualsThrough2026, smart2026OverrideForCalibration);
    // Without smart override → seasonality-only 2026 rev_current
    const heuristic = calcYear(0, 2026, bankActuals2026, bankActualsThrough2026, undefined);
    if (heuristic.totals.rev_current <= 0) return undefined;
    const factor = calibrated.totals.rev_current / heuristic.totals.rev_current;
    // Sanity bounds — never less than 1 (don't project DOWN), and cap at
    // 3× to guard against weird inputs.
    return Math.min(3, Math.max(1, factor));
  }, [yearKey, smart2026OverrideForCalibration, bankActuals2026, bankActualsThrough2026]);

  const prospectsForYear =
    yearKey === 2026 ? prospects2026 :
    yearKey === 2027 ? prospects2027 :
    prospects2028;

  const smartForYear =
    yearKey === 2026 ? smart2026 :
    yearKey === 2027 ? smart2027 :
    smart2028;

  // Live count of active managed properties — pulled from Helm's
  // properties table via the smart-forecast feed, so it updates
  // automatically when a property is added or deactivated in Helm.
  // Falls back to the model config if the smart forecast isn't
  // available (e.g. Supabase down).
  // 2026 counts every managed home the smart forecast knows (all of them
  // earned this year); forward years count the homes that earn in the year,
  // so the three offboarded homes at $0 do not inflate the label.
  const liveCurrentCount =
    smartForYear
      ? (yearKey === 2026
          ? smartForYear.properties.length
          : smartForYear.properties.filter((p) => p.totals.projectedMgmtFee > 0).length)
      : yearConfig.current.length;

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
      statementByMonthForYear, opensIn, matureFee, rosterForYear,
    ),
    [numNew, yearKey, actualsForYear, actualsThrough, smartOverride, calibrationFactor, rolledForward, prospectsForYear, statementByMonthForYear, matureFee, rosterForYear]
  );

  /** Switch year. Per-year slider state is independent so no clamping needed. */
  const setYearKeyClamped = (y: ForecastYear) => {
    setYearKey(y);
  };

  const springTrough = Math.min(...year.cumulative.slice(0, 6), 0);
  // The month the trough lands in, so the caption names the window it
  // measures (January to June) and where in it the low point fell.
  const springTroughMonth = springTrough < 0 ? MONTH_LABELS[year.cumulative.slice(0, 6).indexOf(springTrough)] : null;
  const measured = describeMeasured(year.monthly);
  // Total managed at year-end: the homes earning this year, plus every home
  // added on a PRIOR year's slider (rolled forward as a full-year active),
  // plus the prospects, plus this year's new. Leaving the rollovers out
  // made 2028 read 28 with 39 homes on the books.
  const totalManaged = liveCurrentCount + rolledForward + prospectsForYear.totals.count + numNew;

  return (
    <>
      <ScenarioControl
        yearKey={yearKey}
        setYearKey={setYearKeyClamped}
        numNew2026={numNew2026}
        setNumNew2026={setNumNew2026}
        numNew2027={numNew2027}
        matureFee={matureFee}
        base2027={base2027}
        base2028={base2028}
        setNumNew2027={setNumNew2027}
        numNew2028={numNew2028}
        setNumNew2028={setNumNew2028}
        base2026={base2026}
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
          rolledForward={rolledForward}
          springTrough={springTrough}
          springTroughMonth={springTroughMonth}
          yearKey={yearKey}
          currentCount={liveCurrentCount}
          prospectsCount={prospectsForYear.totals.count}
        />
      </section>

      {/* Monthly P&L — the centerpiece */}
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 32, width: '100%' }}
      >
        <SectionTitle title="Monthly Detail" tag={String(yearKey)} />
        <div style={{ margin: '8px 0 10px', fontSize: 12, color: 'var(--ink-2)' }}>{measured.line}</div>
        <ForecastTable
          year={year}
          yearKey={yearKey}
          currentCount={liveCurrentCount}
          prospectsCount={prospectsForYear.totals.count}
          ruleBefore={measured.ruleBefore}
        />
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
          ytd={ytdByYear[yearKey]}
        />
      </section>

      {/* The pipeline in one line; each deck lives on Prospects. */}
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 32, width: '100%' }}
      >
        <ProspectsLine data={prospectsForYear} yearKey={yearKey} />
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
          :global(.rt-forecast-defs) {
            grid-template-columns: 1fr !important;
            row-gap: 4px !important;
          }
        }
      `}</style>
    </>
  );
}

function SmartForecastPanel({
  data,
  ytd,
}: {
  data: SmartForecast | null;
  ytd: YtdSummary;
}) {
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
        Live bookings did not load, so there is no per-property forecast. The
        months ahead above use the seasonal curve; reload to try again.
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

  // The month columns are the months still AHEAD: forwardMonths() starts at
  // the current month. On its own that made the totals column four months of
  // twelve while calling itself "FY total", $144.5k of a 2026 tracking near
  // $339k, with 4 Brier Neck reading as a dash because its whole year sat
  // behind the left edge.
  //
  // The year-to-date column is the missing half. Closed statements supply the
  // actuals, the month columns supply the projection, and because the
  // statement loader excludes the in-progress month that forwardMonths()
  // starts at, the two tile the year with no gap and no double count.
  // `ytd.coversYear` re-checks that rather than assuming it, and only when it
  // holds does the totals column call itself a fiscal year.
  const showYtd = ytd.total > 0;
  const fyReal = ytd.coversYear;
  const spanLabel = fyReal
    ? 'FY total'
    : data.months.length === 1
    ? fmtMonth(data.months[0])
    : `${fmtMonth(data.months[0])}-${fmtMonth(data.months[data.months.length - 1])}`;
  const actualsSpan = describeMonths(ytd.monthsWithActuals);
  const spanTitle = fyReal
    ? `The whole year: closed statements${actualsSpan ? ` (${actualsSpan})` : ''} plus the months still projected.`
    : `Total across the months shown, ${fmtMonth(data.months[0])} to ${fmtMonth(data.months[data.months.length - 1])}. Closed months are not included here; their actuals are in Monthly Detail below.`;
  const ytdTitle = `Management fee already billed on closed statements${
    actualsSpan ? `, ${actualsSpan}` : ''
  }. Real money, not projected. The in-progress month is never counted as an actual, so it stays in the projected columns.`;
  const fyFor = (propertyId: string, projected: number) =>
    (ytd.byProperty[propertyId] ?? 0) + projected;
  // The same rule Monthly Detail draws: billed to its left, projected to its right.
  const fwdRule = (i: number) => (showYtd && i === 0 ? RULE_LEFT : null);

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
            {showYtd && (
              <Th title={ytdTitle}>
                YTD
              </Th>
            )}
            {data.months.map((m, i) => (
              <Th key={m} ruleLeft={fwdRule(i) != null}>{fmtMonth(m)}</Th>
            ))}
            <Th totals title={spanTitle}>
              {spanLabel}
            </Th>
          </tr>
        </thead>
        <tbody>
          {/* Pacing row — portfolio-level current vs historical. */}
          <tr style={{ background: 'rgba(58, 107, 74, 0.04)' }}>
            <td
              style={labelCellStyle({
                fontWeight: 600,
                color: 'var(--ink-2)',
                background: onPaper('rgba(58, 107, 74, 0.04)'),
              })}
            >
              Portfolio pacing
            </td>
            <td style={cellStyle({ color: 'var(--ink-4)' })}>—</td>
            {showYtd && <td style={cellStyle({ color: 'var(--ink-4)' })}>—</td>}
            {data.monthInputs.map((mi, i) => (
              <td
                key={mi.month}
                style={cellStyle({
                  color: mi.pacingPct < mi.historicalAvgPct ? 'var(--ink-2)' : 'var(--positive)',
                  fontSize: 10,
                  ...fwdRule(i),
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
            {showYtd && <td style={cellStyle({ color: 'var(--ink-4)' })}>—</td>}
            {data.monthInputs.map((mi, i) => (
              <td
                key={mi.month}
                style={cellStyle({
                  color: 'var(--ink-3)',
                  fontStyle: 'italic',
                  fontSize: 10,
                  ...fwdRule(i),
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
              <td
                style={labelCellStyle({
                  color: 'var(--ink-2)',
                  fontWeight: 500,
                  background: onPaper('rgba(58, 107, 74, 0.03)'),
                })}
              >
                {p.property.name}
                {p.annualBasis === 'statements' && (
                  <span
                    title={`Annual gross floored at what this property's closed statements prove (its whole record once it has four closed months): ${fmtUsd(p.annualGross)}`}
                    style={{
                      marginLeft: 6,
                      fontSize: 8.5,
                      letterSpacing: '.12em',
                      textTransform: 'uppercase',
                      color: 'var(--signal)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    floor
                  </span>
                )}
                {p.annualBasis === 'unit' && (
                  <span
                    title="A unit of a home already in this table. It sells the same nights as the whole house, so it projects only its own bookings rather than the portfolio average."
                    style={{
                      marginLeft: 6,
                      fontSize: 8.5,
                      letterSpacing: '.12em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-4)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    unit
                  </span>
                )}
                {p.offSeasonFactor < 1 && p.offSeasonMonth && (
                  <span
                    title={`Off-season at ${Math.round(p.offSeasonFactor * 100)}% of the market curve: what this home has on the books for ${p.offSeasonMonth} is ${Math.round(p.offSeasonFactor * 100)}% of what the curve expected of it, so every month outside June to September carries that share.`}
                    style={{
                      marginLeft: 6,
                      fontSize: 8.5,
                      letterSpacing: '.12em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-4)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    off-season {Math.round(p.offSeasonFactor * 100)}%
                  </span>
                )}
              </td>
              <td style={cellStyle({ color: 'var(--signal)', fontWeight: 600 })}>
                {p.property.mgmtFeePct != null ? `${p.property.mgmtFeePct}%` : '—'}
              </td>
              {showYtd && (
                <td
                  title={ytdTitle}
                  style={cellStyle({
                    color: (ytd.byProperty[p.property.id] ?? 0) > 0 ? 'var(--signal)' : 'var(--ink-4)',
                    opacity: (ytd.byProperty[p.property.id] ?? 0) > 0 ? 1 : 0.4,
                    fontWeight: 600,
                  })}
                >
                  {fmtUsd(ytd.byProperty[p.property.id] ?? 0)}
                </td>
              )}
              {p.monthly.map((m, i) => (
                <td
                  key={m.month}
                  title={
                    m.operating === false
                      ? `${p.property.name} is not operating this month`
                      : undefined
                  }
                  style={cellStyle({
                    color: m.projectedMgmtFee === 0 ? 'var(--ink-4)' : 'var(--positive)',
                    opacity: m.projectedMgmtFee === 0 ? 0.4 : 1,
                    fontWeight: m.projectedMgmtFee > 0 ? 600 : 400,
                    ...fwdRule(i),
                  })}
                >
                  {fmtUsd(m.projectedMgmtFee)}
                </td>
              ))}
              <td
                title={
                  p.totals.projectedMgmtFee === 0 && (ytd.byProperty[p.property.id] ?? 0) > 0
                    ? `${p.property.name} has no operating month left, so this is all year-to-date actual.`
                    : spanTitle
                }
                style={cellStyle({
                  fontWeight: 700,
                  color: 'var(--positive)',
                  background: 'rgba(58, 107, 74, 0.08)',
                })}
              >
                {fmtUsdCents(fyFor(p.property.id, p.totals.projectedMgmtFee))}
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
            {showYtd && (
              <td
                title={ytdTitle}
                style={cellStyle({
                  background: 'var(--ink)',
                  color: '#9bd1ad',
                  fontWeight: 600,
                })}
              >
                {fmtUsd(ytd.total)}
              </td>
            )}
            {data.months.map((ym, i) => {
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
                    ...fwdRule(i),
                  })}
                >
                  {fmtUsd(sum)}
                </td>
              );
            })}
            <td
              title={spanTitle}
              style={cellStyle({
                background: 'var(--ink-2)',
                color: '#9bd1ad',
                fontWeight: 700,
              })}
            >
              {fmtUsdCents(ytd.total + data.totals.projectedMgmtFee)}
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
        Per property × per month, the projected gross is a 50/50 blend of two
        parts. <em>Part A, pacing</em>: revenue on the books for that month,
        scaled by typical market fill — \$5K booked at 30% property occupancy
        with 60% market occupancy projects \$10K. <em>Part B, annual ×
        seasonality</em>: the property&apos;s expected annual gross × the
        share of annual revenue that typically lands in that month. That
        annual gross is the property&apos;s own forward bookings, pace-corrected
        and annualized, since Helm has no full year of per-property booking
        history to draw on, and it is floored at what the property&apos;s own
        closed statements imply: while a home is still ramping (two or three closed full months), the larger of its latest closed full month annualized on its share and its whole closed record; from four closed full months, the whole record alone, so one strong month cannot set the year. That floor is what stops a home
        that was still ramping in August from being projected below that
        August; rows it lifts carry a <em>floor</em> tag. When a month has no
        bookings yet, Part A drops out and Part B carries 100%. Outside June to
        September, Part B is scaled to the home&apos;s own off-season: what it has on
        the books for the shoulder month (the current month from the 15th, the
        month just finished before that) as a share of what the curve expected of
        it, capped at 100%; rows it lowers carry an <em>off-season</em> tag. The mgmt fee column is the blended gross × that
        property&apos;s fee %.
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
 * The prospect pipeline as one line: how many decks are open and the
 * management fee they add to this year once weighted by close likelihood
 * (the same figure as the Prospects row in Monthly Detail). Each deck, its
 * owner payout and its close percent live on Prospects, which this links.
 */
function ProspectsLine({
  data,
  yearKey,
}: {
  data: ProspectForecast;
  yearKey: ForecastYear;
}) {
  const n = data.totals.count;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        borderTop: '1px solid var(--ink)',
        borderBottom: '1px solid var(--rule)',
        padding: '12px 0',
        fontSize: 13,
        color: 'var(--ink-2)',
      }}
    >
      <span>
        <span className="eyebrow" style={{ marginRight: 12 }}>Prospect pipeline · {yearKey}</span>
        {n === 0
          ? 'No open prospects.'
          : `${n} prospect${n === 1 ? '' : 's'} · ${fmtCompactSimple(data.totals.expectedMgmtFee)} mgmt fee, weighted by close %`}
      </span>
      <Link href="/properties/prospects" style={{ color: 'var(--signal)', fontSize: 12 }}>
        {n === 0 ? 'Add a prospect' : 'Open Prospects'} →
      </Link>
    </div>
  );
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
    heading: 'Revenue',
    items: [
      { label: 'Properties', value: 'Seventeen homes filed 2026 statements and make up the Properties row. Measured months carry the real management fee from those statements from April 2026; January to March carry the bank sweep from Chase ...5130, because the Statements module began in April. Forward months come from the smart forecast: the bookings already in Guesty for each home, pace-corrected against the capture rate Rising Tide itself achieved on the closed months of 2026, blended with the annual gross of the home spread over the Gloucester revenue curve. That annual gross is floored at what the closed statements of the home prove: while it is still ramping (two or three closed months), the larger of its latest full month and its whole record (first ramp month dropped once there are three); from four closed months, the whole record alone, so one strong month cannot set the year (decided 2026-10-15, when a single September had 17 Beach at $358K a year). Each month is held at no less than what is already booked, and the pacing scale-up is capped at 2.5x. Rows the floor lifts carry a floor tag in the per-property table. A unit of a home already in the table (17 Beach\'s front unit and guest house, split off on 2026-09-28) sells the same nights as the whole house, so it projects only its own bookings, never the portfolio average; such rows carry a unit tag. Outside June to September every home\'s curve share is scaled to its own off-season, read from the shoulder month on the books (October 2026 as of mid-October: 17 Beach at 61% of what the curve expected, 84 Thatcher 54%, most homes at 100%), so a summer house is not projected a market-shaped winter; the factor only lowers, and rows it lowers carry an off-season tag.' },
      { label: 'Prospects', value: 'The live prospect pipeline (Prospects). Each deck projects a year-one fee; it enters month by month, weighted by close likelihood.' },
      { label: 'New mandates', value: '$25K/yr each in their first season on Cape Ann seasonality (4.3% of the year in each of Jan to May and Nov to Dec, 10% in Jun, Sep and Oct, 20% in Jul and Aug), from the month the slider starts them. Default 3, in Jul, Sep and Nov. Each carries the $3,000 outfitting charge in its start month, so a home added late in the year is a small loss in that year and earns its keep the next. From 2027 they roll forward at the fleet average fee per earning home.' },
      { label: 'Operating windows', value: '4 Brier Neck ran June to August 2026 and is not renewed (notice given 2026-08-31). 73 Rocky Neck is off from November 2026 and 79 Main after 21 October 2026. 16 Waterman runs May to October every year. A closed month projects no revenue, and the card and the bench count only the homes operating that month.' },
    ],
  },
  {
    heading: 'Recurring monthly (projected months; measured months show the bank)',
    items: [
      { label: 'Corporate card', value: 'Two parts, calibrated on 2026 card detail through October 7 and the Amazon Business export of October 15. Variable: guest supplies and small repairs at $2,950 per live home per year, on the Cape Ann turnover curve pulled one month earlier (a home is stocked before its guests arrive) and damped to 60%, with repairs at 12% of it. The rate is measured item by item: $1,805 of Amazon consumables per home per year, about $1,000 of replacement durables, and the non-Amazon stores. It was $8,360 until 2026-10-15, fitted with the summer outfitting orders left in; September, the first month after the onboarding wave, came in at a quarter of what that rate projected, so outfitting is now its own one-time charge (Onboarding, below). Fixed: GEICO $519, AT&T $114, travel $175, the rest of Other $185 (the van, card interest, the hiring run), marketing $680 through May 2026 and $225 from June (the step-down is measured on the card, not assumed), and two $199 Furnished Finder listings, one renewing in August and one in September. Projected months itemise the card by these terms; measured months read the card\'s own categories.' },
      { label: 'Software', value: '$2,700/mo flat in projected months, the September 2026 stack with no API usage in it: Guesty $1,323 (per listing, up from $973 in January), PriceLabs $246, the Claude seats, OpenAI, Seam, Quo, Adobe, AirDNA, Squarespace, Vercel, Supabase and the smaller tools. Measured months show the real card figure: $3,420 in July and $3,804 in August on Anthropic API credits the operator ruled a one-off, then $2,952 in September with that reload stream stopped. The nine-month 2026 mean is $2,598; the constant was $2,300 until 2026-10-15.' },
      { label: 'Office', value: '$750/mo rent at 85 Eastern Ave from March 2026 when the lease began, plus $471/mo for the Republic Services dumpster through November 2026, the rate Republic has billed monthly since August. The dumpster was cancelled effective 2026-11-30 (notice sent 2026-10-05), so December is rent only.' },
      { label: 'Bank fees', value: '$10/mo. Real fee rows total $75 across 24 months; the old $100 figure counted bounced deposits, which are a wash, not a cost.' },
      { label: 'Contractors', value: 'The 1099 bench. Field labor (Delaney Jordan) at $33,700 a year per 16 homes, on Cape Ann seasonality and scaled to the live fleet, July to October 2026; from November it is her salary instead. Creative work (Cooper) $1,300/mo per 16 homes from July 2026 and listing photography (Lightshed, paid on the card) $1,000/mo per 16 homes from August 2026, both scaled to the live fleet. Everyone else $250/mo blended. The operating-account bench ran $8,288/mo over July 1 to August 25, 2026, plus two Lightshed shoots in the same window.' },
      { label: 'Operations manager', value: 'Delaney Jordan on W-2 from 2026-11-01 at $65,000 a year: about $6,226 a month all-in (salary, 9% payroll taxes, a 4% workers comp placeholder pending the Wister quote, the $55 Gusto fee, the $50 phone allowance), flat. Mileage and summer overtime are not projected. The count-triggered hires in the old plan stay dropped (2026-09-06): this one is a date, not a threshold.' },
    ],
  },
  {
    heading: 'Periodic and one-time',
    items: [
      { label: 'Mar 2026', value: 'Phillips commercial insurance, $5,264 paid 03/02. One lump; $0 every other month.' },
      { label: 'Apr 2026', value: 'MS Consultants accounting, $4,443 paid 04/15. A one-off by operator ruling; $0 forward.' },
      { label: 'Bookkeeper', value: 'MH Partners $1,000/mo through April 2026 and a final $1,800 wrap-up in May. $0 after.' },
      { label: 'Onboarding', value: '$3,000 per new home, once, in the month a slider home starts: the linen order ($2,156; Fix Linens billed $23,719 across the eleven 2026 onboardings) plus about $850 of Amazon durables (towels, bedclothes, rugs, a Schlage lock, dispensers, a dryer, a coffee maker), measured item by item on the Amazon Business export. Prospects carry no cost until they become a property. Whether an owner should fund outfitting instead is an open decision; this is what the card shows Rising Tide paying today.' },
    ],
  },
  {
    heading: 'Out of scope',
    items: [
      { label: 'Excluded', value: 'RT-owned units (3 Locust, held by Goose of Astoria LLC), personal owner draw, personal card and ATM spend, health benefits, federal and state taxes, capex, distributions, and channel commissions (VRBO, HomeAway, Expedia), which are netted out of rental revenue before a statement sees them and so are not an expense here.' },
    ],
  },
];

const sections2027: AssumptionSection[] = [
  {
    heading: 'Revenue',
    items: [
      { label: 'Active (Jan 1)', value: 'Every active managed home in Helm\'s registry drives the cost lines (card and bench), minus 4 Brier Neck, 73 Rocky Neck and 79 Main, which the operating windows have offline for the whole year; 16 Waterman is open May to October and counts only in those months. A home costs from the month it is activated, so 4 Middle Road is on the cost lines from day one rather than from its first closed statement. The revenue row is every active managed home in Helm with its operating window applied, so a home with no bookings or statements yet rides the portfolio-average gross (4 Middle Road today), except a unit of a home already in the table (17 Beach\'s front unit and guest house), which sells the whole house\'s nights and projects only its own bookings. Plus every home added on the 2026 slider, rolled forward as a full-year Cape Ann contract at the fleet average fee per earning home for 2027 (the mean of the per-property totals in the smart table, about $32K today), never below $25K.' },
      { label: 'Revenue per home', value: 'The smart forecast, almost entirely its annual-times-seasonality part: the annual gross of each home (its forward pace, floored at what its closed statements prove: the whole record once it has four closed months) spread over the Gloucester revenue curve, with the months outside June to September scaled to the home\'s own off-season as its shoulder month on the books showed it, times its fee percent. Bookings already placed for 2027 blend in where they exist.' },
      { label: 'Prospects', value: 'The live prospect pipeline (Prospects). Each open deck contributes a full year at its projected fee times its close likelihood (50% when none is entered), and adds no cost until it becomes a property.' },
      { label: 'New mandates', value: '$25K/yr each in their first season on Cape Ann seasonality from the month the slider starts them. Default 3, in Mar, Jun and Sep. They roll into 2028 at the fleet average fee.' },
    ],
  },
  {
    heading: 'Recurring monthly',
    items: [
      { label: 'Corporate card', value: 'Same two-part model as 2026: $2,950 per live home per year on the turnover curve (repairs 12% of it; the rate is Amazon consumables plus replacements, measured item by item), plus the fixed floor (GEICO $519, AT&T $114, travel $175, the rest of Other $185, marketing $225 at the post-cut level measured on the card, Furnished Finder $199 in August and again in September). Scales with the homes operating each month: the fourteen, plus rollovers, plus new ones as they start. Outfitting is the separate Onboarding charge, not part of the rate.' },
      { label: 'Software', value: '$2,700/mo flat, the September 2026 stack with no API usage in it, carried forward. No cuts are assumed: none has shown up in the card data yet, and Guesty bills per listing.' },
      { label: 'Office', value: '$750/mo rent, full year. The Republic Services dumpster ended 2026-11-30 and is not projected.' },
      { label: 'Bank fees', value: '$10/mo.' },
      { label: 'Contractors', value: 'Creative $1,300/mo and listing photography $1,000/mo, each per 16 homes and scaled to the live count, plus $250/mo for everyone else. Field labor is no longer on the bench: since November 2026 it is the operations manager\'s salary.' },
      { label: 'Operations manager', value: '$65,000 a year, about $6,226 a month all-in (salary, 9% payroll taxes, a 4% workers comp placeholder, the $55 Gusto fee, the $50 phone allowance), flat all year. The count-triggered hires were dropped 2026-09-06 because a step made whichever home landed on 20 read as a loss; this one is dated, and the bench still scales with the fleet.' },
    ],
  },
  {
    heading: 'Periodic and wind-down',
    items: [
      { label: 'Mar 2027', value: 'Phillips insurance renewal, $5,264 lump, same as 2026. $0 every other month.' },
      { label: 'Onboarding', value: '$3,000 per slider home in its start month (linens plus the Amazon durables). Homes rolled forward from the 2026 slider were outfitted in 2026 and carry none.' },
      { label: 'Bookkeeper', value: '$0. The engagement ended May 2026.' },
      { label: 'Accounting', value: '$0. MS Consultants was a one-off.' },
    ],
  },
  {
    heading: 'Out of scope',
    items: [
      { label: 'Excluded', value: 'RT-owned units, personal draw, health benefits, taxes, capex, distributions, and channel commissions netted out of rental revenue.' },
    ],
  },
];

const sections2028: AssumptionSection[] = [
  {
    heading: 'Revenue',
    items: [
      { label: 'Active (Jan 1)', value: 'The same active managed homes drive the cost lines and the revenue row, each with its operating window applied; a unit of a home already in the table projects only its own bookings. Plus everything added on the 2026 and 2027 sliders, all rolled forward as full-year Cape Ann contracts at the fleet average fee per earning home for 2028, never below $25K. Homes offline before 2028 stay out.' },
      { label: 'Revenue per home', value: 'The smart forecast on its annual-times-seasonality part alone: the annual gross of each home, floored at what its closed statements prove (the whole record once it has four closed months), spread over the Gloucester revenue curve with the months outside June to September scaled to the home\'s own off-season, times its fee percent. Bookings placed for 2028 blend in where they exist; none are on the books today.' },
      { label: 'Prospects', value: 'The live prospect pipeline (Prospects): each open deck a full year at its projected fee times its close likelihood, no cost until it becomes a property.' },
      { label: 'New mandates', value: '$25K/yr each in their first season on Cape Ann seasonality. Default 3, in Mar, Jun and Sep.' },
    ],
  },
  {
    heading: 'Recurring monthly',
    items: [
      { label: 'Corporate card', value: 'Same two-part model: $2,950 per live home per year on the turnover curve (repairs 12% of it), plus the fixed floor (GEICO $519, AT&T $114, travel $175, the rest of Other $185, marketing $225, Furnished Finder $199 in August and September). Scales with the homes operating each month. Outfitting is the separate Onboarding charge.' },
      { label: 'Software', value: '$2,700/mo flat, the September 2026 stack carried forward. No cuts are assumed.' },
      { label: 'Office', value: '$750/mo rent, full year. The Republic Services dumpster ended 2026-11-30 and is not projected.' },
      { label: 'Bank fees', value: '$10/mo.' },
      { label: 'Contractors', value: 'Creative $1,300/mo and listing photography $1,000/mo, each per 16 homes and scaled to the live count, plus $250/mo for everyone else. Field labor is the operations manager\'s salary, not the bench.' },
      { label: 'Operations manager', value: '$65,000 a year, about $6,226 a month all-in, flat all year (dated hire 2026-11-01; no count-triggered hires, decided 2026-09-06).' },
    ],
  },
  {
    heading: 'Periodic',
    items: [
      { label: 'Mar 2028', value: 'Phillips insurance renewal, $5,264 lump. $0 every other month.' },
      { label: 'Onboarding', value: '$3,000 per slider home in its start month. Rolled-forward homes carry none.' },
      { label: 'Bookkeeper and accounting', value: '$0.' },
    ],
  },
  {
    heading: 'Out of scope',
    items: [
      { label: 'Excluded', value: 'RT-owned units, personal draw, health benefits, taxes, capex, distributions, and channel commissions netted out of rental revenue.' },
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
  matureFee,
  base2027,
  base2028,
  setNumNew2027,
  numNew2028,
  setNumNew2028,
  base2026,
  prospectsCount2026,
}: {
  yearKey: ForecastYear;
  setYearKey: (y: ForecastYear) => void;
  numNew2026: number;
  setNumNew2026: (n: number) => void;
  numNew2027: number;
  setNumNew2027: (n: number) => void;
  /** Fleet average fee per earning home for the viewed year; labels the rolled-forward rows. */
  matureFee?: number;
  /** Homes each forward year starts with before rollovers and new ones; offline homes already out. */
  base2027: number;
  base2028: number;
  numNew2028: number;
  setNumNew2028: (n: number) => void;
  /** The live 2026 count, the same one the KPI strip prints for 2026. */
  base2026: number;
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
          subLabel={`beyond ${base2026} current + ${prospectsCount2026} prospect${prospectsCount2026 === 1 ? '' : 's'}`}
        />
        {showRow2027 && (
          <NumNewRow
            year={2027}
            n={numNew2027}
            setN={setNumNew2027}
            newOrder={getYearConfig(2027).newOrder}
            isActiveYear={yearKey === 2027}
            subLabel={`beyond ${base2027} active + ${numNew2026} rolled fwd${matureFee && yearKey === 2027 ? ` at $${Math.round(matureFee / 1000)}K/yr` : ''}`}
          />
        )}
        {showRow2028 && (
          <NumNewRow
            year={2028}
            n={numNew2028}
            setN={setNumNew2028}
            newOrder={getYearConfig(2028).newOrder}
            isActiveYear={yearKey === 2028}
            subLabel={`beyond ${base2028} active + ${numNew2026 + numNew2027} rolled fwd${matureFee && yearKey === 2028 ? ` at $${Math.round(matureFee / 1000)}K/yr` : ''}`}
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
  rolledForward,
  springTrough,
  springTroughMonth,
  yearKey,
  currentCount,
  prospectsCount,
}: {
  year: YearResult;
  numNew: number;
  totalManaged: number;
  rolledForward: number;
  springTrough: number;
  /** Where the January-to-June low lands; null when the year never dips below $0. */
  springTroughMonth: string | null;
  yearKey: ForecastYear;
  currentCount: number;
  prospectsCount: number;
}) {
  const { totals } = year;
  // Every term that is in the number is in the caption, so the two always
  // add up to each other.
  const portfolioBreakdown =
    yearKey === 2026
      ? `${currentCount} current + ${prospectsCount} prospects + ${numNew} new`
      : [
          `${currentCount} active`,
          rolledForward > 0 ? `${rolledForward} rolled fwd` : null,
          prospectsCount > 0 ? `${prospectsCount} prospect${prospectsCount === 1 ? '' : 's'}` : null,
          `${numNew} new`,
        ].filter(Boolean).join(' + ');
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
        sub="Corp + office + people"
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
        sub={springTroughMonth ? `Lowest cumulative Jan to Jun, end of ${springTroughMonth}` : 'Never below $0, Jan to Jun'}
        topBorder
      />
      <KpiCell
        label="Prospects pipeline"
        value={fmtDollar(totals.rev_presigned)}
        sub={`${prospectsCount} prospect${prospectsCount === 1 ? '' : 's'} · mgmt fee weighted by close %`}
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

/** A line of Monthly Detail and, when it has one, its row definition. */
type Line = { label: string; info?: string; values: number[]; fy: number; highlight?: boolean };

const sumOf = (rows: readonly MonthRow[], pick: (r: MonthRow) => number) => rows.reduce((a, r) => a + pick(r), 0);

function ForecastTable({
  year,
  yearKey,
  currentCount,
  prospectsCount,
  ruleBefore,
}: {
  year: YearResult;
  yearKey: ForecastYear;
  currentCount: number;
  prospectsCount: number;
  /** Month indexes (0-11) that open a new measured or projected run. */
  ruleBefore: number[];
}) {
  const { monthly, cumulative, totals } = year;
  const currentLabel = `Properties (${currentCount})`;
  const currentInfo =
    yearKey === 2026
      ? 'Measured months carry the real management fee from the statements from April 2026 (January to March carry the bank sweep, since the Statements module began in April) and the real expenses from Chase ...5130. Any reconciled month from property_statements overrides the projection automatically (the measured columns, left of the rule). Forward months without a closed statement use the Smart Forecast: Guesty bookings × Gloucester pacing × each property\'s actual mgmt fee %. Seasonality fallback only when Guesty is unavailable.'
      : `${currentCount} homes earning in the year (seasonal homes included; offboarded homes at $0 are not counted). Each month uses statement actuals where Helm has reconciled the month, Smart Forecast where Guesty has bookings, and seasonality (scaled by the 2026 calibration factor) for everything else. Each property's annual gross is floored at the run rate its closed 2026 statements prove, so a home still ramping this August is not projected below it. Properties rolled forward from a prior year's slider ride Cape Ann seasonality on top, at the fleet average fee per earning home for the year (the mean of this table's per-property totals), never below the first-year $25K.`;
  const presignedLabel = `Prospects (${prospectsCount})`;
  const presignedInfo =
    'Live pipeline from Prospects. Each prospect\'s projected year-1 mgmt fee × its close likelihood (50% when none is entered), summed per month. This row is what RT keeps; each deck\'s owner payout is on Prospects.';

  const revenue: Line[] = [
    { label: currentLabel, info: currentInfo, values: monthly.map((r) => r.rev_current), fy: totals.rev_current },
    { label: presignedLabel, info: presignedInfo, values: monthly.map((r) => r.rev_presigned), fy: totals.rev_presigned },
    { label: 'New', info: 'Hypothetical new contracts added via the slider above. $25K/yr on Cape Ann seasonality in their first season, which is a ramp, less the $3,000 outfitting charge on the Onboarding line in the month each starts. From the next year they roll into the Properties row at the fleet\'s projected average fee per earning home (never below $25K), so an added home is worth what the average home already run is worth.', values: monthly.map((r) => r.rev_new), fy: totals.rev_new, highlight: true },
  ];
  // Measured wherever the month carries card detail: the card's own
  // categories for a measured month, the model's own terms for a projected
  // one. The proportional split by fallback weight is only for a month
  // whose card spend is known through a payoff alone, which has no
  // categories to read.
  const denom = CC_OPERATING_BREAKDOWN.reduce((a, c) => a + c.monthly, 0);
  const recurring: Line[] = [
    ...CC_OPERATING_BREAKDOWN.map((cat) => {
      const catValue = (r: MonthRow) =>
        r.cc_detail ? r.cc_detail[cat.key] : (r.exp_cc_ops * cat.monthly) / denom;
      return { label: cat.label, info: cat.info, values: monthly.map(catValue), fy: sumOf(monthly, catValue) };
    }),
    { label: 'Office', info: '$750/mo rent at 85 Eastern Ave plus $471/mo for the Republic Services dumpster through November 2026: $165 a month April to June 2026, nothing in July, then $471 on 2026-08-14 and again on 2026-09-14, so $471 is the rate the last two months project. Lease started March 2026. The dumpster was cancelled effective 2026-11-30, so from December 2026 the line projects rent only. Measured months read the landlord ACHs from the operating account plus any Republic Services charge on the card.', values: monthly.map((r) => r.exp_office), fy: sumOf(monthly, (r) => r.exp_office) },
    { label: 'Software', info: 'Software subscriptions on the corporate card: Guesty, Anthropic, PriceLabs, OpenAI, Seam, Quo, QuickBooks, Adobe, AirDNA, Squarespace, Vercel, Supabase and the smaller tools. Measured months show the real card figure ($2,740 Apr, $2,314 May, $1,272 Jun, $3,420 Jul, $3,804 Aug, $2,952 Sep 2026). Projected months carry a flat $2,700/mo, the September 2026 stack with no API usage in it; Guesty bills per listing and has grown from $973 to $1,323 this year. The subscription cuts an earlier version of this model assumed never showed up in the card data.', values: monthly.map((r) => r.exp_software), fy: sumOf(monthly, (r) => r.exp_software) },
    { label: 'Bank fees', info: '$10/mo. Real fee rows on Chase ...5130 total $75 across 24 months; the old $100 to $112 figures counted bounced deposits, which are a wash, not a cost.', values: monthly.map((r) => r.exp_bank), fy: sumOf(monthly, (r) => r.exp_bank) },
  ];
  const people: Line[] = [
    { label: 'Contractors', info: 'The 1099 bench. Delaney Jordan\'s field labor ran per job from 2026-07-07 out of Chase ...5130 by Zelle, clustered on checkout days, so it rode the seasonality curve and scaled with the fleet; it ends in October 2026, when she joins payroll (the row below). Cooper\'s creative work is $1,300/mo per 16 homes from 2026-07-29 on the Chase payroll rail, and Lightshed\'s listing photography $1,000/mo per 16 homes from August 2026 on the card, both scaled to the live fleet. Nicole Whitten, Ian Drometer and one-off trades blend to $250/mo. The operating-account bench ran $8,288/mo across July and August 2026. In a card-only month (operating export not yet uploaded) this row is the model\'s term plus what the card paid.', values: monthly.map((r) => r.exp_contractors), fy: sumOf(monthly, (r) => r.exp_contractors) },
    { label: 'Operations manager', info: 'The one salaried hire, dated: Delaney Jordan moves from the bench to W-2 on 2026-11-01 at $65,000 a year. Projected months carry $5,417 of salary plus 9% payroll taxes, a 4% workers comp placeholder until the Wister quote lands, the $55 Gusto fee and the $50 phone allowance, about $6,226 a month, flat; it does not scale with the fleet. Mileage and summer overtime are not projected. Measured months read the Gusto debits (net pay, taxes and the fee) from the operating account. $0 before November 2026.', values: monthly.map((r) => r.exp_payroll), fy: sumOf(monthly, (r) => r.exp_payroll) },
  ];
  const onboarding = (r: MonthRow) => r.exp_onboard_presigned + r.exp_onboard_new;
  const periodic: Line[] = [
    { label: 'Onboarding', info: 'Outfitting a new home, charged once in the month a slider home starts: $3,000. The linen order is $2,156 (Fix Linens billed $23,719 across the eleven 2026 onboardings) and the Amazon durables bought for a new home beyond a settled home\'s replacement trickle are about $850: towels, bedclothes, rugs, a Schlage lock, soap dispensers, a hair dryer, a coffee maker, shelving, measured item by item on the Amazon Business export of 2026-10-15. The supplies left over once the per-home run rate is taken out say the same ($3,020 each). The card shows what Rising Tide paid; whether an owner should fund outfitting instead is an open decision. Measured months carry it inside Guest supplies, where the card put it. It was $0 until 2026-10-15, which is why the summer read as a supplies run rate.', values: monthly.map(onboarding), fy: sumOf(monthly, onboarding) },
    { label: 'Bookkeeper', info: 'MH Partners outside bookkeeper. ~$1,000/mo Jan-Apr 2026, $1,800 final wrap-up payment in May, then $0 once the engagement ends.', values: monthly.map((r) => r.exp_debt), fy: sumOf(monthly, (r) => r.exp_debt) },
    { label: 'Insurance', info: 'Premiums paid once, not monthly. Phillips commercial liability, $5,263.92 by ACH on 2026-03-02, assumed to renew each March. Arbella, $3,188.57 on the card on 2026-04-15, is treated as a one-time hit and is not projected forward. GEICO auto is monthly and lives on the Vehicle & other insurance row above. $0 every other month.', values: monthly.map((r) => r.exp_insurance), fy: sumOf(monthly, (r) => r.exp_insurance) },
    { label: 'Accounting', info: 'MS Consultants $4,442.96 paid 4/15/2026 was a one-time engagement, not recurring. $0 going forward.', values: monthly.map((r) => r.exp_accounting), fy: sumOf(monthly, (r) => r.exp_accounting) },
  ];

  // One disclosure under the table instead of a hover popover per row, so
  // the definitions are there on a phone too. A card-only month gets its own
  // entry, since the as-of line above only names it.
  const cardOnly = MONTH_LABELS.filter((_, i) => monthly[i]?.actual_card_only);
  const definitions: Array<{ label: string; text: string }> = [
    ...(cardOnly.length > 0
      ? [{
          label: `Card only (${cardOnly.join(', ')})`,
          text: 'Card actual. The operating account export has not reached this month, so rent, the contractor bench, payroll, the bookkeeper and bank fees are the model\'s own terms for it. Upload the Chase ...5130 export under Actuals below to replace them.',
        }]
      : []),
    ...[...revenue, ...recurring, ...people, ...periodic]
      .filter((l): l is Line & { info: string } => !!l.info)
      .map((l) => ({ label: l.label, text: l.info })),
  ];

  const lineRows = (lines: Line[]) =>
    lines.map((l) => <DataRow key={l.label} label={l.label} values={l.values} fy={l.fy} highlight={l.highlight} />);

  return (
    <MonthRules.Provider value={ruleBefore}>
      <div
        style={{
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
              {MONTH_LABELS.map((m, i) => (
                <Th key={m} ruleLeft={ruleBefore.includes(i)}>
                  {m}
                </Th>
              ))}
              <Th totals>FY</Th>
            </tr>
          </thead>
          <tbody>
            <SectionRow label="Revenue" />
            {lineRows(revenue)}
            <TotalRow label="Total revenue" values={monthly.map((r) => r.rev_total)} fy={totals.rev_total} />

            <SectionRow label="Expenses" tag="grouped & sorted by size · calibrated to Chase ...5130 actuals" />

            <SubsectionRow label="Recurring monthly" />
            {lineRows(recurring)}

            <SubsectionRow label="People" />
            {lineRows(people)}

            <SubsectionRow label="Periodic & wind-down" />
            {lineRows(periodic)}
            <SubtotalRow label="Total expenses" values={monthly.map((r) => r.exp_total)} fy={totals.exp_total} variant="expense" />

            <BottomLineRow label="Net business income" values={monthly.map((r) => r.net_business)} fy={totals.net_business} />
            <CumulativeRow label="Cumulative YTD" values={cumulative} />
          </tbody>
        </table>
      </div>
      <RowDefinitions definitions={definitions} />
    </MonthRules.Provider>
  );
}

/** The row definitions as one disclosure: tap to open, works without hover. */
function RowDefinitions({ definitions }: { definitions: Array<{ label: string; text: string }> }) {
  if (definitions.length === 0) return null;
  return (
    <details style={{ marginTop: 10, borderBottom: '1px solid var(--rule)' }}>
      <summary
        style={{
          padding: '8px 0',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--ink-2)',
          userSelect: 'none',
        }}
      >
        Row definitions
      </summary>
      <dl className="rt-forecast-defs" style={{ margin: 0, padding: '4px 0 12px', display: 'grid', gridTemplateColumns: '200px 1fr', gap: '10px 24px', fontSize: 12, lineHeight: 1.5 }}>
        {definitions.map((d) => (
          <div key={d.label} style={{ display: 'contents' }}>
            <dt className="eyebrow" style={{ paddingTop: 2 }}>{d.label}</dt>
            <dd style={{ margin: 0, color: 'var(--ink-2)' }}>{d.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/* --------------------------------------------------- Table cell helpers */

/**
 * The rule between the last measured month and the first projected one.
 * Monthly Detail provides the column indexes; every row reads them, so the
 * line runs the height of the table.
 */
const RULE_LEFT: React.CSSProperties = { borderLeft: '2px solid var(--signal)' };
const MonthRules = createContext<readonly number[]>([]);
function useRuleAt(): (i: number) => React.CSSProperties | null {
  const rules = useContext(MonthRules);
  return (i) => (rules.includes(i) ? RULE_LEFT : null);
}

function Th({
  children,
  first,
  totals,
  ruleLeft,
  title,
}: {
  children: React.ReactNode;
  first?: boolean;
  totals?: boolean;
  /** Draws the measured/projected rule on this column's left edge. */
  ruleLeft?: boolean;
  title?: string;
}) {
  return (
    <th
      title={title}
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
        ...(first ? { position: 'sticky', left: 0 } : null),
        ...(ruleLeft ? RULE_LEFT : null),
      }}
    >
      {children}
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
        <span style={{ position: 'sticky', left: 22, display: 'inline-block' }}>{label}</span>
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
        <span style={{ position: 'sticky', left: 12, display: 'inline-block' }}>
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
        </span>
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
    ...stickyLabelColumn,
    ...extra,
  };
}

/**
 * The row label stays pinned while the months scroll under it. The cell has
 * to be opaque or the figures show through, so a row that carries a tint
 * passes `background: onPaper(tint)` to keep its wash on the label too.
 */
const stickyLabelColumn: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  background: 'var(--paper)',
  boxShadow: 'inset -1px 0 0 var(--rule)',
};

function onPaper(tint: string): string {
  return `linear-gradient(${tint}, ${tint}), var(--paper)`;
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
  const ruleAt = useRuleAt();
  const rowBg = highlight ? 'rgba(200, 90, 58, 0.04)' : dim ? 'rgba(255, 252, 235, 0.5)' : 'transparent';
  return (
    <tr style={{ background: rowBg }}>
      <td
        style={labelCellStyle({
          color: dim ? 'var(--ink-3)' : 'var(--ink-2)',
          ...(rowBg !== 'transparent' ? { background: onPaper(rowBg) } : null),
        })}
      >
        {label}
      </td>
      {values.map((v, i) => (
        <td key={i} style={cellStyle({ color: v === 0 ? 'var(--ink-4)' : 'var(--ink)', opacity: v === 0 ? 0.5 : 1, ...ruleAt(i) })}>
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
  const ruleAt = useRuleAt();
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
            ...ruleAt(i),
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
  const ruleAt = useRuleAt();
  return (
    <tr style={{ background: 'rgba(138, 58, 46, 0.04)' }}>
      <td
        style={labelCellStyle({
          fontWeight: 600,
          color: 'var(--ink)',
          background: onPaper('rgba(138, 58, 46, 0.04)'),
        })}
      >
        {label}
      </td>
      {values.map((v, i) => (
        <td key={i} style={cellStyle({ color: 'var(--ink)', ...ruleAt(i) })}>
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
  const ruleAt = useRuleAt();
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
            ...ruleAt(i),
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
  const ruleAt = useRuleAt();
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
            ...ruleAt(i),
          })}
        >
          {v >= 0 ? fmtNum(v) : `(${fmtNum(Math.abs(v))})`}
        </td>
      ))}
      <td style={cellStyle({ borderBottom: 'none', background: 'var(--paper)' })}></td>
    </tr>
  );
}
