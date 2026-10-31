import { Suspense } from 'react';
import { HomeHeading } from '@/components/HomeHeading';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { TeamActivity } from '@/components/TeamActivity';
import { HomeFeedTabs } from '@/components/HomeFeedTabs';
import { ForMeFeed, RecentPayments } from '@/components/ForMeFeed';
import { HomeSignals } from '@/components/HomeSignals';
import { AskHelm } from '@/components/AskHelm';
import { CleaningsStrip } from '@/components/CleaningsStrip';
import { AiStatusBanner } from '@/components/AiStatusBanner';
import { ConciergeAlertsLine } from '@/components/ConciergeAlerts';
import { isOwnerSession } from '@/lib/helm-access-server';

export const dynamic = 'force-dynamic';
// The day reads live from Supabase per request, so don't cache.
export const revalidate = 0;

/**
 * The home page: the signed-in person's day.
 *
 * The page itself awaits only the session and the tab, so the masthead, the
 * title and Ask Helm paint at once; the feed, the signals and the cleanings
 * strip each stream in behind their own boundary, side by side rather than
 * one after another. `loading.tsx` beside this file covers a navigation in.
 *
 * Recent Activity is a URL tab (`?tab=activity`) and renders only when it is
 * opened: it used to render hidden on every load, six queries nobody saw.
 * The route group `(home)` scopes that loading screen to this page alone; a
 * root loading.tsx would stand in for every page without its own.
 */
export default async function HelmHome({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const [owner, sp] = await Promise.all([isOwnerSession(), searchParams]);
  const tab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const activity = tab === 'activity';

  return (
    <div className="rt-home min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      {/* CONCIERGE: drafts paused, and one line counting the guest
          emergencies and alerts the concierge could not finish on its own,
          linking to their rows on Messaging. Streams in, so a slow Mac Mini
          never holds up the page; renders nothing when all is well. */}
      <Suspense fallback={null}>
        <AiStatusBanner />
      </Suspense>
      <Suspense fallback={null}>
        <ConciergeAlertsLine />
      </Suspense>

      <HomeHeading><AskHelm showSuggestions={false} /></HomeHeading>

      {/* The signed-in person's day leads; activity is one tab away and
          loads only when opened. */}
      <HomeFeedTabs active={activity ? 'activity' : 'forme'} />
      <Suspense fallback={<FeedPlaceholder />}>
        {activity ? <><RecentPayments /><TeamActivity limit={20} hideHeading /></> : <ForMeFeed />}
      </Suspense>

      {/* SIGNALS: the two numbers that change what you do today, each
          saying its window, and the month's payout for owners. */}
      <Suspense fallback={null}>
        <HomeSignals owner={owner} />
      </Suspense>

      {/* CLEANINGS: the crew's next three days, from their own Jobber
          reminders. Sits with the signals because it IS today's question
          at 9 AM: is a cleaner coming, and when. Each house's verdict is
          on its Turnovers board row. Renders nothing when the read fails. */}
      <Suspense fallback={null}>
        <CleaningsStrip />
      </Suspense>

      {/* Spacer keeps the footer pinned to the bottom whichever block is last. */}
      <div style={{ flex: 1 }} />

      <HelmFooter
        left="Rising Tide · 85 Eastern Ave · Gloucester, MA 01930"
      />
    </div>
  );
}

/** Three quiet rows where the feed will be, so it streams in without
 *  pushing the page around. */
function FeedPlaceholder() {
  return (
    <section
      aria-busy="true"
      className="max-w-[1100px] mx-auto px-10"
      style={{ width: '100%', paddingTop: 20, paddingBottom: 24 }}
    >
      <div style={{ height: 22, width: 160, background: 'var(--paper-2)', marginBottom: 12 }} />
      <div style={{ borderTop: '1px solid var(--ink)' }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ padding: '14px 0', borderBottom: '1px solid var(--rule)' }}>
            <div style={{ height: 14, width: `${60 - i * 12}%`, background: 'var(--paper-2)' }} />
          </div>
        ))}
      </div>
    </section>
  );
}
