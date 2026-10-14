'use client';

import { useRef, useState, useTransition } from 'react';
import type { WorkSlipCategory } from '@/lib/work-types';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { updateWorkSlipCategory } from '../actions';

type Props = {
  slipId: string;
  propertyId: string;
  initialCategory: WorkSlipCategory;
};

/** The categories a person files by hand. vendor and ad_hoc stay in the
 *  enum for packet code but are never offered here (same as the create
 *  modals). */
const OPTIONS: { value: WorkSlipCategory; label: string; hint: string }[] = [
  { value: 'maintenance', label: 'Maintenance', hint: 'a fix in the house; who does it is the triage below' },
  { value: 'inventory', label: 'Supply', hint: 'restock or a Rising Tide purchase' },
  { value: 'owner', label: 'Owner', hint: 'the owner buys, approves or decides first' },
  { value: 'rising_tide', label: 'Office', hint: 'desk work, nothing to do in the house' },
  { value: 'other', label: 'Other', hint: 'none of the above' },
];

/**
 * Operator override for the lane. Category is what the board, the print
 * sheet and the Field packet read the lane off (lib/work-slip-lanes.ts), so
 * moving it here moves the slip everywhere at once. A choice made here
 * stamps organized_at: the nightly pass never re-files a human's call.
 */
export function SlipCategoryEditor({ slipId, propertyId, initialCategory }: Props) {
  const softRefresh = useSoftRefresh();
  const [category, setCategory] = useState<WorkSlipCategory>(initialCategory);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const saving = useRef(false);
  useUnsavedWorkGuard(pending);

  function save(target: WorkSlipCategory) {
    if (saving.current || target === category) return;
    saving.current = true;
    setError('');
    const previous = category;
    setCategory(target);
    startTransition(async () => {
      try {
        const res = await updateWorkSlipCategory({ id: slipId, category: target, propertyId });
        if (!res.ok) {
          setCategory(previous);
          setError(res.error);
          return;
        }
        softRefresh();
      } catch {
        setCategory(previous);
        setError('Could not confirm the change. Refresh before retrying.');
      } finally {
        saving.current = false;
      }
    });
  }

  const current = OPTIONS.find((o) => o.value === category);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {OPTIONS.map((o) => {
          const active = o.value === category;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => save(o.value)}
              disabled={pending}
              aria-pressed={active}
              title={o.hint}
              style={{
                background: active ? 'var(--ink)' : 'transparent',
                color: active ? 'var(--paper)' : 'var(--ink-3)',
                border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
                padding: '6px 14px',
                fontSize: 11,
                letterSpacing: '.14em',
                textTransform: 'uppercase',
                fontWeight: 500,
                cursor: pending ? 'wait' : 'pointer',
                opacity: pending && !active ? 0.6 : 1,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {current && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-4)' }}>{current.hint}</div>}
      {error && (
        <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--negative)' }}>
          {error}
        </div>
      )}
    </div>
  );
}
