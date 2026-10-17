import { HelmMasthead } from '@/components/HelmMasthead';
import { MessagingFooter } from '@/components/MessagingFooter';
import { MessagingTabs } from '@/components/MessagingTabs';
import { QueueSkeleton } from '@/components/QueueSkeleton';

/**
 * Route-segment loading UI for /messaging. Because the route is
 * `dynamic = 'force-dynamic'`, Next prefetches exactly this boundary
 * (layout -> loading), so tapping Messaging paints the full shell + queue
 * skeleton INSTANTLY, even on mobile where the menu sheet mounts on tap
 * and there is no hover to warm anything. The real page then streams in and
 * swaps. The shell below is page.tsx's shell exactly (masthead, tabs on the
 * Inbox lens, the queue placeholder, the messaging footer; no hero, which the
 * page does not render), so the swap has no layout shift. No data fetch, no
 * 'use client'.
 */
export default function MessagingLoading() {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead />
      <MessagingTabs current="guests" lens="inbox" />

      <QueueSkeleton />

      <div style={{ flex: 1 }} />

      <MessagingFooter />
    </div>
  );
}
