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
        title="The 2026 plan,"
        emphasis="if everything works."
        description="Slide the lever to see what each new contract does to the year. The model layers nine current properties, three pre-signed contracts, three Rising Tide-owned units, and however many new mandates we choose to chase."
      />

      <ForecastClient />

      <HelmFooter
        module="Forecast"
        right="Excludes taxes. Personal draw $12K Jan-Mar, $21.2K Apr-Dec."
      />
    </div>
  );
}
