'use client';

import { useFormStatus } from 'react-dom';

/**
 * Submit button for the ProjectionForm. Reads the parent form's pending
 * state via useFormStatus() so that the instant the action fires — and,
 * for a new prospect, all the way through the server-side redirect to the
 * detail page — the button disables, dims, and shows a spinner.
 *
 * Without this, clicking "Create prospect" gave no feedback at all: the
 * page just sat there while the server action ran (geocode lookup +
 * insert + redirect can take a couple seconds), so it wasn't obvious the
 * click had registered.
 *
 * Must be rendered as a descendant of the <form> — useFormStatus only
 * reports status for the form it's nested inside.
 */
export function FormSubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  // Gerund form of the action verb for the pending label.
  const lower = label.toLowerCase();
  const pendingLabel = lower.startsWith('create')
    ? 'Creating…'
    : lower.startsWith('save')
      ? 'Saving…'
      : 'Working…';

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      style={{
        background: 'var(--ink)',
        color: 'var(--paper)',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        padding: '14px 28px',
        border: 'none',
        cursor: pending ? 'wait' : 'pointer',
        opacity: pending ? 0.72 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        transition: 'opacity 120ms ease',
      }}
    >
      {pending && (
        <span
          aria-hidden
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '1.5px solid currentColor',
            borderTopColor: 'transparent',
            display: 'inline-block',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      )}
      {pending ? pendingLabel : `${label} →`}
    </button>
  );
}
