'use client';

import { useState } from 'react';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { deleteInspection } from './actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

/**
 * Per-row delete control for the Recent Inspections list. Two-step inline
 * confirm (tap Delete → Confirm / Cancel) so a stray tap on a phone never
 * nukes a walk, without throwing a native confirm() dialog. Quiet by
 * default so it doesn't compete with the row's tap-to-open.
 */
export function DeleteInspectionButton({
  inspectionId,
  label,
}: {
  inspectionId: string;
  label: string;
}) {
  const softRefresh = useSoftRefresh();
  const [confirming, setConfirming] = useState(false);
  const { pending, error, setError, run } = useRecoverableAction();
  useUnsavedWorkGuard(pending);

  function runDelete() {
    run(async () => {
      const res = await deleteInspection(inspectionId);
      if (!res.ok) setError(res.error);
      else softRefresh();
    }, 'Could not confirm deletion. Check the inspection, then retry if it is still present.');
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Delete inspection — ${label}`}
        style={{
          background: 'none',
          border: 'none',
          padding: '8px 0',
          cursor: 'pointer',
          fontSize: 11,
          letterSpacing: '0.04em',
          color: 'var(--ink-4)',
          whiteSpace: 'nowrap',
        }}
      >
        Delete
      </button>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
      {error && <span role="alert" style={{ color: 'var(--negative)', whiteSpace: 'normal', maxWidth: 240 }}>{error}</span>}
      <button
        type="button"
        onClick={runDelete}
        disabled={pending}
        style={{
          background: 'none',
          border: 'none',
          padding: '8px 0',
          cursor: pending ? 'wait' : 'pointer',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: 'var(--negative)',
          whiteSpace: 'nowrap',
        }}
      >
        {pending ? 'Deleting…' : error ? 'Retry delete' : 'Confirm'}
      </button>
      <button
        type="button"
        onClick={() => { setConfirming(false); setError(null); }}
        disabled={pending}
        style={{
          background: 'none',
          border: 'none',
          padding: '8px 0',
          cursor: 'pointer',
          fontSize: 11,
          letterSpacing: '0.04em',
          color: 'var(--ink-4)',
          whiteSpace: 'nowrap',
        }}
      >
        Cancel
      </button>
    </span>
  );
}
