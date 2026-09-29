'use client';

import { useRef, useState, useTransition } from 'react';
import type { RunScope } from '@/lib/work-types';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { updateWorkSlipScope } from '../actions';

type Props = {
  slipId: string;
  initialScope: RunScope | null;
  initialNote: string | null;
};

const OPTIONS: { value: RunScope; label: string; hint: string }[] = [
  { value: 'inspector', label: 'Inspector', hint: 'quick fix on a routine stop' },
  { value: 'handyman', label: 'Handyman', hint: 'bundle onto a maintenance run' },
  { value: 'pro', label: 'Pro / vendor', hint: 'licensed or specialty trade' },
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
              title={o.hint}
              style={{
                background: active ? 'var(--ink)' : 'none',
                color: active ? 'var(--paper)' : 'var(--ink)',
                border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
                padding: '5px 12px',
                fontSize: 10,
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                fontWeight: 700,
                cursor: pending ? 'default' : 'pointer',
                opacity: pending ? 0.6 : 1,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {(pending || error) && (
        <div role={error ? 'alert' : 'status'} style={{ fontSize: 11, marginTop: 8, color: error ? 'var(--negative)' : 'var(--ink-3)' }}>
          {error
            ? `${targetLabel}: ${error} Showing the last confirmed routing.`
            : `Saving routing: ${targetLabel}…`}
          {error && attempt && (
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="button" disabled={pending} onClick={() => save(attempt.scope)}>Retry routing</button>
              <button type="button" disabled={pending} onClick={() => { setAttempt(null); setError(''); }}>Dismiss</button>
            </div>
          )}
        </div>
      )}
      <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8, marginBottom: 0 }}>
        {note
          ? note
          : scope
            ? OPTIONS.find((o) => o.value === scope)?.hint
            : 'Not triaged yet. The planner will classify it on its next pass.'}
      </p>
    </div>
  );
}
