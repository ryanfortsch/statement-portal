import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { MessagingTabs } from '@/components/MessagingTabs';
import { Section } from '@/components/Section';
import {
  isStayConciergeConfigured,
  listCleanerApprovals,
  listRecentCleanerApprovals,
  explainError,
  type CleanerApproval,
} from '@/lib/stay-concierge';
import { CleanerMessagingQueue } from './CleanerMessagingQueue';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type LoadResult =
  | {
      ok: true;
      pending: CleanerApproval[];
      recent: CleanerApproval[];
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
  const [pending, recent] = await Promise.all([
    listCleanerApprovals(),
    listRecentCleanerApprovals(24),
  ]);
  if (!pending.ok) return { ok: false, error: explainError(pending.error) };
  return {
    ok: true,
    pending: pending.data.approvals,
    recent: recent.ok ? recent.data.approvals : [],
  };
}

export default async function CleanerMessagingPage() {
  const data = await loadData();

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead current="messaging" />
      <MessagingTabs current="cleaners" />

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

      {data.ok && <CleanerMessagingQueue initialPending={data.pending} />}

      <div style={{ flex: 1 }} />

      <HelmFooter left="Stay Concierge · cleaner drafts via Opus 4.7" />
    </div>
  );
}
