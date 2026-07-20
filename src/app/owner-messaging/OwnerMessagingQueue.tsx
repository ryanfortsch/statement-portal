'use client';

import { memo, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Section } from '@/components/Section';
import type { OwnerApproval } from '@/lib/stay-concierge';
import {
  approveOwnerDraft,
  rejectOwnerDraft,
  markOwnerHandled,
  coachOwnerDraft,
} from './actions';
import { prettifySlug, prettifyTopic, ageToneColor, relativeTimeShort } from '@/app/messaging/format';
import { splitOwnerText, parseTapback } from './conversation';

type Props = { initialPending: OwnerApproval[] };

const REFRESH_MS = 15_000;

export function OwnerMessagingQueue({ initialPending }: Props) {
  const router = useRouter();
  // Refresh inside a transition. A bare router.refresh() re-suspends the
  // queue's Suspense boundary, which swaps in the skeleton and UNMOUNTS
  // everything below it -- including the proactive-message form, erasing
  // whatever the operator was mid-typing (the exact bug the guest queue
  // shipped and fixed). A transition keeps the current UI mounted while the
  // new payload streams, so client state survives.
  const [, startTransition] = useTransition();
  const softRefresh = useCallback(
    () => startTransition(() => router.refresh()),
    [router],
  );

  useEffect(() => {
    const t = setInterval(softRefresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [softRefresh]);

  return (
    <Section
      title={initialPending.length === 0 ? 'Inbox zero' : `Pending (${initialPending.length})`}
      eyebrow={`refreshes every ${REFRESH_MS / 1000}s`}
      right={<RefreshChip onClick={softRefresh} />}
      empty={initialPending.length === 0}
      emptyMessage="No owner drafts waiting. New owner messages will show up here automatically when the AI drafts a reply."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {initialPending.map((approval) => (
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

function RefreshChip({ onClick }: { onClick: () => void }) {
  // Track elapsed seconds since mount, rather than a Date snapshot. Keeps
  // render pure. setInterval ticks every second; the ref is set during the
  // effect (never read during render) so the chip resets when the parent
  // remounts after a router.refresh.
  const mountedAt = useRef<number>(0);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    mountedAt.current = Date.now();
    const t = setInterval(() => {
      setSeconds(Math.max(0, Math.round((Date.now() - mountedAt.current) / 1000)));
    }, 1_000);
    return () => clearInterval(t);
  }, []);

  const label = seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)} min ago`;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 10,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        fontWeight: 500,
        color: 'var(--ink-3)',
        background: 'transparent',
        border: '1px solid var(--rule)',
        padding: '6px 10px',
        cursor: 'pointer',
      }}
    >
      Refresh · {label}
    </button>
  );
}

type PendingAction = 'approve' | 'reject' | 'mark-handled' | 'coach' | null;

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

  return (
    <article
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{
        border: '1px solid var(--rule)',
        borderLeft: isStale ? '3px solid var(--signal)' : '1px solid var(--rule)',
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
        </div>
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

          {/* PROPOSED REPLY - the hero, editable in place */}
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

          {error && (
            <p style={{ fontSize: 13, color: 'var(--signal)', fontWeight: 500 }} role="alert">
              {error}
            </p>
          )}

          <footer style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <PrimaryButton onClick={doApprove} disabled={!canApprove}>
              {pendingAction === 'approve'
                ? 'Sending…'
                : edited
                  ? 'Approve edited & send'
                  : 'Approve & send'}
            </PrimaryButton>
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
          </footer>

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
