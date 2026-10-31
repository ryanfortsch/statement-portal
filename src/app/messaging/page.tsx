import { reviewCountsByConversation } from '@/lib/inbox-search';
import { RecentMessageOutcomesSection } from '@/components/RecentMessageOutcomesSection';
import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { MessagingFooter } from '@/components/MessagingFooter';
import { Section } from '@/components/Section';
import { RetryRefresh } from '@/components/RetryRefresh';
import { MessagingTabs } from '@/components/MessagingTabs';
import { AiStatusBanner } from '@/components/AiStatusBanner';
import { QueueSkeleton } from '@/components/QueueSkeleton';
import {
  isStayConciergeConfigured,
  listApprovals,
  listInboxSearchApprovals,
  listRecentApprovals,
  listConversations,
  getAiStatus,
  getInboxHealth,
  explainError,
} from '@/lib/stay-concierge';
import { loadGuestQuoteContext } from '@/lib/guest-quote-context';
import { listHelmConversations } from '@/lib/helm-inbox';
import { mergeConversationLists } from '@/lib/helm-inbox-core';
import { PropertyFactsToFile } from '@/components/PropertyFactsToFile';
import { InboxHealth } from '@/components/InboxHealth';
import { InboxBottomTools } from '@/components/InboxBottomTools';
import { ConciergeAlertList } from '@/components/ConciergeAlerts';
import { MessagingQueue } from './MessagingQueue';
import { DecidedRecently } from '@/components/messaging/card/DecidedRecently';
import { undoDecision } from './actions';
import { guestFirstFromDraft, prettifySlug } from './format';
import { ConversationsBrowser } from './Conversations';
import { NumberTriage } from '@/components/messaging/NumberTriage';
import { loadNumberTriage, triageIsEmpty } from '@/lib/number-triage';
import { loadDoNotHostGuests, loadGuestyGuestByReservation } from '@/lib/do-not-host-server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Static shell: masthead, tabs, hero, footer. Renders synchronously with NO
// backend call, so the page paints the instant a navigation lands. The slow
// data streams in below via <Suspense>, so it never gates first paint.
function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead />
      <MessagingTabs current="guests" lens="inbox" />
      {/* Streams in: the shell must still paint with no backend call. */}
      <Suspense fallback={null}>
        <AiStatusBanner />
      </Suspense>
      {/* Only a delivery problem renders here; the routine row is at the foot. */}
      <Suspense fallback={null}>
        <InboxHealth placement="top" />
      </Suspense>

      {children}

      <div style={{ flex: 1 }} />

      <MessagingFooter />
    </div>
  );
}

function NotReachable({ message, retry = false }: { message: string; retry?: boolean }) {
  // `retry` distinguishes a transient upstream failure (self-heals via
  // RetryRefresh) from missing env config (refreshing forever won't set it).
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
        {retry && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-4)' }}>
            Retrying automatically.
          </div>
        )}
      </div>
      {retry && <RetryRefresh />}
    </Section>
  );
}

// Reversible decisions from the last hours (rejects, mark-handleds), a quiet
// ledger with an Undo directly under the queue. The moment-of-decision undo
// is the toast inside MessagingQueue; this is the fallback for anything
// older. Renders nothing when there are none, and nothing when the service
// is unreachable (the queue shows that).
async function RecentDecisionsSection() {
  const recent = await listRecentApprovals(12);
  if (!recent.ok) return null;
  const items = recent.data.approvals
    .filter((a) => a.reversible)
    .map((a) => ({
      id: a.id,
      status: a.status,
      name: a.guest_first || guestFirstFromDraft(a.draft) || 'Guest',
      property: a.listing_name || prettifySlug(a.listing_id) || 'unknown property',
      quote: a.guest_text,
      at: a.resolved_at || a.created_at,
      decidedBy: a.decided_by,
    }));
  return <DecidedRecently items={items} undo={undoDecision} />;
}

// Urgent boundary: the pending-approval queue + reminders. Awaits ONLY the
// fast queue call so it is never held hostage by the slower aggregations.
async function QueueSection() {
  // The AI's state and the held pitches are what a card cannot say for
  // itself: why nothing was drafted, and what waits with no card at all.
  const [pending, ai, health] = await Promise.all([
    listApprovals(),
    getAiStatus().catch(() => null),
    getInboxHealth().catch(() => null),
  ]);
  if (!pending.ok) return <NotReachable message={explainError(pending.error)} retry />;
  const aiPaused = ai?.ok && !ai.data.ok ? { reason: ai.data.reason } : null;
  const dayAgo = Date.now() / 1000 - 24 * 3600;
  const held = health?.ok ? (health.data.held ?? []).filter((h) => h.held_at >= dayAgo) : [];
  // Proactive scheduling moved to the Send lens (/messaging/send): the Inbox
  // is for reacting to what came in, Send is for starting something. Keeping
  // both here made the queue page a junk drawer.
  // A guest's Stay Cape Ann quotes, so the card can say what has already been
  // priced instead of leaving the operator to go and look. Degrades to {}:
  // the queue is the point of this page and must render without it.
  const quotes = await loadGuestQuoteContext(pending.data.approvals).catch(() => ({}));
  // The guests Helm will not host again, and the Guesty guest behind each
  // card's reservation so an OTA card resolves too. Both degrade to nothing:
  // the flag is an enrichment, never a gate on the queue.
  const flagged = await loadDoNotHostGuests().catch(() => []);
  const guestyGuests = flagged.length > 0
    ? await loadGuestyGuestByReservation(pending.data.approvals.map((a) => a.reservation_id)).catch(() => ({}))
    : {};
  return <MessagingQueue initialPending={pending.data.approvals} initialQuotes={quotes} aiPaused={aiPaused} held={held} flagged={flagged} guestyGuests={guestyGuests} />;
}

