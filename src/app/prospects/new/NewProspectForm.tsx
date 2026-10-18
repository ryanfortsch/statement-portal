'use client';

import { useState } from 'react';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { useDraftNavigationGuard } from '@/lib/use-draft-navigation-guard';
import { createProjection } from '@/app/projections/actions';

/** Two fields: who owns it and where it is. The workroom edits the rest. */
export function NewProspectForm() {
  const [draft, setDraft] = useState({ owner_name: '', property_address: '' });
  const { busy, pending, error, setError, run } = useRecoverableAction();
  useDraftNavigationGuard(Object.values(draft).some(Boolean), pending);
  return (
    <form
      method="post"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy.current) return;
        const data = new FormData(event.currentTarget);
        run(async () => {
          const result = await createProjection(data);
          if (result?.error) setError(result.error);
        }, 'Could not confirm the prospect was created. Your entries are still here. Check the prospect list in a new tab before trying again.');
      }}
      style={{ display: 'grid', gap: 20, maxWidth: 520 }}
    >
      <label style={label}>
        <span className="eyebrow">Owner</span>
        <input
          name="owner_name"
          value={draft.owner_name}
          onChange={(e) => setDraft((d) => ({ ...d, owner_name: e.target.value }))}
          required
          disabled={pending}
          autoComplete="off"
          placeholder="John and Mary Erickson"
          style={input}
        />
      </label>
      <label style={label}>
        <span className="eyebrow">Address</span>
        <input
          name="property_address"
          value={draft.property_address}
          onChange={(e) => setDraft((d) => ({ ...d, property_address: e.target.value }))}
          required
          disabled={pending}
          autoComplete="off"
          placeholder="12 Atlantic Road, Gloucester"
          style={input}
        />
        <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>Street and town. The town sets the market.</span>
      </label>
      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--negative)', fontSize: 13.5, lineHeight: 1.5 }}>
          {error}{' '}
          <a href="/properties/prospects" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tide-deep)' }}>
            Check prospects
          </a>
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          style={{
            background: 'var(--ink)',
            color: 'var(--paper)',
            border: 'none',
            cursor: pending ? 'progress' : 'pointer',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            padding: '13px 22px',
          }}
        >
          {pending ? 'Creating…' : 'Create prospect'}
        </button>
      </div>
    </form>
  );
}

const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const input: React.CSSProperties = {
  font: 'inherit',
  fontSize: 15,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  borderBottom: '1px solid var(--ink)',
  padding: '10px 12px',
  width: '100%',
};
