import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { Section } from '@/components/Section';
import { MessagingTabs } from '@/components/MessagingTabs';
import {
  isStayConciergeConfigured,
  listApprovals,
  listRecentApprovals,
  getStats,
  getStatsTimeseries,
  getFacts,
  getFactAudit,
  explainError,
  type Approval,
  type MessagingStats,
  type Fact,
  type FactAudit,
  type TimeseriesPoint,
  type TopicRollup,
} from '@/lib/stay-concierge';
import { MessagingQueue } from './MessagingQueue';
import { RecentStrip } from './RecentStrip';
import { RemindersSection } from './RemindersSection';
import { PerformanceDropdown } from './PerformanceDropdown';
import { FactAuditCard } from './FactAuditCard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type LoadResult =
  | {
      ok: true;
      pending: Approval[];
      recent: Approval[];
      stats: MessagingStats | null;
      statsError: string | null;
      facts: Fact[];
      totalFacts: number;
      timeseries: TimeseriesPoint[];
      availableTopics: TopicRollup[];
      audit: FactAudit | null;
      auditError: string | null;
    }
  | { ok: false; error: string };

async function loadData(): Promise<LoadResult> {
  if (!isStayConciergeConfigured()) {
    return {
      ok: false,
      error:
        'STAY_CONCIERGE_URL and STAY_CONCIERGE_KEY are not set. Pull them from the Mac Mini service config and add them to Helm in Vercel.',
    };
  }
  const [pending, recent, stats, facts, ts, audit] = await Promise.all([
    listApprovals(),
    listRecentApprovals(24),
    // Default the stats window to All-time (hours=0). The 7d window is
    // thin because /messaging only just went live — All-time is where the
    // real "is the AI getting it right?" signal lives (3 weeks of data).
    getStats(0),
    getFacts(20),
    getStatsTimeseries(30),
    getFactAudit(),
  ]);
  if (!pending.ok) return { ok: false, error: explainError(pending.error) };
  return {
    ok: true,
    pending: pending.data.approvals,
    recent: recent.ok ? recent.data.approvals : [],
    stats: stats.ok ? stats.data : null,
    statsError: stats.ok ? null : explainError(stats.error),
    facts: facts.ok ? facts.data.facts : [],
    totalFacts: facts.ok ? facts.data.total_facts : 0,
    timeseries: ts.ok ? ts.data.series : [],
    availableTopics: ts.ok ? ts.data.available_topics : [],
    audit: audit.ok ? audit.data : null,
    auditError: audit.ok ? null : explainError(audit.error),
  };
}

export default async function MessagingPage() {
  const data = await loadData();

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead current="messaging" />
      <MessagingTabs current="guests" />

      <HelmHero
        eyebrow="Module 08 · Messaging"
        title="Guest replies,"
        emphasis="one tap to ship."
        paddingTop={36}
        paddingBottom={20}
      />

      {!data.ok && (
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
            {data.error}
          </div>
        </Section>
      )}

      {data.ok && (
        <>
          <MessagingQueue initialPending={data.pending} />
          <RemindersSection />
          <RecentStrip initialRecent={data.recent} />
          <PerformanceDropdown
            initialStats={data.stats}
            initialError={data.statsError}
            initialFacts={data.facts}
            totalFacts={data.totalFacts}
            initialTimeseries={data.timeseries}
            initialAvailableTopics={data.availableTopics}
          />
          <FactAuditCard initial={data.audit} initialError={data.auditError} />
        </>
      )}

      <div style={{ flex: 1 }} />

      <HelmFooter left="Stay Concierge · drafts via Opus 4.7" />
    </div>
  );
}
