import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { MessagingTabs } from '@/components/MessagingTabs';
import { QueueSkeleton } from '@/components/QueueSkeleton';

/**
 * Route-segment loading UI for /messaging. Because the route is
 * `dynamic = 'force-dynamic'`, Next prefetches exactly this boundary
 * (layout -> loading), so tapping Messaging paints the full shell + queue
 * skeleton INSTANTLY -- even on mobile where the menu sheet mounts on tap
 * and there is no hover to warm anything. The real page then streams in and
 * swaps. The shell components below are identical to page.tsx's, so the swap
 * has no layout shift. No data fetch, no 'use client'.
 */
export default function MessagingLoading() {
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

      <QueueSkeleton />

      <div style={{ flex: 1 }} />

      <HelmFooter left="Stay Concierge · drafts via Opus 4.7" />
    </div>
  );
}
