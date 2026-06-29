import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { MessagingTabs } from '@/components/MessagingTabs';
import { QueueSkeleton } from '@/components/QueueSkeleton';

/**
 * Route-segment loading UI for /owner-messaging. Mirror of the guest
 * messaging skeleton (instant shell + queue placeholder on tap), with the
 * Owners tab active and owner-specific hero/footer copy. No data, no
 * 'use client'.
 */
export default function OwnerMessagingLoading() {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead current="messaging" />
      <MessagingTabs current="owners" />

      <HelmHero
        eyebrow="Module 08 · Messaging"
        title="Owner replies,"
        emphasis="one tap to ship."
        paddingTop={36}
        paddingBottom={20}
      />

      <QueueSkeleton />

      <div style={{ flex: 1 }} />

      <HelmFooter left="Stay Concierge · owner drafts via Opus 4.7" />
    </div>
  );
}
