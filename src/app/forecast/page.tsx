import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { ForecastClient } from './ForecastClient';

export const dynamic = 'force-static';

export default function ForecastPage() {
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
        description="Toggle 2026 / 2027 and slide the lever to see what each new contract does to the year. Expense lines are calibrated to 12 months of Chase ...5130 actuals — office rent, MH Partners debt (retiring June 2026), insurance, accounting, software, and the operating CC pass-through. Pre-signed for 2026: 5 contracts (incl. 79 Main and 16 Waterman) landing May/Jun. Management business only — RT-owned units, personal draw, and healthcare are out of scope."
      />

      <ForecastClient />

      <HelmFooter
        module="Forecast"
        right="Management business only. Excludes RT-owned units, personal draw, taxes."
      />
    </div>
  );
}
