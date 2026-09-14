'use client';

import { useState } from 'react';
import { markLinkCopiedAction } from './payment-link-actions';

/**
 * Copy a payment-link URL. When `requestKey` is given the copy is recorded as
 * the link's delivery (sent_via 'copied'), so a link the operator chose not
 * to text stops showing as unsent once she has it on the clipboard.
 */
export function CopyLinkButton({
  url,
  requestKey,
  label = 'Copy link',
  style,
}: {
  url: string;
  requestKey?: string;
  label?: string;
  style?: React.CSSProperties;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      if (requestKey) void markLinkCopiedAction(requestKey);
    } catch {
      // Clipboard blocked (non-secure context): the URL is on screen anyway.
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      style={{
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        fontWeight: 600,
        color: 'var(--ink)',
        background: 'transparent',
        border: '1px solid var(--rule)',
        padding: '4px 9px',
        cursor: 'pointer',
        ...style,
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}
