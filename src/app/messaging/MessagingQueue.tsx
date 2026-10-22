'use client';

import { useCallback, useState } from 'react';
import { maintenanceWorkState, MaintenanceWorkControls } from '@/components/MaintenanceWorkPanel';
import { EnglishLine } from '@/components/messaging/TranslationLine';
import { splitMaintenanceOutcomes } from '@/lib/message-outcomes';
import { useHelmRole } from '@/components/useHelmRole';
import { useQueueRefresh } from '@/components/QueueRefreshControl';
import { useApprovalQueue } from '@/lib/use-approval-queue';
import type { Approval } from '@/lib/stay-concierge';
import type { CardQuoteBlock, GuestQuoteContext } from '@/lib/guest-quote-context-core';
import { ApprovalCard, BodyText, sentAgoLabel, type CardController } from '@/components/messaging/card/ApprovalCard';
import { ApprovalQueue, type QueueCardHelpers } from '@/components/messaging/card/ApprovalQueue';
import {
  Pill,
  PrimaryButton,
  PrimaryLink,
  SecondaryButton,
  SecondaryLink,
} from '@/components/messaging/card/buttons';
import type { AlsoItem } from '@/components/messaging/card/types';
import {
  approveDraft,
  coachDraft,
  markHandled,
  redraftDraft,
  scheduleDraft,
  cancelSchedule,
  editDraft,
  dismissMaintenanceSlip,
  undoDecision,
} from './actions';
import { RentalInquiryPanel } from './RentalInquiryPanel';
import { addonItem, handoffItem, quotesItem } from './guest-card-blocks';
import { waitReason } from '@/lib/card-wait-reason';
import { sendsTo } from '@/lib/card-sends-to';
import { reviewAskContext } from '@/lib/review-ask-context';
import { stripeLookupHref } from '@/lib/stripe-lookup-link';
import { HeldPitches, type HeldPitch } from './HeldPitches';
import { inquiryDraftState, inquiryMessageText, inquiryQuoteHref } from '@/lib/rental-inquiry';
import { ThreadPanel } from './Thread';
import {
  prettifySlug,
  prettifyTopic,
  guestFirstFromDraft,
  formatStayDates,
  channelTone,
  proactiveKind,
  proactiveBadge,
  isManualSend,
} from './format';

// How often the REST of the page (conversations, outcomes) re-renders. The
// queue polls its own feed every 15s (useApprovalQueue), so a coached card
// never waits on the conversations rebuild, a 16-page Guesty burst.
const PAGE_REFRESH_MS = 60_000;

// Why a card needed no reply at all. Short on purpose and drawn from what the
// 141 real bypasses in the last 30 days were: the rollup reads these back
// against which guard suppressed an auto-send, so a long menu would fragment
// the counts. Since 2026-10-17 this is the ONE door for "no reply"; Reject
// is retired on every queue (it read as "reject this wording" and meant the
// guest was never answered).
const NO_REPLY_REASONS = ['Already answered', 'Guest said thanks', 'Not worth a reply'] as const;

export function MessagingQueue({
  initialPending,
  initialQuotes,
  aiPaused,
  held,
}: {
  initialPending: Approval[];
  /** This guest's Stay Cape Ann quotes, keyed by approval id. Rides the
   *  queue's own feed so a coached rewrite (new id) keeps its context. */
  initialQuotes?: GuestQuoteContext;
  /** The drafting AI is down: a card with no draft says so. */
  aiPaused?: { reason?: string } | null;
  /** First-contact emails the pitch screen held in the last day, with no
   *  draft written: they wait here with Release, not two folds deep. */
  held?: HeldPitch[];
}) {
  const { approvals, context: quotes, refresh, watchRegen, stalledId } = useApprovalQueue<Approval, GuestQuoteContext>(
    initialPending,
    'guests',
    initialQuotes,
  );
  const { softRefresh } = useQueueRefresh(PAGE_REFRESH_MS);
  const onRefresh = useCallback(() => {
    refresh();
    softRefresh();
  }, [refresh, softRefresh]);

  return (
    <ApprovalQueue
      approvals={approvals}
      onRefresh={onRefresh}
      undo={undoDecision}
      emptyMessage="No guest replies waiting."
      after={held && held.length > 0 ? <HeldPitches items={held} /> : undefined}
      renderCard={(approval, helpers) => (
        <GuestCard
          key={approval.id}
          approval={approval}
          quotes={quotes?.[approval.id]}
          helpers={helpers}
          onRegenerating={watchRegen}
          regenStalled={stalledId === approval.id}
          aiPaused={aiPaused}
        />
      )}
    />
  );
}

