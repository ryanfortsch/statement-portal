'use client';

import { useCallback } from 'react';
import type { Approval, HostReviewCard, ReviewReplyCard } from '@/lib/stay-concierge';
import { ApprovalCard, BodyText, type CardController } from '@/components/messaging/card/ApprovalCard';
import { ApprovalQueue, type QueueCardHelpers } from '@/components/messaging/card/ApprovalQueue';
import { Pill, PrimaryButton, PrimaryLink, QuietButton, SecondaryLink } from '@/components/messaging/card/buttons';
import { useApprovalQueue } from '@/lib/use-approval-queue';
import { useQueueRefresh } from '@/components/QueueRefreshControl';
import {
  HOST_REVIEW_POST_REASONS,
  HOST_REVIEW_STOP_REASONS,
  POST_DONE,
  POST_SKIP,
  REPLY_REASONS,
  STOP_DONE,
  STOP_SKIP,
  hostReviewFace,
  reviewReplyFace,
} from '@/lib/review-lens';
import {
  channelTone,
  formatStayDates,
  guestFirstFromDraft,
  isReviewLensKind,
  prettifySlug,
  proactiveBadge,
  proactiveKind,
} from '../format';
import { editReviewDraft, markReviewHandled, postReply, undoReviewDecision } from './actions';

/**
 * The Guest reviews lens (2026-10-30): the cards the concierge files for
 * reviews in both directions, on the one approval card.
 *
 *   hostreview:<rid>:stop   stop Guesty's 5-star auto review of a red stay,
 *                           by hand on the reservation page. Stopped / Let it post.
 *   hostreview:<rid>:post   our own review of that guest, drafted from the
 *                           thread, posted by hand on the channel. Posted / Skip.
 *   reviewreply:<id>        a public reply to a review under five stars, posted
 *                           onto the review through Guesty on Post reply, with
 *                           the removal grounds the thread supports.
 *
 * Nothing here sends a message to a guest. The host-review cards carry no
 * Approve at all (the concierge refuses one, 409); their verbs are Mark
 * handled with a reason, and the reason is the choice (lib/review-lens).
 */

const PAGE_REFRESH_MS = 60_000;

export function ReviewsQueue({ initialPending, today }: { initialPending: Approval[]; today: string }) {
  const { approvals, refreshStatus, refresh, watchRegen, stalledId } = useApprovalQueue<Approval>(initialPending, 'guests');
  const { softRefresh } = useQueueRefresh(PAGE_REFRESH_MS);
  const onRefresh = useCallback(() => {
    refresh();
    softRefresh();
  }, [refresh, softRefresh]);
  // The guests feed carries every card; this lens shows only its own two kinds.
  const cards = approvals.filter((a) => isReviewLensKind(proactiveKind(a.guesty_message_id, a.topic)));

  return (
    <ApprovalQueue
      approvals={cards}
      onRefresh={onRefresh}
      refreshStatus={refreshStatus}
      undo={undoReviewDecision}
      emptyMessage="No review to protect or answer right now."
      renderCard={(approval, helpers) => (
        <ReviewCard
          key={approval.id}
          approval={approval}
          helpers={helpers}
          today={today}
          onRegenerating={watchRegen}
          regenStalled={stalledId === approval.id}
        />
      )}
    />
  );
}

type CardProps = {
  approval: Approval;
  helpers: QueueCardHelpers;
  today: string;
  onRegenerating: (id: string) => void;
  regenStalled: boolean;
};

function ReviewCard(props: CardProps) {
  const { approval } = props;
  const kind = proactiveKind(approval.guesty_message_id, approval.topic);
  if (kind === 'hostreview' && approval.host_review) return <HostReviewCardView {...props} card={approval.host_review} />;
  if (kind === 'reviewreply' && approval.review_reply) return <ReviewReplyCardView {...props} card={approval.review_reply} />;
  return <PlainCard {...props} />;
}

