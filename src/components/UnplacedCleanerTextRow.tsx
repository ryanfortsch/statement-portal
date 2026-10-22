'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/Button';
import {
  attachUnplacedCleanerTextAction,
  setAsideUnplacedCleanerTextAction,
} from '@/app/turnovers/unplaced-cleaner-actions';
import type { AttachChoices } from '@/lib/cleaner-unplaced';

/**
 * One cleaner text Helm could not place on a house, on the home feed's
 * "Cleanings to check": when, who and what they said, a house picker
 * (the homes that checked out that day first), Attach, and Set aside.
 * Attach logs the clean on that house exactly as if the text had named it;
 * the row leaves once the page re-renders. A failure is printed, never
 * swallowed.
 */
export function UnplacedCleanerTextRow({
  id,
  when,
  cleanerName,
  line,
  body,
  choices,
}: {
  id: string;
  when: string;
  cleanerName: string;
  line: string;
  body: string;
  choices: AttachChoices;
}) {
  const [house, setHouse] = useState('');
  const [busy, setBusy] = useState<'attach' | 'aside' | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const houseName = [...choices.likely, ...choices.rest].find((c) => c.id === house)?.name ?? '';

  function run(kind: 'attach' | 'aside') {
    setError('');
    setBusy(kind);
    start(async () => {
      try {
        const r =
          kind === 'attach'
            ? await attachUnplacedCleanerTextAction(id, house)
            : await setAsideUnplacedCleanerTextAction(id);
        if (!r.ok) setError(r.message ?? 'Could not save. Try again.');
      } catch {
        setError('Could not confirm the change. Refresh before retrying.');
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '12px 0',
        borderBottom: '1px solid var(--rule)',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <span aria-hidden style={{ flexShrink: 0, width: 6, height: 6, borderRadius: 999, background: 'var(--signal)' }} />
      <span
        className="font-mono"
        style={{ flexShrink: 0, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)', minWidth: 78 }}
      >
        {when}
      </span>
      <span title={body} style={{ flex: 1, minWidth: 200, fontSize: 14, color: 'var(--ink)' }}>
        <span style={{ fontWeight: 600 }}>{cleanerName}</span>
        <span style={{ color: 'var(--ink-3)' }}> · &ldquo;{line}&rdquo;</span>
      </span>
      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          aria-label="Which house"
          value={house}
          onChange={(e) => setHouse(e.target.value)}
          disabled={pending}
          style={{ border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', padding: '5px 7px', fontSize: 12 }}
        >
          <option value="">Which house?</option>
          {choices.likely.length > 0 && (
            <optgroup label="Checked out that day">
              {choices.likely.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={choices.likely.length > 0 ? 'Every other house' : 'Houses'}>
            {choices.rest.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        </select>
        <Button
          variant="primary"
          size="sm"
          disabled={!house}
          pending={busy === 'attach'}
          pendingLabel="Attaching"
          confirm={{
            title: `Attach this text to ${houseName}?`,
            body: `Helm logs it on ${houseName} the way it logs a text that names the house.`,
            confirmLabel: 'Attach',
          }}
          onClick={() => run('attach')}
        >
          Attach
        </Button>
        <Button variant="quiet" size="sm" disabled={pending} pending={busy === 'aside'} pendingLabel="Saving" onClick={() => run('aside')}>
          Set aside
        </Button>
      </span>
      {error && (
        <span role="alert" style={{ flexBasis: '100%', fontSize: 11, color: 'var(--negative)' }}>
          {error}
        </span>
      )}
    </div>
  );
}