// Numbers that reached a Quo line and that Helm cannot name, plus what the
// Quo address book knows that the contact list does not: one card with one
// verb set (Attach, New contact, Not ours). It lived on /crm until
// 2026-10-18; it belongs where the texts are answered. Its own boundary: a
// slow or failed read never holds the queue, and an empty card renders
// nothing.
async function NumberTriageSection() {
  const triage = await loadNumberTriage().catch(() => null);
  if (!triage || triageIsEmpty(triage)) return null;
  return <NumberTriage {...triage} />;
}

// The Guesty-inbox replacement: every recent guest conversation, expandable
// in place into the full thread with a manual-reply composer. Its own
// boundary because the first cold gather pages the Guesty API (cached 90s
// on the concierge after that).
//
// Helm-native threads (guest SMS on the GUESTS line, email, OTA stays with
// their deep link) ride in the same list, sorted together by last activity.
// Each half fails soft: the concierge being down still shows Helm threads,
// and a Helm read error still shows the concierge list.
//
// `?open=<conversation id>` opens that thread on arrival: an alert's "Open
// the thread" lands on the conversation itself, not the top of the list.
async function ConversationsSection({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const open = (await searchParams).open;
  const openId = (Array.isArray(open) ? open[0] : open)?.trim() || null;
  const [conversations, helm, approvals] = await Promise.all([
    listConversations(60),
    listHelmConversations(60).catch(() => []),
    listInboxSearchApprovals('guests').catch(() => null),
  ]);
  const concierge = conversations.ok ? conversations.data.conversations : [];
  const counts = approvals?.ok ? reviewCountsByConversation(approvals.data.approvals) : null;
  const merged = mergeConversationLists(concierge, helm).map(c => ({
    // Helm counts already use awaiting_approval; concierge counts include scheduled sends.
    ...c, review_count: c.conversation_id.startsWith('helm:') ? c.pending_count : counts ? counts.get(c.conversation_id) || 0 : undefined,
  }));
  return (
    <ConversationsBrowser
      // A new ?open= remounts the list, so the thread asked for opens even
      // when the page was already showing another.
      key={openId ?? 'none'}
      initialConversations={merged}
      initialError={conversations.ok ? null : explainError(conversations.error)}
      initialOpenId={openId}
      // The check-in window the list covers, so it can say so and step back
      // from it. An older concierge sends none; the browser falls back to
      // the same 60 days either side of today.
      initialWindow={conversations.ok && conversations.data.check_in_from && conversations.data.check_in_to
        ? { from: conversations.data.check_in_from, to: conversations.data.check_in_to, truncated: !!conversations.data.truncated }
        : null}
    />
  );
}

// Everything analytical and every "teach the AI" surface (Performance and
// its learned-facts editor, the weekly reflection proposals, the property
// facts to file) lives on the Quality lens (/messaging/quality) since
// 2026-10-17. The Inbox is the working page: it ends at Conversations and
// keeps one line pointing there.

export default function MessagingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isStayConciergeConfigured()) {
    return (
      <Shell>
        <NotReachable message="The messaging service is not connected to Helm. Ask Ryan." />
      </Shell>
    );
  }

  return (
    <Shell>
      {/* What the concierge could not finish on its own, above the queue:
          guest emergencies first, then the alerts, each in plain words. */}
      <Suspense fallback={null}>
        <ConciergeAlertList />
      </Suspense>
      <Suspense fallback={<QueueSkeleton />}>
        <QueueSection />
      </Suspense>
      <Suspense fallback={null}>
        <RecentDecisionsSection />
      </Suspense>
      <Suspense fallback={null}>
        <NumberTriageSection />
      </Suspense>
      <Suspense fallback={null}>
        <ConversationsSection searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={null}><PropertyFactsToFile /></Suspense>
      <Suspense fallback={null}><RecentMessageOutcomesSection audience="guests" /></Suspense>
      <InboxBottomTools />
    </Shell>
  );
}
