'use client';

import { useFormStatus } from 'react-dom';

/**
 * Submit button for the AI campaign drafter. Uses useFormStatus so the
 * button visibly disables and changes label while the server action is
 * in flight (the AI generation takes 10 to 20 seconds and the original
 * button gave zero feedback during that wait).
 */
export function DraftButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        background: 'var(--ink)',
        color: 'var(--paper)',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        padding: '14px 28px',
        border: 'none',
        cursor: pending ? 'wait' : 'pointer',
        opacity: pending ? 0.7 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      {pending ? (
        <>
          <span aria-hidden="true" className="animate-spin" style={{
            display: 'inline-block',
            width: 14,
            height: 14,
            border: '2px solid rgba(250, 247, 241, 0.35)',
            borderTopColor: 'var(--paper)',
            borderRadius: '50%',
          }} />
          <span>Drafting (10 to 20 seconds)</span>
        </>
      ) : (
        <span>Draft with Helm →</span>
      )}
    </button>
  );
}
