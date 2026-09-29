'use client';

import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { dismissFeedItem } from '@/app/feed-actions';

/**
 * Small "×" that clears one item off the home For Me feed. Calls the
 * dismissFeedItem server action inside a transition; the action revalidates
 * the home path, so the item drops out and the next one backfills.
 */
export function FeedClearButton({ itemType, itemId }: { itemType: string; itemId: string }) {
  const action = useRecoverableAction();
  const pending = action.pending;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end' }}>
    <button
      type="button"
      aria-label={action.error ? "Retry clearing from feed" : "Clear from feed"}
      title="Clear"
      disabled={pending}
      onClick={() =>
        action.run(async () => {
          const result = await dismissFeedItem(itemType, itemId);
          if (!result.ok) action.setError(result.error);
        }, 'Could not confirm the clear. Try again.')
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
    {action.error && <span role="alert" style={{ color: 'var(--signal)', fontSize: 12, maxWidth: 180 }}>{action.error} Click × to retry.</span>}
    </span>
  );
}
