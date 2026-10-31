'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/Button';

/**
 * The card's buttons, one set for every queue. One dark primary (send), boxed
 * secondaries (Edit, Coach), and quiet text exits (Redraft, Mark handled):
 * equal boxes read as equal choices, which they are not. The button doing the
 * work keeps full weight and says what it is doing ("Sending" with dots);
 * the others fade.
 */

export { LoadingLabel } from '@/components/Button';

type ButtonProps = {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  title?: string;
};

// The card's three faces are the house Button's (src/components/Button.tsx).
// The watchdog stays off here: a Redraft or a send can run long on the
// concierge, and the card already says why a card waits (card-wait-reason).

export function PrimaryButton({ children, onClick, disabled, loading, loadingLabel, title }: ButtonProps) {
  return (
    <Button variant="primary" size="lg" onClick={onClick} disabled={disabled} pending={loading} pendingLabel={loadingLabel} title={title} watchdog={false}>
      {children}
    </Button>
  );
}

export function SecondaryButton({ children, onClick, disabled, loading, loadingLabel, title }: ButtonProps) {
  return (
    <Button variant="secondary" onClick={onClick} disabled={disabled} pending={loading} pendingLabel={loadingLabel} title={title} watchdog={false}>
      {children}
    </Button>
  );
}

/** Text-only tertiary action, styled by .rt-quiet-btn in globals.css. */
export function QuietButton({ children, onClick, disabled, loading, loadingLabel, title }: ButtonProps) {
  return (
    <Button variant="quiet" onClick={onClick} disabled={disabled} pending={loading} pendingLabel={loadingLabel} title={title} watchdog={false}>
      {children}
    </Button>
  );
}

type LinkProps = {
  href: string;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
  /** Opens in a new tab: a page outside Helm (Guesty, Airbnb) the operator
   *  comes back from to tap the card's verb. */
  external?: boolean;
};

/** Looks like PrimaryButton, but navigates (Send a price). Another action in
 *  flight greys it out: navigating away mid-send would abandon the send. */
export function PrimaryLink({ href, children, disabled, title, external }: LinkProps) {
  return (
    <a
      href={disabled ? undefined : href}
      aria-disabled={disabled || undefined}
      onClick={disabled ? (e) => e.preventDefault() : undefined}
      title={title}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      style={{
        pointerEvents: disabled ? 'none' : undefined,
        opacity: disabled ? 0.5 : 1,
        background: 'var(--ink)',
        color: 'var(--paper)',
        border: '2px solid var(--ink)',
        padding: '13px 22px',
        fontSize: 12,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        fontWeight: 700,
        textDecoration: 'none',
        display: 'inline-block',
      }}
    >
      {children}
    </a>
  );
}

/** A secondary action that navigates, at SecondaryButton's weight. */
export function SecondaryLink({ href, children, disabled, title, external }: LinkProps) {
  return (
    <a
      href={disabled ? undefined : href}
      aria-disabled={disabled || undefined}
      onClick={disabled ? (e) => e.preventDefault() : undefined}
      title={title}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      style={{
        pointerEvents: disabled ? 'none' : undefined,
        opacity: disabled ? 0.5 : 1,
        background: 'var(--paper)',
        color: 'var(--ink-2)',
        border: '1px solid var(--ink-3)',
        padding: '10px 16px',
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        fontWeight: 500,
        textDecoration: 'none',
        display: 'inline-block',
      }}
    >
      {children}
    </a>
  );
}

/** A filled pill in the card header: a channel, a proactive kind, Queued, or
 *  the audience on the Team inbox. */
export function Pill({ label, tone, title }: { label: string; tone: string; title?: string }) {
  return (
    <span
      style={{
        fontSize: 9,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        fontWeight: 700,
        color: 'var(--paper)',
        background: tone,
        padding: '2px 7px',
        borderRadius: 2,
        whiteSpace: 'nowrap',
      }}
      title={title}
    >
      {label}
    </span>
  );
}

/** Small outlined chip for a work slip's category or priority. */
export function OutlineChip({ children, tone }: { children: ReactNode; tone?: string }) {
  const color = tone || 'var(--ink-3)';
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '.16em',
        textTransform: 'uppercase',
        color,
        border: `1px solid ${color}`,
        padding: '2px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
