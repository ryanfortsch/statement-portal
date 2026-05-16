import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { ForecastClient } from './ForecastClient';
import { isConfigured } from '@/lib/supabase';
import {
  forwardMonths,
  getBookedByPropertyByMonth,
  computeSmartForecast,
  type SmartForecast,
} from '@/lib/forecast-smart';
import { ACTUALS_WINDOW } from '@/lib/forecast-actuals';
import { getProspectForecast } from '@/lib/forecast-prospects';
import {
  getStatementRevenueByMonth,
  type StatementRevenueByMonth,
} from '@/lib/forecast-statement-actuals';

// We pull live booking data from Helm's guesty_reservations table — must
// be dynamic so the smart-forecast picks up new bookings without a redeploy.
export const dynamic = 'force-dynamic';

/**
 * 10-K-style cover sheet. Plain Inter, structured key/value rows, no
 * editorial flourishes. Replaces HelmHero on this page because the
 * forecast is a financial document, not editorial content.
 */
function CoverSheet() {
  const asOf = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const rows: Array<[string, React.ReactNode]> = [
    ['Entity', 'Rising Tide STR LLC · management business only'],
    ['Period', 'Jan 2026 – Dec 2028 · 36 months'],
    ['As of', asOf],
    [
      'Sources',
      'Chase ...5130 (operating account), Guesty (forward bookings), Cape Ann market occupancy 2018-2026',
    ],
    ['Currency', 'USD'],
    [
      'Excluded',
      'RT-owned units (3 Locust, Lighthouse Point, 65 Calderwood), personal owner draw, healthcare, federal/state taxes, capex, distributions',
    ],
  ];

  return (
    <section
      className="max-w-[1100px] mx-auto px-10"
      style={{ paddingTop: 40, paddingBottom: 28, width: '100%' }}
    >
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
          marginBottom: 12,
        }}
      >
        Helm · Forecast
      </div>
      <h1
        style={{
          fontFamily: 'var(--font-inter), system-ui, sans-serif',
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: '-0.005em',
          color: 'var(--ink)',
          margin: 0,
        }}
      >
        FY 2026 – 2028 Financial Forecast
      </h1>
      <details
        style={{
          marginTop: 14,
          borderTop: '1px solid var(--ink)',
        }}
      >
        <summary
          style={{
            padding: '10px 0 0',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono-dash), monospace',
            fontSize: 10,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-4)',
            userSelect: 'none',
            listStyle: 'none',
          }}
        >
          Assumptions & sources
          <span
            style={{
              marginLeft: 8,
              fontSize: 11,
              letterSpacing: '.04em',
              textTransform: 'none',
              color: 'var(--ink-4)',
            }}
          >
            (expand)
          </span>
        </summary>
        <div
          style={{
            marginTop: 12,
            display: 'grid',
            gridTemplateColumns: '120px 1fr',
            gap: '6px 24px',
            fontSize: 12,
            lineHeight: 1.55,
          }}
        >
          {rows.map(([k, v]) => (
            <CoverRow key={k} k={k} v={v} />
          ))}
        </div>
      </details>
    </section>
  );
}

/**
 * Banner that surfaces if the bank-derived actuals are more than 30 days
 * old — prompts Dotti to drop a fresh Chase + corporate-card CSV.
 */
function StaleDataBanner() {
  const today = new Date();
  const exportDate = new Date(ACTUALS_WINDOW.rangeEnd);
  const daysSince = Math.floor((today.getTime() - exportDate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince <= 30) return null;
  return (
    <section
      className="max-w-[1100px] mx-auto px-10"
      style={{ paddingBottom: 12, width: '100%' }}
    >
      <div
        style={{
          border: '1px solid var(--signal)',
          background: 'rgba(200, 90, 58, 0.06)',
          padding: '12px 16px',
          fontSize: 12,
          lineHeight: 1.5,
          color: 'var(--ink-2)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono-dash), monospace',
            fontSize: 10,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: 'var(--signal)',
            fontWeight: 700,
            paddingTop: 2,
            whiteSpace: 'nowrap',
          }}
        >
          Action needed
        </span>
        <span>
          Bank actuals are <strong>{daysSince} days old</strong> (last export:{' '}
          {ACTUALS_WINDOW.exportFile}). Re-export the Chase ...5130 transaction CSV and the Rising
          Tide corporate card CSV, then re-run the parser to refresh actuals through the latest
          activity month.
        </span>
      </div>
    </section>
  );
}

function CoverRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <span
        className="font-mono"
        style={{
          fontSize: 10,
          letterSpacing: '.16em',
          color: 'var(--ink-4)',
          textTransform: 'uppercase',
          paddingTop: 1,
        }}
      >
        {k}
      </span>
      <span style={{ color: 'var(--ink-2)' }}>{v}</span>
    </>
  );
}

