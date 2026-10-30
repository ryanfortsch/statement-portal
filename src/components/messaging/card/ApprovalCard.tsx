'use client';

import { draftValidity } from '@/lib/draft-validity';
import { ActionReceipt } from './ActionReceipt';
import type { ApprovalReceipt } from '@/lib/approval-receipt';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { MobileInboxReview } from '@/components/MobileInboxReview';
import { MessageOutcomes } from '@/components/MessageOutcomes';
import { QUEUED_TONE, SchedulePopover, SplitSendButton } from '@/components/ScheduleSend';
import { ageToneColor, relativeTimeShort, sendsInLabel } from '@/app/messaging/format';
import type { MessageOutcomes as Outcomes } from '@/lib/message-outcomes';
import { PrimaryButton, QuietButton, SecondaryButton } from './buttons';
import { Button } from '@/components/Button';
import { AlsoOnApprove } from './AlsoOnApprove';
import { WaitLine } from './WaitLine';
import type { AlsoItem, CardResult, CardVerbs, Decision, HandledCapture, WaitReason } from './types';

/**
 * The one approval card (2026-10-18). Guests, owners, cleaners and
 * contractors all render this, so a verb means the same thing on every tab:
 *
 *   Approve & send, with Send later on the chevron
 *   Edit      changes this reply only
 *   Coach     rewrites it and teaches the AI
 *   Redraft   re-runs it on today's data, teaches nothing
 *   Mark handled, with a reason in one tap, and Undo for 12 hours
 *
 * The card's face is who wrote and what they said, the proposed reply, and the
 * verbs. Everything approving will ALSO do (a work slip, a payment link, a
 * note to Rosa) folds into one "Also on approve" line list, and a card that is
 * waiting for a reason says it in one line under its header.
 *
 * Each audience wraps this with its own blocks and its own server actions;
 * what a send carries (the slip pick, the add-on text box) lives in the
 * wrapper's closures, so the card never needs to know an audience.
 */

/** The button mid-flight, so the operator sees which one she pressed. */
export type PendingAction =
  | 'approve'
  | 'mark-handled'
  | 'coach'
  | 'schedule'
  | 'save-edit'
  | 'cancel-schedule'
  | 'send-now'
  | 'redraft'
  | null;

/** What a custom footer can use: the standard pieces, and the runner. */
export type CardController = {
  busy: boolean;
  pending: PendingAction;
  editing: boolean;
  showHandled: boolean;
  /** A draft exists to send (the server's, or one just saved). */
  hasDraft: boolean;
  /** The text that would send right now: an open edit, a just-saved edit,
   *  or the draft. */
  currentText: () => string;
  approve: () => void;
  startEdit: () => void;
  toggleHandled: () => void;
  redraft: () => void;
  markHandled: (capture?: HandledCapture) => void;
  setError: (message: string | null) => void;
  /** The standard pieces, to compose a footer that differs (a 2027 request,
   *  a copy-to-send card). */
  parts: {
    send: ReactNode;
    edit: ReactNode;
    coach: ReactNode;
    redraft: ReactNode;
    handled: ReactNode;
  };
};

