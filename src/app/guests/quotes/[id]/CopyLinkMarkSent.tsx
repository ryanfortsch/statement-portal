'use client';

import { useState, useTransition } from 'react';

/**
 * The by-hand send: copies the guest link and marks the quote sent in one
 * tap, because a draft's link reads as not found until the quote is sent,
 * and nobody should have to know that. `markSent` is the server action.
 */
export function CopyLinkMarkSent({
  url,
  quoteId,
  markSent,
  primary,
}: {
  url: string;
  quoteId: string;
  markSent: (formData: FormData) => Promise<void>;
  primary?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        void navigator.clipboard?.writeText(url).catch(() => undefined);
        setCopied(true);
        start(async () => {
          const fd = new FormData();
          fd.set('id', quoteId);
          await markSent(fd);
        });
      }}
      style={{
        font: 'inherit',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '.06em',
        color: primary ? 'var(--paper)' : 'var(--ink)',
        background: primary ? 'var(--ink)' : 'transparent',
        border: '1px solid var(--ink)',
        padding: '8px 14px',
        cursor: pending ? 'default' : 'pointer',
        opacity: pending ? 0.7 : 1,
      }}
    >
      {pending ? 'Marking sent…' : copied ? 'Link copied, marked as sent' : 'Copy link to text her yourself'}
    </button>
  );
}
