'use client';

import { useRef, useState, useTransition } from 'react';
import { LANE_CHOICE_LABELS, LANE_HINTS, type WorkLane } from '@/lib/work-slip-lanes';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { updateWorkSlipLane } from '../actions';
import { chipHintStyle, chipStyle } from './slip-controls';
import { Button } from '@/components/Button';

type Props = {
  slipId: string;
  propertyId: string;
  initialLane: WorkLane;
  /** The lanes this slip can move to (laneChoicesFor), in walk order. */
  choices: WorkLane[];
};

/**
 * Whose hands: the one question the slip page asks about who does the work.
 * The six lane words are the only choices, and each writes the category,
 * run_scope and owner flag the board, the print sheet and the Field packet
 * read the lane back off (lib/work-slip-lanes.ts laneChoicePatch), so a
 * choice here moves the slip everywhere at once. Every choice stamps
 * organized_at: the nightly pass never re-files a person's call. A slip is
 * always in a lane, so there is nothing to clear; the lit chip is a no-op.
 */
export function SlipLaneEditor({ slipId, propertyId, initialLane, choices }: Props) {
  const softRefresh = useSoftRefresh();
  const [lane, setLane] = useState<WorkLane>(initialLane);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState<WorkLane | null>(null);
  const saving = useRef(false);
  useUnsavedWorkGuard(pending || attempt !== null);

  function save(target: WorkLane) {
    if (saving.current || target === lane) return;
    saving.current = true;
    setAttempt(target);
    setError('');
    startTransition(async () => {
      try {
        const res = await updateWorkSlipLane({ id: slipId, lane: target, propertyId });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setLane(target);
        setAttempt(null);
        softRefresh();
      } catch {
        setError('Could not confirm the change. Retry to apply your choice.');
      } finally {
        saving.current = false;
      }
    });
  }

  const targetLabel = attempt ? LANE_CHOICE_LABELS[attempt] : '';

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {choices.map((choice) => {
          const active = choice === lane;
          return (
            <button
              key={choice}
              type="button"
              onClick={() => save(choice)}
              disabled={pending}
              aria-pressed={active}
              style={chipStyle(active, pending)}
            >
              {LANE_CHOICE_LABELS[choice]}
            </button>
          );
        })}
      </div>
      {((pending && attempt) || error) && (
        <div role={error ? 'alert' : 'status'} style={{ fontSize: 11, marginTop: 8, color: error ? 'var(--negative)' : 'var(--ink-3)' }}>
          {error
            ? `${targetLabel}: ${error} Showing the last confirmed lane.`
            : `Moving to ${targetLabel}…`}
          {error && attempt && (
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <Button size="sm" disabled={pending} onClick={() => save(attempt)}>Retry</Button>
              <Button variant="quiet" disabled={pending} onClick={() => { setAttempt(null); setError(''); }}>Dismiss</Button>
            </div>
          )}
        </div>
      )}
      <p style={chipHintStyle}>{LANE_HINTS[lane]}</p>
    </div>
  );
}
