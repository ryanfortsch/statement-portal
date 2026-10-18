import { HelmMasthead } from '@/components/HelmMasthead';
import { MessagingFooter } from '@/components/MessagingFooter';
import { MessagingTabs } from '@/components/MessagingTabs';
import { QueueSkeleton } from '@/components/QueueSkeleton';

/**
 * Route-segment loading UI for /messaging/team. Matches the real page shell
 * (masthead, tabs, queue placeholder, the messaging footer; no HelmHero). No
 * data, no 'use client'.
 */
export default function TeamInboxLoading() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <MessagingTabs current="team" />

      <QueueSkeleton />

      <div style={{ flex: 1 }} />

      <MessagingFooter />
    </div>
  );
}
