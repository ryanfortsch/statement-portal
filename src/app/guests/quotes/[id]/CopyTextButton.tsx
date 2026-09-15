'use client';

import { useState } from 'react';

/**
 * Copies an absolute string (the guest's staycapeann.com quote link) to the
 * clipboard. Unlike the agreements CopyLinkButton, the URL lives on another
 * origin, so the full string is passed in rather than built from
 * window.location.
 */
export function CopyTextButton({ text, label = 'Copy guest link' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard can be denied in odd contexts; fall back to prompt.
          window.prompt('Copy the link:', text);
        }
      }}
      style={{
        font: 'inherit',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '.06em',
        color: copied ? 'var(--paper)' : 'var(--ink)',
        background: copied ? 'var(--signal)' : 'transparent',
        border: '1px solid var(--ink)',
        padding: '8px 14px',
        cursor: 'pointer',
      }}
    >
      {copied ? 'Copied ✓' : label}
    </button>
  );
}
