'use client';

import { useCallback, useState } from 'react';
import { useQueueRefresh } from '@/components/QueueRefreshControl';
import { useApprovalQueue } from '@/lib/use-approval-queue';
import type { OwnerApproval } from '@/lib/stay-concierge';
import { prettifySlug, prettifyTopic } from '@/app/messaging/format';
import { ApprovalCard, sentAgoLabel } from '@/components/messaging/card/ApprovalCard';
import { ApprovalQueue, type QueueCardHelpers } from '@/components/messaging/card/ApprovalQueue';
import { SecondaryButton } from '@/components/messaging/card/buttons';
import { TEAM_HANDLED_REASONS } from '@/components/messaging/card/reasons';
import { waitReason } from '@/lib/card-wait-reason';
import {
  approveOwnerDraft,
  markOwnerHandled,
  undoOwnerDecision,
  coachOwnerDraft,
  editOwnerDraft,
  redraftOwnerDraft,
  scheduleOwnerDraft,
  cancelOwnerSchedule,
} from './actions';
import { splitOwnerText, parseTapback } from './conversation';
import { Envelope, InboundSubject } from './Envelope';
import { proposedActionItems } from './ProposedActions';

// How often the REST of the page re-renders. The cards poll their own feed
// every 15s (useApprovalQueue), so a coached draft appears as soon as the
// service has it.
const PAGE_REFRESH_MS = 60_000;

/** The owner queue: the one approval card, stacked so the owner's words,
 *  then where the reply goes (the Envelope), then the reply read in order. */
export function OwnerMessagingQueue({
  initialPending,
  aiPaused,
}: {
  initialPending: OwnerApproval[];
  /** The drafting AI is down: a card with no draft says so. */
  aiPaused?: { reason?: string } | null;
}) {
  const { approvals, updatedTick, refresh, watchRegen, stalledId } = useApprovalQueue(initialPending, 'owners');
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
      undo={undoOwnerDecision}
      emptyMessage="No owner replies waiting."
      renderCard={(approval, helpers) => (
        <OwnerCard
          key={approval.id}
          approval={approval}
          helpers={helpers}
          onRegenerating={watchRegen}
          regenStalled={stalledId === approval.id}
          aiPaused={aiPaused}
        />
      )}
    />
  );
}

