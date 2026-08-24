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
 * composer uses (sendThreadMessage -> sendConversationMessage): no AI
 * rewrite, no draft step, no approval hop. What she types is what the guest
 * reads.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Section } from '@/components/Section';
import type { ConversationSummary } from '@/lib/stay-concierge';
import { sendThreadMessage } from '../thread-actions';
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
  const [stalled, setStalled] = useState(false);
  const [isPending, startTransition] = useTransition();
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

  const doSend = () => {
    if (!picked || !text.trim() || isPending || !canSend) return;
    setError(null);
    setSentTo(null);
    startTransition(async () => {
      const res = await sendThreadMessage(
        picked.conversation_id,
        text,
        picked.module,
        picked.listing_id,
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSentTo(picked.guest_full || picked.guest_first || 'the guest');
      setText('');
      // Bring the thread preview and the queue counts back in step.
      router.refresh();
    });
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
                doSend();
              }
            }}
            rows={6}
            disabled={!canSend}
            placeholder={`Write to ${picked.guest_first || 'them'}...`}
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
            <button
              type="button"
              onClick={doSend}
              disabled={!canSend || !text.trim() || isPending}
              style={{
                padding: '11px 22px',
                fontSize: 11,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                fontWeight: 600,
                color: 'var(--paper)',
                background: 'var(--ink)',
                border: 'none',
                cursor: !canSend || !text.trim() || isPending ? 'default' : 'pointer',
                opacity: !canSend || !text.trim() || isPending ? 0.5 : 1,
              }}
            >
              {isPending ? 'Sending' : 'Send now'}
            </button>
            <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
              Cmd + Enter
            </span>
            {stalled && (
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }} role="status">
                Still working. If this hangs, reload before resending so the guest doesn&apos;t get it twice.
              </span>
            )}
          </div>

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
        </div>
      )}
    </Section>
  );
}
