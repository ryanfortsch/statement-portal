'use client';

import { useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { reloadedForNewDeployment } from '@/lib/version-skew';

// If a form action stays pending this long, suspect a stale bundle: after a
// deploy, an old tab's action still commits server-side but the response
// can't apply client-side, so the spinner runs forever ("Mark paid spinning
// for minutes", 2026-08-04). Long enough that a legitimately slow action
// (approve sending reports, publish texting inspectors) won't trip it.
const STUCK_PENDING_MS = 10000;

/**
 * House submit button for server-action forms: visibly disables and shows a
 * spinner + busy label while the action runs. Generalized from the field
 * portal's PendingButton (src/app/field/packet/[packetId]/PendingButton.tsx,
 * now a re-export of this) after the 2026-07-07 feedback that mutating
 * buttons across Helm gave no signal while multi-second actions ran.
 *
 * Must render as a DESCENDANT of the <form action={...}> it submits —
 * useFormStatus reads the nearest ancestor form. In a form with multiple
 * submit buttons (a formAction per button), every button still disables
 * while the form is pending (correct: the form can only run one action),
 * but the busy label + spinner only show on the button whose formAction
 * actually fired (useFormStatus exposes the in-flight action reference).
 *
 * spinnerTone: 'paper' for dark/ink-ground buttons (default, matches the
 * original), 'ink' for light/ghost buttons where a paper spinner would be
 * invisible.
 */
export function SubmitButton({
  label,
  busyLabel,
  style,
  className,
  disabled,
  spinnerTone = 'paper',
  formAction,
}: {
  label: React.ReactNode;
  busyLabel: string;
  style?: React.CSSProperties;
  className?: string;
  disabled?: boolean;
  spinnerTone?: 'paper' | 'ink';
  formAction?: React.ComponentProps<'button'>['formAction'];
}) {
  const status = useFormStatus();
  // In a multi-button form, only the button whose formAction is in flight
  // shows the busy label/spinner; the others just disable.
  const mine = !formAction || status.action === formAction;
  const busy = status.pending && mine && !disabled;
  const lockout = status.pending && !disabled;

  // Stuck-pending watchdog: a spinner that outlives any reasonable action
  // runs the version-skew check. On a stale bundle this hard-reloads the
  // tab (at most once per deploy), landing on the state the action already
  // committed; when versions match it does nothing, so a genuinely slow
  // action or flaky network keeps its normal behavior.
  useEffect(() => {
    if (!status.pending) return;
    const t = setTimeout(() => void reloadedForNewDeployment(), STUCK_PENDING_MS);
    return () => clearTimeout(t);
  }, [status.pending]);
  const s = style ?? {};
  const spinner =
    spinnerTone === 'ink'
      ? { border: '2px solid rgba(30,46,52,0.25)', borderTopColor: 'var(--ink)' }
      : { border: '2px solid rgba(245,239,226,0.4)', borderTopColor: 'var(--paper)' };
  return (
    <button
      type="submit"
      formAction={formAction}
      disabled={disabled || lockout}
      aria-busy={busy || undefined}
      className={className}
      style={{
        ...s,
        cursor: busy ? 'wait' : disabled ? (s.cursor ?? 'not-allowed') : (s.cursor ?? 'pointer'),
        opacity: busy ? 0.85 : s.opacity ?? 1,
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
          style={{ display: 'inline-block', width: 13, height: 13, borderRadius: '50%', ...spinner }}
        />
      )}
      {busy ? busyLabel : label}
    </button>
  );
}
