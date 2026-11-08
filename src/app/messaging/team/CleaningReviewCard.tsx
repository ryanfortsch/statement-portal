'use client';

import type { ReactNode } from 'react';
import { ApprovalCard, BodyText, sentAgoLabel } from '@/components/messaging/card/ApprovalCard';
import type { QueueCardHelpers } from '@/components/messaging/card/ApprovalQueue';
import type { WaitReason } from '@/components/messaging/card/types';
import { EnglishLine } from '@/components/messaging/TranslationLine';
import { PhotoThumbs } from '@/components/PhotoUploader';
import { houseDay } from '@/lib/house-date';
import { CLEANING_HANDLED_REASONS, type CleaningReviewCardData } from '@/lib/cleaning-reviews-core';
import { approveCleaningReviewAction, editCleaningReviewAction, markCleaningReviewHandledAction } from './cleaning-review-actions';

/**
 * An inspector's rating of the clean, four stars or fewer, on the one
 * approval card (docs/cleaning-reviews.md). What they gave and said, the
 * photos, then the Portuguese text with its English under it. Approve is the
 * only thing that texts; Edit changes the words; Mark handled clears it with
 * a reason. Nothing reaches the crew before the tap.
 */
export function CleaningReviewCard({
  card,
  helpers,
  audienceChip,
}: {
  card: CleaningReviewCardData;
  helpers: QueueCardHelpers;
  audienceChip?: ReactNode;
}) {
  const wait: WaitReason | null = card.stuck
    ? { tone: 'stale', text: 'Sending did not finish. Try again.' }
    : card.status === 'approving'
      ? { tone: 'held', text: 'Someone is sending this one.' }
      : card.lastError
        ? { tone: 'failed', text: card.lastError }
        : null;
  const to = card.recipients.length ? card.recipients.join(', ') : null;
  return (
    <ApprovalCard
      id={card.id}
      status="pending"
      name={`${card.inspectorName} · ${card.propertyName}`}
      property={card.propertyName}
      channel="SMS"
      preview={`${card.stars} of 5${card.reason ? ` · ${card.reason}` : ''}`}
      chips={
        <>
          {audienceChip}
          <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>Walk of {houseDay(card.walkDate)}</span>
        </>
      }
      queuedChips={audienceChip}
      ageMinutes={card.ageMinutes}
      createdAt={card.createdAt}
      shortId={card.id.slice(0, 8)}
      wait={wait}
      layout="stacked"
      said={{
        label: `${card.inspectorName} rated the clean`,
        sub: sentAgoLabel(card.createdAt),
        subTitle: card.createdAt,
        body: (
          <>
            <div style={{ fontSize: 15, color: 'var(--ink)' }}>
              <Stars n={card.stars} /> <span style={{ marginLeft: 6 }}>{card.stars} of 5</span>
            </div>
            {card.reason && <BodyText>{card.reason}</BodyText>}
            {card.photoUrls.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <PhotoThumbs urls={card.photoUrls} size={72} />
              </div>
            )}
          </>
        ),
      }}
      reply={{
        label: to ? `Text to ${to} (Portuguese)` : 'Text to the crew (Portuguese)',
        text: card.pt,
        english: <EnglishLine text={card.en} />,
        englishWhileEditing: <EnglishLine text={card.en} label="English, as drafted" />,
      }}
      approveBlocked={!to ? 'No cleaner on the schedule list for this home.' : card.status === 'approving' && !card.stuck ? 'Someone is sending this one.' : undefined}
      approveLabel="Approve & send"
      verbs={{
        approve: () => approveCleaningReviewAction(card.id),
        saveEdit: (text) => editCleaningReviewAction(card.id, text),
        markHandled: (capture) => markCleaningReviewHandledAction(card.id, capture?.reason),
      }}
      handledReasons={CLEANING_HANDLED_REASONS}
      onResolved={helpers.onResolved}
      onDecided={helpers.onDecided}
      onRegenerating={() => {}}
      regenStalled={false}
    />
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span aria-label={`${n} of 5 stars`} style={{ color: 'var(--signal)', letterSpacing: '0.06em', fontSize: 15 }}>
      {'★'.repeat(n)}
      <span style={{ color: 'var(--rule)' }}>{'★'.repeat(5 - n)}</span>
    </span>
  );
}
