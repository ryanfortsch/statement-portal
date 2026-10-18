'use client';

import { useCallback, type ReactNode } from 'react';
import { useQueueRefresh } from '@/components/QueueRefreshControl';
import { useApprovalQueue } from '@/lib/use-approval-queue';
import type { ContractorApproval } from '@/lib/stay-concierge';
import type { ApprovalContext } from '@/lib/contractor-approval-context';
import { prettifyTopic } from '@/app/messaging/format';
import { ApprovalCard, BodyText, sentAgoLabel } from '@/components/messaging/card/ApprovalCard';
import { ApprovalQueue, type QueueCardHelpers } from '@/components/messaging/card/ApprovalQueue';
import { useWorkSlip } from '@/components/messaging/card/useWorkSlip';
import { TEAM_HANDLED_REASONS, isTeamProactive, reasonsFor } from '@/components/messaging/card/reasons';
import {
  approveContractorDraft,
  markContractorHandled,
  undoContractorDecision,
  coachContractorDraft,
  editContractorDraft,
  redraftContractorDraft,
  scheduleContractorDraft,
  cancelContractorSchedule,
} from './actions';

type PropertyOption = { id: string; name: string };

// How often the REST of the page re-renders. The cards poll their own feed
// every 15s (useApprovalQueue), so a coached draft appears as soon as the
// service has it.
const PAGE_REFRESH_MS = 60_000;

/** The contractor queue: the one approval card, with the work slip their
 *  text implies and the homes on their run today offered first. */
export function ContractorMessagingQueue({
  initialPending,
  properties,
  context,
}: {
  initialPending: ContractorApproval[];
  context?: Record<string, ApprovalContext>;
  /** Helm property list for the proposed-slip selector on each card. */
  properties: PropertyOption[];
}) {
  // The Field context travels with the feed: a coached rewrite lands under a
  // new id, and the context that narrows its property dropdown is keyed by id.
  const { approvals, context: liveContext, updatedTick, refresh, watchRegen, stalledId } = useApprovalQueue<
    ContractorApproval,
    Record<string, ApprovalContext>
  >(initialPending, 'contractors', context);
  const { softRefresh } = useQueueRefresh(PAGE_REFRESH_MS);
  const onRefresh = useCallback(() => {
    refresh();
    softRefresh();
  }, [refresh, softRefresh]);

  return (
    <ApprovalQueue
      approvals={approvals}
      updatedTick={updatedTick}
      onRefresh={onRefresh}
      undo={undoContractorDecision}
      emptyMessage="No contractor texts waiting."
      renderCard={(approval, helpers) => (
        <ContractorCard
          key={approval.id}
          approval={approval}
          properties={properties}
          ctx={liveContext?.[approval.id]}
          helpers={helpers}
          onRegenerating={watchRegen}
          regenStalled={stalledId === approval.id}
        />
      )}
    />
  );
}

export function ContractorCard({
  approval,
  properties,
  ctx,
  helpers,
  onRegenerating,
  regenStalled,
  audienceChip,
}: {
  approval: ContractorApproval;
  properties: PropertyOption[];
  ctx?: ApprovalContext;
  helpers: QueueCardHelpers;
  onRegenerating: (id: string) => void;
  regenStalled: boolean;
  /** The Team inbox says whose card this is. */
  audienceChip?: ReactNode;
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
