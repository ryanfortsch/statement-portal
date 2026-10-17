import { RecentMessageOutcomesSection } from '@/components/RecentMessageOutcomesSection';
import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { MessagingFooter } from '@/components/MessagingFooter';
import { Section } from '@/components/Section';
import { RetryRefresh } from '@/components/RetryRefresh';
import { MessagingTabs } from '@/components/MessagingTabs';
import { AiStatusBanner } from '@/components/AiStatusBanner';
import { QueueSkeleton } from '@/components/QueueSkeleton';
import {
  isStayConciergeConfigured,
  listOwnerApprovals,
  listRecentOwnerApprovals,
  listOwnerHistory,
  getOwnerCuratedFacts,
  explainError,
} from '@/lib/stay-concierge';
import { ProactiveRemindersPanel } from '@/components/ProactiveRemindersPanel';
import { PropertyFactsToFile } from '@/components/PropertyFactsToFile';
import { OwnerMessagingQueue } from './OwnerMessagingQueue';
import { OwnerRecentStrip } from './OwnerRecentStrip';
import { OwnerContactsHistory } from './OwnerContactsHistory';
import { OwnerFactsEditor } from './OwnerFactsEditor';
import {
  fetchProactiveReminders,
  fetchProactiveTargets,
  createProactiveReminder,
  endProactiveReminder,
  polishProactiveForAction,
} from './reminders-actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Static shell renders synchronously; data streams below via <Suspense>.
function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead />
      <MessagingTabs current="owners" />
      {/* Streams in: the shell must still paint with no backend call. */}
      <Suspense fallback={null}>
        <AiStatusBanner />
      </Suspense>

      {children}

      <div style={{ flex: 1 }} />

      <MessagingFooter />
    </div>
  );
}

function NotReachable({ message, retry = false }: { message: string; retry?: boolean }) {
  // `retry` distinguishes a transient upstream failure (self-heals via
  // RetryRefresh) from missing env config (refreshing forever won't set it).
  return (
    <Section title="Service not reachable" eyebrow={retry ? 'Auto-retrying' : 'Setup required'}>
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
        {retry && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-4)' }}>
            Retrying automatically.
          </div>
        )}
      </div>
      {retry && <RetryRefresh />}
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
  if (!pending.ok) return <NotReachable message={explainError(pending.error)} retry />;
  return (
    <>
      <OwnerMessagingQueue initialPending={pending.data.approvals} />
      <OwnerRecentStrip initialRecent={recent.ok ? recent.data.approvals : []} />
      <ProactiveRemindersPanel
        audience="owner"
        actions={{
          fetchReminders: fetchProactiveReminders,
          fetchTargets: fetchProactiveTargets,
          create: createProactiveReminder,
          end: endProactiveReminder,
          polish: polishProactiveForAction,
        }}
      />
    </>
  );
}

// The facts owners share ("Proposed property updates") are filed from the
// Quality lens (/messaging/quality, owner sessions only) since 2026-10-17;
// this page keeps the one-line count.

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
        learnedContent={facts.ok ? facts.data.learned ?? '' : ''}
      />
    </>
  );
}

export default function OwnerMessagingPage() {
  if (!isStayConciergeConfigured()) {
    return (
      <Shell>
        <NotReachable message="The messaging service is not connected to Helm. Ask Ryan." />
      </Shell>
    );
  }

  return (
    <Shell>
      <Suspense fallback={<QueueSkeleton />}>
        <OwnerQueueSection />
      </Suspense>
      <Suspense fallback={null}><RecentMessageOutcomesSection audience="owners" /></Suspense>
      <Suspense fallback={null}><PropertyFactsToFile /></Suspense>
      <Suspense fallback={null}>
        <OwnerDetailSection />
      </Suspense>
    </Shell>
  );
}
