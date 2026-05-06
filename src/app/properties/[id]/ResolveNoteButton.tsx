'use client';

import { useState, useTransition } from 'react';
import { resolveInspectionNote } from '@/app/inspections/actions';

/**
 * Small "Resolve" / "x" button on a pinned property note. Calls the
 * resolveInspectionNote server action which marks the note resolved
 * (so it stops appearing on the property folder) without deleting the
 * row -- the original observation is preserved for history.
 */
export function ResolveNoteButton({ noteId }: { noteId: string }) {
  const [, startTransition] = useTransition();
  const [resolved, setResolved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function resolve() {
    setErr(null);
    setResolved(true);
    startTransition(async () => {
      const res = await resolveInspectionNote(noteId);
      if (!res.ok) {
        setResolved(false);
        setErr(res.error);
      }
    });
  }

  if (resolved && !err) {
    return (
      <span
        style={{
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--positive)',
          fontWeight: 600,
        }}
      >
        Resolved
      </span>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button
        type="button"
        onClick={resolve}
        title="Mark resolved (removes from property folder)"
        style={{
          background: 'transparent',
          border: '1px solid var(--rule)',
          padding: '4px 10px',
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        Resolve
      </button>
      {err && (
        <span style={{ fontSize: 10, color: 'var(--negative)' }}>
          {err}
        </span>
      )}
    </div>
  );
}
