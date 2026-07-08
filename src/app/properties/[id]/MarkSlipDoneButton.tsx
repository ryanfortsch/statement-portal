'use client';

import { useState, useTransition } from 'react';
import { updateWorkSlipStatus } from '@/app/work/actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

/**
 * Inline "Done" control on the property page's Open Work list. Marks the
 * slip done via the shared updateWorkSlipStatus action (same one the
 * /work board uses), which stamps completed_at + closed_by and
 * revalidates the work board, this property, and the /properties slip
 * counts — so the slip drops out of every open-work read at once.
 *
 * Two-tap confirm so a stray click doesn't close a slip; softRefresh
 * pulls the revalidated server render once the action returns, wrapped in
 * a transition so the property page's loading skeleton never swaps in and
 * yanks scroll to the top (you stay on the slip you just closed and can
 * knock out the next one in place).
 */
export function MarkSlipDoneButton({ slipId, propertyId }: { slipId: string; propertyId: string }) {
  const softRefresh = useSoftRefresh();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setError(false);
        if (!confirming) {
          setConfirming(true);
          setTimeout(() => setConfirming(false), 3000);
          return;
        }
        start(async () => {
          const res = await updateWorkSlipStatus({ id: slipId, status: 'done', propertyId });
          if (!res.ok) {
            setError(true);
            setConfirming(false);
            return;
          }
          softRefresh();
        });
      }}
      title="Mark this work slip done"
      style={{
        flexShrink: 0,
        background: confirming ? 'var(--positive)' : 'transparent',
        color: confirming ? 'var(--paper)' : error ? 'var(--negative)' : 'var(--ink-3)',
        border: `1px solid ${confirming ? 'var(--positive)' : error ? 'var(--negative)' : 'var(--rule)'}`,
        fontSize: 9,
        letterSpacing: '.16em',
        textTransform: 'uppercase',
        fontWeight: 600,
        padding: '3px 9px',
        cursor: pending ? 'wait' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {pending ? 'Saving…' : error ? 'Retry' : confirming ? 'Confirm ✓' : 'Done'}
    </button>
  );
}
