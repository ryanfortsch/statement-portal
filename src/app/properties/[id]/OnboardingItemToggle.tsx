'use client';

import { useTransition } from 'react';
import { setOnboardingItemAction } from './onboarding-actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import type { OnboardingItemStatus } from '@/lib/onboarding-items';

/**
 * Status control for one onboarding catalog item. Auto-derived items render
 * a static ✓ (no row needed); manual items get Done / N/A toggles. Clicking
 * the active state clears it back to todo.
 */
export function OnboardingItemToggle({
  propertyId,
  itemKey,
  status,
  derived,
}: {
  propertyId: string;
  itemKey: string;
  /** Effective status: manual row if present, else derived/todo. */
  status: OnboardingItemStatus;
  /** True when the status came from live data, not an operator row. */
  derived: boolean;
}) {
  const [pending, start] = useTransition();
  const softRefresh = useSoftRefresh();

  if (derived) {
    return (
      <span
        title="Derived from live data"
        style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--positive)', whiteSpace: 'nowrap' }}
      >
        ✓ Auto
      </span>
    );
  }

  function set(next: OnboardingItemStatus) {
    start(async () => {
      await setOnboardingItemAction({ propertyId, itemKey, status: next });
      softRefresh();
    });
  }

  const btn = (label: string, value: OnboardingItemStatus, activeColor: string): React.ReactNode => {
    const active = status === value;
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => set(active ? 'todo' : value)}
        style={{
          background: active ? activeColor : 'none',
          color: active ? 'var(--paper)' : 'var(--ink-4)',
          border: `1px solid ${active ? activeColor : 'var(--rule)'}`,
          padding: '3px 9px',
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          cursor: pending ? 'wait' : 'pointer',
          opacity: pending ? 0.6 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <span style={{ display: 'inline-flex', gap: 6, flexShrink: 0 }}>
      {btn('Done', 'done', 'var(--positive)')}
      {btn('N/A', 'n_a', 'var(--ink-4)')}
    </span>
  );
}
