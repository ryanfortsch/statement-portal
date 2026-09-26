'use client';

import { useState } from 'react';

/**
 * A fact you can hand to someone without retyping it.
 *
 * The header band exists for the mid-day lookup: Ryan is on the phone with a
 * guest or a cleaner is texting, and the answer has to leave the screen in one
 * gesture. Selecting a Wi-Fi password out of a grid cell is not that gesture.
 *
 * Falls back silently when the clipboard API is unavailable (an insecure
 * origin, or a browser that refuses without a user-activation it does not
 * think it got): the value stays on screen and selectable, which is exactly
 * where it was before, so nothing is lost by the failure.
 */
export function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* no clipboard: the value is still on screen */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? 'Copied' : `Copy ${label}`}
      style={{
        border: 'none',
        background: 'none',
        padding: '0 0 0 6px',
        cursor: 'pointer',
        fontSize: 10,
        lineHeight: 1,
        color: copied ? 'var(--positive)' : 'var(--ink-4)',
        fontFamily: 'var(--font-mono-dash), ui-monospace, monospace',
      }}
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}
