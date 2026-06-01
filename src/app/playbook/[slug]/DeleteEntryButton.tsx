'use client';

import { deleteEntry } from '../actions';

export function DeleteEntryButton({ id, title }: { id: string; title: string }) {
  return (
    <form
      action={deleteEntry}
      onSubmit={(e) => {
        if (!confirm(`Delete "${title}"? This removes the entry and its history. This cannot be undone.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
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
        Delete
      </button>
    </form>
  );
}
