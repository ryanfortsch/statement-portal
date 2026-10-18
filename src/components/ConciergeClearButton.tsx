'use client';

import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { clearConciergeAlert } from '@/app/feed-actions';

/**
 * Clears a concierge alert for everyone, and says so. Not an ×: the × on the
 * home feed hides a row from one person's feed and nothing else, and an
 * alert somebody handled is handled for the whole team.
 */
export function ConciergeClearButton({ itemKey }: { itemKey: string }) {
  const action = useRecoverableAction();
  const pending = action.pending;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
      <button
        type="button"
        className="rt-quiet-btn"
        disabled={pending}
        onClick={() =>
          action.run(async () => {
            const result = await clearConciergeAlert(itemKey);
            if (!result.ok) action.setError(result.error);
          }, 'Could not confirm the clear. Try again.')
        }
        style={{ whiteSpace: 'nowrap', opacity: pending ? 0.5 : 1 }}
      >
        {pending ? 'Clearing…' : action.error ? 'Retry' : 'Clear for everyone'}
      </button>
      {action.error && <span role="alert" style={{ color: 'var(--signal)', fontSize: 12, maxWidth: 200 }}>{action.error}</span>}
    </span>
  );
}
