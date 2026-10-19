'use client';

import { useRef } from 'react';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { useConfirm } from '@/components/ConfirmDialog';
import { askFromSentence } from '@/lib/confirm-question';

/**
 * Confirm-then-delete button for a property notice (or note, via the
 * optional `label`). Calls the existing server action after the app's
 * confirm modal says yes, so an accidental click on the edit page doesn't
 * drop a record without warning. `confirmText` is one string, question
 * first ("Delete the X notice from Y? This can't be undone."). Pending-aware:
 * disables and shows "Deleting…" while the action runs.
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
  const { ask } = useConfirm();
  // A second submit while the question is open is the same click, not a new one.
  const asking = useRef(false);
  useUnsavedWorkGuard(pending);
  return (
    <form
      action={action}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy.current || asking.current) return;
        asking.current = true;
        const yes = await ask({ ...askFromSentence(confirmText), confirmLabel: label, tone: 'danger' }).finally(() => { asking.current = false; });
        if (!yes || busy.current) return;
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
