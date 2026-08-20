'use client';

import { useFormStatus } from 'react-dom';

/**
 * Submit button for the AI applicant screen. Uses useFormStatus so the button
 * visibly disables and shows a spinner + "Screening…" while the server action
 * runs (the Haiku pass takes a few seconds and the bare button gave zero
 * feedback). Two variants: the dark primary "Screen N new" and the quiet
 * underline "Re-screen all". Must render inside the <form>.
 */
export function ScreenButton({ variant, label }: { variant: 'primary' | 'ghost'; label: string }) {
  const { pending } = useFormStatus();

  if (variant === 'ghost') {
    return (
      <button
        type="submit"
        disabled={pending}
        style={{ background: 'none', border: 'none', cursor: pending ? 'wait' : 'pointer', fontSize: 12, color: 'var(--ink-4)', textDecoration: 'underline', padding: 0, opacity: pending ? 0.7 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        {pending && (
          <span aria-hidden="true" className="animate-spin" style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid var(--rule)', borderTopColor: 'var(--ink-3)', borderRadius: '50%' }} />
        )}
        {pending ? 'Screening…' : label}
      </button>
    );
  }

  return (
    <button
      type="submit"
      disabled={pending}
      style={{ background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 6, cursor: pending ? 'wait' : 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '9px 18px', opacity: pending ? 0.7 : 1, display: 'inline-flex', alignItems: 'center', gap: 8 }}
    >
      {pending && (
        <span aria-hidden="true" className="animate-spin" style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(250, 247, 241, 0.35)', borderTopColor: 'var(--paper)', borderRadius: '50%' }} />
      )}
      {pending ? 'Screening…' : label}
    </button>
  );
}
