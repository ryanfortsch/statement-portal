import { HelmMasthead } from '@/components/HelmMasthead';
import { MarketingTabs } from '@/components/MarketingTabs';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { GuestsTabBar } from '../GuestsTabBar';
import { AgreementsTab } from '../AgreementsTab';

export const dynamic = 'force-dynamic';

// The Agreements lens of the Guests section: bespoke Stay Cape Ann rental
// agreements for direct and mid-term stays. Was a ?tab=agreements lens on
// /guests; old ?tab= URLs are handled by next.config redirects.
export default function AgreementsIndexPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <MarketingTabs current="guests" />
      <HelmHero
        eyebrow="Helm · Guests"
        title="Signed,"
        emphasis="before they check in."
        description="Bespoke rental agreements for direct and mid-term stays, issued under the Stay Cape Ann brand and countersigned in Helm."
      />
      <GuestsTabBar active="agreements" />
      <AgreementsTab />
      <HelmFooter module="Guests" right="Stay Cape Ann · Rising Tide" />
    </div>
  );
}
