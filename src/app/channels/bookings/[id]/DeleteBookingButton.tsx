'use client';

import { useFormStatus } from 'react-dom';
import { deleteBooking } from './actions';

/**
 * The Delete button on the booking record. Renders INSIDE the booking edit
 * <form> and submits it to deleteBooking via formAction (the hidden `id`
 * rides along). Deliberately NOT its own <form>: nested forms are invalid
 * HTML, the SSR parser flattens them, and hydration then mismatches.
 *
 * The server decides what actually happens (deleteOrCancelBooking): only a
 * block, or an inquiry with no downstream artifacts, is deleted; anything
 * else is kept as a soft cancel. `deletable` lets the button say which of
 * the two it will do before the click, so the confirm text is never a lie.
 */
export function DeleteBookingButton({ deletable, reason }: { deletable: boolean; reason?: string }) {
  const status = useFormStatus();
  const busy = status.pending && status.action === deleteBooking;
  const label = deletable ? 'Delete' : 'Delete (kept as cancelled)';
  const confirmText = deletable
    ? 'Delete this row for good? Nothing downstream references it, so it simply disappears.'
    : `This row cannot be deleted: ${reason ?? 'it is history, not a typo'}. It will be kept as a soft cancel with that reason. Continue?`;
  return (
    <button
      type="submit"
      formAction={deleteBooking}
      disabled={status.pending}
      aria-busy={busy || undefined}
      title={deletable ? 'Permanently delete this row' : reason ?? 'Kept as a soft cancel'}
      onClick={(e) => {
        if (!confirm(confirmText)) e.preventDefault();
      }}
      style={{
        background: 'transparent',
        color: 'var(--negative)',
        fontSize: 11,
        letterSpacing: '.06em',
        textTransform: 'uppercase',
        fontWeight: 500,
        padding: '10px 18px',
        border: `1px ${deletable ? 'solid' : 'dashed'} var(--negative)`,
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.85 : 1,
      }}
    >
      {busy ? 'Working…' : label}
    </button>
  );
}
