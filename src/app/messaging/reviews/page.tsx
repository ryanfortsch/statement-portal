import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { MessagingFooter } from '@/components/MessagingFooter';
import { MessagingTabs } from '@/components/MessagingTabs';
import { Section } from '@/components/Section';
import { QueueSkeleton } from '@/components/QueueSkeleton';
import { RetryRefresh } from '@/components/RetryRefresh';
import { DecidedRecently } from '@/components/messaging/card/DecidedRecently';
import {
  explainError,
  getReviewAsks,
  isStayConciergeConfigured,
  listApprovals,
  listRecentApprovals,
} from '@/lib/stay-concierge';
import { todayET } from '@/lib/checkout-schedule';
import { reviewLensRules } from '@/lib/review-lens';
import { guestFirstFromDraft, isReviewLensKind, prettifySlug, proactiveKind } from '../format';
import { ReviewsQueue } from './ReviewsQueue';
import { undoReviewDecision } from './actions';

/**
 * /messaging/reviews, the Guest reviews lens of the Guests tab (2026-10-30).
 *
 * Reviews in both directions, as cards: stop Guesty's automatic 5-star review
 * of a guest whose stay went red, post our own review of them before the
 * window closes, and reply publicly to a review under five stars. The Inbox
 * leaves these cards out, so what the lens shows is what its count says.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <MessagingTabs current="guests" lens="reviews" />
      {children}
      <div style={{ flex: 1 }} />
      <MessagingFooter />
    </div>
  );
}

function NotReachable({ message, retry = false }: { message: string; retry?: boolean }) {
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

async function QueueSection() {
  const pending = await listApprovals();
  if (!pending.ok) return <NotReachable message={explainError(pending.error)} retry />;
  const cards = pending.data.approvals.filter((a) => isReviewLensKind(proactiveKind(a.guesty_message_id, a.topic)));
  return <ReviewsQueue initialPending={cards} today={todayET()} />;
}

// The lens's standing rules, with the concierge's own numbers (the Guesty
// delay it is told, the day our review is due), so the page never states a
// delay the listings no longer have.
async function RulesSection() {
  const asks = await getReviewAsks([]);
  const lines = reviewLensRules(asks.ok ? asks.data : {});
  return (
    <div style={{ padding: '4px 0 28px', fontSize: 13, lineHeight: 1.6, color: 'var(--ink-3)', maxWidth: 720 }}>
      {lines.map((l) => (
        <p key={l} style={{ marginTop: 6 }}>
          {l}
        </p>
      ))}
    </div>
  );
}

async function RecentDecisionsSection() {
  const recent = await listRecentApprovals(72);
  if (!recent.ok) return null;
  const items = recent.data.approvals
    .filter((a) => a.reversible && isReviewLensKind(proactiveKind(a.guesty_message_id, a.topic)))
    .map((a) => ({
      id: a.id,
      status: a.status,
      name: a.guest_first || guestFirstFromDraft(a.draft) || 'Guest',
      property: a.listing_name || prettifySlug(a.listing_id) || 'unknown property',
      quote: a.guest_text,
      at: a.resolved_at || a.created_at,
      decidedBy: a.decided_by,
    }));
  return <DecidedRecently items={items} undo={undoReviewDecision} />;
}

export default function MessagingReviewsPage() {
  if (!isStayConciergeConfigured()) {
    return (
      <Shell>
        <NotReachable message="Ask Ryan: the guest messaging service is not connected to this Helm." />
      </Shell>
    );
  }
  return (
    <Shell>
      <Section title="Guest reviews" eyebrow="Ours of them · replies to theirs">
        <Suspense fallback={<QueueSkeleton />}>
          <QueueSection />
        </Suspense>
        <Suspense fallback={null}>
          <RulesSection />
        </Suspense>
        <Suspense fallback={null}>
          <RecentDecisionsSection />
        </Suspense>
      </Section>
    </Shell>
  );
}
