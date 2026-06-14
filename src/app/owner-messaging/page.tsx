import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { Section } from '@/components/Section';
import {
  isStayConciergeConfigured,
  listOwnerApprovals,
  listRecentOwnerApprovals,
  explainError,
  type OwnerApproval,
} from '@/lib/stay-concierge';
import { OwnerMessagingQueue } from './OwnerMessagingQueue';
import { OwnerRecentStrip } from './OwnerRecentStrip';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type LoadResult =
  | { ok: true; pending: OwnerApproval[]; recent: OwnerApproval[] }
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
    listOwnerApprovals(),
    listRecentOwnerApprovals(24),
  ]);
  if (!pending.ok) return { ok: false, error: explainError(pending.error) };
  return {
    ok: true,
    pending: pending.data.approvals,
    recent: recent.ok ? recent.data.approvals : [],
  };
}

export default async function OwnerMessagingPage() {
  const data = await loadData();

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead current="owner-messaging" />

      <HelmHero
        eyebrow="Owner Messaging"
        title="Owner replies,"
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
          <OwnerMessagingQueue initialPending={data.pending} />
          <OwnerRecentStrip initialRecent={data.recent} />
        </>
      )}

      <div style={{ flex: 1 }} />

      <HelmFooter left="Stay Concierge · owner drafts via Opus 4.7" />
    </div>
  );
}
