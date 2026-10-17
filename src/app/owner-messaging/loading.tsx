import { HelmMasthead } from '@/components/HelmMasthead';
import { MessagingFooter } from '@/components/MessagingFooter';
import { MessagingTabs } from '@/components/MessagingTabs';
import { QueueSkeleton } from '@/components/QueueSkeleton';

/**
 * Route-segment loading UI for /owner-messaging. Mirror of the guest
 * messaging skeleton (instant shell + queue placeholder on tap), with the
 * Owners tab active. The shell is page.tsx's exactly: no hero, the messaging
 * footer. No data, no 'use client'.
 */
export default function OwnerMessagingLoading() {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead />
      <MessagingTabs current="owners" />

      <QueueSkeleton />

      <div style={{ flex: 1 }} />

      <MessagingFooter />
    </div>
  );
}
