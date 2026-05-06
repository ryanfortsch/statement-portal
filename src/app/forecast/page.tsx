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

export default async function ForecastPage() {
  // Run both years in parallel — 2026 forecast covers May-Dec, 2027 forecast
  // covers Jan-Dec.
  const [smart2026, smart2027] = await Promise.all([
    getSmartForecast(2026),
    getSmartForecast(2027),
  ]);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead current="forecast" />

      <HelmHero
        eyebrow="Helm · Forecast"
        title="The two-year plan,"
        emphasis="calibrated to the bank."
        description="Toggle 2026 / 2027 and slide the lever to see what each new contract does to the year. Past months use bank actuals; forward months pull live forward bookings from Guesty and project them to historical Gloucester occupancy. Each property's mgmt fee is applied at its own rate. Management business only — RT-owned units, personal draw, and healthcare are out of scope."
      />

      <ForecastClient smart2026={smart2026} smart2027={smart2027} />

      <HelmFooter
        module="Forecast"
        right="Management business only. Excludes RT-owned units, personal draw, taxes."
      />
    </div>
  );
}
