'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { postOfficeMessageAction } from './actions';

/**
 * The office writes in a request's conversation as Stay Cape Ann. The guest
 * and the host both see it on staycapeann.com and are emailed a link.
 */
export function OfficeReply({ id, guest }: { id: string; guest: string }) {
  const { notify } = useConfirm();
  const softRefresh = useSoftRefresh();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useUnsavedWorkGuard(text.trim().length > 0);

  async function send() {
    setBusy(true);
    try {
      const r = await postOfficeMessageAction(id, text);
      if (!r.ok) {
        await notify({ title: 'That did not go through', body: r.error, tone: 'danger' });
        return;
      }
      setText('');
      if (r.note) await notify({ title: 'Sent', body: r.note });
      softRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10, maxWidth: 720 }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={2000}
        aria-label={`Write to ${guest} and the host`}
        placeholder={`Write to ${guest} and the host`}
        style={{ width: '100%', fontSize: 13, lineHeight: 1.5, padding: '8px 10px', border: '1px solid var(--rule)', borderRadius: 4, background: 'var(--paper, #fff)', resize: 'vertical' }}
      />
      <div style={{ marginTop: 6 }}>
        <Button size="sm" variant="secondary" pending={busy} pendingLabel="Sending" disabled={!text.trim()} onClick={send}>
          Send to both
        </Button>
      </div>
    </div>
  );
}
