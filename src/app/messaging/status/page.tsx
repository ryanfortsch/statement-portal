import { Suspense } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { MessagingFooter } from '@/components/MessagingFooter';
import { MessagingTabs } from '@/components/MessagingTabs';
import { InboxHealth } from '@/components/InboxHealth';
import { Section } from '@/components/Section';
import { HelmRunHomesSection, SyncFeedsSection } from '@/components/SyncHealth';

/**
 * /messaging/status, Delivery & sync: whether message imports from Guesty,
 * Gmail and Quo are working (Working / Delayed / Broken per channel), the
 * imports still unresolved, held pitches to release, and work slips that
 * have not filed yet; then Helm's background syncs that stopped and the
 * calendars Helm runs that need a person (both from the retired /today,
 * 2026-10-18). Wears the messaging shell (2026-10-17): the audience
 * strip with no tab lit, since this page belongs to the whole section, and
 * the messaging footer without its link to itself.
 */
export const dynamic = 'force-dynamic';

export default function MessagingStatusPage() {
  return <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
    <HelmMasthead />
    <MessagingTabs current="none" />
    <Suspense fallback={<Section title="Delivery & sync" eyebrow="loading…"><p style={{ margin: 0, fontSize: 13, color: 'var(--ink-4)' }}>Checking each channel…</p></Section>}><InboxHealth diagnostics /></Suspense>
    <Suspense fallback={null}><SyncFeedsSection /></Suspense>
    <Suspense fallback={null}><HelmRunHomesSection /></Suspense>
    <div style={{ flex: 1 }} />
    <MessagingFooter self />
  </div>;
}
