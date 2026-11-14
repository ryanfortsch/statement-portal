'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { addApplicationAction, declineApplicationAction } from './actions';

/**
 * An owner's two answers to a host's application (src/lib/partner-applications.ts).
 * Add makes the home, the same as Add a partner home, and opens its page.
 * Decline keeps why. Neither sends anything: the office writes to the host.
 */
export function ApplicationActions({ id, address, name }: { id: string; address: string; name: string }) {
  const { ask, askText, notify } = useConfirm();
  const softRefresh = useSoftRefresh();
  const [busy, setBusy] = useState<'add' | 'decline' | null>(null);

  async function add() {
    const yes = await ask({
      title: `Add ${address} as a partner home?`,
      body: `Helm makes the home, off the site, with ${name} as its host, and opens its page to build the listing. Nothing is sent to them.`,
      confirmLabel: 'Add the home',
    });
    if (!yes) return;
    setBusy('add');
    try {
      const r = await addApplicationAction(id);
      if (!r.ok) {
        await notify({ title: 'The home was not added', body: r.error, tone: 'danger' });
        return;
      }
      // A full load: a client push right behind a server action's
      // revalidation can land on the old payload.
      window.location.assign(`/properties/${r.id}#partner-setup`);
    } finally {
      setBusy(null);
    }
  }

  async function decline() {
    const reason = await askText({
      title: `Decline ${address}?`,
      body: 'Nothing is sent. Write to them yourself if you want to.',
      inputLabel: 'Why, for the office',
      optional: true,
      confirmLabel: 'Decline',
      tone: 'danger',
    });
    if (reason === null) return;
    setBusy('decline');
    try {
      const r = await declineApplicationAction(id, reason);
      if (!r.ok) await notify({ title: 'That did not save', body: r.error, tone: 'danger' });
      softRefresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Button size="sm" variant="primary" pending={busy === 'add'} pendingLabel="Adding" disabled={busy != null} onClick={add}>
        Add the home
      </Button>
      <Button size="sm" variant="quiet" pending={busy === 'decline'} disabled={busy != null} onClick={decline}>
        Decline
      </Button>
    </div>
  );
}
