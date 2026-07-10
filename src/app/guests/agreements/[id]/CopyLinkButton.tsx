'use client';

import { useState } from 'react';

/**
 * Copies the public signing URL to the clipboard. Builds the absolute URL
 * from window.location.origin at click time so the same button works on
 * localhost, previews, and production without threading the origin
 * through props.
 */
export function CopyLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}${path}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard can be denied in odd contexts; fall back to prompt.
          window.prompt('Copy the signing link:', `${window.location.origin}${path}`);
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
      {copied ? 'Copied ✓' : 'Copy signing link'}
    </button>
  );
}
