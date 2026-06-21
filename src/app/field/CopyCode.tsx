'use client';

import { useState } from 'react';

/** Tap-to-copy a value (access code, etc.) — peak-stress at the keypad, so
 *  the inspector taps instead of memorizing. */
export function CopyCode({ value, mono = true }: { value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          },
          () => {},
        );
      }}
      title="Tap to copy"
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        font: 'inherit',
        fontFamily: mono ? 'var(--font-mono-dash), monospace' : 'inherit',
        color: copied ? 'var(--positive)' : 'var(--ink)',
        textDecoration: 'underline',
        textDecorationStyle: 'dotted',
        textUnderlineOffset: 3,
      }}
    >
      {copied ? 'copied ✓' : value}
    </button>
  );
}
