'use client';

import { useRef, useState, useTransition } from 'react';
import { resolveInspectionNote } from '@/app/inspections/actions';
import { togglePropertyNoteResolved } from '@/app/properties/actions';
import type { FlagSource } from '@/lib/property-flags';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { useConfirm } from '@/components/ConfirmDialog';

/**
 * One Resolve verb for both note tables.
 *
 * The two stores keep their own server actions because they are two
 * different tables with two different histories; what the operator should
 * never have to know is which one a given row came from. `source` picks the
 * action; the button reads the same either way.
 *
 * Neither action deletes: the observation is preserved, it just stops being
 * open. Show Resolved only after confirmation; a retry must never toggle a
 * successfully resolved property note back open after a lost response.
 */
export function ResolveFlagButton({
  propertyId,
  flagId,
  source,
  guestFacing = false,
}: {
  propertyId: string;
  flagId: string;
  source: FlagSource;
  /**
   * The issue is in the Guest KB, so resolving it also stops the guest AI
   * telling guests about it. Said once, before the tap lands.
   */
  guestFacing?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const lock = useRef(false);
  const softRefresh = useSoftRefresh();
  const { ask } = useConfirm();
  useUnsavedWorkGuard(pending);
  const [resolved, setResolved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function resolve() {
    if (lock.current || resolved) return;
    if (guestFacing && !(await ask({
      title: 'Resolve this and take it out of the Guest KB?',
      body: 'The guest AI stops mentioning it to guests. You can reopen it from its own page.',
      confirmLabel: 'Resolve',
    }))) return;
    if (lock.current) return;
    lock.current = true;
    setErr(null);
    startTransition(async () => {
      try {
        if (source === 'walk') {
          const res = await resolveInspectionNote(flagId);
          if (!res.ok) {
            setErr(res.error);
            return;
          }
        } else {
          await togglePropertyNoteResolved(propertyId, flagId, true);
        }
        setResolved(true);
        softRefresh();
      } catch {
        setErr('Could not confirm resolution. Check the flag before retrying.');
      } finally {
        lock.current = false;
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
        disabled={pending}
        onClick={resolve}
        title="Mark resolved. The issue is kept and can be reopened from its page."
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
        {pending ? 'Resolving…' : 'Resolve'}
      </button>
      {err && <span role="alert" style={{ fontSize: 10, color: 'var(--negative)' }}>{err}</span>}
    </div>
  );
}