async function getSmartForecast(endYear: number): Promise<SmartForecast | null> {
  if (!isConfigured) return null;
  try {
    const today = new Date();
    const months = forwardMonths(today, endYear);
    if (months.length === 0) return null;
    const { bookedByPropMonth, properties } = await getBookedByPropertyByMonth(months);
    return computeSmartForecast(months, bookedByPropMonth, properties);
  } catch (err) {
    console.error('[forecast] smart forecast failed:', err);
    return null;
  }
}

/**
 * Filter a SmartForecast down to the months that fall within `year`. We
 * fetch one big forecast covering through 2028 and split per year on
 * the client; that's cheaper than running three separate Supabase
 * queries with overlapping ranges.
 */
function filterToYear(smart: SmartForecast | null, year: number): SmartForecast | null {
  if (!smart) return null;
  const months = smart.months.filter((ym) => parseInt(ym.split('-')[0], 10) === year);
  if (months.length === 0) {
    // No forward months in that year — return an empty-but-shaped forecast.
    return {
      months: [],
      monthInputs: [],
      properties: smart.properties.map((p) => ({
        property: p.property,
        monthly: [],
        totals: { bookedRevenue: 0, projectedGross: 0, projectedMgmtFee: 0 },
      })),
      totals: { bookedRevenue: 0, projectedGross: 0, projectedMgmtFee: 0 },
    };
  }
  const monthInputs = smart.monthInputs.filter((mi) => months.includes(mi.month));
  const properties = smart.properties.map((p) => {
    const monthly = p.monthly.filter((c) => months.includes(c.month));
    const totals = monthly.reduce(
      (acc, m) => ({
        bookedRevenue: acc.bookedRevenue + m.bookedRevenue,
        projectedGross: acc.projectedGross + m.projectedGross,
        projectedMgmtFee: acc.projectedMgmtFee + m.projectedMgmtFee,
      }),
      { bookedRevenue: 0, projectedGross: 0, projectedMgmtFee: 0 }
    );
    return { property: p.property, monthly, totals };
  });
  const totals = properties.reduce(
    (acc, p) => ({
      bookedRevenue: acc.bookedRevenue + p.totals.bookedRevenue,
      projectedGross: acc.projectedGross + p.totals.projectedGross,
      projectedMgmtFee: acc.projectedMgmtFee + p.totals.projectedMgmtFee,
    }),
    { bookedRevenue: 0, projectedGross: 0, projectedMgmtFee: 0 }
  );
  return { months, monthInputs, properties, totals };
}

export default async function ForecastPage() {
  // Pull Guesty bookings + Helm prospects pipeline + reconciled statements
  // in parallel. Statements feed actual mgmt-fee revenue per closed month.
  const [smartAll, prospects2026, prospects2027, prospects2028, statementRevenue] = await Promise.all([
    getSmartForecast(2028),
    getProspectForecast(2026),
    getProspectForecast(2027),
    getProspectForecast(2028),
    getStatementRevenueByMonth(),
  ]);
  const smart2026 = filterToYear(smartAll, 2026);
  const smart2027 = filterToYear(smartAll, 2027);
  const smart2028 = filterToYear(smartAll, 2028);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead current="forecast" />

      <CoverSheet />
      <StaleDataBanner />


      <ForecastClient
        smart2026={smart2026}
        smart2027={smart2027}
        smart2028={smart2028}
        prospects2026={prospects2026}
        prospects2027={prospects2027}
        prospects2028={prospects2028}
        statementRevenue={statementRevenue}
      />

      <HelmFooter
        module="Forecast"
        right="Management business only. Excludes RT-owned units, personal draw, taxes."
      />
    </div>
  );
}
