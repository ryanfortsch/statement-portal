'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Section } from '@/components/Section';
import { QueueRefreshControl, useQueueRefresh } from '@/components/QueueRefreshControl';
import type { CleanerApproval } from '@/lib/stay-concierge';
import {
  approveCleanerDraft,
  rejectCleanerDraft,
  markCleanerHandled,
  coachCleanerDraft,
  scheduleCleanerDraft,
  cancelCleanerSchedule,
} from './actions';
import { prettifyTopic, ageToneColor, relativeTimeShort, sendsInLabel } from '@/app/messaging/format';
import {
  QUEUED_TONE,
  QueuedBadge,
  SplitSendButton,
  SchedulePopover,
} from '@/components/ScheduleSend';

type PropertyOption = { id: string; name: string };

type Props = {
  initialPending: CleanerApproval[];
  /** Helm property list for the proposed-slip selector on each card. */
  properties: PropertyOption[];
};

const REFRESH_MS = 15_000;

// Teal for the work-slip-on-approval block: an operational side effect,
// distinct from both the draft (ink) and error/stale (signal) tones.
const SLIP_TONE = '#1f5e6b';

export function CleanerMessagingQueue({ initialPending, properties }: Props) {
  // Shared refresh brain (QueueRefreshControl): transition-wrapped
  // router.refresh on a jittered, visibility-gated interval (the #1236
  // stampede fix, which this queue never got), plus a tick the header chip
  // resets its "Updated Xs ago" timer on.
  const { softRefresh, refreshTick } = useQueueRefresh(REFRESH_MS);

  // Queued (scheduled) cards float to the top, ordered by when they fire;
  // pending drafts stay in newest-first order below (guest-queue pattern).
  const queued = initialPending
    .filter((a) => a.status === 'scheduled')
    .sort((a, b) => (a.send_at || '').localeCompare(b.send_at || ''));
  const pending = initialPending.filter((a) => a.status !== 'scheduled');
  const ordered = [...queued, ...pending];
  const title =
    initialPending.length === 0
      ? 'Inbox zero'
      : pending.length === 0
        ? `Queued (${queued.length})`
        : `Pending (${pending.length})${queued.length ? ` · ${queued.length} queued` : ''}`;

  return (
    <Section
      title={title}
      right={<QueueRefreshControl onRefresh={softRefresh} refreshTick={refreshTick} />}
      empty={initialPending.length === 0}
      emptyMessage="No cleaner-manager drafts waiting. Texts from Rosa or Nina show up here automatically."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {ordered.map((approval) => (
          <CleanerApprovalCard
            key={approval.id}
            approval={approval}
            properties={properties}
            onResolved={softRefresh}
          />
        ))}
      </div>
    </Section>
  );
}

type PendingAction =
  | 'approve'
  | 'reject'
  | 'mark-handled'
  | 'coach'
  | 'schedule'
  | 'send-now'
  | 'cancel-schedule'
  | null;

