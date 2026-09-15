'use client';

/**
 * The buttons on a payment-link row: Nudge by text, Check now, Copy link,
 * Cancel link. A client component calling the server actions directly, with
 * the outcome printed next to the buttons ("Texted (407) 724-2020",
 * "Cancelled", "Still unpaid", or the error).
 *
 * These started life as <form action={boundServerAction}> rows inside the
 * server-rendered ledger. In production those forms rendered with React's
 * client-function placeholder action and no server-action fields, so a
 * click did nothing and said nothing (2026-09-14, trying to cancel Jimmy
 * Alburquerque's duplicate pet-fee links). Calling the actions from a
 * client component is the pattern the rest of Helm uses (FeedClearButton,
 * MarkHandledButton, SendPanel) and it also lets the row talk back.
 *
 * Cancel is two taps: the first turns the button into "Sure? Cancel it" for
 * a few seconds, the second turns the link off in Stripe. A cancelled link
 * cannot be turned back on; a new one can always be made.
 */

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { prettyPhone } from '@/lib/payment-links-text';
import {
  cancelPaymentLinkAction,
  checkPaymentLinkAction,
  markLinkCopiedAction,
  nudgePaymentLinkAction,
} from './payment-link-actions';

const CONFIRM_MS = 5000;

export function PaymentLinkActions({
  requestKey,
  url,
  closed,
  markCopied = false,
  compact = false,
}: {
  requestKey: string;
  url: string;
  /** Paid or cancelled: only Copy remains. */
  closed: boolean;
  /** Record a copy as the link's delivery (Helm-minted links not yet sent). */
  markCopied?: boolean;
  /** Feed rows: Nudge and Cancel only. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<'nudge' | 'check' | 'cancel' | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirming]);

  const run = (kind: 'nudge' | 'check' | 'cancel') => {
    if (isPending) return;
    setBusy(kind);
    setNote(null);
    startTransition(async () => {
      try {
        if (kind === 'nudge') {
          const r = await nudgePaymentLinkAction(requestKey);
          setNote(r.ok ? { text: `Texted ${prettyPhone(r.to)}`, tone: 'ok' } : { text: r.error, tone: 'bad' });
        } else if (kind === 'check') {
          const r = await checkPaymentLinkAction(requestKey);
          setNote(
            r.ok
              ? { text: r.paid ? 'Paid' : 'Still unpaid as of just now', tone: 'ok' }
              : { text: `Could not check: ${r.error}`, tone: 'bad' },
          );
        } else {
          const r = await cancelPaymentLinkAction(requestKey);
          setNote(r.ok ? { text: 'Cancelled. The guest can no longer pay this link.', tone: 'ok' } : { text: r.error, tone: 'bad' });
        }
      } catch (e) {
        setNote({ text: e instanceof Error ? e.message : 'Something went wrong.', tone: 'bad' });
      } finally {
        setBusy(null);
        setConfirming(false);
        router.refresh();
      }
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      if (markCopied) {
        void markLinkCopiedAction(requestKey);
        router.refresh();
      }
    } catch {
      setNote({ text: 'Clipboard blocked; the link is in the row above.', tone: 'bad' });
    }
  };

  const label = (kind: 'nudge' | 'check' | 'cancel', idle: string, working: string) =>
    busy === kind ? working : idle;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: compact ? 'flex-start' : 'flex-end', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: compact ? 'flex-start' : 'flex-end' }}>
        {!closed && (
          <button type="button" onClick={() => run('nudge')} disabled={isPending} style={buttonStyle(isPending)}>
            {label('nudge', 'Nudge by text', 'Texting')}
          </button>
        )}
        {!closed && !compact && (
          <button type="button" onClick={() => run('check')} disabled={isPending} style={buttonStyle(isPending)}>
            {label('check', 'Check now', 'Checking')}
          </button>
        )}
        {!compact && (
          <button type="button" onClick={copy} disabled={isPending} style={buttonStyle(isPending)}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        )}
        {!closed && (
          <button
            type="button"
            onClick={() => (confirming ? run('cancel') : setConfirming(true))}
            disabled={isPending}
            style={{
              ...buttonStyle(isPending),
              color: 'var(--signal)',
              borderColor: 'var(--signal)',
              background: confirming ? 'var(--signal)' : 'transparent',
              ...(confirming ? { color: 'var(--paper)' } : {}),
            }}
          >
            {busy === 'cancel' ? 'Cancelling' : confirming ? 'Sure? Cancel it' : 'Cancel link'}
          </button>
        )}
      </div>
      {note && (
        <span
          role={note.tone === 'bad' ? 'alert' : 'status'}
          style={{ fontSize: 11, fontWeight: 500, color: note.tone === 'bad' ? 'var(--signal)' : 'var(--ink-3)', textAlign: compact ? 'left' : 'right', maxWidth: 360 }}
        >
          {note.text}
        </span>
      )}
    </div>
  );
}

function buttonStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    fontWeight: 600,
    color: 'var(--ink)',
    background: 'transparent',
    border: '1px solid var(--rule)',
    padding: '4px 9px',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    fontFamily: 'inherit',
  };
}
