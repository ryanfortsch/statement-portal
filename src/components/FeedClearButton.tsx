'use client';

import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { dismissFeedItem } from '@/app/feed-actions';

/**
 * The home feed's ×, and its one meaning: hide this row from my feed. It
 * changes nothing else (the slip, the email, the payment link stay as they
 * are) and nobody else's feed. The action revalidates the home path, so the
 * row drops out and the next one backfills.
 *
 * Drawn as a 22px circle inside a 44px target, the touch size the Work board
 * holds every control to; the negative margin keeps the row its height.
 */
export function FeedClearButton({ itemType, itemId }: { itemType: string; itemId: string }) {
  const action = useRecoverableAction();
  const pending = action.pending;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
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
        width: 44,
        height: 44,
        margin: '-9px -11px -11px 0',
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: pending ? 'default' : 'pointer',
        opacity: pending ? 0.4 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          border: '1px solid var(--rule)',
          background: 'var(--paper)',
          color: 'var(--ink-4)',
          fontSize: 14,
          lineHeight: '20px',
          textAlign: 'center',
        }}
      >
        ×
      </span>
    </button>
    {action.error && <span role="alert" style={{ color: 'var(--signal)', fontSize: 12, maxWidth: 180 }}>{action.error} Click × to retry.</span>}
    </span>
  );
}
