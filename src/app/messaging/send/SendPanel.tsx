'use client';

/**
 * The Send lens: pick a stay, write, send. Free text only in this phase -
 * the mirrored Guesty templates land on top of this same surface next.
 *
 * Replaces a 13-step errand (expand the Proactive block, choose a kind,
 * find the guest in a dropdown that fetched separately, fill a cadence, a
 * time, a start date, an end date...) with: pick the guest, type, send.
 *
 * The message goes out EXACTLY as typed through the same rail the Inbox
 * composer uses (sendThreadMessage -> sendConversationMessage): no draft
 * step, no approval hop. What is in the box when Send is pressed is what
 * the guest reads.
 *
 * Polish (Dotti, 2026-08-25) is an OPT-IN step before that, never a
 * rewrite-on-send: shorthand goes up to the same engine that drafts guest
 * replies (voice references + this property's KB, via polishProactive),
 * and the polished text lands back IN the box for her to read, edit, or
 * undo. Send stays verbatim, so "messages send as typed" is still true.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Section } from '@/components/Section';
import { SplitSendButton, SchedulePopover } from '@/components/ScheduleSend';
import type { ConversationSummary } from '@/lib/stay-concierge';
import { sendThreadMessage } from '../thread-actions';
import { polishProactiveAction } from '../reminders-actions';
import { formatStayDates, channelTone, prettifySlug } from '../format';
import { StayPicker } from './StayPicker';

// Matches the documented deploy-skew signature: the DB write lands but the
// button keeps spinning. After this long, say so instead of spinning forever.
const STALL_MS = 10_000;

export function SendPanel({
  initialConversations,
  initialError,
  today,
}: {
  initialConversations: ConversationSummary[];
  initialError: string | null;
  today: string;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<ConversationSummary | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [queuedFor, setQueuedFor] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Polish state: `prePolish` holds the shorthand so Undo can put it back,
  // and doubles as the "this text was polished" flag.
  const [polishing, setPolishing] = useState(false);
  const [prePolish, setPrePolish] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  // Focus the composer the moment a stay is picked: the next thing she wants
  // to do is always type.
  useEffect(() => {
    if (picked) composerRef.current?.focus();
  }, [picked]);

  useEffect(() => {
    if (!isPending) {
      setStalled(false);
      return;
    }
    const t = setTimeout(() => setStalled(true), STALL_MS);
    return () => clearTimeout(t);
  }, [isPending]);

  // Direct-booked guests have no Guesty module our API can post to. Say so on
  // the row rather than failing at send time.
  const canSend = !!picked?.module;

  const doSend = (sendAtIso?: string) => {
    if (!picked || !text.trim() || isPending || polishing || !canSend) return;
    setError(null);
    setSentTo(null);
    setQueuedFor(null);
    setScheduleOpen(false);
    startTransition(async () => {
      const res = await sendThreadMessage(
        picked.conversation_id,
        text,
        picked.module,
        picked.listing_id,
        sendAtIso
          ? {
              sendAtUtc: sendAtIso,
              guestFirst: picked.guest_first || '',
              reservationId: picked.reservation_id || '',
              checkIn: picked.check_in || '',
              checkOut: picked.check_out || '',
            }
          : undefined,
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.scheduled) {
        const at = res.sendAt || sendAtIso || '';
        setQueuedFor(
          at
            ? new Date(at).toLocaleString([], {
                weekday: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })
            : 'later',
        );
      } else {
        setSentTo(picked.guest_full || picked.guest_first || 'the guest');
      }
      setText('');
      setPrePolish(null);
      // Bring the thread preview and the queue counts back in step.
      router.refresh();
    });
  };

  // Shorthand -> our voice, grounded in this stay's KB. Deliberately NOT
  // wired into doSend: she reads (and can edit or undo) the result before
  // anything reaches the guest.
  const doPolish = async () => {
    const rough = text.trim();
    if (!picked || !rough || polishing || isPending) return;
    setError(null);
    setSentTo(null);
    setPolishing(true);
    try {
      const res = await polishProactiveAction(picked.reservation_id || '', rough);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const polished = (res.polished || '').trim();
      if (!polished || polished === rough) {
        setError('The polish came back empty. Sending as written is fine.');
        return;
      }
      setPrePolish(rough);
      setText(polished);
      composerRef.current?.focus();
    } catch {
      setError('Could not reach the polish service. Sending as written is fine.');
    } finally {
      setPolishing(false);
    }
  };

  const undoPolish = () => {
    if (prePolish === null) return;
    setText(prePolish);
    setPrePolish(null);
    composerRef.current?.focus();
  };

  const propertyLabel = picked
    ? picked.property_name || prettifySlug(picked.listing_id) || 'unknown property'
    : '';
  const stayLabel = picked ? formatStayDates(picked.check_in, picked.check_out) : '';

  return (
    <Section
      title="Send a message"
      eyebrow="pick a stay, write, send"
      right={
        picked ? (
          <button
            type="button"
            onClick={() => {
              setPicked(null);
              setText('');
              setError(null);
              setSentTo(null);
              setQueuedFor(null);
              setScheduleOpen(false);
              setPrePolish(null);
            }}
            className="eyebrow"
            style={{
              color: 'var(--ink-4)',
              background: 'transparent',
              border: '1px solid var(--rule)',
              padding: '6px 10px',
              cursor: 'pointer',
            }}
          >
            Change stay
          </button>
        ) : undefined
      }
    >
      {initialError && initialConversations.length === 0 ? (
        <div style={{ borderTop: '1px solid var(--ink)', padding: '16px 0', fontSize: 13, color: 'var(--ink-3)' }}>
          {initialError}
        </div>
      ) : !picked ? (
        <StayPicker
          conversations={initialConversations}
          today={today}
          selectedId={null}
          onPick={(c) => {
            setPicked(c);
            setSentTo(null);
            setQueuedFor(null);
            setScheduleOpen(false);
            setError(null);
          }}
        />
      ) : (
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              flexWrap: 'wrap',
              borderTop: '1px solid var(--ink)',
              padding: '14px 0 12px',
            }}
          >
            <span className="font-serif" style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.01em' }}>
              {picked.guest_full || picked.guest_first || 'Guest'}
            </span>
            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{propertyLabel}</span>
            {picked.channel && (
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  color: 'var(--paper)',
                  background: channelTone(picked.channel),
                  padding: '2px 7px',
                  borderRadius: 2,
                }}
              >
                {picked.channel}
              </span>
            )}
            {stayLabel && (
              <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
                {stayLabel}
              </span>
            )}
          </div>

          {!canSend && (
            <p
              style={{ fontSize: 12, color: 'var(--signal)', fontWeight: 500, margin: '0 0 10px' }}
              role="alert"
            >
              Direct-booked guest: Guesty cannot deliver a message on this thread. Reach them by
              text or email instead.
            </p>
          )}

          <textarea
            ref={composerRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                // Shift = polish the shorthand; plain = send what's here.
                if (e.shiftKey) doPolish();
                else doSend();
              }
            }}
            rows={6}
            disabled={!canSend || polishing}
            placeholder={`Write to ${picked.guest_first || 'them'}... shorthand is fine, Polish cleans it up`}
            aria-label="Message"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: 12,
              fontSize: 14,
              lineHeight: 1.6,
              fontFamily: 'inherit',
              color: 'var(--ink)',
              background: canSend ? 'var(--paper)' : 'var(--paper-2)',
              border: '1px solid var(--rule)',
              resize: 'vertical',
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingTop: 10 }}>
            <SplitSendButton
              label="Send now"
              loadingLabel="Sending"
              onApprove={() => doSend()}
              onToggle={() => setScheduleOpen((o) => !o)}
              disabled={!canSend || !text.trim() || isPending || polishing}
              loading={isPending}
              open={scheduleOpen}
            />
            <button
              type="button"
              onClick={doPolish}
              disabled={!canSend || !text.trim() || isPending || polishing}
              title="Rewrite your shorthand in our voice, using this property's knowledge base. You still read and send it."
              style={{
                padding: '11px 18px',
                fontSize: 11,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                fontWeight: 600,
                color: 'var(--ink)',
                background: 'transparent',
                border: '1px solid var(--ink)',
                cursor:
                  !canSend || !text.trim() || isPending || polishing ? 'default' : 'pointer',
                opacity: !canSend || !text.trim() || isPending || polishing ? 0.5 : 1,
              }}
            >
              {polishing ? 'Polishing' : 'Polish'}
            </button>
            <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
              Cmd + Enter to send · Cmd + Shift + Enter to polish
            </span>
            {prePolish !== null && !polishing && (
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }} role="status">
                Polished.{' '}
                <button
                  type="button"
                  onClick={undoPolish}
                  style={{
                    fontSize: 12,
                    color: 'var(--ink)',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Undo
                </button>{' '}
                to get your version back. Edit anything before sending.
              </span>
            )}
            {stalled && (
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }} role="status">
                Still working. If this hangs, reload before resending so the guest doesn&apos;t get it twice.
              </span>
            )}
          </div>

          {scheduleOpen && (
            <SchedulePopover
              onSchedule={(iso) => doSend(iso)}
              disabled={!canSend || !text.trim() || isPending || polishing}
            />
          )}

          {error && (
            <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--signal)', fontWeight: 500 }} role="alert">
              {error}
            </p>
          )}
          {sentTo && !error && (
            <p style={{ margin: '10px 0 0', fontSize: 12, color: '#5b7b4e', fontWeight: 500 }} role="status">
              Sent to {sentTo}.
            </p>
          )}
          {queuedFor && !error && (
            <p style={{ margin: '10px 0 0', fontSize: 12, color: '#7a6a3a', fontWeight: 500 }} role="status">
              Queued, sends {queuedFor}. It sits in the Inbox queue with Send now / Cancel until
              then, and comes back for review if the guest writes first.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
