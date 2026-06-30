'use client';

import { useFormStatus } from 'react-dom';

/**
 * Submit button for the packet page's server-action forms (claim, start a stop,
 * submit the packet). Uses useFormStatus so the button visibly disables and
 * shows a spinner + busy label while the action runs (claim/submit do real work
 * then redirect, which felt like a dead link with no feedback). All three
 * buttons are dark grounds with paper text, so the spinner is paper-toned.
 */
export function PendingButton({
  label,
  busyLabel,
  style,
  disabled,
}: {
  label: React.ReactNode;
  busyLabel: string;
  style: React.CSSProperties;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const busy = pending && !disabled;
  return (
    <button
      type="submit"
      disabled={disabled || busy}
      style={{
        ...style,
        cursor: busy ? 'wait' : disabled ? (style.cursor ?? 'not-allowed') : 'pointer',
        opacity: busy ? 0.85 : style.opacity ?? 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
      }}
    >
      {busy && (
        <span
          aria-hidden
          className="animate-spin"
          style={{ display: 'inline-block', width: 13, height: 13, border: '2px solid rgba(245,239,226,0.4)', borderTopColor: 'var(--paper)', borderRadius: '50%' }}
        />
      )}
      {busy ? busyLabel : label}
    </button>
  );
}
