'use client';

import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { deleteEntry } from '../actions';

export function DeleteEntryButton({ id, title }: { id: string; title: string }) {
  const { busy, pending, error, run } = useRecoverableAction();
  useUnsavedWorkGuard(pending);
  return (
    <form
      action={deleteEntry}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy.current || !confirm(`Delete "${title}"? This removes the entry and its history. This cannot be undone.`)) return;
        const data = new FormData(event.currentTarget);
        run(async () => { await deleteEntry(data); }, 'Could not confirm deletion. Check the entry, then retry if it is still present.');
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        style={{
          fontSize: 13,
          fontWeight: 600,
          padding: '7px 15px',
          borderRadius: 4,
          border: '1px solid var(--rule)',
          background: 'transparent',
          color: 'var(--negative)',
          cursor: 'pointer',
        }}
      >
        {pending ? 'Deleting…' : error ? 'Retry delete' : 'Delete'}
      </button>
      {error && <p role="alert" style={{ color: 'var(--negative)' }}>{error}</p>}
    </form>
  );
}
