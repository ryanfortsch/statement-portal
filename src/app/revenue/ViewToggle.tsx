'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';

export type RevenueView = 'pacing' | 'actuals';

/**
 * Two-segment toggle between Pacing (projected end-of-month via the smart-
 * forecast multiplier) and Actuals (booked-so-far revenue only). Only
 * meaningful when the requested range contains an in-progress calendar
 * month; the page renders it conditionally.
 *
 * URL-synced via ?view=pacing|actuals, matching TimeRangePicker's pattern.
 */
export function ViewToggle({ value }: { value: RevenueView }) {
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
      <Segment label="Pacing" active={value === 'pacing'} onClick={() => pick('pacing')} />
      <Segment label="Actuals" active={value === 'actuals'} onClick={() => pick('actuals')} divider />
    </div>
  );
}

function Segment({
  label,
  active,
  divider = false,
  onClick,
}: {
  label: string;
  active: boolean;
  divider?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
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
        cursor: 'pointer',
        letterSpacing: '0.01em',
        fontStyle: active ? 'italic' : 'normal',
      }}
    >
      {label}
    </button>
  );
}
