import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { MessagingTabs } from '@/components/MessagingTabs';
import { QueueSkeleton } from '@/components/QueueSkeleton';

/**
 * Route-segment loading UI for /cleaner-messaging. Matches the real page
 * shell exactly (masthead + tabs + queue placeholder + footer; the cleaner
 * page renders no HelmHero, so neither does its skeleton). No data, no
 * 'use client'.
 */
export default function CleanerMessagingLoading() {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead current="messaging" />
      <MessagingTabs current="cleaners" />

      <QueueSkeleton />

      <div style={{ flex: 1 }} />

      <HelmFooter left="Stay Concierge · cleaner drafts via Opus 4.7" />
    </div>
  );
}
