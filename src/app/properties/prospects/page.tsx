import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { ProspectsPanel } from '@/components/projections/ProspectsPanel';
import { PropertiesTabBar } from '../PropertiesTabBar';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

/** The prospect funnel, promoted from /properties?view=prospects to its own
 *  route. ProspectsPanel fetches its own data; this page supplies the
 *  chrome. A prospect here is a deal (a projections row). Adding a home we
 *  may sign, which makes a properties row, lives on /properties. */
export default function ProspectsPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <HelmHero plain eyebrow="Helm · Properties" title="Prospects" />

      <PropertiesTabBar active="prospects" />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <ProspectsPanel />
      </div>

      <HelmFooter module="Properties" right="Source: Helm" />
    </div>
  );
}
