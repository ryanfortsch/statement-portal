'use client';

import { useRef, useState, useTransition } from 'react';
import {
  WORK_SLIP_CATEGORY_HINTS,
  WORK_SLIP_CATEGORY_LABELS,
  WORK_SLIP_PICKER_CATEGORIES,
  type WorkSlipCategory,
} from '@/lib/work-types';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { updateWorkSlipCategory } from '../actions';
import { chipHintStyle, chipStyle } from './slip-controls';

type Props = {
  slipId: string;
  propertyId: string;
  initialCategory: WorkSlipCategory;
};

/** The same five words, in the same order, as the create modals: one
 *  vocabulary for the category (lib/work-types.ts). */
const OPTIONS: { value: WorkSlipCategory; label: string; hint: string }[] = WORK_SLIP_PICKER_CATEGORIES.map((value) => ({
  value,
  label: WORK_SLIP_CATEGORY_LABELS[value],
  hint: WORK_SLIP_CATEGORY_HINTS[value],
}));

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
              style={chipStyle(active, pending)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {/* A slip always has a category, so there is nothing to clear here;
          the hint says what the lit chip means. */}
      {current && <p style={chipHintStyle}>{current.hint}</p>}
      {error && (
        <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--negative)' }}>
          {error}
        </div>
      )}
    </div>
  );
}
