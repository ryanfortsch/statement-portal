'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { DoNotHostLine } from '@/components/DoNotHostLine';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import type { DoNotHostNote } from '@/lib/do-not-host';
import { clearDoNotHost, setDoNotHost } from '../actions';

/**
 * Do not host again, on the guest record's header. One verb each way:
 *
 *   Do not host again   asks why in the app's dialog (the reason is
 *                       required; it prints beside the flag everywhere this
 *                       guest appears), then writes the flag
 *   Undo                on a flagged record, beside the red line
 *
 * Owners and staff may both use it. The line and the Undo show at once
 * after a set, before the page's refresh catches up; the server's answer
 * replaces them on the next render.
 */
type Props = {
  contactId: string;
  name: string;
  /** The record's flag as rendered, or null when the guest is not flagged. */
  flag: DoNotHostNote | null;
};

export function DoNotHostControl({ contactId, name, flag }: Props) {
  const { ask, askText } = useConfirm();
  const softRefresh = useSoftRefresh();
  const [pending, setPending] = useState<'set' | 'clear' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What this control wrote, until the server's flag prop moves on from the
  // one it was written against. No effect needed: a new prop ends it.
  const [override, setOverride] = useState<{ against: DoNotHostNote | null; flag: DoNotHostNote | null } | null>(null);
  const shown = override && override.against === flag ? override.flag : flag;

  async function flagGuest() {
    const reason = await askText({
      title: `Do not host ${name} again?`,
      body: 'A red line with your reason follows this guest everywhere Helm names them: this record, their messages, their bookings, and a text from their number. It blocks nothing by itself; the channels do that.',
      inputLabel: 'Why',
      placeholder: 'Harassed the team by text after checkout',
      confirmLabel: 'Flag this guest',
      tone: 'danger',
    });
    if (reason == null) return;
    setPending('set');
    setError(null);
    try {
      const res = await setDoNotHost({ id: contactId, reason });
      if (!res.ok) { setError(res.error); return; }
      setOverride({ against: flag, flag: { reason: reason.trim(), set_by: 'you', set_at: new Date().toISOString() } });
      softRefresh();
    } catch {
      setError('Could not confirm the flag. Reload the record before trying again.');
    } finally {
      setPending(null);
    }
  }

  async function undo() {
    const ok = await ask({
      title: `Host ${name} again?`,
      body: 'Removes the red line everywhere it shows. The decision and its reason stay in the timeline.',
      confirmLabel: 'Remove flag',
    });
    if (!ok) return;
    setPending('clear');
    setError(null);
    try {
      const res = await clearDoNotHost({ id: contactId });
      if (!res.ok) { setError(res.error); return; }
      setOverride({ against: flag, flag: null });
      softRefresh();
    } catch {
      setError('Could not confirm the undo. Reload the record before trying again.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {shown ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <DoNotHostLine reason={shown.reason} set_by={shown.set_by} set_at={shown.set_at} />
          <Button variant="quiet" size="sm" pending={pending === 'clear'} pendingLabel="Removing" onClick={undo}>
            Undo
          </Button>
        </div>
      ) : (
        <div>
          <Button variant="danger" size="sm" pending={pending === 'set'} pendingLabel="Flagging" onClick={flagGuest}>
            Do not host again
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--signal)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
