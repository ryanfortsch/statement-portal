import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { Section } from '@/components/Section';
import { MessagingTabs } from '@/components/MessagingTabs';
import { QueueSkeleton } from '@/components/QueueSkeleton';
import {
  isStayConciergeConfigured,
  listApprovals,
  listRecentApprovals,
  listConversations,
  getStats,
  getStatsTimeseries,
  getFacts,
  getFactAudit,
  explainError,
} from '@/lib/stay-concierge';
import { MessagingQueue } from './MessagingQueue';
import { RemindersSection } from './RemindersSection';
import { ConversationsBrowser } from './Conversations';
import { PerformanceDropdown } from './PerformanceDropdown';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Static shell: masthead, tabs, hero, footer. Renders synchronously with NO
// backend call, so the page paints the instant a navigation lands. The slow
// data streams in below via <Suspense>, so it never gates first paint.
function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead current="messaging" />
      <MessagingTabs current="guests" />

      {children}

      <div style={{ flex: 1 }} />

      <HelmFooter left="Stay Concierge · drafts via Opus 4.7" />
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

// Urgent boundary: the pending-approval queue + reminders. Awaits ONLY the
// fast queue call so it is never held hostage by the slower aggregations.
async function QueueSection() {
  const pending = await listApprovals();
  if (!pending.ok) return <NotReachable message={explainError(pending.error)} />;
  return (
    <>
      <MessagingQueue initialPending={pending.data.approvals} />
      <RemindersSection />
    </>
  );
}

// The Guesty-inbox replacement: every recent guest conversation, expandable
// in place into the full thread with a manual-reply composer. Its own
// boundary because the first cold gather pages the Guesty API (cached 90s
// on the concierge after that).
async function ConversationsSection() {
  const conversations = await listConversations(60);
  return (
    <ConversationsBrowser
      initialConversations={conversations.ok ? conversations.data.conversations : []}
      initialError={conversations.ok ? null : explainError(conversations.error)}
    />
  );
}

// Below-the-fold boundary: the tabbed Performance section (score / last-24h
// activity / learning + weekly fact audit). Slow calls; they stream in
// independently after the queue and never block it.
async function AnalyticsSection() {
  const [stats, facts, ts, audit, recent] = await Promise.all([
    // Default the stats window to All-time (hours=0). The 7d window is thin
    // because /messaging only just went live; All-time is where the real
    // "is the AI getting it right?" signal lives.
    getStats(0),
    getFacts(20),
    getStatsTimeseries(30),
    getFactAudit(),
    listRecentApprovals(24),
  ]);
  return (
    <PerformanceDropdown
      initialStats={stats.ok ? stats.data : null}
      initialError={stats.ok ? null : explainError(stats.error)}
      initialFacts={facts.ok ? facts.data.facts : []}
      totalFacts={facts.ok ? facts.data.total_facts : 0}
      initialTimeseries={ts.ok ? ts.data.series : []}
      initialAvailableTopics={ts.ok ? ts.data.available_topics : []}
      initialRecent={recent.ok ? recent.data.approvals : []}
      audit={audit.ok ? audit.data : null}
      auditError={audit.ok ? null : explainError(audit.error)}
    />
  );
}

export default function MessagingPage() {
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
        <QueueSection />
      </Suspense>
      <Suspense fallback={null}>
        <ConversationsSection />
      </Suspense>
      <Suspense fallback={null}>
        <AnalyticsSection />
      </Suspense>
    </Shell>
  );
}
