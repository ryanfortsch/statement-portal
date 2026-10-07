import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { ProspectsPanel } from '@/components/projections/ProspectsPanel';
import { AddProspectForm } from './AddProspectForm';
import { PropertiesTabBar } from '../PropertiesTabBar';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

/** The prospect funnel, promoted from /properties?view=prospects to its own
 *  route. ProspectsPanel fetches its own data; this page supplies the chrome
 *  plus the quick add-a-prospect form (which lives with the funnel now that
 *  prospects have a home of their own). */
export default function ProspectsPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <HelmHero
        eyebrow="Helm · Properties"
        title="All Rising Tide"
        emphasis="prospects."
        description="The prospect funnel, in one place."
      />

      <PropertiesTabBar active="prospects" />

      <ProspectsPanel />

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <AddProspectForm />
      </section>

      <HelmFooter module="Properties" right="Source: Helm" />
    </div>
  );
}
