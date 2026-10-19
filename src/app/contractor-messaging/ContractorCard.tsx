'use client';

import type { ReactNode } from 'react';
import type { ContractorApproval } from '@/lib/stay-concierge';
import type { ApprovalContext } from '@/lib/contractor-approval-context';
import { prettifyTopic } from '@/app/messaging/format';
import { ApprovalCard, BodyText, sentAgoLabel } from '@/components/messaging/card/ApprovalCard';
import type { QueueCardHelpers } from '@/components/messaging/card/ApprovalQueue';
import { useWorkSlip } from '@/components/messaging/card/useWorkSlip';
import { TEAM_HANDLED_REASONS, isTeamProactive, reasonsFor } from '@/components/messaging/card/reasons';
import { waitReason } from '@/lib/card-wait-reason';
import {
  approveContractorDraft,
  markContractorHandled,
  coachContractorDraft,
  editContractorDraft,
  redraftContractorDraft,
  scheduleContractorDraft,
  cancelContractorSchedule,
} from './actions';

type PropertyOption = { id: string; name: string };

/** A contractor's text on the one approval card, on the Team inbox: the work
 *  slip their text implies, with the homes on their run today offered first. */
export function ContractorCard({
  approval,
  properties,
  ctx,
  helpers,
  onRegenerating,
  regenStalled,
  audienceChip,
  aiPaused,
}: {
  approval: ContractorApproval;
  properties: PropertyOption[];
  ctx?: ApprovalContext;
  helpers: QueueCardHelpers;
  onRegenerating: (id: string) => void;
  regenStalled: boolean;
  /** The Team inbox says whose card this is. */
  audienceChip?: ReactNode;
  /** The drafting AI is down. */
  aiPaused?: { reason?: string } | null;
}) {
  const id = approval.id;
  // The concierge's own inference wins if it names a known home; otherwise
  // Helm's run-derived guess (the home they just finished, or flagged).
  const inferred = properties.some((p) => p.id === approval.property_id) ? approval.property_id : '';
  const runGuess = ctx?.suggestedPropertyId && properties.some((p) => p.id === ctx.suggestedPropertyId) ? ctx.suggestedPropertyId : '';
  const slip = useWorkSlip({
    id,
    slip: approval.proposed_slip ?? null,
    properties,
    initialPropertyId: approval.proposed_slip ? inferred || runGuess : '',
    runProperties: ctx?.runProperties,
    alreadyFiled: ctx?.alreadyFiled,
  });
  const proactive = isTeamProactive(approval);
  const name = approval.contractor_name || approval.contractor_contact || 'Contractor';

  return (
    <ApprovalCard
      id={id}
      status={approval.status}
      sendAt={approval.send_at}
      name={name}
      preview={approval.contractor_text}
      channel="SMS"
      chips={
        <>
          {audienceChip}
          <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>{prettifyTopic(approval.topic) || 'General'}</span>
        </>
      }
      queuedChips={audienceChip}
      ageMinutes={approval.age_minutes}
      createdAt={approval.created_at}
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
        body: <BodyText>{approval.contractor_text || '(empty)'}</BodyText>,
      }}
      reply={{ text: approval.draft }}
      also={slip.item ? [slip.item] : undefined}
      approveBlocked={slip.blocked}
      scheduleBlocked={slip.scheduleBlocked}
      verbs={{
        approve: () => approveContractorDraft(id, slip.opts),
        schedule: (at) => scheduleContractorDraft(id, at),
        sendNow: () => approveContractorDraft(id),
        cancelSchedule: () => cancelContractorSchedule(id),
        saveEdit: (text) => editContractorDraft(id, text),
        // A proactive reminder is the operator's own message: nothing to
        // coach or redraft.
        coach: proactive ? undefined : (note) => coachContractorDraft(id, note),
        redraft: proactive ? undefined : () => redraftContractorDraft(id),
        markHandled: (capture) => markContractorHandled(id, capture),
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
