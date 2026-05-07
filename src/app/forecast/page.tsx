import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { ForecastClient } from './ForecastClient';
import { isConfigured } from '@/lib/supabase';
import {
  forwardMonths,
  getBookedByPropertyByMonth,
  computeSmartForecast,
  type SmartForecast,
} from '@/lib/forecast-smart';

// We pull live booking data from Helm's guesty_reservations table — must
// be dynamic so the smart-forecast picks up new bookings without a redeploy.
export const dynamic = 'force-dynamic';

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
  // One Supabase query covering through end of 2028; split per year on
  // the client to avoid duplicated work.
  const smartAll = await getSmartForecast(2028);
  const smart2026 = filterToYear(smartAll, 2026);
  const smart2027 = filterToYear(smartAll, 2027);
  const smart2028 = filterToYear(smartAll, 2028);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead current="forecast" />

      <HelmHero
        eyebrow="Helm · Forecast"
        title="The three-year plan,"
        emphasis="calibrated to the bank."
        description="Toggle 2026 / 2027 / 2028 and dial in how many new contracts you'd add each year — earlier additions roll forward as full-year actives. Past months use bank actuals; forward months pull live Guesty bookings × historical Gloucester occupancy × each property's mgmt fee. Management business only — RT-owned units, personal draw, and healthcare are out of scope."
      />

      <ForecastClient smart2026={smart2026} smart2027={smart2027} smart2028={smart2028} />

      <HelmFooter
        module="Forecast"
        right="Management business only. Excludes RT-owned units, personal draw, taxes."
      />
    </div>
  );
}
