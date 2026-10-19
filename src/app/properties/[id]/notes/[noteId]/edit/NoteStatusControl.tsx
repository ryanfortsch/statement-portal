'use client';

import { useRef, useState, useTransition } from 'react';
import { reopenPropertyNote, togglePropertyNoteResolved } from '@/app/properties/actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { useConfirm } from '@/components/ConfirmDialog';

/**
 * An issue's status on its own page: open with Resolve, or resolved with
 * Reopen. The edit page is the one place a resolved issue can come back;
 * before this, Resolve had no undo anywhere.
 *
 * Both calls are explicit rather than a toggle (Resolve passes resolveOnly,
 * Reopen is its own action), so a retry after a lost response never flips
 * the issue the wrong way.
 */
export function NoteStatusControl({
  propertyId,
  noteId,
  resolved,
  guestFacing,
}: {
  propertyId: string;
  noteId: string;
  resolved: boolean;
  guestFacing: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const lock = useRef(false);
  const softRefresh = useSoftRefresh();
  const { ask } = useConfirm();
  useUnsavedWorkGuard(pending);
  const [err, setErr] = useState<string | null>(null);

  function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setErr(null);
    startTransition(async () => {
      try {
        await fn();
        softRefresh();
      } catch {
        setErr('Could not confirm the change. Reload to check before retrying.');
      } finally {
        lock.current = false;
      }
    });
  }

  async function onResolve() {
    if (guestFacing && !(await ask({
      title: 'Resolve this and take it out of the Guest KB?',
      body: 'The guest AI stops mentioning it to guests. Reopen brings it back.',
      confirmLabel: 'Resolve',
    }))) return;
    run(() => togglePropertyNoteResolved(propertyId, noteId, true));
  }

  return (
    <div
      style={{
        marginTop: 18,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
        borderTop: '1px solid var(--rule)',
        borderBottom: '1px solid var(--rule)',
        padding: '10px 0',
      }}
    >
      <span className="eyebrow" style={{ color: resolved ? 'var(--positive)' : 'var(--signal)' }}>
        {resolved ? 'Resolved' : 'Open issue'}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={resolved ? () => run(() => reopenPropertyNote(propertyId, noteId)) : onResolve}
        style={{
          background: 'transparent',
          border: '1px solid var(--rule)',
          padding: '6px 12px',
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink)',
          cursor: pending ? 'wait' : 'pointer',
          fontWeight: 500,
          minHeight: 32,
        }}
      >
        {pending ? 'Saving…' : resolved ? 'Reopen' : 'Resolve'}
      </button>
      <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>
        {resolved ? 'Reopening puts it back on Now.' : 'Resolving takes it off Now; it stays here.'}
      </span>
      {err && <span role="alert" style={{ fontSize: 11, color: 'var(--negative)' }}>{err}</span>}
    </div>
  );
}
