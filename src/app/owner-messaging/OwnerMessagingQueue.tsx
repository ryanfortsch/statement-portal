'use client';

import { memo, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Section } from '@/components/Section';
import { QueueRefreshControl, useQueueRefresh } from '@/components/QueueRefreshControl';
import type { OwnerApproval } from '@/lib/stay-concierge';
import {
  approveOwnerDraft,
  rejectOwnerDraft,
  markOwnerHandled,
  coachOwnerDraft,
  scheduleOwnerDraft,
  cancelOwnerSchedule,
} from './actions';
import {
  prettifySlug,
  prettifyTopic,
  ageToneColor,
  relativeTimeShort,
  sendsInLabel,
} from '@/app/messaging/format';
import {
  QUEUED_TONE,
  QueuedBadge,
  SplitSendButton,
  SchedulePopover,
} from '@/components/ScheduleSend';
import { splitOwnerText, parseTapback } from './conversation';

type Props = { initialPending: OwnerApproval[] };

const REFRESH_MS = 15_000;

export function OwnerMessagingQueue({ initialPending }: Props) {
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
      emptyMessage="No owner drafts waiting. New owner messages will show up here automatically when the AI drafts a reply."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {ordered.map((approval) => (
          <OwnerApprovalCard
            key={approval.id}
            approval={approval}
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

const OwnerApprovalCard = memo(function OwnerApprovalCard({
  approval,
  onResolved,
}: {
  approval: OwnerApproval;
  onResolved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showCoach, setShowCoach] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  // The draft is a live editable field. draftText is what actually sends;
  // `edited` flags that the operator changed it from the AI's original.
  const [draftText, setDraftText] = useState(approval.draft ?? '');
  const [edited, setEdited] = useState(false);
  const coachRef = useRef<HTMLTextAreaElement>(null);
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

  const ownerLabel = approval.owner_name || approval.owner_contact || 'Owner';
  const propertyLabel =
    approval.property_name || prettifySlug(approval.property_id) || '(no property tag)';
  const topicLabel = prettifyTopic(approval.topic) || 'General';
  const channelLabel = approval.channel === 'email_gmail' ? 'email' : 'SMS';
  const isStale = ageToneColor(approval.age_minutes) === 'var(--signal)';

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

  // Split the stacked owner_text into individual messages; drop pure tapbacks
  // (reactions to our earlier replies, not new asks). If every segment is a
  // reaction, the card collapses to a one-line notice + a single Dismiss.
  const segments = splitOwnerText(approval.owner_text || '');
  const reactions = segments.map((s) => parseTapback(s)).filter(Boolean) as {
    glyph: string;
    verb: string;
    quoted: string;
  }[];
  const realSegments = segments.filter((s) => !parseTapback(s));
  const allReactions = segments.length > 0 && realSegments.length === 0;
  const ownerSaid = realSegments.length > 0 ? realSegments : [approval.owner_text || '(empty)'];
  const firstName = (approval.owner_name || '').trim().split(/\s+/)[0] || 'They';

  const canApprove = draftText.trim().length > 0 && !isPending;

  const doApprove = () => {
    if (!canApprove) return;
    run('approve', () => approveOwnerDraft(approval.id, edited ? draftText : undefined));
  };
  const doSchedule = (sendAtIso: string) => {
    setShowSchedule(false);
    // An in-place edit rides along, mirroring approve, so the queued send
    // fires the operator's text.
    run('schedule', () =>
      scheduleOwnerDraft(approval.id, sendAtIso, edited ? draftText : undefined),
    );
  };
  // Edits were persisted at schedule time, so Send now fires the stored draft.
  const doSendNow = () => run('send-now', () => approveOwnerDraft(approval.id));
  const doCancelSchedule = () => run('cancel-schedule', () => cancelOwnerSchedule(approval.id));
  const doReject = () => run('reject', () => rejectOwnerDraft(approval.id));
  const doHandled = () => run('mark-handled', () => markOwnerHandled(approval.id));
  const doCoach = () => {
    // Collapse the drawer immediately so the in-flight status line below
    // reads cleanly for the whole regeneration (guests-queue pattern —
    // without it the only signal is a tiny button label and the coach
    // looks like it did nothing).
    setShowCoach(false);
    run('coach', async () => {
      const res = await coachOwnerDraft(approval.id, feedback, edited ? draftText : undefined);
      if (res.ok) {
        setFeedback('');
      } else {
        // Reopen so the note can be revised instead of retyped.
        setShowCoach(true);
      }
      return res;
    });
  };
  const toggleCoach = () => {
    setShowCoach((v) => {
      const next = !v;
      if (next) setTimeout(() => coachRef.current?.focus(), 0);
      return next;
    });
  };

  // Card-scoped keyboard shortcuts. Typing inside a textarea never fires an
  // action, with one exception: Cmd/Ctrl+Enter from the draft field is the
  // "done editing, send it" gesture.
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    // A queued card's only actions are the explicit Send now / Cancel send
    // buttons; single-key shortcuts firing a send here would be a footgun.
    if (isScheduled) return;
    const inTextarea = (e.target as HTMLElement)?.tagName === 'TEXTAREA';
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      doApprove();
      return;
    }
    if (inTextarea || isPending) return;
    const k = e.key.toLowerCase();
    if (k === 'a') {
      e.preventDefault();
      doApprove();
    } else if (k === 'c') {
      e.preventDefault();
      toggleCoach();
    } else if (k === 'h') {
      e.preventDefault();
      doHandled();
    } else if (k === 'r') {
      e.preventDefault();
      doReject();
    } else if (e.key === 'Escape') {
      if (showCoach) {
        setShowCoach(false);
        setFeedback('');
      } else {
        (e.currentTarget as HTMLElement).blur();
      }
    }
  };

  // Collapsed queued card: a single dense row (name, countdown, a one-line
  // draft preview) with its actions, so waiting sends stay quiet on the
  // dashboard. "Show" expands to the full card below.
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
          {ownerLabel} · {propertyLabel}
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
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{
        border: '1px solid var(--rule)',
        borderLeft: isScheduled
          ? `3px solid ${QUEUED_TONE}`
          : isStale
            ? '3px solid var(--signal)'
            : '1px solid var(--rule)',
        background: 'var(--paper-2)',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        outline: 'none',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="font-serif" style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em' }}>
            {ownerLabel} · {propertyLabel}
          </span>
          <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
            {topicLabel} · {channelLabel}
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
        {/* Queued cards suppress the "drafted X ago" cue (the countdown is
            the one time readout) and offer Hide to collapse back down. */}
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
                fontWeight: isStale ? 700 : 500,
              }}
            >
              {ageLabel}
            </span>
            {' · id '}
            {approval.short_id}
          </span>
        )}
      </header>

      {allReactions ? (
        <>
          <div style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            {firstName} reacted {reactions.map((r) => r.glyph).join(' ') || '👍'} to your message.
            Nothing to reply to.
          </div>
          {error && (
            <p style={{ fontSize: 13, color: 'var(--signal)', fontWeight: 500 }} role="alert">
              {error}
            </p>
          )}
          <footer style={{ display: 'flex', gap: 10 }}>
            <SecondaryButton
              onClick={doReject}
              disabled={isPending}
              title="A reaction, not a message. Clears it from the queue."
            >
              {pendingAction === 'reject' ? 'Dismissing…' : 'Dismiss'}
            </SecondaryButton>
          </footer>
        </>
      ) : (
        <>
          {/* OWNER SAID - the ask, read first */}
          <div>
            <div
              className="eyebrow"
              style={{ marginBottom: 6, color: 'var(--ink-4)', display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}
            >
              <span>{ownerSaid.length > 1 ? `Owner said · ${ownerSaid.length} messages` : 'Owner said'}</span>
              {relativeTimeShort(approval.created_at) && (
                <span
                  style={{ fontSize: 10, fontWeight: 400, letterSpacing: '0.10em', color: 'var(--ink-3)', textTransform: 'none' }}
                  title={approval.created_at}
                >
                  sent {relativeTimeShort(approval.created_at)}
                </span>
              )}
            </div>
            {/* subject slot: OwnerApproval has no email subject yet; add here when it lands */}
            <OwnerSaidRun segments={ownerSaid} />
            {reactions.length > 0 && <ReactionChips reactions={reactions} />}
          </div>

          {/* PROPOSED REPLY - the hero, editable in place. A queued card
              shows the locked text instead: cancel the send to edit. */}
          {isScheduled ? (
            <div style={{ background: 'var(--paper-3)', border: '1px solid var(--rule)', padding: '18px 20px' }}>
              <div className="eyebrow" style={{ color: 'var(--ink-4)', marginBottom: 8 }}>
                Reply that will send
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 15,
                  lineHeight: 1.65,
                  color: 'var(--ink)',
                  fontWeight: 500,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {approval.draft || '(no draft)'}
              </p>
            </div>
          ) : (
            <DraftHero
              key={approval.draft}
              initial={approval.draft ?? ''}
              edited={edited}
              onChange={(v, changed) => {
                setDraftText(v);
                if (changed) setEdited(true);
              }}
              onApprove={doApprove}
            />
          )}

          {error && (
            <p style={{ fontSize: 13, color: 'var(--signal)', fontWeight: 500 }} role="alert">
              {error}
            </p>
          )}

          <footer style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
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
                  label={edited ? 'Approve edited & send' : 'Approve & send'}
                  onApprove={doApprove}
                  onToggle={() => setShowSchedule((v) => !v)}
                  disabled={!canApprove}
                  loading={pendingAction === 'approve'}
                  open={showSchedule}
                />
                <SecondaryButton onClick={toggleCoach} disabled={isPending}>
                  {pendingAction === 'coach'
                    ? 'Regenerating…'
                    : showCoach
                      ? 'Cancel coaching'
                      : 'Coach the AI'}
                </SecondaryButton>
                <SecondaryButton
                  onClick={doHandled}
                  disabled={isPending}
                  title="Already replied to the owner directly. Clears the queue without sending."
                >
                  {pendingAction === 'mark-handled' ? 'Clearing…' : 'Mark handled'}
                </SecondaryButton>
                <SecondaryButton
                  onClick={doReject}
                  disabled={isPending}
                  title="This owner message doesn't need a reply. Drops the draft."
                >
                  {pendingAction === 'reject' ? 'Skipping…' : 'Reject'}
                </SecondaryButton>
              </>
            )}
          </footer>

          {showSchedule && !isScheduled && (
            <SchedulePopover onSchedule={doSchedule} disabled={isPending} />
          )}

          {pendingAction === 'schedule' && (
            <p
              style={{ fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic' }}
              role="status"
              aria-live="polite"
            >
              Queueing this reply to send later…
            </p>
          )}

          {pendingAction === 'coach' && (
            <p
              style={{
                marginTop: 4,
                fontSize: 13,
                color: 'var(--ink-3)',
                fontStyle: 'italic',
              }}
              role="status"
              aria-live="polite"
            >
              Implementing your coaching. The rewritten draft replaces this one
              in a few seconds.
            </p>
          )}

          {showCoach && (
            <div>
              <label
                htmlFor={`owner-coach-${approval.id}`}
                className="eyebrow"
                style={{ display: 'block', marginBottom: 6, color: 'var(--ink-3)' }}
              >
                Coaching note
              </label>
              <textarea
                id={`owner-coach-${approval.id}`}
                ref={coachRef}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Say what's wrong with the draft. The AI will rewrite using your guidance (and keep any edits you made above)."
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
                <PrimaryButton onClick={doCoach} disabled={isPending || !feedback.trim()}>
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
        </>
      )}
    </article>
  );
});

/**
 * The proposed reply, presented as the hero: a raised surface with a
 * borderless textarea that reads as typeset prose. Editing it here sends the
 * edited text on approve (no coach round-trip for a one-word fix). Remounted
 * (via key) whenever the AI draft changes, which reseeds the field and clears
 * the edited flag.
 */
function DraftHero({
  initial,
  edited,
  onChange,
  onApprove,
}: {
  initial: string;
  edited: boolean;
  onChange: (value: string, changed: boolean) => void;
  onApprove: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ background: 'var(--paper-3)', border: '1px solid var(--rule)', padding: '18px 20px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
          Proposed reply
        </span>
        {edited && (
          <span className="eyebrow" style={{ color: 'var(--signal)' }}>
            edited
          </span>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onChange(e.target.value, e.target.value !== initial);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="No draft was generated. Coach the AI, or write a reply here."
        style={{
          width: '100%',
          border: 'none',
          background: 'transparent',
          resize: 'vertical',
          fontFamily: 'inherit',
          fontSize: 15,
          lineHeight: 1.65,
          color: 'var(--ink)',
          fontWeight: 500,
          minHeight: 76,
          padding: 0,
          outline: 'none',
          boxShadow: focused ? 'inset 0 -1px 0 var(--ink-3)' : 'none',
          whiteSpace: 'pre-wrap',
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            onApprove();
          }
        }}
      />
    </div>
  );
}

/** Owner tapbacks that accompanied a real message, shown as compact chips
 *  under the owner note instead of a wall of quoted text. */
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

/** The owner's message(s) as a clustered run. A single message reads as one
 *  line; a stacked burst becomes a keylined block, one line per message, so
 *  the operator reads a real exchange instead of a wall. Owner words render at
 *  full --ink weight so they read as the primary context. */
function OwnerSaidRun({ segments }: { segments: string[] }) {
  const line = (s: string, key: number) => (
    <p
      key={key}
      style={{
        margin: 0,
        fontSize: 14,
        lineHeight: 1.55,
        color: 'var(--ink)',
        whiteSpace: 'pre-wrap',
      }}
    >
      {s || '(empty)'}
    </p>
  );
  if (segments.length <= 1) return line(segments[0] || '', 0);
  return (
    <div
      style={{
        borderLeft: '2px solid var(--rule)',
        paddingLeft: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {segments.map((s, i) => line(s, i))}
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
