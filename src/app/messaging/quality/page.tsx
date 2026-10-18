import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { MessagingFooter } from '@/components/MessagingFooter';
import { MessagingTabs } from '@/components/MessagingTabs';
import { Section } from '@/components/Section';
import { QueueSkeleton } from '@/components/QueueSkeleton';
import {
  isStayConciergeConfigured,
  listProposedPropertyUpdates,
  listReflectionProposals,
  listRecentApprovals,
  getStats,
  getStatsTimeseries,
  getCourtesyRollup,
  getFacts,
  getFactAudit,
  getOwnerCuratedFacts,
  explainError,
} from '@/lib/stay-concierge';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { sessionRole } from '@/lib/helm-access-server';
import { TriagedPropertyUpdates } from '../TriagedPropertyUpdates';
import { ProposedPropertyUpdatesCard } from '@/app/owner-messaging/ProposedPropertyUpdatesCard';
import { ReflectionProposals } from '../ReflectionProposals';
import { PerformanceDropdown } from '../PerformanceDropdown';
import { OwnerFactsEditor } from '@/app/owner-messaging/OwnerFactsEditor';

/**
 * /messaging/quality, the Quality lens of the Guests tab (2026-10-17).
 *
 * How the AI is doing and what it is being taught, in one place and off the
 * working page: the property facts waiting to be filed (from the operator's
 * own replies, from cleaners, from contractors, and for an owner login from
 * owners), the rules the weekly reflection pass keeps seeing coached, and
 * Performance with its learned-facts editor. The Inbox ends at Conversations
 * and keeps a one-line count pointing here; the owner, cleaner and
 * contractor pages keep the same line.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <MessagingTabs current="guests" lens="quality" />
      {children}
      <div style={{ flex: 1 }} />
      <MessagingFooter />
    </div>
  );
}

function NotReachable({ message }: { message: string }) {
  return (
    <Section title="Service not reachable" eyebrow="Setup required">
      <div style={{ borderTop: '1px solid var(--ink)', padding: '20px 0', fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
        {message}
      </div>
    </Section>
  );
}

/** null means the lookup FAILED, which is not the same as "no properties".
 *  Returning [] for both made a momentary read error tell the operator each
 *  property "is not in Helm's registry" and switched filing off fleet-wide
 *  (2026-09-23, 3 South). Callers must treat null as "could not check". */
async function loadProperties(): Promise<{ id: string; name: string }[] | null> {
  try {
    const { data, error } = await supabase.from('properties').select('id, name').order('name');
    if (error || !data) return null;
    return data as { id: string; name: string }[];
  } catch {
    return null;
  }
}

// Facts mined from the operator's own guest replies, already checked against
// each home's knowledge base by the concierge's kb_triage pass. Always
// rendered: this is the lens for it, and its empty state says so.
async function GuestFactsSection() {
  const [proposed, properties] = await Promise.all([listProposedPropertyUpdates('guest'), loadProperties()]);
  return (
    <TriagedPropertyUpdates
      initial={proposed.ok ? proposed.data.updates : []}
      initialError={proposed.ok ? null : explainError(proposed.error)}
      properties={properties}
      source="guest"
    />
  );
}

// Facts a cleaner, a contractor or an owner shared, on the older
// one-fact-at-a-time card. Rendered only with something to file (or an
// error to show): three empty cards under the one above would be noise.
async function SharedFactsSection({ source }: { source: 'cleaner' | 'contractor' | 'owner' }) {
  // Owner correspondence is an owner page: a staff login never reads it,
  // not even as a fact to file.
  if (source === 'owner' && (await sessionRole()) !== 'owner') return null;
  const [proposed, properties] = await Promise.all([
    listProposedPropertyUpdates(source === 'owner' ? undefined : source),
    loadProperties(),
  ]);
  if (proposed.ok && proposed.data.updates.length === 0) return null;
  return (
    <ProposedPropertyUpdatesCard
      initial={proposed.ok ? proposed.data.updates : []}
      initialError={proposed.ok ? null : explainError(proposed.error)}
      properties={properties ?? []}
      source={source}
    />
  );
}

// The weekly reflection pass, as decisions. It mines the coaching log and the
// AI-drafted-vs-human-sent diffs for rules taught repeatedly that the canon
// never absorbed. It proposes and never self-applies, which was correct and
// also meant nothing applied: its report had no reader on either side of the
// bridge, so 25 proposals piled up across 5 runs. This page is its reader.
async function ReflectionSection() {
  const res = await listReflectionProposals();
  return (
    <ReflectionProposals
      initial={res.ok ? res.data.proposals : []}
      initialError={res.ok ? null : explainError(res.error)}
      openCount={res.ok ? res.data.open_count : 0}
      promotedCount={res.ok ? res.data.promoted_count : 0}
    />
  );
}

// The rules the owner drafter applies verbatim. Owner correspondence is an
// owner page, so a staff login never sees them. Moved here off the owner
// queue page on 2026-10-18, with everything else that teaches the AI.
async function OwnerFactsSection() {
  if ((await sessionRole()) !== 'owner') return null;
  const facts = await getOwnerCuratedFacts();
  return (
    <OwnerFactsEditor
      initialContent={facts.ok ? facts.data.content : ''}
      initialBytes={facts.ok ? facts.data.bytes : 0}
      learnedContent={facts.ok ? facts.data.learned ?? '' : ''}
    />
  );
}

// The tabbed Performance section (score / last-24h activity / learning +
// weekly fact audit). Slow calls; they stream in after the facts.
async function AnalyticsSection() {
  const [stats, facts, ts, audit, recent, rollup] = await Promise.all([
    // All-time (hours=0) by default: that is where the honest signal lives.
    getStats(0),
    getFacts(20),
    getStatsTimeseries(30, undefined, 'substantive'),
    getFactAudit(),
    listRecentApprovals(24),
    getCourtesyRollup(28),
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
      rollup={rollup.ok ? rollup.data : null}
    />
  );
}

export default function MessagingQualityPage() {
  if (!isStayConciergeConfigured()) {
    return (
      <Shell>
        <NotReachable message="The messaging service is not connected to Helm. Ask Ryan." />
      </Shell>
    );
  }
  return (
    <Shell>
      <div id="facts">
        <Suspense fallback={<QueueSkeleton title="Property facts to file" />}>
          <GuestFactsSection />
        </Suspense>
        <Suspense fallback={null}><SharedFactsSection source="cleaner" /></Suspense>
        <Suspense fallback={null}><SharedFactsSection source="contractor" /></Suspense>
        <Suspense fallback={null}><SharedFactsSection source="owner" /></Suspense>
      </div>
      <Suspense fallback={null}>
        <ReflectionSection />
      </Suspense>
      <Suspense fallback={null}>
        <AnalyticsSection />
      </Suspense>
      <Suspense fallback={null}>
        <OwnerFactsSection />
      </Suspense>
    </Shell>
  );
}
