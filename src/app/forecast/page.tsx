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
        emphasis="modeled live."
        description="Slide the lever to see what each new contract does to the year. Management business only: nine current managed properties, three pre-signed contracts, and however many new mandates we choose to chase. RT-owned units and personal draw are out of scope."
      />

      <ForecastClient />

      <HelmFooter
        module="Forecast"
        right="Management business only. Excludes RT-owned units, personal draw, taxes."
      />
    </div>
  );
}
