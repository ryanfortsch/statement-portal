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
  listContractorApprovals,
  listDecidedTeamApprovals,
  getAiStatus,
  explainError,
  type CleanerApproval,
  type ContractorApproval,
} from '@/lib/stay-concierge';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { loadContractorApprovalContext } from '@/lib/contractor-approval-context';
import { parseTeamAudience, showsCleaners, showsContractors, type TeamAudience } from '@/lib/team-inbox';
import { ScheduleDigestCard } from '@/app/cleaner-messaging/ScheduleDigestCard';
import { OwnerHoldQuestionsCard } from '@/app/cleaner-messaging/OwnerHoldQuestionsCard';
import * as cleanerReminders from '@/app/cleaner-messaging/reminders-actions';
import * as contractorReminders from '@/app/contractor-messaging/reminders-actions';
import { TeamInboxQueue } from './TeamInboxQueue';
import { TeamDecidedRecently } from './TeamDecidedRecently';
import { TeamQueueSummary } from './TeamQueueSummary';
import { TeamProactive } from './TeamProactive';

/**
 * The Team inbox (2026-10-18): the cleaner and contractor queues as one
 * list, each card wearing whose it is, with an All / Cleaners / Contractors
 * filter. /cleaner-messaging and /contractor-messaging redirect here with the
 * filter set. The cleaners' own asks, "clean after?" and the schedule text,
 * stay as sections under the queue on All and Cleaners. Owners stays its own
 * tab, owners only.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// Headroom for the schedule card's "Re-scan messages" action (a bounded AI
// pass over recent guest threads).
export const maxDuration = 120;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Static shell renders synchronously; data streams below via <Suspense>.
function Shell({ audience, children }: { audience: TeamAudience; children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <MessagingTabs current="team" />
      <Suspense fallback={null}>
        <AiStatusBanner />
      </Suspense>
      {/* Only a delivery problem renders here; the routine row is at the foot. */}
      <Suspense fallback={null}>
        <InboxHealth placement="top" />
      </Suspense>
      {/* The tab's pill is one number; this row names what it is made of. */}
      <Suspense fallback={null}>
        <TeamQueueSummary audience={audience} />
      </Suspense>

      {children}

      <div style={{ flex: 1 }} />

      <MessagingFooter />
    </div>
  );
}

