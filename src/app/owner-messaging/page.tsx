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
  listOwnerHistory,
  listDecidedTeamApprovals,
  getAiStatus,
  explainError,
  type OwnerApproval,
} from '@/lib/stay-concierge';
import { DecidedRecently } from '@/components/messaging/card/DecidedRecently';
import { prettifySlug } from '@/app/messaging/format';
import { ProactiveRemindersPanel } from '@/components/ProactiveRemindersPanel';
import { PropertyFactsToFile } from '@/components/PropertyFactsToFile';
import { InboxHealth } from '@/components/InboxHealth';
import { InboxBottomTools } from '@/components/InboxBottomTools';
import { OwnerMessagingQueue } from './OwnerMessagingQueue';
import { undoOwnerDecision } from './actions';
import { OwnerContactsHistory } from './OwnerContactsHistory';
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
      {/* Only a delivery problem renders here; the routine row is at the foot. */}
      <Suspense fallback={null}>
        <InboxHealth placement="top" />
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
// The queue alone: it is the first thing on the page (2026-10-18). The "Last
// 24 hours" strip is gone (the contact history below carries every reply),
// and Proactive messages moved to the foot.
async function OwnerQueueSection() {
  const [pending, ai] = await Promise.all([listOwnerApprovals(), getAiStatus().catch(() => null)]);
  if (!pending.ok) return <NotReachable message={explainError(pending.error)} retry />;
  const aiPaused = ai?.ok && !ai.data.ok ? { reason: ai.data.reason } : null;
  return <OwnerMessagingQueue initialPending={pending.data.approvals} aiPaused={aiPaused} />;
}

// Handled owner cards from the last 12 hours that Undo can still reach.
async function DecidedSection() {
  const res = await listDecidedTeamApprovals<OwnerApproval>('owner', 12);
  if (!res.ok) return null;
  const items = res.data.approvals
    .filter((a) => a.reversible)
    .map((a) => ({
      id: a.id,
      status: a.status,
      name: a.owner_name || a.owner_contact || 'Owner',
      property: a.property_name || prettifySlug(a.property_id) || undefined,
      quote: a.owner_text,
      at: a.resolved_at || a.created_at,
      decidedBy: a.decided_by,
    }));
  return <DecidedRecently items={items} undo={undoOwnerDecision} />;
}

function OwnerProactive() {
  return (
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
  );
}

// The facts owners share ("Proposed property updates") are filed from the
// Quality lens (/messaging/quality, owner sessions only) since 2026-10-17;
// this page keeps the one-line count.

// Below-the-fold boundary: contact history + curated owner facts editor.
// The owner facts editor (rules the owner drafter applies) lives on the
// Quality lens with the rest of what teaches the AI (2026-10-18).
async function OwnerDetailSection() {
  const history = await listOwnerHistory(60);
  return <OwnerContactsHistory initialContacts={history.ok ? history.data.contacts : []} />;
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
      <Suspense fallback={null}>
        <DecidedSection />
      </Suspense>
      <Suspense fallback={null}><RecentMessageOutcomesSection audience="owners" /></Suspense>
      <Suspense fallback={null}>
        <OwnerDetailSection />
      </Suspense>
      <OwnerProactive />
      <Suspense fallback={null}><PropertyFactsToFile /></Suspense>
      <InboxBottomTools />
    </Shell>
  );
}
