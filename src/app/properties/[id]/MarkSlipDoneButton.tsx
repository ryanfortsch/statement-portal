'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateWorkSlipStatus } from '@/app/work/actions';

/**
 * Inline "Done" control on the property page's Open Work list. Marks the
 * slip done via the shared updateWorkSlipStatus action (same one the
 * /work board uses), which stamps completed_at + closed_by and
 * revalidates the work board, this property, and the /properties slip
 * counts — so the slip drops out of every open-work read at once.
 *
 * Two-tap confirm so a stray click doesn't close a slip; router.refresh
 * pulls the revalidated server render once the action returns.
 */
export function MarkSlipDoneButton({ slipId, propertyId }: { slipId: string; propertyId: string }) {
  const router = useRouter();
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
          router.refresh();
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
