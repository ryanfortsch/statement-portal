'use client';

import { useTransition } from 'react';
import { dismissFeedItem } from '@/app/feed-actions';

/**
 * Small "×" that clears one item off the home For Me feed. Calls the
 * dismissFeedItem server action inside a transition; the action revalidates
 * the home path, so the item drops out and the next one backfills.
 */
export function FeedClearButton({ itemType, itemId }: { itemType: string; itemId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-label="Clear from feed"
      title="Clear"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await dismissFeedItem(itemType, itemId);
        })
      }
      style={{
        flexShrink: 0,
        width: 22,
        height: 22,
        marginTop: 2,
        borderRadius: 999,
        border: '1px solid var(--rule)',
        background: 'var(--paper)',
        color: 'var(--ink-4)',
        cursor: pending ? 'default' : 'pointer',
        opacity: pending ? 0.4 : 1,
        fontSize: 14,
        lineHeight: '18px',
        padding: 0,
        textAlign: 'center',
      }}
    >
      ×
    </button>
  );
}
