'use client';

import { useState, useTransition } from 'react';
import { confirmCleaningDoneAction } from './cleaning-actions';

/**
 * The operator's hand on a clean: confirm an estimated finish, or mark the
 * clean done when no signal is coming. It writes a manual finish to
 * cleaning_sessions with no undo in the UI, so it takes two taps (the verb,
 * then Confirm), and a failure is printed, never swallowed. Shared by the
 * six-stage rail and the three-step line; the page re-renders from the
 * server once the action revalidates /turnovers.
 */
export function MarkCleaned({
  propertyId,
  checkoutDate,
  estimated = false,
  onDone,
}: {
  propertyId: string;
  /** The departure the clean follows, YYYY-MM-DD. */
  checkoutDate: string;
  /** A lock-estimated finish is on file: the verb confirms it. */
  estimated?: boolean;
  onDone?: () => void;
}) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  function save() {
    setError('');
    start(async () => {
      try {
        const r = await confirmCleaningDoneAction(propertyId, checkoutDate);
        if (r.ok) {
          setConfirming(false);
          onDone?.();
        } else {
          setError(r.message ?? 'Could not save the clean.');
        }
      } catch {
        setError('Could not confirm the change. Refresh before retrying.');
      }
    });
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} style={markButton(false)}>
        {estimated ? 'Confirm cleaned' : 'Mark cleaned'}
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
        {estimated ? 'The cleaner has finished?' : 'Mark this home cleaned by hand?'}
      </span>
      <button type="button" onClick={save} disabled={pending} style={markButton(true, pending)}>
        {pending ? 'Saving…' : error ? 'Retry' : 'Confirm'}
      </button>
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
          setError('');
        }}
        disabled={pending}
        style={markButton(false, pending)}
      >
        Cancel
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 11, color: 'var(--negative)' }}>
          {error}
        </span>
      )}
    </span>
  );
}

/** Solid for the commit, ghost for the rest; tall enough for a thumb. */
function markButton(solid: boolean, busy = false): React.CSSProperties {
  return {
    background: solid ? 'var(--ink)' : 'none',
    color: solid ? 'var(--paper)' : 'var(--ink-3)',
    border: `1px solid ${solid ? 'var(--ink)' : 'var(--rule)'}`,
    padding: '8px 14px',
    minHeight: 40,
    fontSize: 11,
    letterSpacing: '.14em',
    textTransform: 'uppercase',
    fontWeight: 600,
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.6 : 1,
  };
}
