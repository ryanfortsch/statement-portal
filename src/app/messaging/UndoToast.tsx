'use client';

/**
 * The undo that appears the moment a card is rejected or marked handled:
 * one line pinned to the bottom of the viewport with "Undo", the way mail
 * clients do it. Before this (2026-09-21) the only way back was a boxed
 * "Decided recently" list that sat full-width ABOVE the queue, so the first
 * thing on the Inbox was a ledger of past decisions rather than the work.
 * That list now lives quietly under the queue for anything older than this
 * toast; this is the fast path.
 *
 * Latest decision wins (a second decision replaces the first), it hides
 * itself after 15s, Escape closes it, and a refusal from the concierge
 * (already sent, someone replied, a newer draft exists) reads back in place.
 */

import { useEffect, useState, useTransition } from 'react';
import { undoDecision } from './actions';

export type Decision = {
  id: string;
  action: 'rejected' | 'manual_sent';
  guest: string;
  property: string;
};

const LABEL: Record<Decision['action'], string> = {
  rejected: 'Rejected',
  manual_sent: 'Marked handled',
};

const AUTO_HIDE_MS = 15_000;
const AFTER_UNDO_MS = 2_500;

export function UndoToast({
  decision,
  onClose,
  onUndone,
}: {
  decision: Decision | null;
  onClose: () => void;
  /** The card is back: refresh the queue feed. */
  onUndone: () => void;
}) {
  if (!decision) return null;
  // Keyed on the card id so a new decision remounts with fresh state instead
  // of resetting the old one in an effect.
  return <Toast key={decision.id} decision={decision} onClose={onClose} onUndone={onUndone} />;
}

function Toast({
  decision,
  onClose,
  onUndone,
}: {
  decision: Decision;
  onClose: () => void;
  onUndone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);

  // Auto-hide, paused while the undo request is in flight, short after it lands.
  useEffect(() => {
    if (isPending || error) return;
    const t = window.setTimeout(onClose, undone ? AFTER_UNDO_MS : AUTO_HIDE_MS);
    return () => window.clearTimeout(t);
  }, [isPending, undone, error, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const undo = () => {
    setError(null);
    startTransition(async () => {
      const res = await undoDecision(decision.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setUndone(true);
      onUndone();
    });
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="rt-undo-toast"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        zIndex: 60,
        maxWidth: 'calc(100vw - 32px)',
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '12px 14px 12px 18px',
        background: 'var(--ink)',
        color: 'var(--paper)',
        boxShadow: '0 10px 30px rgba(11, 37, 69, 0.28)',
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      <span style={{ minWidth: 0 }}>
        {undone ? (
          <>Back in the queue.</>
        ) : (
          <>
            <span style={{ opacity: 0.7 }}>{LABEL[decision.action]} · </span>
            <span style={{ fontWeight: 500 }}>{decision.guest}</span>
            <span style={{ opacity: 0.7 }}> · {decision.property}</span>
            {error && (
              <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--signal-soft)' }}>
                {error}
              </span>
            )}
          </>
        )}
      </span>
      {!undone && !error && (
        <button
          type="button"
          onClick={undo}
          disabled={isPending}
          aria-busy={isPending || undefined}
          style={{
            background: 'transparent',
            border: 0,
            padding: '4px 2px',
            color: 'var(--paper)',
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            fontWeight: 700,
            textDecoration: 'underline',
            textUnderlineOffset: 5,
            textDecorationColor: 'rgba(245, 239, 226, 0.45)',
            cursor: isPending ? 'wait' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {isPending ? 'Undoing…' : 'Undo'}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          border: 0,
          padding: '2px 4px',
          color: 'var(--paper)',
          opacity: 0.6,
          fontSize: 16,
          lineHeight: 1,
          cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>
  );
}
