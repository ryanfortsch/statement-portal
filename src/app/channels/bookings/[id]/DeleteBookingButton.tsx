'use client';

import { useFormStatus } from 'react-dom';
import { deleteBooking } from './actions';
import { askThenSubmit, useConfirm } from '@/components/ConfirmDialog';

/**
 * The Delete button on the booking record. Renders INSIDE the booking edit
 * <form> and submits it to deleteBooking via formAction (the hidden `id`
 * rides along). Deliberately NOT its own <form>: nested forms are invalid
 * HTML, the SSR parser flattens them, and hydration then mismatches.
 *
 * The server decides what actually happens (deleteOrCancelBooking): only an
 * inquiry with no downstream artifacts is deleted; a hold made in Helm and
 * anything else is kept as a soft cancel, and a row imported from a feed is
 * refused (the page does not render the button for one). `deletable` lets
 * the button say which it will do before the click, so the confirm text is
 * never a lie.
 */
export function DeleteBookingButton({ deletable, reason }: { deletable: boolean; reason?: string }) {
  const status = useFormStatus();
  const busy = status.pending && status.action === deleteBooking;
  const { ask } = useConfirm();
  const label = deletable ? 'Delete' : 'Delete (kept as cancelled)';
  const question = deletable
    ? { title: 'Delete this row for good?', body: 'Nothing downstream references it, so it simply disappears.', confirmLabel: 'Delete row', tone: 'danger' as const, irreversible: true }
    : { title: 'Keep this row as cancelled?', body: `It cannot be deleted: ${reason ?? 'it is history, not a typo'}. It is kept as a soft cancel with that reason.`, confirmLabel: 'Cancel the row', tone: 'danger' as const };
  return (
    <button
      type="submit"
      formAction={deleteBooking}
      disabled={status.pending}
      aria-busy={busy || undefined}
      title={deletable ? 'Permanently delete this row' : reason ?? 'Kept as a soft cancel'}
      onClick={(e) => askThenSubmit(e, ask, question)}
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
