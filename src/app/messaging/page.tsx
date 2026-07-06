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
  getStats,
  getStatsTimeseries,
  getFacts,
  getFactAudit,
  explainError,
} from '@/lib/stay-concierge';
import { MessagingQueue } from './MessagingQueue';
import { RecentStrip } from './RecentStrip';
import { RemindersSection } from './RemindersSection';
import { PerformanceDropdown } from './PerformanceDropdown';
import { FactAuditCard } from './FactAuditCard';

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

// Urgent boundary: the pending-approval queue + reminders + recent strip.
// Awaits ONLY the two fast calls so the queue is no longer held hostage by
// the all-time stats aggregation or the weekly AI fact audit.
async function QueueSection() {
  const [pending, recent] = await Promise.all([
    listApprovals(),
    listRecentApprovals(24),
  ]);
  if (!pending.ok) return <NotReachable message={explainError(pending.error)} />;
  return (
    <>
      <MessagingQueue initialPending={pending.data.approvals} />
      <RemindersSection />
      <RecentStrip initialRecent={recent.ok ? recent.data.approvals : []} />
    </>
  );
}

// Below-the-fold boundary: performance analytics + fact audit. These are the
// slow calls (all-time stats, 30-day series, AI-generated audit); they stream
// in independently after the queue and never block it.
async function AnalyticsSection() {
  const [stats, facts, ts, audit] = await Promise.all([
    // Default the stats window to All-time (hours=0). The 7d window is thin
    // because /messaging only just went live; All-time is where the real
    // "is the AI getting it right?" signal lives.
    getStats(0),
    getFacts(20),
    getStatsTimeseries(30),
    getFactAudit(),
  ]);
  return (
    <>
      <PerformanceDropdown
        initialStats={stats.ok ? stats.data : null}
        initialError={stats.ok ? null : explainError(stats.error)}
        initialFacts={facts.ok ? facts.data.facts : []}
        totalFacts={facts.ok ? facts.data.total_facts : 0}
        initialTimeseries={ts.ok ? ts.data.series : []}
        initialAvailableTopics={ts.ok ? ts.data.available_topics : []}
      />
      <FactAuditCard
        initial={audit.ok ? audit.data : null}
        initialError={audit.ok ? null : explainError(audit.error)}
      />
    </>
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
        <AnalyticsSection />
      </Suspense>
    </Shell>
  );
}
