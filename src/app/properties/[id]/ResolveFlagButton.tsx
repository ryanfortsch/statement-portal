'use client';

import { useState, useTransition } from 'react';
import { resolveInspectionNote } from '@/app/inspections/actions';
import { togglePropertyNoteResolved } from '@/app/properties/actions';
import type { FlagSource } from '@/lib/property-flags';

/**
 * One Resolve verb for both note tables.
 *
 * The two stores keep their own server actions because they are two
 * different tables with two different histories; what the operator should
 * never have to know is which one a given row came from. `source` picks the
 * action; the button reads the same either way.
 *
 * Neither action deletes: the observation is preserved, it just stops being
 * open. The row disappears optimistically and comes back if the write fails,
 * so a failure is visible rather than silently swallowed.
 */
export function ResolveFlagButton({
  propertyId,
  flagId,
  source,
}: {
  propertyId: string;
  flagId: string;
  source: FlagSource;
}) {
  const [, startTransition] = useTransition();
  const [resolved, setResolved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function resolve() {
    setErr(null);
    setResolved(true);
    startTransition(async () => {
      try {
        if (source === 'walk') {
          const res = await resolveInspectionNote(flagId);
          if (!res.ok) {
            setResolved(false);
            setErr(res.error);
          }
          return;
        }
        await togglePropertyNoteResolved(propertyId, flagId);
      } catch (e) {
        setResolved(false);
        setErr(e instanceof Error ? e.message : 'Could not resolve');
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
        title="Mark resolved. The note is kept, it just stops being open."
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
      {err && <span style={{ fontSize: 10, color: 'var(--negative)' }}>{err}</span>}
    </div>
  );
}