function NotReachable({ message, retry = false }: { message: string; retry?: boolean }) {
  // `retry` tells a transient upstream failure (self-heals) from missing
  // config (refreshing forever won't set it).
  return (
    <Section title="Service not reachable" eyebrow={retry ? 'Auto-retrying' : 'Setup required'}>
      <div style={{ borderTop: '1px solid var(--ink)', padding: '20px 0', fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
        {message}
        {retry && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-4)' }}>Retrying automatically.</div>}
      </div>
      {retry && <RetryRefresh />}
    </Section>
  );
}

// Helm's own property list for the proposed-slip selector on each card.
// Independent of the concierge; a failure just yields an empty list.
async function loadProperties(): Promise<{ id: string; name: string }[]> {
  try {
    const { data, error } = await supabase.from('properties').select('id, name').order('name');
    if (error || !data) return [];
    return data as { id: string; name: string }[];
  } catch {
    return [];
  }
}

// Urgent boundary: both feeds, merged on the client. One failing feed still
// shows the other; both failing is the service being down.
async function QueueSection({ audience }: { audience: TeamAudience }) {
  const [cleaners, contractors, properties, ai] = await Promise.all([
    listCleanerApprovals(),
    listContractorApprovals(),
    loadProperties(),
    getAiStatus().catch(() => null),
  ]);
  const aiPaused = ai?.ok && !ai.data.ok ? { reason: ai.data.reason } : null;
  if (!cleaners.ok && !contractors.ok) return <NotReachable message={explainError(cleaners.error)} retry />;
  const contractorRows = contractors.ok ? contractors.data.approvals : [];
  // Infer a contractor's work-slip property from their Field run (the
  // concierge has no Field data), so the office is not handed a blank pick.
  const names = new Map(properties.map((p) => [p.id, p.name]));
  const context = await loadContractorApprovalContext(contractorRows, names).catch(() => ({}));
  return (
    <TeamInboxQueue
      initialCleaners={cleaners.ok ? cleaners.data.approvals : []}
      initialContractors={contractorRows}
      contractorContext={context}
      properties={properties}
      audience={audience}
      aiPaused={aiPaused}
    />
  );
}

// Handled cards from the last 12 hours that Undo can still reach, a quiet
// ledger under the queue. Nothing when there is nothing to undo.
async function DecidedSection({ audience }: { audience: TeamAudience }) {
  const [cleaners, contractors] = await Promise.all([
    showsCleaners(audience) ? listDecidedTeamApprovals<CleanerApproval>('cleaner', 12) : Promise.resolve(null),
    showsContractors(audience) ? listDecidedTeamApprovals<ContractorApproval>('contractor', 12) : Promise.resolve(null),
  ]);
  const items = [
    ...(cleaners?.ok ? cleaners.data.approvals : [])
      .filter((a) => a.reversible)
      .map((a) => ({
        id: a.id,
        status: a.status,
        name: a.cleaner_name || a.cleaner_contact || 'Cleaner',
        property: a.property_name || undefined,
        quote: a.cleaner_text_english || a.cleaner_text,
        at: a.resolved_at || a.created_at,
        decidedBy: a.decided_by,
        audience: 'cleaner',
      })),
    ...(contractors?.ok ? contractors.data.approvals : [])
      .filter((a) => a.reversible)
      .map((a) => ({
        id: a.id,
        status: a.status,
        name: a.contractor_name || a.contractor_contact || 'Contractor',
        quote: a.contractor_text,
        at: a.resolved_at || a.created_at,
        decidedBy: a.decided_by,
        audience: 'contractor',
      })),
  ].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  return <TeamDecidedRecently items={items} />;
}

// "Owner block: clean after?" A question with a date on it. Helm-native,
// like the schedule below it, so it renders with the Mac Mini asleep.
async function OwnerHoldSection({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return <OwnerHoldQuestionsCard notice={first(sp.ownerhold) ?? null} />;
}

// The daily checkout-schedule text (Helm-native, sends via Helm's own Quo
// credentials): renders in the unconfigured branch too, because it must
// survive a sleeping Mac Mini.
async function ScheduleDigestSection({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
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

const cleanerProactiveActions = {
  fetchReminders: cleanerReminders.fetchProactiveReminders,
  fetchTargets: cleanerReminders.fetchProactiveTargets,
  create: cleanerReminders.createProactiveReminder,
  end: cleanerReminders.endProactiveReminder,
  polish: cleanerReminders.polishProactiveForAction,
};

const contractorProactiveActions = {
  fetchReminders: contractorReminders.fetchProactiveReminders,
  fetchTargets: contractorReminders.fetchProactiveTargets,
  create: contractorReminders.createProactiveReminder,
  end: contractorReminders.endProactiveReminder,
  polish: contractorReminders.polishProactiveForAction,
};

/** One Proactive messages panel: the audience the filter shows, or on All a
 *  Cleaners / Contractors pick in its header. */
function TeamProactiveSection({ audience }: { audience: TeamAudience }) {
  if (audience === 'cleaners') return <ProactiveRemindersPanel audience="cleaner" actions={cleanerProactiveActions} />;
  if (audience === 'contractors') return <ProactiveRemindersPanel audience="contractor" actions={contractorProactiveActions} />;
  return <TeamProactive cleaner={cleanerProactiveActions} contractor={contractorProactiveActions} />;
}

export default async function TeamInboxPage({ searchParams }: { searchParams: SearchParams }) {
  const audience = parseTeamAudience((await searchParams).audience);
  const cleaners = showsCleaners(audience);
  const contractors = showsContractors(audience);

  if (!isStayConciergeConfigured()) {
    return (
      <Shell audience={audience}>
        {cleaners && (
          <>
            <Suspense fallback={null}>
              <OwnerHoldSection searchParams={searchParams} />
            </Suspense>
            <Suspense fallback={null}>
              <ScheduleDigestSection searchParams={searchParams} />
            </Suspense>
          </>
        )}
        <NotReachable message="The messaging service is not connected to Helm. Ask Ryan." />
      </Shell>
    );
  }

  // The texts waiting on a reply come first (2026-10-18), then the cleaners'
  // two dated asks the kinds row links to. Everything else is below them.
  return (
    <Shell audience={audience}>
      <Suspense fallback={<QueueSkeleton />}>
        <QueueSection audience={audience} />
      </Suspense>
      <Suspense fallback={null}>
        <DecidedSection audience={audience} />
      </Suspense>
      {cleaners && (
        <>
          <Suspense fallback={null}>
            <OwnerHoldSection searchParams={searchParams} />
          </Suspense>
          <Suspense fallback={null}>
            <ScheduleDigestSection searchParams={searchParams} />
          </Suspense>
        </>
      )}
      {cleaners && (
        <Suspense fallback={null}>
          <RecentMessageOutcomesSection audience="cleaners" title={contractors ? 'Follow-up history · Cleaners' : undefined} />
        </Suspense>
      )}
      {contractors && (
        <Suspense fallback={null}>
          <RecentMessageOutcomesSection audience="contractors" title={cleaners ? 'Follow-up history · Contractors' : undefined} />
        </Suspense>
      )}
      <TeamProactiveSection audience={audience} />
      <Suspense fallback={null}>
        <PropertyFactsToFile />
      </Suspense>
      <InboxBottomTools />
    </Shell>
  );
}
