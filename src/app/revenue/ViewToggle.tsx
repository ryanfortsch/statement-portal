'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';

export type RevenueView = 'pacing' | 'actuals';

/**
 * Two-segment toggle between Pacing (projected end-of-month via the smart-
 * forecast multiplier) and Actuals (booked-so-far revenue only).
 *
 * Always rendered, like BasisToggle: a control that hides itself is one the
 * operator stops trusting. When there is nothing to project, Pacing is
 * disabled and `disabledNote` says why ("at target", "nothing booked yet").
 *
 * URL-synced via ?view=pacing|actuals, matching TimeRangePicker's pattern.
 */
export function ViewToggle({ value, disabledNote = null }: { value: RevenueView; disabledNote?: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function pick(next: RevenueView) {
    if (next === value) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', next);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
    <div
      role="tablist"
      aria-label="Revenue view"
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        border: '1px solid var(--ink)',
        background: 'var(--paper)',
        opacity: pending ? 0.6 : 1,
        cursor: pending ? 'wait' : 'default',
      }}
    >
      <Segment label="Pacing" active={value === 'pacing'} onClick={() => pick('pacing')} disabled={!!disabledNote} />
      <Segment label="Actuals" active={value === 'actuals'} onClick={() => pick('actuals')} divider />
    </div>
    {disabledNote && <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{disabledNote}</span>}
    </div>
  );
}

function Segment({
  label,
  active,
  divider = false,
  disabled = false,
  onClick,
}: {
  label: string;
  active: boolean;
  divider?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onClick}
      className="font-serif"
      style={{
        background: active ? 'var(--ink)' : 'transparent',
        color: active ? 'var(--paper)' : 'var(--ink)',
        fontSize: 13,
        fontWeight: 500,
        padding: '7px 16px',
        border: 'none',
        borderLeft: divider ? '1px solid var(--ink)' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        letterSpacing: '0.01em',
        fontStyle: active ? 'italic' : 'normal',
      }}
    >
      {label}
    </button>
  );
}
