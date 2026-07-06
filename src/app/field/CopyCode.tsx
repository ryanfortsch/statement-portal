'use client';

import { useState } from 'react';

/** Tap-to-copy a value (access code, etc.) — peak-stress at the keypad, so
 *  the inspector taps instead of memorizing. */
export function CopyCode({ value, copyValue, mono = true }: { value: string; copyValue?: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(copyValue ?? value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          },
          () => {},
        );
      }}
      title="Tap to copy"
      style={{
        // A real chip, not 13px underlined text: codes get tapped at the keypad
        // (peak stress), so give the tap a target.
        display: 'inline-flex',
        alignItems: 'center',
        justifySelf: 'start',
        maxWidth: '100%',
        background: 'var(--paper-2, #fff)',
        border: `1px solid ${copied ? 'var(--positive)' : 'var(--rule)'}`,
        borderRadius: 8,
        cursor: 'pointer',
        padding: '8px 12px',
        minHeight: 38,
        font: 'inherit',
        fontFamily: mono ? 'var(--font-mono-dash), monospace' : 'inherit',
        color: copied ? 'var(--positive)' : 'var(--ink)',
        textAlign: 'left',
        overflowWrap: 'anywhere',
      }}
    >
      {copied ? 'copied ✓' : value}
    </button>
  );
}
