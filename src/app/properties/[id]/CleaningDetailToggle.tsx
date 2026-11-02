'use client';

import { useState } from 'react';
import { useRecoverableAction } from '@/lib/use-recoverable-action';

import { updateStatementCleaningDetail } from './actions';

/**
 * The "Statement shows cleaning by turnover" switch on the Owner & money tab.
 * One tap each way; the statement render page reads the flag on the next
 * render, so the current month's preview changes at once.
 */
export function CleaningDetailToggle({ propertyId, initial }: { propertyId: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const { pending, busy, error, setError, run } = useRecoverableAction();

  function flip() {
    if (busy.current) return;
    const next = !on;
    setError(null);
    run(async () => {
      const res = await updateStatementCleaningDetail(propertyId, next);
      if (res.ok) setOn(next);
      else setError(res.error);
    }, 'Could not confirm the change was saved. Try again.');
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ color: on ? 'var(--ink)' : 'var(--ink-4)' }}>
        {on ? 'One row per turnover, under Financials' : 'One Cleaning line'}
      </span>
      <button
        type="button"
        onClick={flip}
        disabled={pending}
        aria-pressed={on}
        style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
          color: 'var(--ink-3)', border: '1px solid var(--rule)', background: 'transparent',
          padding: '2px 8px', cursor: pending ? 'wait' : 'pointer',
        }}
      >
        {pending ? 'Saving…' : on ? 'Turn off' : 'Itemize'}
      </button>
      {error && <span style={{ fontSize: 11, color: 'var(--negative, #b13b2a)' }}>{error}</span>}
    </span>
  );
}
