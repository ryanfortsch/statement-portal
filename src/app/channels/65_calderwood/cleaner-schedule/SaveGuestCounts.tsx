'use client';

import { useActionState } from 'react';
import { saveGuestCounts, type CountSaveState } from './actions';

export function SaveGuestCounts({ available }: { available: boolean }) {
  const [state, action, pending] = useActionState(saveGuestCounts, { status: 'idle', saved: 0 } as CountSaveState);
  return <section className="mt-5 rounded-xl border p-5 text-sm leading-6" style={{ borderColor: 'var(--rule)' }}>
    <h2 className="font-semibold">Guest counts for the cleaner portal</h2>
    <p className="mt-1">Save missing counts from Guesty into the matching booking records. Each save checks the source again. Existing counts are kept; later Guesty changes still need review.</p>
    <form action={action} className="mt-3">
      <button type="submit" disabled={!available || pending} className="min-h-11 rounded-lg px-4 py-2 font-medium disabled:opacity-50" style={{ background: 'var(--ink)', color: 'var(--paper)' }}>
        {pending ? 'Checking and saving…' : 'Recheck and save missing counts'}
      </button>
    </form>
    <p role="status" aria-live="polite" className="mt-2">
      {state.status === 'saved' ? state.saved ? `${state.saved} guest counts saved. The cleaner portal now reads these booking counts.` : 'No missing guest counts to save.'
        : state.status === 'error' ? 'The save could not be confirmed. Reload to check the current counts, then try again.'
        : !available ? 'No verified missing counts are ready to save. Reload if the source check was unavailable.'
        : 'Saving records the source check in booking history. It does not send a message.'}
    </p>
  </section>;
}
