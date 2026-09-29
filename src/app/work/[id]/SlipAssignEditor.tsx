'use client';

import { useRef, useState, useTransition } from 'react';
import { TeamPicker } from '@/components/TeamPicker';
import { displayNameForEmail } from '@/lib/team';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { updateWorkSlipAssignment } from '../actions';

type Props = {
  slipId: string;
  initialAssignedToEmail: string | null;
  myEmail: string;
};

/**
 * Inline assignee editor, compact enough to live in the detail page's
 * stat grid. Uses TeamPicker for the actual selection and persists via
 * the server action. The trigger keeps the last confirmed assignment
 * until a save succeeds; failed choices remain available for retry.
 */
export function SlipAssignEditor({ slipId, initialAssignedToEmail, myEmail }: Props) {
  const [value, setValue] = useState<string | null>(initialAssignedToEmail);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<{ email: string | null } | null>(null);
  const saving = useRef(false);
  useUnsavedWorkGuard(pending || attempt !== null);

  function handleChange(next: string | null) {
    if (saving.current) return;
    saving.current = true;
    const email = next?.trim() || null;
    setAttempt({ email });
    setErr(null);
    startTransition(async () => {
      try {
        const res = await updateWorkSlipAssignment({ id: slipId, assigned_to_email: email });
        if (!res.ok) {
          setErr(res.error);
          return;
        }
        setValue(email);
        setAttempt(null);
      } catch {
        setErr('Could not confirm the assignment. Retry to apply your selection.');
      } finally {
        saving.current = false;
      }
    });
  }

  const targetLabel = attempt?.email ? displayNameForEmail(attempt.email) : 'Unassigned';

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
        <div role={err ? 'alert' : 'status'} style={{ marginTop: 4, fontSize: 11, color: err ? 'var(--negative)' : 'var(--ink-4)' }}>
          {err ? `${targetLabel}: ${err} Showing the last confirmed assignment.` : `Saving assignment: ${targetLabel}…`}
          {err && attempt && (
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="button" disabled={pending} onClick={() => handleChange(attempt.email)}>Retry assignment</button>
              <button type="button" disabled={pending} onClick={() => { setAttempt(null); setErr(null); }}>Dismiss</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
