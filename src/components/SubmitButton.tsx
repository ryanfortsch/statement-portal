'use client';

import { useFormStatus } from 'react-dom';
import { usePendingWatchdog } from '@/lib/use-pending-watchdog';
import { askThenSubmit, useConfirm, type AskOptions } from '@/components/ConfirmDialog';
import { askFromSentence } from '@/lib/confirm-question';

/**
 * House submit button for server-action forms: visibly disables and shows a
 * spinner + busy label while the action runs.
 *
 * `confirm`: a sentence that states the EFFECT of an irreversible or
 * outward-facing action ("pulls the door codes", "re-texts the roster"). The
 * click asks first, in the app's confirm modal, and submits only on yes; the
 * modal's confirm button carries this button's label. A string is split at
 * its first "? " into the question and what it does; pass an object instead
 * for a red button, "This cannot be undone." or a typed-word gate. Keep it to
 * what the action does; the button label already says what it is. Generalized from the field
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
 * name/value: for a multi-submit form sharing ONE action where the buttons
 * differ only by submitter value (e.g. mode=publish vs mode=draft), pass
 * them here — the submitter's entry lands in useFormStatus's in-flight
 * FormData, so only the clicked button shows the busy label.
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
  name,
  value,
  confirm: confirmText,
}: {
  label: React.ReactNode;
  busyLabel: string;
  style?: React.CSSProperties;
  className?: string;
  disabled?: boolean;
  spinnerTone?: 'paper' | 'ink';
  formAction?: React.ComponentProps<'button'>['formAction'];
  name?: string;
  value?: string;
  confirm?: string | ConfirmSpec;
}) {
  const status = useFormStatus();
  // In a multi-button form, only the button whose formAction is in flight
  // shows the busy label/spinner; the others just disable. Same for shared-
  // action forms whose buttons differ by submitter name/value.
  const mine =
    (!formAction || status.action === formAction) &&
    (!name || value === undefined || !status.data || status.data.get(name) === value);
  const busy = status.pending && mine && !disabled;
  const lockout = status.pending && !disabled;
  const { ask } = useConfirm();

  // The question opens in the app's modal (ConfirmDialog), so the click is
  // held, and a yes resubmits the form with this button as the submitter:
  // its formAction and name/value ride along exactly as a plain click's.
  const spec: ConfirmSpec | null = !confirmText ? null : typeof confirmText === 'string' ? askFromSentence(confirmText) : confirmText;
  const askFirst = spec
    ? (e: React.MouseEvent<HTMLButtonElement>) => askThenSubmit(e, ask, {
        ...spec,
        confirmLabel: spec.confirmLabel ?? (typeof label === 'string' ? label : 'Confirm'),
      })
    : undefined;

  usePendingWatchdog(status.pending);
  const s = style ?? {};
  const spinner =
    spinnerTone === 'ink'
      ? { border: '2px solid rgba(30,46,52,0.25)', borderTopColor: 'var(--ink)' }
      : { border: '2px solid rgba(245,239,226,0.4)', borderTopColor: 'var(--paper)' };
  return (
    <button
      type="submit"
      formAction={formAction}
      name={name}
      value={value}
      disabled={disabled || lockout}
      aria-busy={busy || undefined}
      onClick={askFirst}
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

/** A confirm spec for SubmitButton: ConfirmDialog's options, the verb optional. */
export type ConfirmSpec = Omit<AskOptions, 'confirmLabel'> & { confirmLabel?: string };
