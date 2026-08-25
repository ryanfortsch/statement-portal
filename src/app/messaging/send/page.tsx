import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { Section } from '@/components/Section';
import { RetryRefresh } from '@/components/RetryRefresh';
import { MessagingTabs } from '@/components/MessagingTabs';
import { isStayConciergeConfigured, listConversations, explainError } from '@/lib/stay-concierge';
import { todayET } from '@/lib/checkout-schedule';
import { RemindersSection } from '../RemindersSection';
import { SendPanel } from './SendPanel';

/**
 * /messaging/send - the Send lens of the Guests tab.
 *
 * The Inbox reacts to what guests sent us. This is the other half: starting
 * a message ourselves. Phase 1 is free text against a picked stay; the
 * mirrored Guesty check-in templates mount onto this same surface next.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <MessagingTabs current="guests" lens="send" />
      {children}
      <div style={{ flex: 1 }} />
      <HelmFooter left="Stay Concierge · polish is optional, messages send as typed" />
    </div>
  );
}

function NotReachable({ message, retry = false }: { message: string; retry?: boolean }) {
  return (
    <Section title="Service not reachable" eyebrow={retry ? 'Auto-retrying' : 'Setup required'}>
      <div
        style={{
          borderTop: '1px solid var(--ink)',
          padding: '20px 0',
          fontSize: 13,
          color: 'var(--ink-3)',
          lineHeight: 1.6,
        }}
      >
        {message}
        {retry && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-4)' }}>Retrying automatically.</div>}
      </div>
      {retry && <RetryRefresh />}
    </Section>
  );
}

// The stay list is the same cached Guesty gather the Inbox uses, so landing
// here right after /messaging is warm. `today` is resolved server-side in ET
// so stay proximity can never disagree with the render because of a browser
// clock or timezone.
async function SendSection() {
  const conversations = await listConversations(60);
  if (!conversations.ok) {
    return <NotReachable message={explainError(conversations.error)} retry />;
  }
  return (
    <SendPanel
      initialConversations={conversations.data.conversations}
      initialError={null}
      today={todayET()}
    />
  );
}

export default function MessagingSendPage() {
  if (!isStayConciergeConfigured()) {
    return (
      <Shell>
        <NotReachable message="STAY_CONCIERGE_URL and STAY_CONCIERGE_KEY are not set. Pull them from the Mac Mini service config and add them to Helm in Vercel." />
      </Shell>
    );
  }
  return (
    <Shell>
      <Suspense fallback={<SendSkeleton />}>
        <SendSection />
      </Suspense>
      {/* Scheduled + repeating messages moved here with the compose surface:
          both are "things we start", so they belong on the same lens. */}
      <RemindersSection />
    </Shell>
  );
}

function SendSkeleton() {
  return (
    <Section title="Send a message" eyebrow="pick a stay, write, send">
      <div style={{ borderTop: '1px solid var(--ink)', padding: '18px 0', fontSize: 13, color: 'var(--ink-4)' }}>
        Loading stays...
      </div>
    </Section>
  );
}