function GuestCard({
  approval,
  quotes,
  helpers,
  onRegenerating,
  regenStalled,
  aiPaused,
}: {
  approval: Approval;
  /** Stay Cape Ann quotes already on file for this guest, with the true
   *  count. Undefined when the card has no email to join on, or the lookup
   *  degraded. */
  quotes?: CardQuoteBlock;
  helpers: QueueCardHelpers;
  onRegenerating: (id: string) => void;
  regenStalled: boolean;
  aiPaused?: { reason?: string } | null;
}) {
  const id = approval.id;
  // Guest pricing is set by the owners: /guests/quotes is an owner page, so a
  // staff login gets no Send a price, no quote links and no "See all in
  // Quotes". The price note tells them who to ask instead of a dead button.
  const role = useHelmRole();
  const canPrice = role === 'owner';
  const [showThread, setShowThread] = useState(false);
  // A 2027 request usually has one useful next step, price it and send it,
  // so the card leads with that and tucks coaching and the quiet exits
  // behind Other options (Dotti, 2026-09-18: "I want a simple system").
  // Sending the written reply is never hidden: when the home is not ours to
  // sell there is no price to send (Beth Dowling, 4 Brier Neck, 2026-10-01).
  const [showMore, setShowMore] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [dismissingSlip, setDismissingSlip] = useState(false);
  const [slipError, setSlipError] = useState<string | null>(null);

  const isScheduled = approval.status === 'scheduled';
  // Copy-to-send: drafted but not auto-postable (a WhatsApp-only direct guest).
  const manual = isManualSend(approval.guesty_message_id);
  const inquiry = approval.rental_inquiry;
  const inquiryState = inquiry ? inquiryDraftState(inquiry) : null;
  const propertyLabel = (inquiry ? 'Rental inquiry' : '') || approval.listing_name || prettifySlug(approval.listing_id) || 'unknown property';
  const guestLabel = approval.guest_first || guestFirstFromDraft(approval.draft) || 'Guest';
  const topicLabel = prettifyTopic(approval.topic) || 'General';
  const isPrereleaseRequest = approval.topic === 'prerelease_request';
  // Describes what the button DOES, not what the draft says: the drafted
  // reply varies, and copy that claims its wording goes stale silently.
  const PRERELEASE_SEND_HINT = 'Emails the draft above as written, from hello@staycapeann.com. No price, no payment link.';

  // The quote composer, prefilled from the request so nothing is retyped.
  const pre = approval.prerelease;
  const quoteProperty = pre?.helm_property_id || approval.listing_id || '';
  const quoteEmail = pre?.guest_email || approval.guest_email || '';
  const quoteHref = inquiry
    ? inquiryQuoteHref(inquiry, inquiry.homes.length === 1 ? inquiry.homes[0].property_id : '', { first: guestLabel, email: quoteEmail, source: approval.guesty_message_id })
    : `/guests/quotes/new?property=${encodeURIComponent(quoteProperty)}` +
      `&check_in=${encodeURIComponent(approval.check_in || '')}` +
      `&check_out=${encodeURIComponent(approval.check_out || '')}` +
      `&first=${encodeURIComponent(approval.guest_first || '')}` +
      (pre?.guests ? `&guests=${encodeURIComponent(String(pre.guests))}` : '') +
      (quoteEmail ? `&email=${encodeURIComponent(quoteEmail)}` : '') +
      (pre?.guest_last ? `&last=${encodeURIComponent(pre.guest_last)}` : '') +
      (pre?.guest_phone ? `&phone=${encodeURIComponent(pre.guest_phone)}` : '') +
      `&source=${encodeURIComponent(isPrereleaseRequest ? 'prerelease' : approval.topic || 'messaging')}` +
      `&source_ref=${encodeURIComponent(approval.guesty_message_id || '')}`;
  // An email guest can be priced too, as a SECONDARY action (Abha Singhal,
  // 2026-09-21): the action is gated on whether a quote is possible, not on
  // the card's topic, and not on the card knowing a property (an email thread
  // often carries none; the composer then opens on the property picker).
  const canQuoteEmailGuest = !isPrereleaseRequest && approval.module === 'email';
  const quoteHint = quoteProperty
    ? 'Opens the quote form with their home filled in. The reply above is unaffected.'
    : 'Opens the quote form with this guest filled in. Pick their home there. The reply above is unaffected.';
  const stayLabel = formatStayDates(approval.check_in, approval.check_out);
  // Where approving sends when it leaves the platform thread: a text to the
  // number the guest gave, or a relay email to the third party the booker
  // named. '' on an ordinary card.
  const destination = sendsTo(approval);
  // "Did they pay?" one click away: the Stripe lookup prefilled with this
  // guest's email and stay, for every login (the lookup is read-only and
  // open to staff); a rental inquiry has no stay to look up.
  const lookupHref = !inquiry
    ? stripeLookupHref({
        email: approval.guest_email,
        name: pre?.guest_last ? `${approval.guest_first || ''} ${pre.guest_last}` : null,
        checkOut: approval.check_out,
      })
    : null;
  const kind = proactiveKind(approval.guesty_message_id, approval.topic);
  const badge = proactiveBadge(kind);
  // A proactive card has no guest message, so "Guest said thanks" cannot apply.
  const noReplyReasons = kind ? NO_REPLY_REASONS.filter((r) => r !== 'Guest said thanks') : NO_REPLY_REASONS;

  // Add-on charge riding on this card. The text leg needs a minted link and a
  // phone; without either, approve sends only the in-platform reply.
  const addon = approval.addon ?? null;
  const addonSmsPossible = !!(addon && addon.payment_link_url && addon.guest_phone);
  const [sendAddonSms, setSendAddonSms] = useState(true);
  // A note to a teammate this reply commits us to. Ticked by default: the
  // whole point is that she does not have to remember Rosa exists.
  const handoff = approval.handoff ?? null;
  const [createHandoff, setCreateHandoff] = useState(true);
  const [cleanerChoice, setCleanerChoice] = useState<{ action: 'skip' | 'draft' | 'send'; token: string }>({ action: 'draft', token: '' });
  const cleanerAction = cleanerChoice.action === 'send' && cleanerChoice.token !== handoff?.preview_token ? 'draft' : cleanerChoice.action;
  const recordedHandoffStatus: Record<string, string> = { approved: 'Sent', sending: 'Sending', scheduled: 'Scheduled', rejected: 'Handled', superseded: 'Replaced' };
  const handoffStatus = handoff?.create_error
    ? 'Needs review'
    : recordedHandoffStatus[handoff?.note_status || ''] ||
      (handoff?.audience === 'cleaner'
        ? { send: 'Send after reply', draft: 'Draft for approval', skip: 'Skip note' }[cleanerAction]
        : handoff?.filed
          ? 'Draft awaiting approval'
          : createHandoff
            ? 'Draft when approved'
            : 'Skip note');
  const [createWorkSlip, setCreateWorkSlip] = useState(true);
  const workOutcomes = splitMaintenanceOutcomes(approval);
  const approveOpts =
    addon || handoff || approval.maintenance_work
      ? {
          ...(addon ? { sendAddonSms: addonSmsPossible && sendAddonSms } : {}),
          ...(handoff && handoff.audience !== 'cleaner' && !handoff.filed ? { createHandoff } : {}),
          ...(handoff?.audience === 'cleaner' ? { cleanerAction, previewToken: cleanerChoice.token } : {}),
          ...(approval.maintenance_work ? { workAction: createWorkSlip ? ('create' as const) : ('skip' as const) } : {}),
        }
      : undefined;

  const copyAddonLink = async () => {
    if (!addon?.payment_link_url) return;
    try {
      await navigator.clipboard.writeText(addon.payment_link_url);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      /* the URL is printed beside the button to select by hand */
    }
  };

  // ── Also on approve: one line each ──────────────────────────────────────
  const also: AlsoItem[] = [];

  if (quotes && quotes.quotes.length > 0) also.push(quotesItem({ quotes, canPrice, guestEmail: approval.guest_email || '' }));

  if (addon) {
    also.push(addonItem({ addon, channel: approval.channel, smsPossible: addonSmsPossible, send: sendAddonSms, setSend: setSendAddonSms, linkCopied, onCopy: copyAddonLink }));
  }

  if (approval.maintenance_work) {
    const work = maintenanceWorkState({ work: approval.maintenance_work, outcome: workOutcomes.maintenance, create: createWorkSlip });
    also.push({
      key: 'work',
      line: work.hasSlip || !createWorkSlip ? `Work slip · ${work.title}` : `Files work slip “${work.title}”`,
      status: slipError ? 'Not dismissed' : work.status,
      attention: work.attention || !!slipError,
      body: (
        <>
        {slipError && <p role="alert" style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--signal)' }}>{slipError}</p>}
        <MaintenanceWorkControls
          id={id}
          work={approval.maintenance_work}
          outcome={workOutcomes.maintenance}
          create={createWorkSlip}
          busy={dismissingSlip}
          dismissing={dismissingSlip}
          onCreateChange={setCreateWorkSlip}
          onDismiss={async () => {
            setDismissingSlip(true);
            setSlipError(null);
            const result = await dismissMaintenanceSlip(id);
            if (result.ok) helpers.onResolved();
            else setSlipError(result.error);
            setDismissingSlip(false);
          }}
        />
        </>
      ),
    });
  }

  if (handoff) {
    also.push(handoffItem({ id, handoff, role, handoffStatus, cleanerAction, setCleanerChoice, createHandoff, setCreateHandoff }));
  }

  // ── Footers that differ from the standard one ──────────────────────────
  const staffPrice = <StaffPriceNote />;

  /** Copy-to-send: she pastes OUR draft in Guesty's WhatsApp inbox, so the
   *  draft IS what the guest got; Mark sent captures it rather than asking. */
  const manualFooter = (ctl: CardController) => (
    <>
      <PrimaryButton
        onClick={async () => {
          ctl.setError(null);
          try {
            await navigator.clipboard.writeText(ctl.currentText());
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            ctl.setError('Could not copy automatically. Select the message above and copy it manually.');
          }
        }}
        disabled={ctl.busy}
      >
        {copied ? 'Copied ✓' : 'Copy message'}
      </PrimaryButton>
      {ctl.parts.edit}
      <SecondaryButton
        onClick={() => ctl.markHandled({ sent_text: ctl.currentText() || '' })}
        disabled={ctl.busy}
        loading={ctl.pending === 'mark-handled'}
        loadingLabel="Marking"
        title="You've pasted and sent this in Guesty's WhatsApp inbox. Clears it from the queue."
      >
        Mark sent
      </SecondaryButton>
      <SecondaryButton onClick={ctl.toggleHandled} disabled={ctl.busy} title="Nothing to send. Clears the card without sending; Undo for 12 hours.">
        {ctl.showHandled ? 'Cancel' : 'Mark handled'}
      </SecondaryButton>
    </>
  );

  /** An inquiry the AI could not draft: price it, retry, or write it. */
  const inquiryFooter = (ctl: CardController) => (
    <>
      {inquiryState?.pricing ? (
        canPrice ? <PrimaryLink href={quoteHref} disabled={ctl.busy}>Set a price</PrimaryLink> : staffPrice
      ) : (
        <PrimaryButton onClick={ctl.redraft} disabled={ctl.busy} loading={ctl.pending === 'redraft'} loadingLabel="Drafting">
          Retry draft
        </PrimaryButton>
      )}
      {inquiryState?.pricing && (
        <SecondaryButton onClick={ctl.redraft} disabled={ctl.busy} loading={ctl.pending === 'redraft'} loadingLabel="Drafting">
          Recheck &amp; draft
        </SecondaryButton>
      )}
      <SecondaryButton onClick={ctl.startEdit} disabled={ctl.busy}>Write reply</SecondaryButton>
      <SecondaryButton onClick={ctl.toggleHandled} disabled={ctl.busy}>{ctl.showHandled ? 'Cancel' : 'Mark handled'}</SecondaryButton>
    </>
  );

  /** A 2027 request: Send a price leads, Send reply is never hidden, the rest
   *  waits behind Other options. Not a second dark button: only one action
   *  here is the likely one. */
  const prereleaseFooter = (ctl: CardController) => (
    <>
      {canPrice ? <PrimaryLink href={quoteHref} disabled={ctl.busy}>Send a price</PrimaryLink> : staffPrice}
      <SecondaryButton onClick={ctl.approve} disabled={ctl.busy} loading={ctl.pending === 'approve'} loadingLabel="Sending" title={PRERELEASE_SEND_HINT}>
        Send reply
      </SecondaryButton>
      <span className="eyebrow" style={{ color: 'var(--ink-3)', ...(showMore ? { flexBasis: '100%' } : {}) }}>
        {canPrice
          ? 'Send a price opens the quote form, filled in. Send reply emails the draft above as written.'
          : 'Send reply emails the draft above as written, with no price and no payment link.'}
      </span>
      {showMore ? (
        <>
          {ctl.parts.edit}
          {ctl.parts.coach}
          <div className="rt-message-quiet">
            {ctl.parts.redraft}
            {ctl.parts.handled}
            <button type="button" onClick={() => setShowMore(false)} aria-expanded className="rt-quiet-btn">
              Fewer options
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setShowMore(true)}
          aria-expanded={false}
          className="eyebrow"
          style={{ background: 'none', border: 'none', padding: 0, color: 'var(--ink-3)', textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer', marginLeft: 'auto' }}
        >
          Other options
        </button>
      )}
    </>
  );

  /** An email guest: the standard verbs, with Send a price beside send. */
  const emailFooter = (ctl: CardController) => (
    <>
      {ctl.parts.send}
      {canQuoteEmailGuest && canPrice && (
        <SecondaryLink href={quoteHref} disabled={ctl.busy} title={quoteHint}>
          Send a price
        </SecondaryLink>
      )}
      {ctl.parts.edit}
      {ctl.parts.coach}
      <div className="rt-message-quiet">
        {ctl.parts.redraft}
        {ctl.parts.handled}
      </div>
    </>
  );

  const footer = (ctl: CardController) =>
    manual
      ? manualFooter(ctl)
      : inquiry && !ctl.hasDraft
        ? inquiryFooter(ctl)
        : isPrereleaseRequest
          ? prereleaseFooter(ctl)
          : canQuoteEmailGuest && canPrice
            ? emailFooter(ctl)
            : null;

  // A review ask's context is the concierge's paragraph; the card shows it in
  // a few words (lib/review-ask-context).
  const guestText = kind === 'review' ? reviewAskContext(approval.guest_text) ?? approval.guest_text : approval.guest_text;

  return (
    <ApprovalCard
      id={id}
      status={approval.status}
      sendAt={approval.send_at}
      name={`${guestLabel} · ${propertyLabel}`}
      property={propertyLabel}
      preview={guestText}
      channel={approval.channel || ''}
      chips={
        <>
          {approval.channel && <ChannelBadge channel={approval.channel} />}
          {stayLabel && (
            <span className="eyebrow" style={{ color: 'var(--ink-3)' }} title={`${approval.check_in || '?'} to ${approval.check_out || '?'}`}>
              {stayLabel}
            </span>
          )}
          {lookupHref && (
            <a href={lookupHref} target="_blank" rel="noopener noreferrer" className="eyebrow" style={{ color: 'var(--tide-deep)' }}>
              Stripe lookup →
            </a>
          )}
          {!isScheduled &&
            (badge ? (
              <Pill label={badge.label} tone={badge.tone} title="System-initiated message. Review and approve before it sends" />
            ) : (
              <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>{topicLabel}</span>
            ))}
          {destination && (
            <span
              className="eyebrow"
              style={{ color: 'var(--signal)', fontWeight: 600, textTransform: 'none', letterSpacing: '0.02em', fontSize: 11, overflowWrap: 'anywhere' }}
            >
              {destination}
            </span>
          )}
        </>
      }
      queuedChips={approval.channel ? <ChannelBadge channel={approval.channel} /> : null}
      accent={badge?.tone}
      ageMinutes={approval.age_minutes}
      createdAt={approval.created_at}
      shortId={approval.short_id}
      wait={waitReason({
        status: approval.status,
        lastSendError: approval.last_send_error,
        noDraft: !approval.draft.trim(),
        aiPaused,
        unverifiedHomes: inquiry ? inquiry.homes.filter((h) => h.availability === 'unknown').length : 0,
      })}
      said={{
        // Proactive cards have no guest message: the left column is the
        // trigger, not "Guest said".
        label: kind === 'extension' ? 'Why this offer' : kind ? 'Context' : 'Guest said',
        sub: kind ? '' : sentAgoLabel(approval.guest_received_at, approval.created_at),
        subTitle: approval.guest_received_at || approval.created_at || undefined,
        body: (
          <>
            <BodyText>{(inquiry ? inquiryMessageText(approval.guest_text || '') : guestText) || '(empty)'}</BodyText>
            <EnglishLine text={approval.guest_text_english} translating={approval.guest_text_translating} />
          </>
        ),
      }}
      reply={{
        text: approval.draft,
        english: <EnglishLine text={approval.draft_english} translating={approval.draft_translating} />,
        // The English of the draft as written, for someone rewriting a reply
        // in another language.
        englishWhileEditing: <EnglishLine text={approval.draft_english} label="English, as drafted" />,
        override: inquiry ? <RentalInquiryPanel inquiry={inquiry} first={guestLabel} email={quoteEmail} source={approval.guesty_message_id} /> : undefined,
        emptyLabel: inquiryState?.label,
        after: inquiry ? (
          <details style={{ marginTop: 14 }}>
            <summary className="eyebrow" style={{ cursor: 'pointer', color: 'var(--ink-3)' }}>Inquiry details</summary>
            <div style={{ marginTop: 10 }}>
              <RentalInquiryPanel inquiry={inquiry} first={guestLabel} email={quoteEmail} source={approval.guesty_message_id} />
            </div>
          </details>
        ) : undefined,
      }}
      afterColumns={
        approval.conversation_id && (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={() => setShowThread((v) => !v)}
              aria-expanded={showThread}
              className="eyebrow"
              style={{ color: showThread ? 'var(--ink-2)' : 'var(--ink-4)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
              title={approval.conversation_id.startsWith('helm:') ? 'The full conversation history, live from Helm' : 'The full conversation history, live from Guesty'}
            >
              {showThread ? 'Hide conversation ▴' : 'View conversation ▾'}
            </button>
            {showThread && (
              <div style={{ marginTop: 10 }}>
                <ThreadPanel
                  conversationId={approval.conversation_id}
                  guestFirst={guestLabel}
                  channel={approval.channel}
                  module={approval.module}
                  listingId={approval.listing_id}
                  maxHeight={380}
                />
              </div>
            )}
          </div>
        )
      }
      also={also}
      queuedLead={
        <>
          {/* A queued holding reply must not hide the pricing action. */}
          {isPrereleaseRequest && (canPrice ? <PrimaryLink href={quoteHref}>Send a price</PrimaryLink> : staffPrice)}
          {canQuoteEmailGuest && canPrice && (
            <SecondaryLink href={quoteHref} title={quoteHint}>
              Send a price
            </SecondaryLink>
          )}
        </>
      }
      footer={footer}
      externalBusy={dismissingSlip}
      redraftOutcome={
        // An unsuccessful retry updates the inquiry in place instead of
        // replacing the card.
        inquiry && (inquiry.draft_issue || inquiry.decision)
          ? { key: JSON.stringify(inquiry), error: !approval.draft.trim() ? null : inquiry.draft_issue?.message || null }
          : null
      }
      verbs={{
        approve: () => approveDraft(id, approveOpts),
        schedule: (at) => scheduleDraft(id, at, approveOpts),
        sendNow: () => approveDraft(id, approveOpts),
        cancelSchedule: () => cancelSchedule(id),
        saveEdit: (text) => editDraft(id, text),
        coach: manual ? undefined : (note) => coachDraft(id, note),
        redraft: manual ? undefined : () => redraftDraft(id),
        markHandled: (capture) => markHandled(id, capture),
      }}
      handledReasons={noReplyReasons}
      pastePlaceholder="Paste the reply you sent in Guesty, by text or by email"
      outcomes={workOutcomes.remaining}
      onResolved={helpers.onResolved}
      onDecided={helpers.onDecided}
      onRegenerating={onRegenerating}
      regenStalled={regenStalled}
    />
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  return <Pill label={channel} tone={channelTone(channel)} title={`Sent / received via ${channel}`} />;
}

/** What a staff login sees where an owner sees Send a price: the quote form
 *  is owners-only, so the card says who prices it instead of a dead button. */
function StaffPriceNote() {
  return (
    <span className="eyebrow" style={{ color: 'var(--ink-3)' }}>
      Ask Ryan to price this
    </span>
  );
}
