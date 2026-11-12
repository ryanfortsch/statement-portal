'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/Button';

/** One deliberate attempt. A missing response can hide a committed save. */
export function TimingCapture({ disabled, onBusyChange }: {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const attempted = useRef(false);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'unconfirmed'>('idle');
  const [saved, setSaved] = useState(0);

  async function capture() {
    if (disabled || attempted.current) return;
    attempted.current = true;
    setState('saving'); onBusyChange(true);
    try {
      const response = await fetch('/api/channex/message-preparation/capture', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'capture_source_timing' }),
        cache: 'no-store', signal: AbortSignal.timeout(125000),
      });
      const result = await response.json();
      if (!response.ok || result?.ok !== true || !Number.isInteger(result.saved)
        || result.saved < 0 || result.saved > 12 || result.jobsCreated !== 0 || result.messagesSent !== 0
        || (result.saved === 0 ? result.captureId !== null
          : typeof result.captureId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.captureId))) {
        throw Error('Unconfirmed');
      }
      setSaved(result.saved); setState('saved');
    } catch { setState('unconfirmed'); }
    finally { onBusyChange(false); }
  }

  return <section className="mt-5 rounded-xl border p-5 sm:p-6" aria-labelledby="save-source-timings"
    style={{ borderColor: 'var(--rule)' }}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl">
        <h2 id="save-source-timings" className="text-lg font-semibold">Keep the existing reservation timings</h2>
        <p className="mt-2 text-sm leading-6" style={{ color: 'var(--ink-3)' }}>
          Recheck Guesty and save a private snapshot of each current or upcoming stay’s confirmation,
          arrival and departure times for the handover. Guesty continues sending all messages.
        </p>
      </div>
      <Button type="button" onClick={capture} disabled={disabled || state !== 'idle'}
        pending={state === 'saving'} pendingLabel="Checking and saving…" watchdog={false}>
        {state === 'saved' ? 'Check complete' : state === 'unconfirmed' ? 'Verification needed' : 'Save verified timings'}
      </Button>
    </div>
    <p className="mt-3 text-sm leading-6" role={state === 'unconfirmed' ? 'alert' : 'status'}
      style={{ color: state === 'unconfirmed' ? 'var(--negative)' : 'var(--ink-3)' }}>
      {state === 'saving' ? 'Checking all reservation matches and times twice. Keep this page open until the result appears.'
        : state === 'saved' ? saved > 0
          ? `Timings saved for ${saved} ${saved === 1 ? 'reservation' : 'reservations'}. No messages were queued or sent.`
          : 'No current or upcoming reservations were found. No snapshot was saved.'
        : state === 'unconfirmed' ? 'The save could not be confirmed. It may have completed. Have the saved records checked before trying again; this page will not retry.'
        : 'Saves timing evidence only. Sending schedules and the Guesty queue still need their separate handover checks.'}
    </p>
  </section>;
}
