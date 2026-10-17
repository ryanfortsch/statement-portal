'use client';

import { useRef, useState, useTransition } from 'react';
import type { RunScope } from '@/lib/work-types';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { updateWorkSlipScope } from '../actions';
import { chipHintStyle, chipStyle, smallGhostButton, withClearHint } from './slip-controls';

type Props = {
  slipId: string;
  initialScope: RunScope | null;
  initialNote: string | null;
};

const OPTIONS: { value: RunScope; label: string; hint: string }[] = [
  { value: 'inspector', label: 'Inspector', hint: 'A quick fix on a routine visit.' },
  { value: 'handyman', label: 'Handyman', hint: 'Bundled onto a maintenance run.' },
  { value: 'pro', label: 'Pro / vendor', hint: 'A licensed or specialty trade the office books.' },
];

/**
 * Operator override for the AI's who-does-this triage. The classifier only
 * fills empty scopes, so a choice made here is final; picking the current
 * value clears back to unset (re-triaged on the next planning pass).
 */
export function SlipScopeEditor({ slipId, initialScope, initialNote }: Props) {
  const [scope, setScope] = useState<RunScope | null>(initialScope);
  const [note, setNote] = useState<string | null>(initialNote);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState<{ scope: RunScope | null } | null>(null);
  const saving = useRef(false);
  useUnsavedWorkGuard(pending || attempt !== null);

  function save(target: RunScope | null) {
    if (saving.current) return;
    saving.current = true;
    setAttempt({ scope: target });
    setError('');
    startTransition(async () => {
      try {
        const res = await updateWorkSlipScope({ id: slipId, run_scope: target });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setScope(target);
        setNote(null);
        setAttempt(null);
      } catch {
        setError('Could not confirm the routing change. Retry to apply your selection.');
      } finally {
        saving.current = false;
      }
    });
  }

  const targetLabel = attempt?.scope ? OPTIONS.find((o) => o.value === attempt.scope)?.label : 'Clear routing';

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {OPTIONS.map((o) => {
          const active = scope === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => save(o.value === scope ? null : o.value)}
              disabled={pending}
              aria-pressed={active}
              style={chipStyle(active, pending)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {((pending && attempt) || error) && (
        <div role={error ? 'alert' : 'status'} style={{ fontSize: 11, marginTop: 8, color: error ? 'var(--negative)' : 'var(--ink-3)' }}>
          {error
            ? `${targetLabel}: ${error} Showing the last confirmed routing.`
            : `Saving routing: ${targetLabel}…`}
          {error && attempt && (
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button type="button" disabled={pending} onClick={() => save(attempt.scope)} style={smallGhostButton}>Retry routing</button>
              <button type="button" disabled={pending} onClick={() => { setAttempt(null); setError(''); }} style={smallGhostButton}>Dismiss</button>
            </div>
          )}
        </div>
      )}
      <p style={chipHintStyle}>
        {note
          ? withClearHint(note, !!scope)
          : scope
            ? withClearHint(OPTIONS.find((o) => o.value === scope)?.hint ?? '', true)
            : 'Not decided yet. Helm decides on its next pass; tap a chip to decide now.'}
      </p>
    </div>
  );
}
