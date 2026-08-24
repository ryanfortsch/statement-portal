'use client';

import { useState, useTransition } from 'react';
import { TeamPicker } from '@/components/TeamPicker';
import { updateWorkSlipAssignment } from '../actions';

type Props = {
  slipId: string;
  initialAssignedToEmail: string | null;
  myEmail: string;
};

/**
 * Inline assignee editor, compact enough to live in the detail page's
 * stat grid. Uses TeamPicker for the actual selection and persists via
 * the server action. Optimistic local state keeps the trigger snappy
 * while the write is in flight.
 */
export function SlipAssignEditor({ slipId, initialAssignedToEmail, myEmail }: Props) {
  const [value, setValue] = useState<string | null>(initialAssignedToEmail);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handleChange(next: string | null) {
    setValue(next);
    setErr(null);
    startTransition(async () => {
      const res = await updateWorkSlipAssignment({ id: slipId, assigned_to_email: next });
      if (!res.ok) setErr(res.error);
    });
  }

  return (
    <div>
      <TeamPicker
        value={value}
        onChange={handleChange}
        myEmail={myEmail}
        placeholder="Unassigned"
        disabled={pending}
      />
      {(pending || err) && (
        <div style={{ marginTop: 4, fontSize: 11, color: err ? 'var(--negative)' : 'var(--ink-4)' }}>
          {err ?? 'Saving…'}
        </div>
      )}
    </div>
  );
}
