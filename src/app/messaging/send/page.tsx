import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { MessagingFooter } from '@/components/MessagingFooter';
import { Section } from '@/components/Section';
import { RetryRefresh } from '@/components/RetryRefresh';
import { MessagingTabs } from '@/components/MessagingTabs';
import { AiStatusBanner } from '@/components/AiStatusBanner';
import { isStayConciergeConfigured, listConversations, explainError } from '@/lib/stay-concierge';
import { todayET } from '@/lib/checkout-schedule';
import { RemindersSection } from '../RemindersSection';
import { SendPanel, type SendTab } from './SendPanel';
import { PaymentLinksLedger } from './PaymentLinksLedger';

/**
 * /messaging/send - the Send lens of the Guests tab, in two tabs.
 *
 * The Inbox reacts to what guests sent us. This is the other half: starting
 * something ourselves. Message: pick a stay, write, send (now or later).
 * Charge: pick a stay, say what for and how much, and the payment link
 * mints in the home's own Stripe account and texts the guest; the ledger
 * of every link from the last month sits under it. The tab rides in the
 * URL (?tab=charge) so the home feed's Payments cards and the concierge's
 * add-on alert land on the ledger, and so the server can render the
 * ledger only when it is wanted.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <MessagingTabs current="guests" lens="send" />
      {/* Streams in: the shell must still paint with no backend call. */}
      <Suspense fallback={null}>
        <AiStatusBanner />
      </Suspense>
      {children}
      <div style={{ flex: 1 }} />
      <MessagingFooter />
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
async function SendSection({ tab, stayId }: { tab: SendTab; stayId: string }) {
  const conversations = await listConversations(60);
  if (!conversations.ok) {
    return <NotReachable message={explainError(conversations.error)} retry />;
  }
  return (
    <SendPanel
      initialConversations={conversations.data.conversations}
      initialError={null}
      today={todayET()}
      tab={tab}
      initialStayId={stayId}
    />
  );
}

export default async function MessagingSendPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const tab: SendTab = first(sp.tab) === 'charge' ? 'charge' : 'message';
  const stayId = first(sp.stay);

  if (!isStayConciergeConfigured()) {
    return (
      <Shell>
        <NotReachable message="The messaging service is not connected to Helm. Ask Ryan." />
      </Shell>
    );
  }
  return (
    <Shell>
      <Suspense fallback={<SendSkeleton tab={tab} />}>
        <SendSection tab={tab} stayId={stayId} />
      </Suspense>
      {tab === 'charge' ? (
        // Every payment link from the last month and whether it was paid.
        // Reads Supabase, not the concierge, so it renders even when the
        // Mac Mini is unreachable.
        <Suspense fallback={null}>
          <PaymentLinksLedger />
        </Suspense>
      ) : (
        // Scheduled + repeating messages ride with the compose surface: both
        // are "things we start", so they belong on the Message tab.
        <RemindersSection />
      )}
    </Shell>
  );
}

function SendSkeleton({ tab }: { tab: SendTab }) {
  return (
    <Section title={tab === 'charge' ? 'Charge a guest' : 'Send a message'} eyebrow={tab === 'charge' ? 'pick a stay, say what for' : 'pick a stay, write, send'}>
      <div style={{ borderTop: '1px solid var(--ink)', padding: '18px 0', fontSize: 13, color: 'var(--ink-4)' }}>
        Loading stays...
      </div>
    </Section>
  );
}
