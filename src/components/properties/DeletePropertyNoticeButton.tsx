'use client';

import { SubmitButton } from '@/components/SubmitButton';

/**
 * Confirm-then-delete button for a property notice (or note, via the
 * optional `label`). Wraps a server-action `<form>` with a `confirm()`
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
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    >
      <SubmitButton
        label={label}
        busyLabel="Deleting…"
        spinnerTone="ink"
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
      />
    </form>
  );
}
