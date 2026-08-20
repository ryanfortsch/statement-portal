import { HelmMasthead } from '@/components/HelmMasthead';
import { MarketingTabs } from '@/components/MarketingTabs';
import { HelmFooter } from '@/components/HelmFooter';
import { GuestsTabBar } from './GuestsTabBar';
import { ReviewsTab, type ReviewsTabParams } from './ReviewsTab';

export const dynamic = 'force-dynamic';

// Reviews is the DEFAULT lens for the Guests section: opening /guests lands
// here. Contacts and Agreements are real routes now (/guests/contacts,
// /guests/agreements); old ?tab= URLs are handled by next.config redirects.
// The ?days / rating / channel / property filters stay on this bare path so
// deep links like /guests?days=30 keep working.
export default async function GuestPage({
  searchParams,
}: {
  searchParams: Promise<ReviewsTabParams>;
}) {
  const sp = await searchParams;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <MarketingTabs current="guests" />
      {/* No hero headline on Reviews, straight to the work. Keep the eyebrow so the section stays labeled. */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 20, width: '100%' }}>
        <div className="eyebrow">Helm &middot; Guests</div>
      </section>
      <GuestsTabBar active="reviews" />
      <ReviewsTab params={sp} />
      <HelmFooter module="Guests" right="Source: Guesty" />
    </div>
  );
}
