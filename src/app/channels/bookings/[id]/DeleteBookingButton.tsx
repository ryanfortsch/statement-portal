'use client';

import { useFormStatus } from 'react-dom';
import { deleteBooking } from './actions';

/**
 * Delete button for the booking edit page. Renders INSIDE the booking edit
 * <form> and submits it to deleteBooking via formAction (the form's hidden
 * `id` input rides along). Deliberately NOT its own <form>: nested forms are
 * invalid HTML, the SSR parser flattens them, and hydration then mismatches.
 * Confirm-gated; disables with a 'Deleting…' swap while the action runs.
 */
export function DeleteBookingButton() {
  const status = useFormStatus();
  const busy = status.pending && status.action === deleteBooking;
  return (
    <button
      type="submit"
      formAction={deleteBooking}
      disabled={status.pending}
      aria-busy={busy || undefined}
      title="Permanently delete this booking record"
      onClick={(e) => {
        if (!confirm('Delete this booking record? This cannot be undone.')) {
          e.preventDefault();
        }
      }}
      style={{
        background: 'transparent',
        color: 'var(--negative)',
        fontSize: 11,
        letterSpacing: '.06em',
        textTransform: 'uppercase',
        fontWeight: 500,
        padding: '10px 18px',
        border: '1px solid var(--negative)',
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.85 : 1,
      }}
    >
      {busy ? 'Deleting…' : 'Delete'}
    </button>
  );
}
