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
// If it's STILL pending here, the response is lost, not slow - Vercel
// sheds an action response mid-burst after committing the write ("SAVING…"
// spun 2+ minutes on 2026-08-13 while the value had landed in 11 seconds),
// and the version probe stands down when no deploy landed. Reload once: the
// page renders whatever the action committed, and a genuinely lost write just
// brings the form back to try again. Kept well above any legitimate action
// runtime (post-#1206 actions answer in seconds; publish's SMS loop is the
// slowest at a handful of seconds).
const FORCE_RELOAD_MS = 30000;

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

  // Stuck-pending watchdog, two rungs. At 10s: the version-skew check — on a
  // stale bundle this hard-reloads the tab (at most once per deploy), landing
  // on the state the action already committed. At 30s: the response is lost
  // (request shed), not slow. Re-probe for a deploy, then reload regardless.
  // Both timers clear the moment the action actually resolves.
  useEffect(() => {
    if (!status.pending) return;
    const t = setTimeout(() => void reloadedForNewDeployment(), STUCK_PENDING_MS);
    const t2 = setTimeout(async () => {
      if (await reloadedForNewDeployment()) return;
      window.location.reload();
    }, FORCE_RELOAD_MS);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
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
      name={name}
      value={value}
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
