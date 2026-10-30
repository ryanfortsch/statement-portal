'use client';

import type { ReactNode } from 'react';
import type { CleanerApproval } from '@/lib/stay-concierge';
import { prettifyTopic } from '@/app/messaging/format';
import { EnglishLine } from '@/components/messaging/TranslationLine';
import { ApprovalCard, BodyText, sentAgoLabel } from '@/components/messaging/card/ApprovalCard';
import type { QueueCardHelpers } from '@/components/messaging/card/ApprovalQueue';
import { useWorkSlip } from '@/components/messaging/card/useWorkSlip';
import { TEAM_HANDLED_REASONS, isTeamProactive, reasonsFor } from '@/components/messaging/card/reasons';
import { waitReason } from '@/lib/card-wait-reason';
import {
  approveCleanerDraft,
  markCleanerHandled,
  coachCleanerDraft,
  editCleanerDraft,
  redraftCleanerDraft,
  scheduleCleanerDraft,
  cancelCleanerSchedule,
} from './actions';

type PropertyOption = { id: string; name: string };

/** A cleaner's text on the one approval card, on the Team inbox: Portuguese
 *  with the English under each side, and the work slip a text implies. */
export function CleanerCard({
  approval,
  properties,
  helpers,
  onRegenerating,
  regenStalled,
  audienceChip,
  aiPaused,
}: {
  approval: CleanerApproval;
  properties: PropertyOption[];
  helpers: QueueCardHelpers;
  onRegenerating: (id: string) => void;
  regenStalled: boolean;
  /** The Team inbox says whose card this is. */
  audienceChip?: ReactNode;
  /** The drafting AI is down. */
  aiPaused?: { reason?: string } | null;
}) {
  const id = approval.id;
  const slip = useWorkSlip({
    id,
    slip: approval.proposed_slip ?? null,
    properties,
    initialPropertyId:
      approval.proposed_slip && properties.some((p) => p.id === approval.property_id) ? approval.property_id : '',
  });
  const proactive = isTeamProactive(approval);
  const name = approval.cleaner_name || approval.cleaner_contact || 'Cleaner';
  const wrote = approval.inbound_language === 'pt' ? 'they wrote PT' : approval.inbound_language === 'mixed' ? 'mixed PT/EN' : 'they wrote EN';
  // English inbound needs no English line under it.
  const inboundForeign = approval.inbound_language === 'pt' || approval.inbound_language === 'mixed';

  return (
    <ApprovalCard
      id={id}
      status={approval.status}
      sendAt={approval.send_at}
      name={name}
      property={approval.property_name || ''}
      preview={approval.cleaner_text}
      channel="SMS"
      chips={
        <>
          {audienceChip}
          <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
            {prettifyTopic(approval.topic) || 'General'} · {wrote}
          </span>
        </>
      }
      queuedChips={audienceChip}
      ageMinutes={approval.age_minutes}
      createdAt={approval.created_at}
      draftTiming={{ createdAt: approval.created_at, translation: approval.draft_translating ? undefined : approval.draft_english }}
      shortId={approval.short_id}
      wait={waitReason({
        status: approval.status,
        lastSendError: approval.last_send_error,
        noDraft: !approval.draft.trim(),
        aiPaused,
      })}
      said={{
        label: 'They said',
        sub: sentAgoLabel(approval.created_at),
        subTitle: approval.created_at,
        body: (
          <>
            <BodyText>{approval.cleaner_text || '(empty)'}</BodyText>
            {inboundForeign && <EnglishLine text={approval.cleaner_text_english} />}
          </>
        ),
      }}
      reply={{
        label: 'Proposed reply (Portuguese)',
        text: approval.draft,
        english: <EnglishLine text={approval.draft_english} translating={approval.draft_translating} />,
        englishWhileEditing: <EnglishLine text={approval.draft_english} label="English, as drafted" />,
      }}
      coachHint="Write the note in English if you like; the reply comes back in Portuguese."
      also={slip.item ? [slip.item] : undefined}
      approveBlocked={slip.blocked}
      scheduleBlocked={slip.scheduleBlocked}
      verbs={{
        approve: () => approveCleanerDraft(id, slip.opts),
        schedule: (at) => scheduleCleanerDraft(id, at),
        sendNow: () => approveCleanerDraft(id),
        cancelSchedule: () => cancelCleanerSchedule(id),
        // Edit on the Portuguese: the English beside it is remade from the
        // edited text (concierge #88), and shows "translating" until it lands.
        saveEdit: (text) => editCleanerDraft(id, text),
        // A proactive reminder is the operator's own message: nothing to
        // coach or redraft.
        coach: proactive ? undefined : (note) => coachCleanerDraft(id, note),
        redraft: proactive ? undefined : () => redraftCleanerDraft(id),
        markHandled: (capture) => markCleanerHandled(id, capture),
      }}
      handledReasons={reasonsFor(TEAM_HANDLED_REASONS, proactive)}
      outcomes={approval.outcomes}
      onResolved={helpers.onResolved}
      onDecided={helpers.onDecided}
      onRegenerating={onRegenerating}
      regenStalled={regenStalled}
    />
  );
}
