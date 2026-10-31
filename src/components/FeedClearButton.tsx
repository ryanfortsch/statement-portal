'use client';

import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { dismissFeedItem } from '@/app/feed-actions';

/**
 * The home feed's secondary action: hide this row from my feed. It
 * changes nothing else (the slip, the email, the payment link stay as they
 * are) and nobody else's feed. The action revalidates the home path, so the
 * row drops out and the next one backfills.
 *
 * Kept behind a 44px actions disclosure so the item title has room on mobile.
 */
export function FeedClearButton({ itemType, itemId, itemLabel }: { itemType: string; itemId: string; itemLabel?: string }) {
  const action = useRecoverableAction();
  const pending = action.pending;
  return (
    <details className="rt-feed-actions">
    <summary aria-label={itemLabel ? `Actions for ${itemLabel}` : 'Item actions'}><span aria-hidden="true">···</span></summary>
    <div className="rt-feed-actions-panel">
    <button
      type="button"
      aria-label={action.error ? 'Retry hiding from my feed' : 'Hide from my feed'}
      title="Hide from my feed"
      disabled={pending}
      onClick={() =>
        action.run(async () => {
          const result = await dismissFeedItem(itemType, itemId);
          if (!result.ok) action.setError(result.error);
        }, 'Could not confirm the hide. Try again.')
      }
      style={{
        minWidth: 44,
        height: 44,
        padding: '0 10px',
        border: 'none',
        background: 'transparent',
        cursor: pending ? 'default' : 'pointer',
        opacity: pending ? 0.4 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span style={{ fontSize: 11, color: 'var(--ink-3)', textDecoration: 'underline', textUnderlineOffset: 3 }}>Hide from my feed</span>
    </button>
    {action.error && <span role="alert" style={{ color: 'var(--signal)', fontSize: 12, maxWidth: 180 }}>{action.error} Click Hide from my feed to retry.</span>}
    </div>
    </details>
  );
}
