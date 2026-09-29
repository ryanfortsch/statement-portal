'use client';

import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { useRecoverableAction } from '@/lib/use-recoverable-action';

/**
 * Confirm-then-delete button for a property notice (or note, via the
 * optional `label`). Calls the existing server action after `confirm()`
 * so an accidental click on the edit page doesn't drop a record without
 * warning. Pending-aware: disables and shows "Deleting…" while the
 * action runs.
 */
export function DeletePropertyNoticeButton({
  action,
  confirmText,
  label = 'Delete notice',
}: {
  action: () => Promise<void> | void;
  confirmText: string;
  label?: string;
}) {
  const { busy, pending, error, run } = useRecoverableAction();
  useUnsavedWorkGuard(pending);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy.current || !window.confirm(confirmText)) return;
        run(async () => { await action(); }, 'Could not confirm deletion. Check the record, then retry if it is still present.');
      }}
    >
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        style={{
          background: 'transparent',
          color: 'var(--negative)',
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          padding: '12px 18px',
          border: '1px solid var(--negative)',
          cursor: 'pointer',
        }}
      >
        {pending ? 'Deleting…' : error ? `Retry ${label.toLowerCase()}` : label}
      </button>
      {error && <p role="alert" style={{ color: 'var(--negative)' }}>{error}</p>}
    </form>
  );
}
