'use client';

import { useState, useTransition } from 'react';
import { updateWorkSlipStatus } from '@/app/work/actions';
import type { WorkSlipRow } from '@/lib/work-types';
import { WORK_SLIP_CATEGORY_LABELS } from '@/lib/work-types';

/**
 * One row on the property's work-slip checklist. Two faces:
 *
 *   - On screen (especially mobile): the tick box is tappable. One tap
 *     marks the slip done — the row optimistically dims + strikes through
 *     and the box fills with a check. The server action runs in the
 *     background; if it errors, the visual reverts. Lets you walk the
 *     property, see what's already handled, and check it off in-line
 *     without bouncing to /work/[id] for each one.
 *
 *   - On paper (print): the `@media print` block in the parent page
 *     forces the box back to empty and the row back to crisp ink, so
 *     printing always yields a fresh paper checklist regardless of
 *     what's been ticked on screen.
 *
 * One-way for v1: once you mark a slip done, the tick box locks. Undo
 * is on the slip detail page (/work/[id]).
 */
export function SlipRow({ slip, number }: { slip: WorkSlipRow; number: number }) {
  const [done, setDone] = useState(slip.status === 'done');
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handleTick() {
    if (done || isPending) return;
    setDone(true);
    setErr(null);
    startTransition(async () => {
      const res = await updateWorkSlipStatus({ id: slip.id, status: 'done' });
      if (!res.ok) {
        setDone(false);
        setErr(res.error);
      }
    });
  }

  const priorityColor =
    slip.priority === 'high'
      ? 'var(--negative)'
      : slip.priority === 'low'
        ? 'var(--ink-4)'
        : 'var(--ink-3)';

  return (
    <div
      className={`ws-pdf-row ${done ? 'ws-pdf-row-done' : ''}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '36px 1fr auto',
        gap: 18,
        padding: '14px 0',
        borderBottom: '1px solid var(--rule)',
        alignItems: 'flex-start',
        opacity: done ? 0.5 : 1,
        transition: 'opacity 120ms',
      }}
    >
      {/* Tick box — tappable on screen, always empty on print */}
      <button
        type="button"
        onClick={handleTick}
        disabled={done || isPending}
        aria-pressed={done}
        aria-label={done ? `${slip.title} marked done` : `Mark ${slip.title} done`}
        className="ws-tick"
        style={{
          width: 28,
          height: 28,
          marginTop: 2,
          border: '1.5px solid var(--ink)',
          background: done ? 'var(--ink)' : 'transparent',
          color: 'var(--paper)',
          cursor: done ? 'default' : 'pointer',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          lineHeight: 1,
          fontWeight: 700,
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span className="ws-tick-mark" style={{ display: done ? 'inline' : 'none' }}>
          ✓
        </span>
      </button>

      <div
        className="ws-pdf-row-body"
        style={{
          textDecoration: done ? 'line-through' : 'none',
          textDecorationColor: 'var(--ink-3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span
            className="font-mono"
            style={{ fontSize: 10, letterSpacing: '.06em', color: 'var(--ink-4)' }}
          >
            {String(number).padStart(2, '0')}
          </span>
          <span
            style={{
              fontSize: 14,
              color: 'var(--ink)',
              fontWeight: 500,
              lineHeight: 1.35,
            }}
          >
            {slip.title}
          </span>
        </div>
        {slip.location && (
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-3)' }}>
            Location: {slip.location}
          </div>
        )}
        {slip.action_summary && (
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--signal)', fontWeight: 600 }}>
            {slip.action_summary}
          </div>
        )}
        {slip.description && (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              color: 'var(--ink-3)',
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
            }}
          >
            {slip.description}
          </div>
        )}
        {err && (
          <div
            data-no-print
            role="alert"
            style={{ marginTop: 6, fontSize: 11, color: 'var(--negative)' }}
          >
            Couldn&rsquo;t mark done: {err}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right' }}>
        <div
          style={{
            fontSize: 9,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            fontWeight: 600,
            color: priorityColor,
          }}
        >
          {slip.priority}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 9,
            letterSpacing: '.14em',
            textTransform: 'uppercase',
            color: 'var(--ink-4)',
          }}
        >
          {WORK_SLIP_CATEGORY_LABELS[slip.category] ?? slip.category}
        </div>
        <div
          className="font-mono"
          style={{
            marginTop: 8,
            fontSize: 9,
            letterSpacing: '.04em',
            color: 'var(--ink-4)',
          }}
        >
          /work/{slip.id.slice(0, 8)}
        </div>
      </div>
    </div>
  );
}
