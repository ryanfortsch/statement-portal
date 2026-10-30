'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/Button';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { updateWorkSlipCoordination } from '../actions';

export function SlipFollowUpEditor({ slipId, initialDate }: { slipId: string; initialDate: string | null }) {
  const [date, setDate] = useState(initialDate ?? '');
  const [saved, setSaved] = useState(initialDate ?? '');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const refresh = useSoftRefresh();
  useUnsavedWorkGuard(pending || date !== saved);
  function save() {
    const attempted = date;
    setError('');
    start(async () => {
      try {
        const res = await updateWorkSlipCoordination({ id: slipId, follow_up_date: attempted || null });
        if (!res.ok) { setError(res.error); return; }
        setSaved(attempted);
        refresh();
      } catch { setError('Could not confirm the follow-up date. Your choice is kept for retry.'); }
    });
  }
  return <div>
    <input aria-label="Next follow-up date" type="date" value={date} disabled={pending} onChange={e => setDate(e.target.value)} style={{ maxWidth: '100%', padding: 6, border: '1px solid var(--rule)', background: 'var(--paper)', fontSize: 13 }} />
    {date !== saved && <Button size="sm" pending={pending} onClick={save}>Save follow-up</Button>}
    {error && <p role="alert" style={{ fontSize: 12, color: 'var(--negative)' }}>{error}</p>}
  </div>;
}
