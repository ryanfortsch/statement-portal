'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { updateWorkSlipStatus } from '@/app/work/actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { buttonClass } from '@/lib/button-class';

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
 *
 * The row's one box, on the house small secondary face; armed it turns
 * green, failed it turns red, and the row's dates and hands beside it are
 * plain text so nothing else on the row reads as a control.
 */
export function MarkSlipDoneButton({ slipId, propertyId, reportCount = 1 }: { slipId: string; propertyId: string; reportCount?: number }) {
  const softRefresh = useSoftRefresh();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const lock = useRef(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);
  useUnsavedWorkGuard(pending);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
    <button
      type="button"
      disabled={pending || done}
      aria-busy={pending || undefined}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (lock.current || done) return;
        setError(null);
        if (!confirming) {
          setConfirming(true);
          if (confirmTimer.current) clearTimeout(confirmTimer.current);
          confirmTimer.current = setTimeout(() => setConfirming(false), 3000);
          return;
        }
        lock.current = true;
        if (confirmTimer.current) clearTimeout(confirmTimer.current);
        setConfirming(false);
        start(async () => {
          try {
            const res = await updateWorkSlipStatus({ id: slipId, status: 'done', propertyId });
            if (!res.ok) { setError(res.error); return; }
            setDone(true);
            softRefresh();
          } catch {
            setError('Could not confirm completion. Check the slip before retrying.');
            softRefresh();
          } finally {
            lock.current = false;
          }
        });
      }}
      title={reportCount > 1 ? `Complete this issue and its ${reportCount} linked reports` : "Mark this work item done"}
      className={buttonClass('secondary', 'sm')}
      style={{
        flexShrink: 0,
        cursor: pending ? 'wait' : 'pointer',
        ...(confirming
          ? { background: 'var(--positive)', color: 'var(--paper)', borderColor: 'var(--positive)' }
          : error
            ? { color: 'var(--negative)', borderColor: 'var(--negative)' }
            : {}),
      }}
    >
      {pending ? 'Saving…' : done ? 'Done ✓' : error ? 'Retry' : confirming ? (reportCount > 1 ? `Complete ${reportCount} reports` : 'Confirm ✓') : 'Done'}
    </button>
    {error && <span role="alert" style={{ fontSize: 11, color: 'var(--negative)', maxWidth: 240 }}>{error}</span>}
    </div>
  );
}
