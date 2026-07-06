'use client';

import { useState, useTransition } from 'react';
import { setSmsOptIn } from './actions';

/**
 * The "text me when new work is posted" switch on the profile. Opt-out: on by
 * default, flip it off to stop the new-work texts. Optimistic: the switch moves
 * instantly, persists via the server action, and reverts if the save fails.
 */
export function SmsToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    setSaved(false);
    start(async () => {
      const res = await setSmsOptIn(next);
      if (!res?.ok) {
        setOn(!next); // revert
      } else {
        setSaved(true);
      }
    });
  }

  return (
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
        onClick={toggle}
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
  );
}
