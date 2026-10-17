import { HelmMasthead } from '@/components/HelmMasthead';
import { MessagingFooter } from '@/components/MessagingFooter';
import { MessagingTabs } from '@/components/MessagingTabs';
import { QueueSkeleton } from '@/components/QueueSkeleton';

/**
 * Route-segment loading UI for /messaging/quality: the same shell the page
 * renders (masthead, tabs on the Quality lens, footer) and a placeholder
 * where the first section lands, so the swap has no layout shift. No data,
 * no 'use client'.
 */
export default function MessagingQualityLoading() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <MessagingTabs current="guests" lens="quality" />
      <QueueSkeleton title="Property facts to file" />
      <div style={{ flex: 1 }} />
      <MessagingFooter />
    </div>
  );
}
