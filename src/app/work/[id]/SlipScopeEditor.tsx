'use client';

import { useState, useTransition } from 'react';
import type { RunScope } from '@/lib/work-types';
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

  function choose(next: RunScope) {
    const target = next === scope ? null : next;
    startTransition(async () => {
      setError('');
      const prevScope = scope;
      const prevNote = note;
      setScope(target);
      setNote(target ? null : prevNote);
      const res = await updateWorkSlipScope({ id: slipId, run_scope: target });
      if (!res.ok) {
        setScope(prevScope);
        setNote(prevNote);
        setError(res.error);
      }
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {OPTIONS.map((o) => {
          const active = scope === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => choose(o.value)}
              disabled={pending}
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
      <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8, marginBottom: 0 }}>
        {error
          ? error
          : note
            ? note
            : scope
              ? OPTIONS.find((o) => o.value === scope)?.hint
              : 'Not triaged yet. The planner will classify it on its next pass.'}
      </p>
    </div>
  );
}