export type ApprovalCardProps = {
  id: string;
  status: string;
  sendAt?: string;
  name: string;
  /** For the phone review row. */
  property?: string;
  channel?: string;
  /** What they wrote, as one line for the phone review row. */
  preview?: string | null;
  /** The phone review row's call to action, when there is no reply to
   *  review (a vendor visit proposes a hold). Defaults to "Review reply". */
  reviewLabel?: string;
  /** Header chips after the name: channel, stay dates, topic, audience. */
  chips?: ReactNode;
  /** Chips on the collapsed queued row. */
  queuedChips?: ReactNode;
  /** Left rule for a proactive card. */
  accent?: string;
  ageMinutes: number | null | undefined;
  createdAt?: string | null;
  shortId?: string;
  wait?: WaitReason | null;
  /** columns: said | reply side by side. stacked: said, between, reply. */
  layout?: 'columns' | 'stacked';
  said: { label: string; sub?: string; subTitle?: string; body: ReactNode };
  /** Stacked layout only: the owner Envelope, read before the reply. */
  between?: ReactNode;
  /** null: nothing to reply to (an owner's reaction). */
  reply: {
    label?: string;
    text: string;
    /** The English under the draft, when the reply is in another language. */
    english?: ReactNode;
    /** The English shown under an open editor. */
    englishWhileEditing?: ReactNode;
    /** Stands in for the draft while there is none (an inquiry the AI could
     *  not price), under `emptyLabel`. A saved reply replaces it at once. */
    override?: ReactNode;
    emptyLabel?: string;
    /** Under the draft text. */
    after?: ReactNode;
  } | null;
  /** Under the columns: View conversation. */
  afterColumns?: ReactNode;
  also?: AlsoItem[];
  verbs: CardVerbs;
  /** Mark handled's reasons, one tap each. */
  handledReasons: readonly string[];
  pastePlaceholder?: string;
  approveLabel?: string;
  approveSummary?: string;
  approvePendingLabel?: string;
  /** Why Approve is disabled (a slip with no property). */
  approveBlocked?: string;
  draftTiming?: { createdAt: string | null; translation?: string };
  /** Why Send later is disabled. */
  scheduleBlocked?: string;
  /** One line under the coaching contract (the cleaner card: write in English). */
  coachHint?: string;
  /** Something outside the card's own verbs is in flight. */
  externalBusy?: boolean;
  /** A redraft that settles in place rather than replacing the card (an
   *  inquiry the AI still could not price). When `key` changes mid-redraft,
   *  the redraft ends with `error`. */
  redraftOutcome?: { key: string; error: string | null } | null;
  /** Replaces the footer's contents; returning null keeps the standard one
   *  (send, Edit, Coach, then the quiet exits). */
  footer?: (ctl: CardController) => ReactNode;
  /** Before Send now / Cancel send on a queued card (a 2027 request keeps
   *  its Send a price there). */
  queuedLead?: ReactNode;
  outcomes?: Outcomes;
  onResolved: (warning?: string, receipt?: ApprovalReceipt) => void;
  onDecided: (decision: Decision) => void;
  onRegenerating: (id: string) => void;
  regenStalled: boolean;
};

