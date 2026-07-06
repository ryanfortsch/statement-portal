'use client';

import { useFormStatus } from 'react-dom';
import { startStopInspection } from '../../actions';

/**
 * Start (or resume) a stop's inspection. The server action generates the deck +
 * creates the inspection before redirecting, which takes a couple seconds — and
 * a spinner buried inside a full-width button is hidden under the thumb that
 * just tapped it. So while pending we REPLACE the button with an unmistakable
 * "Opening inspection…" bar the inspector can't miss.
 */
function StartInner({ resume }: { resume: boolean }) {
  const { pending } = useFormStatus();
  if (pending) {
    return (
      <div
        aria-live="polite"
        style={{ width: '100%', minHeight: 48, background: 'var(--tide-deep)', color: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, fontSize: 13, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' }}
      >
        <span aria-hidden className="animate-spin" style={{ display: 'inline-block', width: 15, height: 15, border: '2px solid rgba(245,239,226,0.45)', borderTopColor: 'var(--paper)', borderRadius: '50%' }} />
        Opening inspection…
      </div>
    );
  }
  return (
    <button
      type="submit"
      style={{ width: '100%', minHeight: 48, background: 'var(--ink)', color: 'var(--paper)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '14px 18px' }}
    >
      {resume ? 'Resume inspection' : 'Start inspection'}
    </button>
  );
}

export function StartStop({ packetId, stopId, resume }: { packetId: string; stopId: string; resume: boolean }) {
  return (
    <form action={startStopInspection} style={{ margin: 0 }}>
      <input type="hidden" name="packet_id" value={packetId} />
      <input type="hidden" name="stop_id" value={stopId} />
      <StartInner resume={resume} />
    </form>
  );
}
