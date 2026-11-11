'use client';

import type { ReactNode } from 'react';
import { ApprovalCard, sentAgoLabel } from '@/components/messaging/card/ApprovalCard';
import type { QueueCardHelpers } from '@/components/messaging/card/ApprovalQueue';
import type { WaitReason } from '@/components/messaging/card/types';
import { EnglishLine } from '@/components/messaging/TranslationLine';
import { PhotoThumbs } from '@/components/PhotoUploader';
import { houseDay } from '@/lib/house-date';
import { CLEANING_HANDLED_REASONS, enShort, needsCleaningNotice, type CleaningReviewCardData } from '@/lib/cleaning-reviews-core';
import { approveCleaningReviewAction, editCleaningReviewAction, markCleaningReviewHandledAction } from './cleaning-review-actions';

/**
 * The week's cleaning review email on the one approval card
 * (docs/cleaning-reviews.md). Every clean the inspectors rated, with the
 * reason and photos under each at four stars or fewer, then the email in the
 * crew's language with its English under it. Approve is the only thing that
 * emails; Edit changes the words; Mark handled clears the week with a reason.
 * Nothing reaches the crew before the tap.
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
  const noEmail = card.recipients.length === 0;
  const wait: WaitReason | null = card.stuck
    ? { tone: 'stale', text: 'Sending did not finish. Try again.' }
    : card.status === 'approving'
      ? { tone: 'held', text: 'Someone is sending this one.' }
      : card.lastError
        ? { tone: 'failed', text: card.lastError }
        : noEmail
          ? { tone: 'held', text: 'No cleaner email on file. Add one under Cleaner settings.' }
          : null;
  const range = card.firstWalk === card.weekEnd ? enShort(card.weekEnd) : `${enShort(card.firstWalk)} to ${enShort(card.weekEnd)}`;
  const flagged = card.cleans.filter((c) => needsCleaningNotice(c.stars)).length;
  const n = card.cleans.length;
  const preview = [
    card.average != null ? `${card.average.toFixed(1)} average` : null,
    `${n} ${n === 1 ? 'clean' : 'cleans'}`,
    flagged ? `${flagged} at 4 or below` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const to = card.recipients.join(', ');
  const language = card.language === 'en' ? 'English' : 'Portuguese';
  return (
    <ApprovalCard
      id={card.id}
      status="pending"
      name={`Cleaning review · ${range}`}
      channel="Email"
      preview={preview}
      chips={audienceChip}
      queuedChips={audienceChip}
      ageMinutes={card.ageMinutes}
      createdAt={card.createdAt}
      shortId={card.id.slice(0, 8)}
      wait={wait}
      layout="stacked"
      said={{
        label: 'The week the inspectors rated',
        sub: sentAgoLabel(card.createdAt),
        subTitle: card.createdAt,
        body: (
          <div style={{ display: 'grid', gap: 10 }}>
            {card.cleans.map((c) => (
              <div key={c.id}>
                <div style={{ fontSize: 14, color: 'var(--ink)' }}>
                  <Stars n={c.stars} />
                  <span style={{ marginLeft: 8 }}>{c.propertyName}</span>
                  <span style={{ marginLeft: 8, color: 'var(--ink-4)', fontSize: 12 }}>
                    {houseDay(c.walkDate)} · {c.inspectorName}
                  </span>
                </div>
                {c.reason && (
                  <div style={{ fontSize: 14, color: 'var(--ink-2)', marginTop: 2, lineHeight: 1.45 }}>{c.reason}</div>
                )}
                {c.photoUrls.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <PhotoThumbs urls={c.photoUrls} size={56} />
                  </div>
                )}
              </div>
            ))}
            {card.missingEmail.length > 0 && !noEmail && (
              <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>No email on file for {card.missingEmail.join(', ')}.</div>
            )}
          </div>
        ),
      }}
      reply={{
        label: `${noEmail ? 'Email to the crew' : `Email to ${to}`} (${language})${card.copy.length ? `, copy ${card.copy.join(', ')}` : ''}`,
        text: card.text,
        english:
          card.language === 'pt' ? (
            <EnglishLine text={card.english} label={card.edited ? 'English, as drafted before your edit' : 'English'} />
          ) : undefined,
        englishWhileEditing: card.language === 'pt' ? <EnglishLine text={card.english} label="English, as drafted" /> : undefined,
      }}
      approveBlocked={
        noEmail ? 'No cleaner email on file.' : card.status === 'approving' && !card.stuck ? 'Someone is sending this one.' : undefined
      }
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
    <span aria-label={`${n} of 5 stars`} style={{ color: 'var(--signal)', letterSpacing: '0.06em', fontSize: 14 }}>
      {'★'.repeat(n)}
      <span style={{ color: 'var(--rule)' }}>{'★'.repeat(5 - n)}</span>
    </span>
  );
}