function OwnerCard({
  approval,
  helpers,
  onRegenerating,
  regenStalled,
  aiPaused,
}: {
  approval: OwnerApproval;
  helpers: QueueCardHelpers;
  onRegenerating: (id: string) => void;
  regenStalled: boolean;
  aiPaused?: { reason?: string } | null;
}) {
  const id = approval.id;
  const owner = approval.owner_name || approval.owner_contact || 'Owner';
  const property = approval.property_name || prettifySlug(approval.property_id) || '(no property tag)';
  const channel = approval.channel === 'email_gmail' ? 'email' : 'SMS';

  // Split the stacked owner_text into its messages; drop pure tapbacks
  // (reactions to our earlier replies, not new asks). A card that is all
  // reactions has nothing to reply to.
  const segments = splitOwnerText(approval.owner_text || '');
  const reactions = segments.map((s) => parseTapback(s)).filter(Boolean) as { glyph: string; verb: string; quoted: string }[];
  const realSegments = segments.filter((s) => !parseTapback(s));
  const allReactions = segments.length > 0 && realSegments.length === 0;
  const ownerSaid = realSegments.length > 0 ? realSegments : [approval.owner_text || '(empty)'];
  const firstName = (approval.owner_name || '').trim().split(/\s+/)[0] || 'They';

  const proposedActions = approval.proposed_actions ?? [];
  const [fileActions, setFileActions] = useState(approval.followup_status?.enabled !== 0);
  const checking =
    approval.followup_status?.enabled !== 0 &&
    approval.followup_status &&
    ['checking', 'retrying', 'unchecked'].includes(approval.followup_status.state)
      ? approval.followup_status
      : null;

  const common = {
    id,
    status: approval.status,
    sendAt: approval.send_at,
    name: `${owner} · ${property}`,
    property,
    preview: approval.owner_text,
    channel,
    chips: <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>{prettifyTopic(approval.topic) || 'General'} · {channel}</span>,
    ageMinutes: approval.age_minutes,
    createdAt: approval.created_at,
    shortId: approval.short_id,
    wait: waitReason({
      status: approval.status,
      ageMinutes: approval.age_minutes,
      sendAttempts: approval.send_attempts,
      lastSendError: approval.last_send_error,
      answeredWhere: channel === 'email' ? 'by email' : 'by text',
      noDraft: !allReactions && !approval.draft.trim(),
      aiPaused,
    }),
    outcomes: approval.outcomes,
    onResolved: helpers.onResolved,
    onDecided: helpers.onDecided,
    onRegenerating,
    regenStalled,
  };

  if (allReactions) {
    return (
      <ApprovalCard
        {...common}
        said={{
          label: 'Owner reacted',
          body: (
            <div style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.55 }}>
              {firstName} reacted {reactions.map((r) => r.glyph).join(' ') || '👍'} to your message. Nothing to reply to.
            </div>
          ),
        }}
        reply={null}
        verbs={{ markHandled: (capture) => markOwnerHandled(id, fileActions, capture) }}
        handledReasons={TEAM_HANDLED_REASONS}
        // A reaction is cleared in one tap; the toast still offers Undo.
        footer={(ctl) => (
          <SecondaryButton
            onClick={() => ctl.markHandled({ reason: 'Reaction, nothing to reply to' })}
            disabled={ctl.busy}
            loading={ctl.pending === 'mark-handled'}
            loadingLabel="Marking"
            title="A reaction, not a message. Clears it from the queue without sending."
          >
            Mark handled
          </SecondaryButton>
        )}
      />
    );
  }

  return (
    <ApprovalCard
      {...common}
      layout="stacked"
      said={{
        label: ownerSaid.length > 1 ? `Owner said · ${ownerSaid.length} messages` : 'Owner said',
        sub: sentAgoLabel(approval.created_at),
        subTitle: `${approval.created_at} · ${approval.short_id}`,
        body: (
          <>
            <InboundSubject envelope={approval.envelope} />
            <OwnerSaidRun segments={ownerSaid} />
            {reactions.length > 0 && <ReactionChips reactions={reactions} />}
          </>
        ),
      }}
      // Where the reply goes, read before approving, not after.
      between={<Envelope envelope={approval.envelope} />}
      reply={{ text: approval.draft }}
      afterColumns={
        checking && (
          <p role="status" style={{ marginTop: 12, fontSize: 13, color: checking.error ? 'var(--signal)' : 'var(--ink-3)' }}>
            {checking.error || 'Checking this message for follow-up work.'}
          </p>
        )
      }
      also={approval.status === 'scheduled' ? undefined : proposedActionItems(proposedActions, fileActions, setFileActions)}
      verbs={{
        approve: () => approveOwnerDraft(id, undefined, { fileActions }),
        schedule: (at) => scheduleOwnerDraft(id, at, undefined, fileActions),
        // An edit is stored on the card when it is saved, so Send now fires it.
        sendNow: () => approveOwnerDraft(id, undefined, { fileActions }),
        cancelSchedule: () => cancelOwnerSchedule(id),
        saveEdit: (text) => editOwnerDraft(id, text),
        coach: (note) => coachOwnerDraft(id, note),
        redraft: () => redraftOwnerDraft(id),
        markHandled: (capture) => markOwnerHandled(id, fileActions, capture),
      }}
      handledReasons={TEAM_HANDLED_REASONS}
      pastePlaceholder="Paste the reply you sent the owner, by text or by email"
    />
  );
}

/** Owner tapbacks that came with a real message, as chips under it instead
 *  of a wall of quoted text. */
function ReactionChips({ reactions }: { reactions: { glyph: string; verb: string }[] }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      {reactions.map((r, i) => (
        <span
          key={i}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: 'var(--ink-3)',
            background: 'var(--paper)',
            border: '1px solid var(--rule)',
            padding: '3px 8px',
            borderRadius: 999,
          }}
        >
          <span aria-hidden="true">{r.glyph}</span>
          {r.verb}
        </span>
      ))}
    </div>
  );
}

/** The owner's message(s) as a run. One message reads as one line; a burst
 *  becomes a keylined block, one line per message, at full ink weight. */
function OwnerSaidRun({ segments }: { segments: string[] }) {
  const line = (s: string, key: number) => (
    <p key={key} style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>
      {s || '(empty)'}
    </p>
  );
  if (segments.length <= 1) return line(segments[0] || '', 0);
  return (
    <div style={{ borderLeft: '2px solid var(--rule)', paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {segments.map((s, i) => line(s, i))}
    </div>
  );
}
