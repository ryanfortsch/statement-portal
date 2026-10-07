'use client';

import { useState } from 'react';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';

import { updateTaxCertId } from './actions';

/**
 * Inline editor for a property's MassTaxConnect occupancy-tax certificate
 * ID. Lives in the "Tax Cert ID" row on the property detail page. Saves
 * straight to `properties.tax_cert_id`; the Statements > Remittance modal
 * reads from the same column.
 */
export function TaxCertEditor({ propertyId, initial }: { propertyId: string; initial: string | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial || '');
  const [current, setCurrent] = useState(initial);
  const { pending, busy, error, setError, run } = useRecoverableAction();
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setCurrent(initial);
    if (!editing && !busy.current) setValue(initial || '');
  }
  useUnsavedWorkGuard(pending || (editing && value !== (current || '')));

  function start() {
    setValue(current || '');
    setError(null);
    setEditing(true);
  }
  function cancel() {
    if (busy.current || (value !== (current || '') && !confirm('Discard this certificate ID edit?'))) return;
    setEditing(false);
    setError(null);
  }
  function save() {
    if (busy.current) return;
    setError(null);
    const next = value.trim() || null;
    run(async () => {
      const res = await updateTaxCertId(propertyId, next);
      if (res.ok) {
        setCurrent(next);
        setEditing(false);
      } else {
        setError(res.error);
      }
    }, 'Could not confirm the certificate ID was saved. Your edit is kept; try again.');
  }

  if (!editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontFamily: 'var(--font-mono, monospace)', color: current ? 'var(--ink)' : 'var(--ink-4)' }}>
          {current || '—'}
        </span>
        <button
          type="button"
          onClick={start}
          style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
            color: 'var(--ink-3)', border: '1px solid var(--rule)', background: 'transparent',
            padding: '2px 8px', cursor: 'pointer',
          }}
        >
          Edit
        </button>
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="C0585051070"
        disabled={pending}
        autoFocus
        spellCheck={false}
        style={{
          fontFamily: 'var(--font-mono, monospace)',
          border: '1px solid var(--ink)', background: 'var(--paper)', color: 'var(--ink)',
          padding: '3px 8px', fontSize: 13, width: 180,
        }}
      />
      <button
        type="button"
        onClick={save}
        disabled={pending}
        style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
          color: 'var(--paper)', background: 'var(--ink)', border: '1px solid var(--ink)',
          padding: '3px 10px', cursor: pending ? 'wait' : 'pointer',
        }}
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={pending}
        style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
          color: 'var(--ink-3)', background: 'transparent', border: '1px solid var(--rule)',
          padding: '3px 10px', cursor: pending ? 'wait' : 'pointer',
        }}
      >
        Cancel
      </button>
      {error && <span style={{ fontSize: 11, color: 'var(--negative, #b13b2a)' }}>{error}</span>}
    </span>
  );
}