function useCardBasics(approval: Approval) {
  const guestLabel = approval.guest_first || guestFirstFromDraft(approval.draft) || 'Guest';
  const propertyLabel = approval.listing_name || prettifySlug(approval.listing_id) || 'unknown property';
  const badge = proactiveBadge(proactiveKind(approval.guesty_message_id, approval.topic));
  const stayLabel = formatStayDates(approval.check_in, approval.check_out);
  const chips = (
    <>
      {approval.channel && <Pill label={approval.channel} tone={channelTone(approval.channel)} title={`Booked via ${approval.channel}`} />}
      {stayLabel && (
        <span className="eyebrow" style={{ color: 'var(--ink-3)' }} title={`${approval.check_in || '?'} to ${approval.check_out || '?'}`}>
          {stayLabel}
        </span>
      )}
      {badge && <Pill label={badge.label} tone={badge.tone} title="Filed by the concierge. Nothing sends from this card." />}
    </>
  );
  return { guestLabel, propertyLabel, badge, chips };
}

const DUE_COLOR = { due: 'var(--signal)', late: 'var(--signal)', calm: 'var(--ink-3)' } as const;

function HostReviewCardView({ approval, helpers, today, onRegenerating, regenStalled, card }: CardProps & { card: HostReviewCard }) {
  const id = approval.id;
  const { guestLabel, propertyLabel, badge, chips } = useCardBasics(approval);
  const face = hostReviewFace(card, guestLabel, today);
  const isStop = card.stage === 'stop';
  const dueLine = (
    <div style={{ fontSize: 13, fontWeight: 600, color: DUE_COLOR[face.dueTone], marginBottom: 8 }}>{face.due}</div>
  );
  const footer = (ctl: CardController) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
      {face.link && (
        <PrimaryLink external href={face.link.href} disabled={ctl.busy} title="Opens in a new tab. Come back and tap the verb once it is done.">
          {face.link.label} ↗
        </PrimaryLink>
      )}
      <PrimaryButton
        onClick={() => ctl.markHandled(isStop ? { reason: STOP_DONE } : { reason: POST_DONE, sent_text: ctl.currentText() })}
        disabled={ctl.busy || (!isStop && !ctl.hasDraft)}
        loading={ctl.pending === 'mark-handled'}
        loadingLabel="Recording"
        title={isStop ? 'You stopped the auto review on the reservation page in Guesty.' : 'You posted this text on the channel. Records it with the words you used.'}
      >
        {face.done}
      </PrimaryButton>
      {!isStop && ctl.parts.edit}
      <QuietButton
        onClick={() => ctl.markHandled({ reason: isStop ? STOP_SKIP : POST_SKIP })}
        disabled={ctl.busy}
        title={isStop ? "Leave Guesty's 5-star review to post as usual." : 'Leave this guest with no review from us.'}
      >
        {face.skip}
      </QuietButton>
    </div>
  );
  return (
    <ApprovalCard
      id={id}
      status={approval.status}
      name={`${guestLabel} · ${propertyLabel}`}
      property={propertyLabel}
      preview={face.title}
      reviewLabel={isStop ? 'Stop auto review' : 'Post our review'}
      channel={approval.channel || ''}
      chips={chips}
      accent={badge?.tone}
      ageMinutes={approval.age_minutes}
      createdAt={approval.created_at}
      shortId={approval.short_id}
      layout="stacked"
      said={{
        label: face.title,
        body: (
          <>
            {dueLine}
            <BodyText>{face.context}</BodyText>
          </>
        ),
      }}
      reply={isStop ? null : { label: 'Our review, to post by hand', text: approval.draft }}
      verbs={{
        ...(isStop ? {} : { saveEdit: (text: string) => editReviewDraft(id, text) }),
        markHandled: (capture) => markReviewHandled(id, capture),
      }}
      handledReasons={isStop ? HOST_REVIEW_STOP_REASONS : HOST_REVIEW_POST_REASONS}
      pastePlaceholder="Paste the review you posted, if you changed it"
      footer={footer}
      onResolved={helpers.onResolved}
      onDecided={helpers.onDecided}
      onRegenerating={onRegenerating}
      regenStalled={regenStalled}
    />
  );
}

