import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { Section } from '@/components/Section';
import { MessagingTabs } from '@/components/MessagingTabs';
import { QueueSkeleton } from '@/components/QueueSkeleton';
import {
  isStayConciergeConfigured,
  listOwnerApprovals,
  listRecentOwnerApprovals,
  listOwnerHistory,
  getOwnerCuratedFacts,
  explainError,
} from '@/lib/stay-concierge';
import { OwnerMessagingQueue } from './OwnerMessagingQueue';
import { OwnerRecentStrip } from './OwnerRecentStrip';
import { OwnerContactsHistory } from './OwnerContactsHistory';
import { OwnerFactsEditor } from './OwnerFactsEditor';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Static shell renders synchronously; data streams below via <Suspense>.
function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead current="messaging" />
      <MessagingTabs current="owners" />

      <HelmHero
        eyebrow="Module 08 · Messaging"
        title="Owner replies,"
        emphasis="one tap to ship."
        paddingTop={36}
        paddingBottom={20}
      />

      {children}

      <div style={{ flex: 1 }} />

      <HelmFooter left="Stay Concierge · owner drafts via Opus 4.7" />
    </div>
  );
}

function NotReachable({ message }: { message: string }) {
  return (
    <Section title="Service not reachable" eyebrow="Setup required">
      <div
        style={{
          borderTop: '1px solid var(--ink)',
          padding: '20px 0',
          fontSize: 13,
          color: 'var(--ink-3)',
          lineHeight: 1.6,
        }}
      >
        {message}
      </div>
    </Section>
  );
}

// Urgent boundary: the owner queue + recent strip. Awaits only the two fast
// calls so the heavier contact history + curated facts never gate the queue.
async function OwnerQueueSection() {
  const [pending, recent] = await Promise.all([
    listOwnerApprovals(),
    listRecentOwnerApprovals(24),
  ]);
  if (!pending.ok) return <NotReachable message={explainError(pending.error)} />;
  return (
    <>
      <OwnerMessagingQueue initialPending={pending.data.approvals} />
      <OwnerRecentStrip initialRecent={recent.ok ? recent.data.approvals : []} />
    </>
  );
}

// Below-the-fold boundary: contact history + curated owner facts editor.
async function OwnerDetailSection() {
  const [history, facts] = await Promise.all([
    listOwnerHistory(60),
    getOwnerCuratedFacts(),
  ]);
  return (
    <>
      <OwnerContactsHistory initialContacts={history.ok ? history.data.contacts : []} />
      <OwnerFactsEditor
        initialContent={facts.ok ? facts.data.content : ''}
        initialBytes={facts.ok ? facts.data.bytes : 0}
      />
    </>
  );
}

export default function OwnerMessagingPage() {
  if (!isStayConciergeConfigured()) {
    return (
      <Shell>
        <NotReachable message="STAY_CONCIERGE_URL and STAY_CONCIERGE_KEY are not set. Pull them from the Mac Mini service config and add them to Helm in Vercel." />
      </Shell>
    );
  }

  return (
    <Shell>
      <Suspense fallback={<QueueSkeleton />}>
        <OwnerQueueSection />
      </Suspense>
      <Suspense fallback={null}>
        <OwnerDetailSection />
      </Suspense>
    </Shell>
  );
}
