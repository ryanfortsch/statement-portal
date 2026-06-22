'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteInspection } from './actions';

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
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function runDelete() {
    setErr(null);
    startTransition(async () => {
      const res = await deleteInspection(inspectionId);
      if (!res.ok) {
        setErr(res.error);
        setConfirming(false);
      } else {
        router.refresh();
      }
    });
  }

  if (err) {
    return (
      <button
        type="button"
        onClick={() => setErr(null)}
        title={`${err} — tap to dismiss`}
        style={{
          background: 'none',
          border: 'none',
          padding: '8px 0',
          cursor: 'pointer',
          fontSize: 11,
          color: 'var(--negative)',
          maxWidth: 160,
          whiteSpace: 'normal',
          textAlign: 'right',
          lineHeight: 1.3,
        }}
      >
        {err}
      </button>
    );
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
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, whiteSpace: 'nowrap' }}>
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
        {pending ? 'Deleting…' : 'Confirm'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
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
