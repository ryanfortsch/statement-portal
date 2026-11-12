'use client';

import { useState, type ChangeEvent, type CSSProperties } from 'react';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { createPartnerHomeAction } from './actions';

/**
 * Add a partner home: its street address and town, and its host. Helm makes
 * the home (a partner home, run by its host, off the site) and opens its
 * property page, where the office builds the listing and works the bar.
 */

const field: CSSProperties = {
  fontSize: 13,
  padding: '6px 9px',
  border: '1px solid var(--rule)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minWidth: 0,
};

const EMPTY = { address: '', city: 'Gloucester', host_name: '', host_email: '', host_phone: '' };

export function AddPartnerHome() {
  const { notify } = useConfirm();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState(EMPTY);
  const set = (k: keyof typeof EMPTY) => (e: ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));

  async function add() {
    setBusy(true);
    try {
      const r = await createPartnerHomeAction(v);
      if (!r.ok) {
        await notify({ title: 'The home was not added', body: r.error, tone: 'danger' });
        return;
      }
      setV(EMPTY);
      setOpen(false);
      // A full load: a client push right behind a server action's
      // revalidation can land on the old payload.
      window.location.assign(`/properties/${r.id}#partner-setup`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Add a partner home
      </Button>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, maxWidth: 860, padding: '12px 0' }}>
      <input aria-label="Street address" placeholder="12 Main Street" value={v.address} onChange={set('address')} style={field} />
      <input aria-label="Town" placeholder="Gloucester" value={v.city} onChange={set('city')} style={field} />
      <input aria-label="Host's name" placeholder="The host's full name" value={v.host_name} onChange={set('host_name')} style={field} />
      <input aria-label="Host's email" placeholder="host@example.com" type="email" value={v.host_email} onChange={set('host_email')} style={field} />
      <input aria-label="Host's phone" placeholder="Phone (optional)" type="tel" value={v.host_phone} onChange={set('host_phone')} style={field} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button size="sm" variant="primary" pending={busy} pendingLabel="Adding" disabled={busy || !v.address.trim() || !v.host_name.trim() || !v.host_email.trim()} onClick={add}>
          Add the home
        </Button>
        <Button size="sm" variant="quiet" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
