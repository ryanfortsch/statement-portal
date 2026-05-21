'use client';

import { useState, useTransition } from 'react';
import { markEmailHandled } from './actions';

export function MarkHandledButton({ messageId }: { messageId: string }) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--ink-4)' }}>
        Handled
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const res = await markEmailHandled(messageId);
          if (res.ok) setDone(true);
        });
      }}
      className="text-[10px] uppercase tracking-[0.14em] hover:underline disabled:opacity-50"
      style={{ color: 'var(--ink-4)', cursor: 'pointer', background: 'none', border: 0, padding: 0 }}
      aria-label="Mark email handled"
      title="Drop from /today (does not change Gmail read state)"
    >
      {isPending ? 'Handling…' : 'Handled ✓'}
    </button>
  );
}
