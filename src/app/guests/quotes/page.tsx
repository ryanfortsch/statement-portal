import { HelmMasthead } from '@/components/HelmMasthead';
import { MarketingTabs } from '@/components/MarketingTabs';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { GuestsTabBar } from '../GuestsTabBar';
import { QuotesTab } from '../QuotesTab';

export const dynamic = 'force-dynamic';

// The Quotes lens of the Guests section: Stay Cape Ann custom quotes and
// booking requests. Composed here, accepted and paid on staycapeann.com.
export default function QuotesIndexPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <MarketingTabs current="guests" />
      <HelmHero
        eyebrow="Helm · Guests"
        title="Quoted,"
        emphasis="then booked."
        description="Custom quotes and booking requests for Stay Cape Ann. Compose the price here, the guest accepts and pays on staycapeann.com, and the reservation lands in Guesty at the quoted rate."
      />
      <GuestsTabBar active="quotes" />
      <QuotesTab />
      <HelmFooter module="Guests" right="Stay Cape Ann · Rising Tide" />
    </div>
  );
}
