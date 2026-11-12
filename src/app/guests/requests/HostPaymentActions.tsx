'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { makeSetupLinkAction, setFeeAction } from './actions';

/**
 * A partner home's payments row: set our fee, and make the link the host
 * opens to connect their own Stripe account on staycapeann.com. The link is
 * shown once, here, to copy into an email or a text; Helm keeps only its
 * hash, so a lost link is replaced, never looked up.
 */
export function HostPaymentActions({
  propertyId,
  home,
  feePct,
  hasLink,
  connected,
}: {
  propertyId: string;
  home: string;
  feePct: number | null;
  hasLink: boolean;
  connected: boolean;
}) {
  const { ask, askText, notify } = useConfirm();
  const softRefresh = useSoftRefresh();
  const [busy, setBusy] = useState<null | 'fee' | 'link'>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onFee() {
    const raw = await askText({
      title: `Our fee at ${home}`,
      body: 'A percent of what the guest pays before occupancy tax. It comes off each charge on the host’s Stripe; the host pays Stripe’s card fee.',
      inputLabel: 'Fee, in percent',
      placeholder: feePct == null ? '10' : String(feePct),
      confirmLabel: 'Save the fee',
    });
    if (raw === null) return;
    setBusy('fee');
    try {
      const r = await setFeeAction(propertyId, raw);
      if (!r.ok) await notify({ title: 'That did not save', body: r.error, tone: 'danger' });
      softRefresh();
    } finally {
      setBusy(null);
    }
  }

  async function onLink() {
    if (hasLink || connected) {
      const yes = await ask({
        title: 'Make a new setup link?',
        body: connected
          ? 'The host already connected Stripe. A new link lets them finish what Stripe still needs; the old link stops working.'
          : 'The link already sent stops working.',
        confirmLabel: 'Make a new link',
      });
      if (!yes) return;
    }
    setBusy('link');
    try {
      const r = await makeSetupLinkAction(propertyId);
      if (!r.ok) await notify({ title: 'No link was made', body: r.error, tone: 'danger' });
      else {
        setLink(r.link);
        setCopied(false);
      }
      softRefresh();
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button size="sm" variant={feePct == null ? 'primary' : 'secondary'} pending={busy === 'fee'} pendingLabel="Saving" disabled={busy !== null} onClick={onFee}>
          {feePct == null ? 'Set the fee' : 'Change the fee'}
        </Button>
        <Button size="sm" variant={connected ? 'quiet' : 'secondary'} pending={busy === 'link'} pendingLabel="Making" disabled={busy !== null} onClick={onLink}>
          {hasLink || connected ? 'New setup link' : 'Make a setup link'}
        </Button>
      </div>
      {link && (
        <div style={{ marginTop: 10, fontSize: 12.5, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <code style={{ fontSize: 12, background: 'var(--paper-2, #f3efe6)', padding: '4px 8px', wordBreak: 'break-all' }}>{link}</code>
          <Button size="sm" variant="quiet" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <span style={{ color: 'var(--ink-4)' }}>Send it to the host. It works for 14 days and is shown only now.</span>
        </div>
      )}
    </div>
  );
}
