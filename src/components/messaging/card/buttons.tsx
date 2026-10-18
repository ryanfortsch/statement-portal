'use client';

import type { ReactNode } from 'react';

/**
 * The card's buttons, one set for every queue. One dark primary (send), boxed
 * secondaries (Edit, Coach), and quiet text exits (Redraft, Mark handled):
 * equal boxes read as equal choices, which they are not. The button doing the
 * work keeps full weight and says what it is doing ("Sending" with dots);
 * the others fade.
 */

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

type ButtonProps = {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  title?: string;
};

export function PrimaryButton({ children, onClick, disabled, loading, loadingLabel, title }: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={loading || undefined}
      title={title}
      style={{
        background: disabled && !loading ? 'var(--ink-4)' : 'var(--ink)',
        color: 'var(--paper)',
        border: '2px solid var(--ink)',
        padding: '13px 22px',
        fontSize: 12,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled && !loading ? 0.7 : 1,
      }}
    >
      {loading ? <LoadingLabel label={loadingLabel || 'Working'} /> : children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, disabled, loading, loadingLabel, title }: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={loading || undefined}
      title={title}
      style={{
        background: loading ? 'var(--paper-2)' : 'var(--paper)',
        color: loading ? 'var(--ink)' : 'var(--ink-2)',
        border: loading ? '1px solid var(--ink)' : '1px solid var(--ink-3)',
        padding: '10px 16px',
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled && !loading ? 0.5 : 1,
      }}
    >
      {loading ? <LoadingLabel label={loadingLabel || 'Working'} /> : children}
    </button>
  );
}

/** Text-only tertiary action, styled by .rt-quiet-btn in globals.css. */
export function QuietButton({ children, onClick, disabled, loading, loadingLabel, title }: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={loading || undefined}
      title={title}
      className="rt-quiet-btn"
    >
      {loading ? <LoadingLabel label={loadingLabel || 'Working'} /> : children}
    </button>
  );
}

type LinkProps = { href: string; children: ReactNode; disabled?: boolean; title?: string };

/** Looks like PrimaryButton, but navigates (Send a price). Another action in
 *  flight greys it out: navigating away mid-send would abandon the send. */
export function PrimaryLink({ href, children, disabled, title }: LinkProps) {
  return (
    <a
      href={disabled ? undefined : href}
      aria-disabled={disabled || undefined}
      onClick={disabled ? (e) => e.preventDefault() : undefined}
      title={title}
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
export function SecondaryLink({ href, children, disabled, title }: LinkProps) {
  return (
    <a
      href={disabled ? undefined : href}
      aria-disabled={disabled || undefined}
      onClick={disabled ? (e) => e.preventDefault() : undefined}
      title={title}
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
