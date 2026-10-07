'use client';

import { useRef, useState, useTransition } from 'react';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { markEmailHandled } from './actions';

export function MarkHandledButton({ messageId }: { messageId: string }) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const softRefresh = useSoftRefresh();
  useUnsavedWorkGuard(isPending);

  if (done) {
    return (
      <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--ink-4)' }}>
        Handled
      </span>
    );
  }

  return (
    <span>
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (lock.current) return;
        lock.current = true; setError('');
        startTransition(async () => {
          try {
            const res = await markEmailHandled(messageId);
            if (!res.ok) { setError(res.error || 'Could not mark this email handled. Please try again.'); return; }
            setDone(true); softRefresh();
          } catch {
            setError('Could not confirm this email was handled. Check the inbox before retrying.');
          } finally { lock.current = false; }
        });
      }}
      className="text-[10px] uppercase tracking-[0.14em] hover:underline disabled:opacity-50"
      style={{ color: 'var(--ink-4)', cursor: 'pointer', background: 'none', border: 0, padding: 0 }}
      aria-label="Mark email handled"
      title="Drop from /today (does not change Gmail read state)"
    >
      {isPending ? 'Handling…' : error ? 'Retry' : 'Mark handled'}
    </button>
    {error && <span role="alert" style={{ display: 'block', fontSize: 11, color: 'var(--negative)' }}>{error}</span>}
    </span>
  );
}
