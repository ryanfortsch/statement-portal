'use client';

import { useState } from 'react';

/** Tap-to-copy a value (access code, etc.) — peak-stress at the keypad, so
 *  the inspector taps instead of memorizing. */
export function CopyCode({
  value,
  copyValue,
  mono = true,
  label,
  pill = false,
}: {
  value: string;
  copyValue?: string;
  mono?: boolean;
  /** Small caps prefix inside the button ("Code"), so the number needs no
   *  emoji or wrapper chip to say what it is. */
  label?: string;
  /** Render as a single rounded chip that sits in a chip row — the code used
   *  to be a bordered box nested INSIDE another pill, which read as sloppy. */
  pill?: boolean;
}) {
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
        borderRadius: pill ? 999 : 8,
        cursor: 'pointer',
        gap: 8,
        padding: pill ? '8px 14px' : '10px 14px',
        minHeight: pill ? 38 : 44,
        font: 'inherit',
        fontFamily: mono ? 'var(--font-mono-dash), monospace' : 'inherit',
        color: copied ? 'var(--positive)' : 'var(--ink)',
        textAlign: 'left',
        overflowWrap: 'anywhere',
      }}
    >
      {label && !copied && (
        <span
          style={{
            fontFamily: 'inherit',
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            fontWeight: 600,
            color: 'var(--ink-4)',
          }}
        >
          {label}
        </span>
      )}
      <span style={{ letterSpacing: mono ? '0.08em' : undefined }}>{copied ? 'copied ✓' : value}</span>
    </button>
  );
}