function ReviewReplyCardView({ approval, helpers, onRegenerating, regenStalled, card }: CardProps & { card: ReviewReplyCard }) {
  const id = approval.id;
  const { guestLabel, propertyLabel, badge, chips } = useCardBasics(approval);
  const face = reviewReplyFace(card, guestLabel);
  // Vrbo has no reply endpoint in Guesty: the reply is typed on Vrbo by hand.
  const byHand = !face.canPost;
  const footer = byHand
    ? (ctl: CardController) => (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <PrimaryButton
            onClick={() => ctl.markHandled({ reason: REPLY_REASONS[0], sent_text: ctl.currentText() })}
            disabled={ctl.busy || !ctl.hasDraft}
            loading={ctl.pending === 'mark-handled'}
            loadingLabel="Recording"
            title="You posted this reply on the channel yourself. Records it with the words you used."
          >
            Replied by hand
          </PrimaryButton>
          {ctl.parts.edit}
          {ctl.parts.handled}
        </div>
      )
    : undefined;
  return (
    <ApprovalCard
      id={id}
      status={approval.status}
      name={`${guestLabel} · ${propertyLabel}`}
      property={propertyLabel}
      preview={`${face.rating} · ${card.public_review}`}
      reviewLabel="Review reply"
      channel={approval.channel || ''}
      chips={chips}
      accent={badge?.tone}
      ageMinutes={approval.age_minutes}
      createdAt={approval.created_at}
      shortId={approval.short_id}
      said={{
        label: face.title,
        sub: face.rating,
        subTitle: card.written_on ? `Written ${card.written_on}` : undefined,
        body: (
          <>
            <BodyText>{card.public_review || '(no text)'}</BodyText>
            {card.private_feedback && (
              <p style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                <span className="eyebrow">Private feedback · </span>
                {card.private_feedback}
              </p>
            )}
            <p style={{ marginTop: 10, fontSize: 12, lineHeight: 1.5, color: face.contestable ? 'var(--signal)' : 'var(--ink-3)' }}>
              {face.grounds}
            </p>
            {face.policy && (
              <div style={{ marginTop: 8 }}>
                <SecondaryLink external href={face.policy.href} title="Airbnb removes a review only on these grounds. Request removal on Airbnb, then Mark handled: Removal requested.">
                  {face.policy.label} ↗
                </SecondaryLink>
              </div>
            )}
          </>
        ),
      }}
      reply={{ label: byHand ? 'Public reply, to post by hand' : 'Public reply', text: approval.draft }}
      verbs={{
        ...(byHand ? {} : { approve: () => postReply(id) }),
        saveEdit: (text) => editReviewDraft(id, text),
        markHandled: (capture) => markReviewHandled(id, capture),
      }}
      approveLabel="Post reply"
      approveSummary="Publishes this reply on the review through Guesty. One reply per review; Airbnb lets you edit it later, Booking.com does not."
      approvePendingLabel="Posting"
      handledReasons={REPLY_REASONS}
      pastePlaceholder="Paste the reply you posted on the channel"
      footer={footer}
      onResolved={helpers.onResolved}
      onDecided={helpers.onDecided}
      onRegenerating={onRegenerating}
      regenStalled={regenStalled}
    />
  );
}

/** A lens card whose sidecar did not arrive (an older concierge): shown as
 *  written, with Mark handled as its one door. */
function PlainCard({ approval, helpers, onRegenerating, regenStalled }: CardProps) {
  const id = approval.id;
  const { guestLabel, propertyLabel, badge, chips } = useCardBasics(approval);
  return (
    <ApprovalCard
      id={id}
      status={approval.status}
      name={`${guestLabel} · ${propertyLabel}`}
      property={propertyLabel}
      preview={approval.guest_text}
      channel={approval.channel || ''}
      chips={chips}
      accent={badge?.tone}
      ageMinutes={approval.age_minutes}
      createdAt={approval.created_at}
      shortId={approval.short_id}
      layout="stacked"
      said={{ label: 'Context', body: <BodyText>{approval.guest_text || '(empty)'}</BodyText> }}
      reply={approval.draft.trim() ? { text: approval.draft } : null}
      verbs={{
        ...(approval.draft.trim() ? { saveEdit: (text: string) => editReviewDraft(id, text) } : {}),
        markHandled: (capture) => markReviewHandled(id, capture),
      }}
      handledReasons={['Handled']}
      onResolved={helpers.onResolved}
      onDecided={helpers.onDecided}
      onRegenerating={onRegenerating}
      regenStalled={regenStalled}
    />
  );
}
