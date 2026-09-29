'use client';

import { useRef, useState, useTransition } from 'react';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { setSmsOptIn } from './actions';

/**
 * The "text me when new work is posted" switch on the profile. Opt-out: on by
 * default, flip it off to stop the new-work texts. The switch changes only
 * after the server confirms the saved preference; failures keep the intended retry target.
 */
export function SmsToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const lock = useRef(false);
  const [error, setError] = useState('');
  const [failedTarget, setFailedTarget] = useState<boolean | null>(null);
  useUnsavedWorkGuard(pending);

  function toggle(next = !on) {
    if (lock.current) return;
    lock.current = true;
    setSaved(false); setError(''); setFailedTarget(null);
    start(async () => {
      try {
        const res = await setSmsOptIn(next);
        if (!res.ok) { setError(res.error || 'Could not save your text preference.'); setFailedTarget(next); return; }
        setOn(next); setSaved(true);
      } catch {
        setError('Could not confirm your text preference. Retry to save your choice.'); setFailedTarget(next);
      } finally { lock.current = false; }
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      <span
        aria-hidden
        style={{
          fontSize: 11,
          color: saved ? 'var(--positive)' : 'var(--ink-4)',
          minWidth: 34,
          textAlign: 'right',
          transition: 'opacity .2s ease',
          opacity: saved || pending ? 1 : 0,
        }}
      >
        {pending ? 'Saving' : saved ? 'Saved' : ''}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Text me when new work is posted"
        onClick={() => toggle()}
        disabled={pending}
        style={{
          position: 'relative',
          width: 46,
          height: 28,
          borderRadius: 999,
          border: 'none',
          padding: 0,
          cursor: pending ? 'wait' : 'pointer',
          background: on ? 'var(--positive)' : 'var(--rule)',
          transition: 'background .2s ease',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: 3,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
            transform: on ? 'translateX(18px)' : 'none',
            transition: 'transform .2s ease',
          }}
        />
      </button>
    </div>
    {error && <div role="alert" style={{ fontSize: 12, maxWidth: 280, color: 'var(--signal)' }}>
      {error}
      {failedTarget !== null && <button type="button" disabled={pending} onClick={() => toggle(failedTarget)}>Retry {failedTarget ? 'turning texts on' : 'turning texts off'}</button>}
    </div>}
    </div>
  );
}
