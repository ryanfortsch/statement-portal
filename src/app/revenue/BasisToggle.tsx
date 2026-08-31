'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';
import type { RevenueBasis } from '@/lib/revenue-nights-basis';

/**
 * Which month a dollar is counted in.
 *
 * "At checkout" is the owner-statement rule and the default: a stay's whole
 * value lands in the month it checks out. "Nights stayed" splits that same
 * money across the months the nights fall in.
 *
 * Checkout is expressed by the ABSENCE of the param, so every existing
 * bookmark and every deep link into /revenue keeps today's numbers.
 *
 * Deliberately never gated on anything. A control that hides itself is a
 * control the operator stops trusting, and unlike Pacing this one is
 * meaningful on every range.
 */
export function BasisToggle({ value }: { value: RevenueBasis }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function pick(next: RevenueBasis) {
    if (next === value) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'nights') params.set('basis', 'nights');
    else params.delete('basis');
    // Deleting the only key would otherwise leave a bare "?" on the URL.
    // ViewToggle and TimeRangePicker always .set(), so they never hit this.
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
        }}
      >
        Count by
      </span>
      <div
        role="tablist"
        aria-label="Revenue counting basis"
        style={{
          display: 'inline-flex',
          alignItems: 'stretch',
          border: '1px solid var(--ink)',
          background: 'var(--paper)',
          opacity: pending ? 0.6 : 1,
          cursor: pending ? 'wait' : 'default',
        }}
      >
        <Segment label="At checkout" active={value === 'checkout'} onClick={() => pick('checkout')} />
        <Segment label="Nights stayed" active={value === 'nights'} onClick={() => pick('nights')} divider />
      </div>
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
