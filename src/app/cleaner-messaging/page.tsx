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
import { ProactiveRemindersPanel } from '@/components/ProactiveRemindersPanel';
import { PropertyFactsToFile } from '@/components/PropertyFactsToFile';
import { InboxHealth } from '@/components/InboxHealth';
import { InboxBottomTools } from '@/components/InboxBottomTools';
import {
  isStayConciergeConfigured,
  listCleanerApprovals,
  listDecidedTeamApprovals,
  explainError,
  type CleanerApproval,
} from '@/lib/stay-concierge';
import { DecidedRecently } from '@/components/messaging/card/DecidedRecently';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { CleanerMessagingQueue } from './CleanerMessagingQueue';
import { undoCleanerDecision } from './actions';
import { CleanerQueueSummary } from './CleanerQueueSummary';
import { ScheduleDigestCard } from './ScheduleDigestCard';
import { OwnerHoldQuestionsCard } from './OwnerHoldQuestionsCard';
import {
  fetchProactiveReminders,
  fetchProactiveTargets,
  createProactiveReminder,
  endProactiveReminder,
  polishProactiveForAction,
} from './reminders-actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// Headroom for the digest card's "Re-scan messages" action (a bounded
// AI pass over recent guest threads).
export const maxDuration = 120;

// Static shell renders synchronously; data streams below via <Suspense>.
function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead />
      <MessagingTabs current="cleaners" />
      {/* Streams in: the shell must still paint with no backend call. */}
      <Suspense fallback={null}>
        <AiStatusBanner />
      </Suspense>
      {/* Only a delivery problem renders here; the routine row is at the foot. */}
      <Suspense fallback={null}>
        <InboxHealth placement="top" />
      </Suspense>
      {/* The tab's pill is one number; this row names what it is made of. */}
      <Suspense fallback={null}>
        <CleanerQueueSummary />
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

// Helm's own property list (anon-readable id + name) for the proposed-slip
// selector on each approval card and the target selector on each proposed
// update. Independent of the stay-concierge service; a failure here just
// yields an empty list.
async function loadProperties(): Promise<{ id: string; name: string }[]> {
  try {
    const { data, error } = await supabase.from('properties').select('id, name').order('name');
    if (error || !data) return [];
    return data as { id: string; name: string }[];
  } catch {
    return [];
  }
}

// Urgent boundary: the cleaner queue.
async function QueueSection() {
  const [pending, properties] = await Promise.all([
    listCleanerApprovals(),
    loadProperties(),
  ]);
  if (!pending.ok) return <NotReachable message={explainError(pending.error)} retry />;
  return <CleanerMessagingQueue initialPending={pending.data.approvals} properties={properties} />;
}

// Handled cards from the last 12 hours that Undo can still reach, a quiet
// ledger under the queue. Nothing when there is nothing to undo.
async function DecidedSection() {
  const res = await listDecidedTeamApprovals<CleanerApproval>('cleaner', 12);
  if (!res.ok) return null;
  const items = res.data.approvals
    .filter((a) => a.reversible)
    .map((a) => ({
      id: a.id,
      status: a.status,
      name: a.cleaner_name || a.cleaner_contact || 'Cleaner',
      property: a.property_name || undefined,
      quote: a.cleaner_text_english || a.cleaner_text,
      at: a.resolved_at || a.created_at,
      decidedBy: a.decided_by,
    }));
  return <DecidedRecently items={items} undo={undoCleanerDecision} />;
}

// Proactive messages sit at the foot of the page, out of the queue's way.
function CleanerProactive() {
  return (
      <ProactiveRemindersPanel
        audience="cleaner"
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

// The facts cleaners share ("Proposed property updates") are filed from the
// Quality lens (/messaging/quality) since 2026-10-17; this page keeps the
// one-line count.

// "Owner block: clean after?" Above everything, because it is a question
// with a date on it and the operator asked to see it loudly. Helm-native,
// like the digest below it, so it renders with the Mac Mini asleep.
async function OwnerHoldSection({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return <OwnerHoldQuestionsCard notice={first(sp.ownerhold) ?? null} />;
}

// The daily checkout-schedule digest (Helm-native, sends via Helm's own
// Quo credentials): rendered ABOVE the concierge queue and in the
// unconfigured branch too, because it must survive a sleeping Mac Mini.
async function ScheduleDigestSection({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return (
    <ScheduleDigestCard
      notice={{
        sent: first(sp.sent),
        failed: first(sp.failed),
        err: first(sp.err),
        noclean: first(sp.noclean),
        nocleanSent: first(sp.noclean_sent),
      }}
    />
  );
}

export default function CleanerMessagingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isStayConciergeConfigured()) {
    return (
      <Shell>
        <Suspense fallback={null}>
          <OwnerHoldSection searchParams={searchParams} />
        </Suspense>
        <Suspense fallback={null}>
          <ScheduleDigestSection searchParams={searchParams} />
        </Suspense>
        <NotReachable message="The messaging service is not connected to Helm. Ask Ryan." />
      </Shell>
    );
  }

  // The texts waiting on a reply come first (2026-10-18), then the two
  // dated asks the kinds row above links to: "clean after?" and the
  // schedule text. Everything else is below them.
  return (
    <Shell>
      <Suspense fallback={<QueueSkeleton />}>
        <QueueSection />
      </Suspense>
      <Suspense fallback={null}>
        <DecidedSection />
      </Suspense>
      <Suspense fallback={null}>
        <OwnerHoldSection searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={null}>
        <ScheduleDigestSection searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={null}><RecentMessageOutcomesSection audience="cleaners" /></Suspense>
      <CleanerProactive />
      <Suspense fallback={null}><PropertyFactsToFile /></Suspense>
      <InboxBottomTools />
    </Shell>
  );
}
