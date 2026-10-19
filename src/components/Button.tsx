'use client';

import type { ComponentPropsWithRef, MouseEvent, ReactNode } from 'react';
import { askThenSubmit, useConfirm, type AskOptions } from '@/components/ConfirmDialog';
import { usePendingWatchdog } from '@/lib/use-pending-watchdog';
import { buttonClass, type ButtonSize, type ButtonVariant } from '@/lib/button-class';

/**
 * The house button: four faces, one pending state.
 *
 *   primary    the one dark verb a block is for (Send, Save, Approve)
 *   secondary  an outlined alternative beside it (Edit, Coach, Retry)
 *   quiet      a text exit (Dismiss, Redraft, Mark handled)
 *   danger     an outlined red verb that removes or cancels something
 *
 * Equal boxes read as equal choices, which they rarely are, so a block has
 * one primary at most. The faces live in globals.css (.rt-btn), so hover and
 * the keyboard focus ring work, which an inline style cannot do.
 *
 * `pending` shows `pendingLabel` with three dots, sets aria-busy and holds the
 * click. It also runs SubmitButton's stuck-pending watchdog: at 10s a stale
 * bundle reloads onto the new deploy; at 30s a lost response reloads the
 * page, unless the page has unsaved work registered (a long AI draft is not
 * a lost response). `watchdog={false}` turns it off.
 *
 * `confirm` asks in the app's modal first (ConfirmDialog) and only then runs
 * onClick, or, on a type="submit" button, resubmits the form with this
 * button. The modal's confirm button defaults to this button's label.
 *
 * For a server-action form's own submit button, SubmitButton is still the
 * one: it reads the form's pending state itself. Give it the same face with
 * `className={buttonClass('primary', 'sm')}` (src/lib/button-class.ts).
 */

export type { ButtonSize, ButtonVariant };
export type ButtonConfirm = Omit<AskOptions, 'confirmLabel'> & { confirmLabel?: string };

export type ButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  pending?: boolean;
  pendingLabel?: string;
  confirm?: ButtonConfirm;
  watchdog?: boolean;
};

/** A label with three pulsing dots: which button is doing the work. */
export function LoadingLabel({ label }: { label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {label}
      <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 6, gap: 3 }}>
        <span className="rt-loading-dot" />
        <span className="rt-loading-dot" />
        <span className="rt-loading-dot" />
      </span>
    </span>
  );
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  pending = false,
  pendingLabel,
  confirm,
  watchdog = true,
  type = 'button',
  disabled,
  onClick,
  className,
  ref,
  ...rest
}: ButtonProps) {
  const { ask } = useConfirm();
  usePendingWatchdog(pending && watchdog, { yieldToUnsavedWork: true });

  const question = confirm
    ? { ...confirm, confirmLabel: confirm.confirmLabel ?? (typeof children === 'string' ? children : 'Confirm') }
    : null;

  const handleClick = async (e: MouseEvent<HTMLButtonElement>) => {
    if (pending) { e.preventDefault(); return; }
    if (!question) { onClick?.(e); return; }
    if (type === 'submit') { await askThenSubmit(e, ask, question); return; }
    if (await ask(question)) onClick?.(e);
  };

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      onClick={handleClick}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {pending ? <LoadingLabel label={pendingLabel || 'Working'} /> : children}
    </button>
  );
}
