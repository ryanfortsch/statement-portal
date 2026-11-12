'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { acceptRequestAction, declineRequestAction, markHostToldAction, withdrawRequestAction, type RequestActionResult } from './actions';

type Busy = null | 'accept' | 'told' | 'decline' | 'withdraw';

/**
 * The verbs on an open request: Accept (only with a card on hold and the
 * nights still open: books them, and the card is charged on the host's
 * Stripe within a minute or two), Told the host (the office passes the
 * request on by hand), Decline (asks why, emails the guest a plain no and
 * releases the hold) and Guest withdrew (closes it, emails nothing).
 */
export function RequestActions({
  id,
  guest,
  home,
  hostTold,
  canAccept,
  total,
  held,
}: {
  id: string;
  guest: string;
  home: string;
  hostTold: boolean;
  canAccept: boolean;
  total: string;
  held: boolean;
}) {
  const { ask, askText, notify } = useConfirm();
  const softRefresh = useSoftRefresh();
  const [busy, setBusy] = useState<Busy>(null);

  async function run(which: Exclude<Busy, null>, call: () => Promise<RequestActionResult>) {
    setBusy(which);
    try {
      const r = await call();
      if (!r.ok) await notify({ title: 'That did not go through', body: r.error, tone: 'danger' });
      else if (r.note) await notify({ title: 'Done', body: r.note });
      softRefresh();
    } finally {
      setBusy(null);
    }
  }

  async function onAccept() {
    const yes = await ask({
      title: `Accept ${guest}'s request?`,
      body: `Only once the host of ${home} said yes. The nights are booked on staycapeann.com, and the ${total} held on ${guest}'s card is charged on the host's own Stripe within a minute or two. ${guest} gets a confirmation email once it is.`,
      confirmLabel: `Accept and charge ${total}`,
    });
    if (!yes) return;
    await run('accept', () => acceptRequestAction(id));
  }

  async function onDecline() {
    const reason = await askText({
      title: `Decline ${guest}'s request?`,
      body: `${guest} gets an email that the host of ${home} can't take those dates and nothing was charged, with a link to other homes.${held ? ' The hold on their card is released.' : ''} Your reason stays in Helm.`,
      inputLabel: 'Why (for us)',
      placeholder: 'Host has family that week',
      optional: true,
      confirmLabel: 'Decline and email the guest',
      tone: 'danger',
    });
    if (reason === null) return;
    await run('decline', () => declineRequestAction(id, reason));
  }

  async function onWithdraw() {
    const yes = await ask({
      title: `Close ${guest}'s request?`,
      body: `Use this when the guest told us they no longer want the dates. Nothing is emailed.${held ? ' The hold on their card is released.' : ''}`,
      confirmLabel: 'Close the request',
    });
    if (!yes) return;
    await run('withdraw', () => withdrawRequestAction(id));
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {canAccept && (
        <Button size="sm" variant="primary" pending={busy === 'accept'} pendingLabel="Accepting" disabled={busy !== null} onClick={onAccept}>
          Accept
        </Button>
      )}
      {!hostTold && (
        <Button size="sm" variant={canAccept ? 'secondary' : 'primary'} pending={busy === 'told'} pendingLabel="Saving" disabled={busy !== null} onClick={() => run('told', () => markHostToldAction(id))}>
          Told the host
        </Button>
      )}
      <Button size="sm" variant="danger" pending={busy === 'decline'} pendingLabel="Declining" disabled={busy !== null} onClick={onDecline}>
        Decline
      </Button>
      <Button size="sm" variant="quiet" pending={busy === 'withdraw'} pendingLabel="Closing" disabled={busy !== null} onClick={onWithdraw}>
        Guest withdrew
      </Button>
    </div>
  );
}
