import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { MessagingTabs } from '@/components/MessagingTabs';
import { QueueSkeleton } from '@/components/QueueSkeleton';

/**
 * Route-segment loading UI for /contractor-messaging. Matches the real page
 * shell exactly (masthead + tabs + queue placeholder + footer; the contractor
 * page renders no HelmHero, so neither does its skeleton). No data, no
 * 'use client'.
 */
export default function ContractorMessagingLoading() {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead current="messaging" />
      <MessagingTabs current="contractors" />

      <QueueSkeleton />

      <div style={{ flex: 1 }} />

      <HelmFooter left="Stay Concierge · contractor drafts via Opus 4.7" />
    </div>
  );
}
