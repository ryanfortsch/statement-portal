'use client';

import { useRef } from 'react';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { deleteEntry } from '../actions';
import { useConfirm } from '@/components/ConfirmDialog';

export function DeleteEntryButton({ id, title }: { id: string; title: string }) {
  const { busy, pending, error, run } = useRecoverableAction();
  const { ask } = useConfirm();
  // A second submit while the question is open is the same click, not a new one.
  const asking = useRef(false);
  useUnsavedWorkGuard(pending);
  return (
    <form
      action={deleteEntry}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy.current || asking.current) return;
        const data = new FormData(event.currentTarget);
        asking.current = true;
        const yes = await ask({
          title: `Delete "${title}"?`,
          body: 'This removes the entry and its history from the Playbook.',
          confirmLabel: 'Delete entry',
          tone: 'danger',
          irreversible: true,
        }).finally(() => { asking.current = false; });
        if (!yes || busy.current) return;
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