export function ApprovalCard(props: ApprovalCardProps) {
  const {
    id, status, sendAt, name, property, channel, preview, reviewLabel, chips, queuedChips, accent, ageMinutes, createdAt, shortId,
    wait, layout = 'columns', said, between, reply, afterColumns, also, verbs, handledReasons,
    pastePlaceholder = 'Paste the reply you sent, by text or by email', approveLabel, approveSummary, approvePendingLabel, approveBlocked: otherBlocked, draftTiming,
    scheduleBlocked: otherScheduleBlocked, coachHint, externalBusy, redraftOutcome, footer, queuedLead, outcomes, onResolved, onDecided,
    onRegenerating, regenStalled,
  } = props;
  const draft = reply?.text ?? '';
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ApprovalReceipt | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  // Coach and Redraft outlive their request: the service answers 202 and
  // rewrites in the background. Keep the card locked until the replacement
  // lands (or the watch gives up) so nobody approves a draft about to be
  // superseded under them.
  const busy = isPending || pending === 'coach' || pending === 'redraft' || !!externalBusy;
  const [showCoach, setShowCoach] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [showHandled, setShowHandled] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [sentText, setSentText] = useState('');
  const [markingReason, setMarkingReason] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(draft);
  // After a save, show the saved text at once instead of waiting for the
  // queue feed to bring the canonical row down. Cleared when it catches up.
  const [savedDraft, setSavedDraft] = useState<string | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  // The text the open editor was seeded from, to tell an edit from the
  // draft changing underneath it.
  const [editBase, setEditBase] = useState(draft);
  const isScheduled = status === 'scheduled';
  const shownDraft = savedDraft ?? draft;
  const [clock, setClock] = useState(() => new Date());
  const timingEnabled = !!draftTiming;
  useEffect(() => {
    if (!timingEnabled) return;
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [timingEnabled]);
  const timing = draftTiming ? draftValidity({
    createdAt: draftTiming.createdAt,
    text: shownDraft + (shownDraft === draft && draftTiming.translation ? `\n${draftTiming.translation}` : ''),
  }, clock) : {};
  const approveBlocked = otherBlocked || timing.blocked;
  const scheduleBlocked = otherScheduleBlocked || timing.blocked;
  const editDirty = editing && draftText.trim() !== '' && draftText !== editBase;
  // The draft changed under an open editor (a coach landed, another operator
  // edited) and the operator has not typed the same: warn, never overwrite.
  const draftChangedUnderEdit =
    editing && savedDraft == null && draft !== editBase && draft !== draftText;

  const closeDrawers = () => {
    setShowCoach(false);
    setShowSchedule(false);
    setEditing(false);
    setShowHandled(false);
    setShowPaste(false);
  };

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

  // These three follow a prop change, so they adjust state during render
  // (React's "storing information from previous renders") rather than in an
  // effect that renders twice.
  //
  // The card is keyed by id, so a regenerated draft reconciles in place. A
  // closed editor's buffer follows it; an open one is left alone and the
  // conflict banner says so.
  const [seenDraft, setSeenDraft] = useState(draft);
  if (draft !== seenDraft) {
    setSeenDraft(draft);
    if (!isPending && !editing) {
      setDraftText(draft);
      setSavedDraft(null);
      setShowCoach(false);
      setFeedback('');
    }
  }

  // The watch gave up: the rewrite failed upstream and left this card pending.
  const [seenStalled, setSeenStalled] = useState(regenStalled);
  if (regenStalled !== seenStalled) {
    setSeenStalled(regenStalled);
    if (regenStalled && (pending === 'coach' || pending === 'redraft')) {
      setPending(null);
      if (pending === 'coach') setShowCoach(true);
      setError(
        pending === 'redraft'
          ? 'The draft has not come back. Redraft again or write the reply yourself.'
          : "The rewrite hasn't come back. Send the note again.",
      );
    }
  }

  // A redraft that settles in place (an inquiry still without a price): the
  // outcome's key moving while a redraft is out ends it.
  const outcomeKey = redraftOutcome?.key ?? null;
  const [seenOutcomeKey, setSeenOutcomeKey] = useState(outcomeKey);
  if (outcomeKey !== seenOutcomeKey) {
    setSeenOutcomeKey(outcomeKey);
    if (pending === 'redraft' && redraftOutcome) {
      setPending(null);
      setError(redraftOutcome.error);
    }
  }

  /** One runner for every action: a stale card refreshes, an error stays on
   *  the card with the buttons re-enabled, success leaves the working label
   *  up until the queue drops the card. */
  const run = (
    action: PendingAction,
    fn: () => Promise<CardResult>,
    on?: { ok?: (res: CardResult & { ok: true }) => boolean | void; err?: () => void; stale?: () => void },
  ) => {
    setError(null);
    setReceipt(null);
    setPending(action);
    startTransition(async () => {
      let res: CardResult;
      try {
        res = await fn();
      } catch {
        res = { ok: false, error: 'That did not go through. Try again.' };
      }
      if (!res.ok) {
        if (res.stale) {
          if (on?.stale) on.stale();
          else onResolved();
          return;
        }
        setError(res.error);
        if (res.receipt) setReceipt(res.receipt);
        setPending(null);
        on?.err?.();
        return;
      }
      // A handler that keeps the card (a saved edit) returns true.
      if (on?.ok?.(res)) return;
      onResolved(res.warning, res.receipt ? { ...res.receipt, title: name } : undefined);
    });
  };

  /** Store an edit. Used by Save, and by Approve / Send later on an open,
   *  changed editor, so what the operator typed is what sends. */
  const persistEdit = async (text: string): Promise<CardResult> => {
    if (!verbs.saveEdit) return { ok: false, error: 'This reply cannot be edited here.' };
    const res = await verbs.saveEdit(text);
    if (res.ok) {
      setSavedDraft(text);
      setEditBase(text);
      setEditing(false);
    } else if (res.stale) {
      // Queued or changed elsewhere: keep the typed text and say so rather
      // than discarding it through a refresh.
      setEditing(true);
      return {
        ok: false,
        error: 'This draft was just queued or changed elsewhere. Copy your text, then cancel the send to keep editing.',
      };
    }
    return res;
  };

  const approve = () => {
    if (!verbs.approve || approveBlocked) return;
    const send = verbs.approve;
    if (editDirty) {
      const text = draftText;
      run('approve', async () => {
        const saved = await persistEdit(text);
        return saved.ok ? send() : saved;
      });
      return;
    }
    run('approve', send);
  };

  const schedule = (sendAtIso: string) => {
    if (!verbs.schedule) return;
    const queue = verbs.schedule;
    setShowSchedule(false);
    if (editDirty) {
      const text = draftText;
      run('schedule', async () => {
        const saved = await persistEdit(text);
        return saved.ok ? queue(sendAtIso) : saved;
      });
      return;
    }
    run('schedule', () => queue(sendAtIso));
  };

  const saveEdit = () => {
    const text = draftText;
    // Resolves on the write itself: the card stays, the queue feed reconciles.
    run('save-edit', () => persistEdit(text), {
      ok: () => {
        setPending(null);
        return true;
      },
      stale: () => setPending(null),
    });
  };

  const startEdit = () => {
    closeDrawers();
    const base = savedDraft ?? draft;
    setDraftText(base);
    setEditBase(base);
    setEditing(true);
  };

  const toggleCoach = () => {
    if (showCoach) {
      setShowCoach(false);
      return;
    }
    closeDrawers();
    setShowCoach(true);
  };

  const toggleSchedule = () => {
    if (showSchedule) {
      setShowSchedule(false);
      return;
    }
    setShowCoach(false);
    setShowHandled(false);
    setShowSchedule(true);
  };

  const toggleHandled = () => {
    const next = !showHandled;
    closeDrawers();
    setShowHandled(next);
  };

  const coach = () => {
    if (!verbs.coach) return;
    const send = verbs.coach;
    const note = feedback;
    // Collapse the drawer so the working line reads for the whole rewrite;
    // the note stays in the box until the card is actually replaced.
    setShowCoach(false);
    run('coach', () => send(note), {
      ok: () => {
        onRegenerating(id);
        return true;
      },
      err: () => setShowCoach(true),
    });
  };

  const redraft = () => {
    if (!verbs.redraft) return;
    const send = verbs.redraft;
    closeDrawers();
    onRegenerating(id);
    // The replacement drops this card; a redraft that settles in place ends
    // through redraftOutcome. Either way the label holds until then.
    run('redraft', send);
  };

  const markHandled = (capture?: HandledCapture) => {
    setMarkingReason(capture?.sent_text ? 'paste' : capture?.reason ?? null);
    run('mark-handled', () => verbs.markHandled(capture), {
      ok: () => {
        setShowHandled(false);
        onDecided({ id, name, property });
      },
      err: () => setMarkingReason(null),
    });
  };

  const sendNow = () => !approveBlocked && verbs.sendNow && run('send-now', verbs.sendNow);
  const cancelSchedule = () => verbs.cancelSchedule && run('cancel-schedule', verbs.cancelSchedule);

  const ageLabel =
    ageMinutes == null || ageMinutes < 1
      ? 'just now'
      : ageMinutes < 60
        ? `${ageMinutes} min ago`
        : `${Math.floor(ageMinutes / 60)}h ${ageMinutes % 60}m ago`;
  const ageTone = ageToneColor(ageMinutes);

  const queuedActions = (
    <>
      {timing.blocked && <p role="status" style={{ color: 'var(--signal)', fontSize: 13 }}>{timing.blocked} Cancel the scheduled send to review it.</p>}
      {verbs.sendNow && (
        <SecondaryButton
          onClick={sendNow}
          disabled={busy || !!approveBlocked}
          loading={pending === 'send-now'}
          loadingLabel={approvePendingLabel || "Sending"}
          title="Send this reply right now instead of waiting."
        >
          Send now
        </SecondaryButton>
      )}
      {verbs.cancelSchedule && (
        <SecondaryButton
          onClick={cancelSchedule}
          disabled={busy}
          loading={pending === 'cancel-schedule'}
          loadingLabel="Cancelling"
          title="Stop the scheduled send and return this draft to the queue."
        >
          Cancel send
        </SecondaryButton>
      )}
    </>
  );

  // Collapsed queued card: one dense row, so waiting sends stay quiet.
  if (isScheduled && !expanded) {
    return (
      <article
        id={`approval-${id}`}
        ref={cardRef}
        className="rt-message-card"
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
        <span className="font-serif" style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.01em' }}>
          {name}
        </span>
        {queuedChips}
        <span className="eyebrow" style={{ color: 'var(--ink-3)' }} title={sendAt}>
          {sendsInLabel(sendAt || '')}
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
          title={draft}
        >
          {draft}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
          <Button variant="quiet" onClick={() => setExpanded(true)} aria-expanded={false}>
            Show ▾
          </Button>
          {queuedActions}
        </div>
        {wait && <div style={{ width: '100%' }}><WaitLine wait={wait} /></div>}
        {error && (
          <p style={{ width: '100%', margin: '4px 0 0', fontSize: 12, color: 'var(--signal)', fontWeight: 500 }} role="alert">
            {error}
          </p>
        )}
        <MessageOutcomes value={outcomes} />
      </article>
    );
  }

  const saidBlock = (
    <FieldBlock label={said.label} sub={said.sub} subTitle={said.subTitle}>
      {said.body}
    </FieldBlock>
  );

  const replyBlock = reply && (
    <FieldBlock
      label={editing ? 'Editing reply' : reply.override && !shownDraft.trim() ? reply.emptyLabel || 'No draft yet' : reply.label || 'Proposed reply'}
      labelTone={editing ? 'var(--ink)' : undefined}
    >
      {editing ? (
        <div>
          <EditCoachContract />
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            autoFocus
            onFocus={(e) => e.currentTarget.setSelectionRange(draftText.length, draftText.length)}
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter: done editing, send it.
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && verbs.approve && !busy && !approveBlocked) {
                e.preventDefault();
                approve();
              }
            }}
            aria-label="Reply"
            rows={Math.max(4, Math.min(14, draftText.split('\n').length + 2))}
            style={{
              width: '100%',
              padding: 10,
              // 2px ink border = armed: this surface is what sends.
              border: '2px solid var(--ink)',
              background: 'var(--paper)',
              fontFamily: 'inherit',
              fontSize: 14,
              lineHeight: 1.55,
              color: 'var(--ink)',
              resize: 'vertical',
            }}
          />
          {reply.englishWhileEditing}
          {draftChangedUnderEdit && (
            <div style={{ marginTop: 10, padding: '8px 10px', border: '1px solid var(--signal)', background: 'var(--paper)' }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--signal)', fontWeight: 600 }}>
                The AI regenerated this draft while you were editing. Saving will keep your version.
              </p>
              <Button
                variant="quiet"
                onClick={() => {
                  setDraftText(draft);
                  setEditBase(draft);
                }}
                style={{ marginTop: 4 }}
              >
                Load the new draft instead (discards your changes)
              </Button>
            </div>
          )}
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <PrimaryButton
              onClick={saveEdit}
              disabled={busy || !draftText.trim()}
              loading={pending === 'save-edit'}
              loadingLabel="Saving"
            >
              Save
            </PrimaryButton>
            <SecondaryButton onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </SecondaryButton>
          </div>
        </div>
      ) : reply.override && !shownDraft.trim() ? (
        reply.override
      ) : (
        <>
          <BodyText emphasis>{shownDraft || '(no draft)'}</BodyText>
          {/* The English is for the text that sends: only once a saved edit
              is the server's draft again. */}
          {savedDraft == null && reply.english}
          {reply.after}
        </>
      )}
    </FieldBlock>
  );

  const sendPart = verbs.approve ? (
    <SplitSendButton
      label={editDirty ? 'Save & send' : approveLabel || 'Approve & send'}
      onApprove={approve}
      onToggle={toggleSchedule}
      disabled={busy || !!approveBlocked || (!shownDraft.trim() && !editDirty)}
      toggleDisabled={!verbs.schedule || !!scheduleBlocked}
      toggleTitle={scheduleBlocked}
      title={approveBlocked}
      loading={pending === 'approve'}
      loadingLabel={approvePendingLabel || 'Sending'}
      open={showSchedule}
    />
  ) : null;

  const editPart = verbs.saveEdit ? (
    <SecondaryButton
      onClick={editing ? () => setEditing(false) : startEdit}
      disabled={busy}
      title="Change the words of this reply yourself. The AI does not learn from it."
    >
      {editing ? 'Cancel edit' : 'Edit'}
    </SecondaryButton>
  ) : null;

  const coachPart = verbs.coach ? (
    <SecondaryButton onClick={toggleCoach} disabled={busy} loading={pending === 'coach'} loadingLabel="Regenerating">
      {showCoach ? 'Cancel coaching' : 'Coach the AI'}
    </SecondaryButton>
  ) : null;

  const redraftPart = verbs.redraft ? (
    <QuietButton
      onClick={redraft}
      disabled={busy}
      loading={pending === 'redraft'}
      loadingLabel="Redrafting"
      title="Re-run this draft against today's data. Use when the draft is stale rather than wrong. Nothing is sent."
    >
      {draftTiming ? 'Refresh draft' : 'Redraft'}
    </QuietButton>
  ) : null;

  const handledPart = (
    <QuietButton
      onClick={toggleHandled}
      disabled={busy}
      loading={pending === 'mark-handled'}
      loadingLabel="Marking"
      title="You replied elsewhere, or no reply is needed. Clears the card without sending. Undo for 12 hours."
    >
      {showHandled ? 'Cancel' : 'Mark handled'}
    </QuietButton>
  );

  const ctl: CardController = {
    busy,
    pending,
    editing,
    showHandled,
    hasDraft: !!shownDraft.trim(),
    currentText: () => (editing ? draftText : shownDraft),
    approve,
    startEdit,
    toggleHandled,
    redraft,
    markHandled,
    setError,
    parts: { send: sendPart, edit: editPart, coach: coachPart, redraft: redraftPart, handled: handledPart },
  };

  const customFooter = footer ? footer(ctl) : null;

  return (
    <MobileInboxReview
      id={id}
      name={name}
      property={property || ''}
      preview={preview}
      reviewLabel={reviewLabel}
      channel={channel || ''}
      enabled={!isScheduled}
      keepOpen={busy || !!error || regenStalled}
      draftInProgress={editing || showCoach || showSchedule || showHandled}
    >
      <article
        id={`approval-${id}`}
        ref={cardRef}
        className="rt-message-card"
        style={{
          border: '1px solid var(--rule)',
          borderLeft: isScheduled
            ? `3px solid ${QUEUED_TONE}`
            : wait && wait.tone === 'failed'
              ? '3px solid var(--signal)'
              : accent
                ? `3px solid ${accent}`
                : '1px solid var(--rule)',
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
            marginBottom: wait ? 8 : 14,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span className="font-serif" style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em' }}>
              {name}
            </span>
            {chips}
            {isScheduled && (
              <span className="eyebrow" style={{ color: 'var(--ink-3)' }} title={sendAt}>
                {sendsInLabel(sendAt || '')}
              </span>
            )}
          </div>
          {/* A queued card's countdown is its one time readout; Hide folds it. */}
          {isScheduled ? (
            <Button variant="quiet" onClick={() => setExpanded(false)} aria-expanded={true}>
              Hide ▴
            </Button>
          ) : (
            <span className="eyebrow" style={{ color: 'var(--ink-4)' }} title={`Drafted ${createdAt || ''}${shortId ? ` · id ${shortId}` : ''}`}>
              {'drafted '}
              <span suppressHydrationWarning style={{ color: ageTone, fontWeight: ageTone === 'var(--signal)' ? 700 : 500 }}>{ageLabel}</span>
            </span>
          )}
        </header>

        {wait && <div style={{ marginBottom: 14 }}><WaitLine wait={wait} /></div>}

        {layout === 'stacked' || !replyBlock ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {saidBlock}
            {between}
            {replyBlock && <div style={{ background: 'var(--paper-3)', border: '1px solid var(--rule)', padding: '18px 20px' }}>{replyBlock}</div>}
          </div>
        ) : (
          <div className="rt-msg-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            {saidBlock}
            {replyBlock}
          </div>
        )}

        {afterColumns}

        {also && also.length > 0 && <AlsoOnApprove items={also} />}

        {error && (
          <p style={{ marginTop: 14, fontSize: 13, color: 'var(--signal)', fontWeight: 500 }} role="alert">
            {error}
          </p>
        )}

        {receipt && <ActionReceipt receipt={receipt} />}

        {pending === 'coach' && (
          <p style={{ marginTop: 14, fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic' }} role="status" aria-live="polite">
            Coaching the AI with your note. The rewritten draft replaces this one in a few seconds.
          </p>
        )}

        {approveSummary && !isScheduled && <p style={{ marginTop: 16, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>{approveSummary}</p>}
        <footer
          className="rt-message-actions"
          style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}
        >
          {isScheduled ? (
            <>
              {queuedLead}
              {queuedActions}
              <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
                Cancel send to edit or coach
              </span>
            </>
          ) : customFooter != null ? (
            customFooter
          ) : (
            <>
              {sendPart}
              {/* Edit and Coach at one weight: both change the reply, and only
                  the drawer each opens says how they differ. */}
              {editPart}
              {coachPart}
              {/* Closing a card WITHOUT sending is text, apart from the send
                  controls. Mark handled is the one door for no reply. */}
              <div className="rt-message-quiet">
                {redraftPart}
                {handledPart}
              </div>
            </>
          )}
        </footer>

        {timing.context && <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>{timing.context}</p>}
        {approveBlocked && !isScheduled && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--signal)' }}>{approveBlocked}</p>
        )}

        {showSchedule && !isScheduled && verbs.schedule && <SchedulePopover onSchedule={schedule} disabled={busy} />}

        {pending === 'schedule' && (
          <p style={{ marginTop: 12, fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic' }} role="status" aria-live="polite">
            Queueing this reply to send later…
          </p>
        )}

        {showHandled && (
          <div className="rt-handled-panel" role="group" aria-label="Mark handled">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="eyebrow" style={{ color: 'var(--ink-3)', marginRight: 4 }}>Why?</span>
              {handledReasons.map((reason) => (
                <SecondaryButton
                  key={reason}
                  onClick={() => markHandled({ reason })}
                  disabled={busy}
                  loading={pending === 'mark-handled' && markingReason === reason}
                  loadingLabel="Marking"
                >
                  {reason}
                </SecondaryButton>
              ))}
              <Button
                variant="quiet"
                onClick={() => setShowPaste((v) => !v)}
                aria-expanded={showPaste}
                disabled={busy}
                style={{ marginLeft: 'auto' }}
                title="The AI learns your wording from what you actually sent."
              >
                {showPaste ? 'Hide' : 'Paste what you sent'}
              </Button>
            </div>
            {showPaste && (
              <div style={{ marginTop: 10 }}>
                <label htmlFor={`sent-${id}`} className="sr-only">What you sent</label>
                <textarea
                  id={`sent-${id}`}
                  value={sentText}
                  onChange={(e) => setSentText(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder={pastePlaceholder}
                  style={{
                    width: '100%',
                    padding: 10,
                    border: '1px solid var(--rule)',
                    background: 'var(--paper-2)',
                    fontFamily: 'inherit',
                    fontSize: 14,
                    lineHeight: 1.55,
                    color: 'var(--ink)',
                    resize: 'vertical',
                  }}
                />
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                  {/* Already answered is the reason; the text is what the AI
                      learns from. The service keeps 25 characters or more and
                      still marks a shorter one handled. */}
                  <PrimaryButton
                    onClick={() => markHandled({ sent_text: sentText, reason: 'Already answered' })}
                    disabled={busy || !sentText.trim()}
                    loading={pending === 'mark-handled' && markingReason === 'paste'}
                    loadingLabel="Marking"
                  >
                    Save and mark handled
                  </PrimaryButton>
                  {sentText.trim().length > 0 && sentText.trim().length < 25 && (
                    <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>Too short to learn from; it still marks the card handled.</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {showCoach && (
          <div style={{ marginTop: 14 }}>
            <label htmlFor={`coach-${id}`} className="eyebrow" style={{ display: 'block', marginBottom: 6, color: 'var(--ink-3)' }}>
              Coaching note
            </label>
            <EditCoachContract />
            {coachHint && <p style={{ margin: '0 0 8px', fontSize: 12, lineHeight: 1.5, color: 'var(--ink-3)' }}>{coachHint}</p>}
            <textarea
              id={`coach-${id}`}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setShowCoach(false);
              }}
              autoFocus
              placeholder="What should change?"
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
              <PrimaryButton onClick={coach} disabled={busy || !feedback.trim()} loading={pending === 'coach'} loadingLabel="Regenerating">
                Regenerate with this note
              </PrimaryButton>
              <SecondaryButton
                onClick={() => {
                  setShowCoach(false);
                  setFeedback('');
                }}
                disabled={busy}
              >
                Cancel
              </SecondaryButton>
            </div>
          </div>
        )}
        <MessageOutcomes value={outcomes} />
      </article>
    </MobileInboxReview>
  );
}

/** The two-line contract, printed once in whichever drawer is open: the only
 *  place the difference between the two verbs is stated, so it is text on
 *  the page, never a placeholder that vanishes on the first keystroke. */
export function EditCoachContract() {
  return (
    <p style={{ margin: '0 0 8px', fontSize: 12, lineHeight: 1.5, color: 'var(--ink-3)' }}>
      Edit changes this reply only.
      <br />
      Coach rewrites it and teaches the AI.
    </p>
  );
}

export function FieldBlock({
  label,
  sub,
  subTitle,
  labelTone,
  children,
}: {
  label: string;
  sub?: string;
  subTitle?: string;
  labelTone?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        className="eyebrow"
        style={{ marginBottom: 6, color: labelTone || 'var(--ink-4)', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}
      >
        <span>{label}</span>
        {sub && (
          // `sub` is often an age ("sent 3m ago") that reads the clock.
          <span suppressHydrationWarning style={{ fontSize: 10, fontWeight: 400, letterSpacing: '0.10em', color: 'var(--ink-3)', textTransform: 'none' }} title={subTitle}>
            {sub}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export function BodyText({ children, emphasis = false }: { children: ReactNode; emphasis?: boolean }) {
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

/** "sent 3h ago" for the said block, or '' when the message and the draft
 *  are within ~90 seconds (the drafted-ago readout already covers it). */
export function sentAgoLabel(receivedAt: string | null | undefined, draftedAt?: string | null): string {
  if (!receivedAt) return '';
  if (draftedAt) {
    const gap = Math.abs(new Date(draftedAt).getTime() - new Date(receivedAt).getTime());
    if (!Number.isNaN(gap) && gap < 90_000) return '';
  }
  const rel = relativeTimeShort(receivedAt);
  return rel ? `sent ${rel}` : '';
}
