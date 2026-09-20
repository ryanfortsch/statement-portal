'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { undoDecision } from './actions';

/**
 * Reverse a reject or a mark-handled. The concierge restores the card as it
 * was and the queue refreshes; a refusal (already sent, someone replied,
 * a newer draft exists) reads back in plain words next to the button.
 */
export function UndoButton({ approvalId, label = 'Undo' }: { approvalId: string; label?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      const res = await undoDecision(approvalId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(true);
      router.refresh();
    });
  };

  if (done) {
    return (
      <span className="eyebrow" style={{ color: 'var(--ink-3)', fontWeight: 600 }}>
        Back in queue
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        style={{
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          fontWeight: 600,
          color: 'var(--ink-2)',
          background: 'transparent',
          border: '1px solid var(--rule)',
          padding: '6px 12px',
          cursor: isPending ? 'wait' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {isPending ? 'Undoing…' : label}
      </button>
      {error && (
        <span style={{ fontSize: 11, color: 'var(--signal, #c85a3a)', maxWidth: 260, textAlign: 'right' }}>{error}</span>
      )}
    </span>
  );
}
