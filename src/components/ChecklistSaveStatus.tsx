'use client';

import type { ChecklistSaveStatus as Status } from '@/lib/checklist-save-queue';

export function ChecklistSaveStatus({ status, retry }: { status: Status; retry: () => Promise<boolean> }) {
  return <div aria-live="polite" style={{ fontSize: 12, marginTop: 8, color: status.failures ? 'var(--signal)' : 'var(--ink-3)' }}>
    {status.failures > 0 ? <>
      <span role="alert">Some changes could not be saved. Your edits are kept. </span>
      <button type="button" style={{ border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', padding: '4px 8px', cursor: 'pointer', fontFamily: 'inherit' }} disabled={status.saving} onClick={() => void retry()}>Retry saving</button>
    </> : status.dirty ? (status.saving ? 'Saving changes…' : 'Changes waiting to save…') : 'All changes saved.'}
  </div>;
}
