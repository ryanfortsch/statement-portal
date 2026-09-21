import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { Section } from '@/components/Section';
import { RetryRefresh } from '@/components/RetryRefresh';
import { MessagingTabs } from '@/components/MessagingTabs';
import { AiStatusBanner } from '@/components/AiStatusBanner';
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
  listProposedPropertyUpdates,
  explainError,
} from '@/lib/stay-concierge';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { loadGuestQuoteContext } from '@/lib/guest-quote-context';
import { MessagingQueue } from './MessagingQueue';
import { RecentDecisions } from './RecentDecisions';
import { ConversationsBrowser } from './Conversations';
import { PerformanceDropdown } from './PerformanceDropdown';
import { TriagedPropertyUpdates } from './TriagedPropertyUpdates';

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
      <HelmMasthead />
      <MessagingTabs current="guests" lens="inbox" />
      {/* Streams in: the shell must still paint with no backend call. */}
      <Suspense fallback={null}>
        <AiStatusBanner />
      </Suspense>

      {children}

      <div style={{ flex: 1 }} />

      <HelmFooter left="Stay Concierge · drafts via Opus 4.7" />
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

// Reversible decisions from the last hours (rejects, mark-handleds), a quiet
// ledger with an Undo directly under the queue. The moment-of-decision undo
// is the toast inside MessagingQueue; this is the fallback for anything
// older. Renders nothing when there are none, and nothing when the service
// is unreachable (the queue shows that).
async function RecentDecisionsSection() {
  const recent = await listRecentApprovals(12);
  if (!recent.ok) return null;
  const items = recent.data.approvals.filter((a) => a.reversible);
  if (items.length === 0) return null;
  return <RecentDecisions items={items} />;
}

// Urgent boundary: the pending-approval queue + reminders. Awaits ONLY the
// fast queue call so it is never held hostage by the slower aggregations.
async function QueueSection() {
  const pending = await listApprovals();
  if (!pending.ok) return <NotReachable message={explainError(pending.error)} retry />;
  // Proactive scheduling moved to the Send lens (/messaging/send): the Inbox
  // is for reacting to what came in, Send is for starting something. Keeping
  // both here made the queue page a junk drawer.
  // A guest's Stay Cape Ann quotes, so the card can say what has already been
  // priced instead of leaving the operator to go and look. Degrades to {}:
  // the queue is the point of this page and must render without it.
  const quotes = await loadGuestQuoteContext(pending.data.approvals).catch(() => ({}));
  return <MessagingQueue initialPending={pending.data.approvals} initialQuotes={quotes} />;
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

// Helm's own property list (service-role read; properties is RLS-locked) for the target selector
// on each proposed update. Independent of the stay-concierge service; a
// failure here just yields an empty list (operator can still dismiss).
async function loadProperties(): Promise<{ id: string; name: string }[]> {
  try {
    const { data, error } = await supabase.from('properties').select('id, name').order('name');
    if (error || !data) return [];
    return data as { id: string; name: string }[];
  } catch {
    return [];
  }
}

// Mid boundary: the KB self-healing loop's review card. kb_gap_harvest mines
// the operator's own manual Guesty replies for durable property facts the AI
// drafts lacked (item locations, standing fees, quirks) and proposes them
// here; applying routes through the same Quick Capture parse + apply as the
// owner and cleaner cards.
async function ProposedUpdatesSection() {
  const [proposed, properties] = await Promise.all([
    listProposedPropertyUpdates('guest'),
    loadProperties(),
  ]);
  // Hide the card entirely when there is nothing to review AND no error -
  // unlike the owner page, /messaging is a daily working surface and an
  // empty educational card would be noise on it.
  if (proposed.ok && proposed.data.updates.length === 0) return null;
  return (
    <TriagedPropertyUpdates
      initial={proposed.ok ? proposed.data.updates : []}
      initialError={proposed.ok ? null : explainError(proposed.error)}
      properties={properties}
      source="guest"
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
        <RecentDecisionsSection />
      </Suspense>
      <Suspense fallback={null}>
        <ConversationsSection />
      </Suspense>
      <Suspense fallback={null}>
        <ProposedUpdatesSection />
      </Suspense>
      <Suspense fallback={null}>
        <AnalyticsSection />
      </Suspense>
    </Shell>
  );
}
