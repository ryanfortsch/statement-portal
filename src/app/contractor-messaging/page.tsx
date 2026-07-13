import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { Section } from '@/components/Section';
import { MessagingTabs } from '@/components/MessagingTabs';
import { QueueSkeleton } from '@/components/QueueSkeleton';
import { ProactiveRemindersPanel } from '@/components/ProactiveRemindersPanel';
import {
  isStayConciergeConfigured,
  listContractorApprovals,
  listRecentContractorApprovals,
  listProposedPropertyUpdates,
  explainError,
} from '@/lib/stay-concierge';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { ContractorMessagingQueue } from './ContractorMessagingQueue';
import { loadContractorApprovalContext } from '@/lib/contractor-approval-context';
import { ProposedPropertyUpdatesCard } from '../owner-messaging/ProposedPropertyUpdatesCard';
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
      <MessagingTabs current="contractors" />

      {children}

      <div style={{ flex: 1 }} />

      <HelmFooter left="Stay Concierge · contractor drafts via Opus 4.7" />
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

// Urgent boundary: the contractor queue + proactive panel. recent is fetched
// for parity with the cleaner page (the strip is not rendered yet) but never
// gates anything the operator sees.
async function QueueSection() {
  const [pending, , properties] = await Promise.all([
    listContractorApprovals(),
    listRecentContractorApprovals(24),
    loadProperties(),
  ]);
  if (!pending.ok) return <NotReachable message={explainError(pending.error)} />;
  // Infer the work-slip property from the sender's Field run (stay-concierge
  // can't — it has no Field data), so the office isn't handed a blank dropdown.
  const propertyNames = new Map(properties.map((p) => [p.id, p.name]));
  const approvalContext = await loadContractorApprovalContext(pending.data.approvals, propertyNames).catch(() => ({}));
  return (
    <>
      <ContractorMessagingQueue initialPending={pending.data.approvals} properties={properties} context={approvalContext} />
      <ProactiveRemindersPanel
        audience="contractor"
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

// Mid boundary: property facts contractors shared (the contractor-sourced
// slice of the same extractor feeding /owner-messaging), ready to file to the
// property.
async function ProposedUpdatesSection() {
  const [proposed, properties] = await Promise.all([
    listProposedPropertyUpdates('contractor'),
    loadProperties(),
  ]);
  return (
    <ProposedPropertyUpdatesCard
      initial={proposed.ok ? proposed.data.updates : []}
      initialError={proposed.ok ? null : explainError(proposed.error)}
      properties={properties}
      source="contractor"
    />
  );
}

export default function ContractorMessagingPage() {
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
        <ProposedUpdatesSection />
      </Suspense>
    </Shell>
  );
}
