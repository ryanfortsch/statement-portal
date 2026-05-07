'use client';

/**
 * Confirm-then-delete button for a property notice. Wraps a server-action
 * `<form>` with a `confirm()` so an accidental click on the edit page
 * doesn't drop a notice without warning.
 */
export function DeletePropertyNoticeButton({
  action,
  confirmText,
}: {
  action: () => Promise<void> | void;
  confirmText: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    >
      <button
        type="submit"
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
        Delete notice
      </button>
    </form>
  );
}
