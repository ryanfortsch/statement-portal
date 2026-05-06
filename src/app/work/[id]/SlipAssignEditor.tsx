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
 * Inline assignee editor for the slip detail page. Uses TeamPicker for
 * the actual selection and persists via the server action. Optimistic
 * local state keeps the trigger snappy while the write is in flight.
 */
export function SlipAssignEditor({ slipId, initialAssignedToEmail, myEmail }: Props) {
  const [value, setValue] = useState<string | null>(initialAssignedToEmail);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function handleChange(next: string | null) {
    setValue(next);
    setErr(null);
    startTransition(async () => {
      const res = await updateWorkSlipAssignment({ id: slipId, assigned_to_email: next });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setSavedAt(Date.now());
    });
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <TeamPicker
        value={value}
        onChange={handleChange}
        myEmail={myEmail}
        placeholder="Unassigned"
        disabled={pending}
      />
      <span
        style={{
          fontSize: 11,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          color: err ? 'var(--negative)' : 'var(--ink-3)',
          minWidth: 60,
        }}
      >
        {err ? err : pending ? 'Saving…' : savedAt ? 'Saved' : ''}
      </span>
    </div>
  );
}