function CleanerApprovalCard({
  approval,
  properties,
  onResolved,
}: {
  approval: CleanerApproval;
  properties: PropertyOption[];
  onResolved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showCoach, setShowCoach] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  // Send-later drawer + collapsed state for queued cards (guest pattern).
  const [showSchedule, setShowSchedule] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const isScheduled = approval.status === 'scheduled';

  // Dismiss the schedule menu on Escape or a click outside this card.
  useEffect(() => {
    if (!showSchedule) return;
    const onDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) setShowSchedule(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSchedule(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showSchedule]);

  // Proposed work slip mined from the cleaner's message. The operator picks
  // the property and can untick filing entirely; the decision rides along on
  // approve. Default the select to the inferred property when Helm knows it.
  const slip = approval.proposed_slip ?? null;
  const inferredKnown = properties.some((p) => p.id === approval.property_id);
  const [slipPropertyId, setSlipPropertyId] = useState(
    slip && inferredKnown ? approval.property_id : '',
  );
  const [fileSlip, setFileSlip] = useState(true);
  // Filing needs a destination: block approve rather than silently dropping
  // the slip (or filing it nowhere). Unticking the box unblocks.
  const slipBlocked = !!slip && fileSlip && !slipPropertyId;

  const nameLabel = approval.cleaner_name || approval.cleaner_contact || 'Cleaner';
  const topicLabel = prettifyTopic(approval.topic) || 'General';
  const langChip = approval.inbound_language === 'pt'
    ? 'they wrote PT'
    : approval.inbound_language === 'mixed'
      ? 'mixed PT/EN'
      : 'they wrote EN';

  const ageLabel =
    approval.age_minutes == null
      ? 'just now'
      : approval.age_minutes < 1
        ? 'just now'
        : approval.age_minutes < 60
          ? `${approval.age_minutes} min ago`
          : `${Math.floor(approval.age_minutes / 60)}h ${approval.age_minutes % 60}m ago`;

  const run = (action: PendingAction, fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    setPendingAction(action);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        setPendingAction(null);
        return;
      }
      onResolved();
    });
  };

  // If inbound was English, don't double-render English under it.
  const showInboundEnglish =
    approval.inbound_language === 'pt' || approval.inbound_language === 'mixed';
  const inboundEnglishText = approval.cleaner_text_english?.trim();

  const doSchedule = (sendAtIso: string) => {
    setShowSchedule(false);
    run('schedule', () => scheduleCleanerDraft(approval.id, sendAtIso));
  };
  const doSendNow = () => run('send-now', () => approveCleanerDraft(approval.id));
  const doCancelSchedule = () => run('cancel-schedule', () => cancelCleanerSchedule(approval.id));

  // Collapsed queued card: a single dense row so waiting sends stay quiet.
  if (isScheduled && !expanded) {
    return (
      <article
        ref={cardRef}
        style={{
          border: '1px solid var(--rule)',
          borderLeft: `3px solid ${QUEUED_TONE}`,
          background: 'var(--paper-2)',
          padding: '11px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <QueuedBadge />
        <span className="font-serif" style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.01em' }}>
          {nameLabel}
        </span>
        <span className="eyebrow" style={{ color: 'var(--ink-3)' }} title={approval.send_at}>
          {sendsInLabel(approval.send_at)}
        </span>
        <span
          style={{
            flex: '1 1 120px',
            minWidth: 0,
            fontSize: 12,
            color: 'var(--ink-4)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={approval.draft}
        >
          {approval.draft}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="eyebrow"
            style={{ color: 'var(--ink-4)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            Show ▾
          </button>
          <SecondaryButton onClick={doSendNow} disabled={isPending}>
            {pendingAction === 'send-now' ? 'Sending…' : 'Send now'}
          </SecondaryButton>
          <SecondaryButton onClick={doCancelSchedule} disabled={isPending}>
            {pendingAction === 'cancel-schedule' ? 'Cancelling…' : 'Cancel send'}
          </SecondaryButton>
        </div>
        {error && (
          <p style={{ width: '100%', margin: '4px 0 0', fontSize: 12, color: 'var(--signal)', fontWeight: 500 }} role="alert">
            {error}
          </p>
        )}
      </article>
    );
  }

  return (
    <article
      ref={cardRef}
      style={{
        border: '1px solid var(--rule)',
        borderLeft: isScheduled ? `3px solid ${QUEUED_TONE}` : '1px solid var(--rule)',
        background: 'var(--paper-2)',
        padding: 20,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 14,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="font-serif" style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em' }}>
            {nameLabel}
          </span>
          <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
            {topicLabel} · {langChip}
          </span>
          {isScheduled && (
            <>
              <QueuedBadge />
              <span className="eyebrow" style={{ color: 'var(--ink-3)' }} title={approval.send_at}>
                {sendsInLabel(approval.send_at)}
              </span>
            </>
          )}
        </div>
        {isScheduled ? (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="eyebrow"
            style={{ color: 'var(--ink-4)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            Hide ▴
          </button>
        ) : (
          <span className="eyebrow" style={{ color: 'var(--ink-4)' }} title={approval.created_at}>
            {'drafted '}
            <span
              style={{
                color: ageToneColor(approval.age_minutes),
                fontWeight: ageToneColor(approval.age_minutes) === 'var(--signal)' ? 700 : 500,
              }}
            >
              {ageLabel}
            </span>
            {' · id '}
            {approval.short_id}
          </span>
        )}
      </header>

      <div className="rt-msg-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <FieldBlock
          label="They said"
          sub={relativeTimeShort(approval.created_at) ? `sent ${relativeTimeShort(approval.created_at)}` : ''}
          subTitle={approval.created_at}
        >
          <BodyText>{approval.cleaner_text || '(empty)'}</BodyText>
          {showInboundEnglish && inboundEnglishText && (
            <TranslationLine label="English">{inboundEnglishText}</TranslationLine>
          )}
        </FieldBlock>
        <FieldBlock label="Proposed reply (Portuguese)">
          <BodyText emphasis>{approval.draft || '(no draft)'}</BodyText>
          {approval.draft_english?.trim() && (
            <TranslationLine label="English">{approval.draft_english}</TranslationLine>
          )}
        </FieldBlock>
      </div>

      {slip && (
        <div
          style={{
            marginTop: 16,
            border: '1px solid var(--rule)',
            borderLeft: `3px solid ${SLIP_TONE}`,
            background: 'var(--paper)',
            padding: '12px 14px',
          }}
        >
          <div className="eyebrow" style={{ color: SLIP_TONE, marginBottom: 8 }}>
            Work slip on approval
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span className="font-serif" style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>
              {slip.title}
            </span>
            <SlipChip>{slip.category}</SlipChip>
            <SlipChip tone={slip.priority === 'high' ? 'var(--signal)' : undefined}>
              {slip.priority} priority
            </SlipChip>
          </div>
          {slip.note && (
            <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>
              {slip.note}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
            <select
              value={slipPropertyId}
              onChange={(e) => setSlipPropertyId(e.target.value)}
              aria-label="Property for the work slip"
              style={{
                fontSize: 13,
                padding: '6px 8px',
                background: 'var(--paper)',
                color: 'var(--ink)',
                border: '1px solid var(--rule)',
                outline: 'none',
              }}
            >
              <option value="">Select property…</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={fileSlip}
                onChange={(e) => setFileSlip(e.target.checked)}
                style={{ accentColor: SLIP_TONE, width: 14, height: 14 }}
              />
              File this slip when I approve
            </label>
          </div>
          {slipBlocked && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--signal)' }}>
              Pick a property for the slip (or untick it).
            </p>
          )}
        </div>
      )}

      {error && (
        <p style={{ marginTop: 14, fontSize: 13, color: 'var(--signal)', fontWeight: 500 }} role="alert">
          {error}
        </p>
      )}

      <footer
        style={{
          marginTop: 18,
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {isScheduled ? (
          <>
            <SecondaryButton
              onClick={doSendNow}
              disabled={isPending}
              title="Send this reply right now instead of waiting."
            >
              {pendingAction === 'send-now' ? 'Sending…' : 'Send now'}
            </SecondaryButton>
            <SecondaryButton
              onClick={doCancelSchedule}
              disabled={isPending}
              title="Stop the scheduled send and return this draft to the queue."
            >
              {pendingAction === 'cancel-schedule' ? 'Cancelling…' : 'Cancel send'}
            </SecondaryButton>
            <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
              Cancel send to edit or coach
            </span>
          </>
        ) : (
          <>
            <SplitSendButton
              onApprove={() =>
                run('approve', () =>
                  approveCleanerDraft(
                    approval.id,
                    slip
                      ? { fileSlip, slipPropertyId: slipPropertyId || undefined }
                      : undefined,
                  ),
                )
              }
              onToggle={() => setShowSchedule((v) => !v)}
              disabled={isPending || slipBlocked}
              // A queued send would file the slip with mined defaults, silently
              // dropping the operator's untick / property pick — so slip cards
              // send immediately only.
              toggleDisabled={!!slip}
              toggleTitle={
                slip
                  ? 'This card files a work slip, so it sends immediately (your slip choices ride along on approve).'
                  : undefined
              }
              loading={pendingAction === 'approve'}
              open={showSchedule}
            />
            {/* Proactive reminders are the operator's own composed message, not an
                AI draft of an inbound, so there is nothing to coach/regenerate. */}
            {approval.topic !== 'proactive_reminder' && (
              <SecondaryButton onClick={() => setShowCoach((v) => !v)} disabled={isPending}>
                {pendingAction === 'coach'
                  ? 'Regenerating…'
                  : showCoach
                    ? 'Cancel coaching'
                    : 'Coach the AI'}
              </SecondaryButton>
            )}
            <SecondaryButton
              onClick={() => run('mark-handled', () => markCleanerHandled(approval.id))}
              disabled={isPending}
              title="Already replied directly. Clears the queue without sending."
            >
              {pendingAction === 'mark-handled' ? 'Clearing…' : 'Mark handled'}
            </SecondaryButton>
            <SecondaryButton
              onClick={() => run('reject', () => rejectCleanerDraft(approval.id))}
              disabled={isPending}
              title="This message doesn't need a reply. Drops the draft."
            >
              {pendingAction === 'reject' ? 'Skipping…' : 'Reject'}
            </SecondaryButton>
          </>
        )}
      </footer>

      {showSchedule && !isScheduled && (
        <SchedulePopover onSchedule={doSchedule} disabled={isPending} />
      )}

      {pendingAction === 'coach' && (
        <p
          style={{ marginTop: 12, fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic' }}
          role="status"
          aria-live="polite"
        >
          Implementing your coaching. The rewritten draft replaces this one in a
          few seconds.
        </p>
      )}

      {showCoach && (
        <div style={{ marginTop: 14 }}>
          <label
            htmlFor={`cleaner-coach-${approval.id}`}
            className="eyebrow"
            style={{ display: 'block', marginBottom: 6, color: 'var(--ink-3)' }}
          >
            Coaching note
          </label>
          <textarea
            id={`cleaner-coach-${approval.id}`}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Say what's wrong with the Portuguese draft. You can write in English — the AI will regenerate in PT."
            rows={3}
            style={{
              width: '100%',
              padding: 10,
              border: '1px solid var(--rule)',
              background: 'var(--paper)',
              fontFamily: 'inherit',
              fontSize: 14,
              color: 'var(--ink)',
              resize: 'vertical',
            }}
          />
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <PrimaryButton
              onClick={() => {
                // Collapse immediately so the in-flight status above reads
                // for the whole regeneration; reopen on failure to revise.
                setShowCoach(false);
                run(
                  'coach',
                  async () => {
                    const res = await coachCleanerDraft(approval.id, feedback);
                    if (res.ok) setFeedback('');
                    else setShowCoach(true);
                    return res;
                  },
                );
              }}
              disabled={isPending || !feedback.trim()}
            >
              {pendingAction === 'coach' ? 'Regenerating…' : 'Regenerate with this note'}
            </PrimaryButton>
            <SecondaryButton
              onClick={() => {
                setShowCoach(false);
                setFeedback('');
              }}
              disabled={isPending}
            >
              Cancel
            </SecondaryButton>
          </div>
        </div>
      )}
    </article>
  );
}

function FieldBlock({
  label,
  sub,
  subTitle,
  children,
}: {
  label: string;
  sub?: string;
  subTitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="eyebrow"
        style={{
          marginBottom: 6,
          color: 'var(--ink-4)',
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span>{label}</span>
        {sub && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 400,
              letterSpacing: '0.10em',
              color: 'var(--ink-3)',
              textTransform: 'none',
            }}
            title={subTitle}
          >
            {sub}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function BodyText({ children, emphasis = false }: { children: React.ReactNode; emphasis?: boolean }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 14,
        lineHeight: 1.55,
        color: emphasis ? 'var(--ink)' : 'var(--ink-2)',
        whiteSpace: 'pre-wrap',
        fontWeight: emphasis ? 500 : 400,
      }}
    >
      {children}
    </p>
  );
}

/** Small uppercase chip for a proposed slip's category/priority. Neutral ink
 * by default; a high priority borrows the signal tone so it reads urgent. */
function SlipChip({ children, tone }: { children: React.ReactNode; tone?: string }) {
  const color = tone || 'var(--ink-3)';
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '.16em',
        textTransform: 'uppercase',
        color,
        border: `1px solid ${color}`,
        padding: '2px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function TranslationLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 8,
        paddingTop: 8,
        borderTop: '1px dashed var(--rule)',
        fontSize: 12,
        lineHeight: 1.55,
        color: 'var(--ink-3)',
        fontStyle: 'italic',
      }}
    >
      <span
        className="eyebrow"
        style={{ fontStyle: 'normal', color: 'var(--ink-4)', marginRight: 6 }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? 'var(--ink-4)' : 'var(--ink)',
        color: 'var(--paper)',
        border: '2px solid var(--ink)',
        padding: '13px 22px',
        fontSize: 12,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: 'var(--paper)',
        color: 'var(--ink-2)',
        border: '1px solid var(--ink-3)',
        padding: '10px 16px',
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
