import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
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
  listProposedPropertyUpdates,
  explainError,
} from '@/lib/stay-concierge';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { ProactiveRemindersPanel } from '@/components/ProactiveRemindersPanel';
import { OwnerMessagingQueue } from './OwnerMessagingQueue';
import { OwnerRecentStrip } from './OwnerRecentStrip';
import { OwnerContactsHistory } from './OwnerContactsHistory';
import { OwnerFactsEditor } from './OwnerFactsEditor';
import { ProposedPropertyUpdatesCard } from './ProposedPropertyUpdatesCard';
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
      <HelmMasthead current="messaging" />
      <MessagingTabs current="owners" />

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

// Helm's own property list (anon-readable id + name) for the target selector
// on each proposed update. Independent of the stay-concierge service; a
// failure here just yields an empty list (operator can still dismiss, and the
// synced slug usually matches).
async function loadProperties(): Promise<{ id: string; name: string }[]> {
  try {
    const { data, error } = await supabase.from('properties').select('id, name').order('name');
    if (error || !data) return [];
    return data as { id: string; name: string }[];
  } catch {
    return [];
  }
}

// Mid boundary: property facts owners shared, ready to file to the property.
async function ProposedUpdatesSection() {
  const [proposed, properties] = await Promise.all([
    listProposedPropertyUpdates(),
    loadProperties(),
  ]);
  return (
    <ProposedPropertyUpdatesCard
      initial={proposed.ok ? proposed.data.updates : []}
      initialError={proposed.ok ? null : explainError(proposed.error)}
      properties={properties}
    />
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
        learnedContent={facts.ok ? facts.data.learned ?? '' : ''}
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
        <ProposedUpdatesSection />
      </Suspense>
      <Suspense fallback={null}>
        <OwnerDetailSection />
      </Suspense>
    </Shell>
  );
}
