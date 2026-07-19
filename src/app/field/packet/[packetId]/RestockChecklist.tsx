'use client';

import { useState, useTransition } from 'react';
import { completeAttachedSlipInFlow } from '../../actions';

export type RestockItem = {
  attachmentId: string;
  title: string;
  /** One quiet qualifier line (bring list or location), if any. */
  sub: string | null;
  done: boolean;
};

/**
 * The restock slips at a stop as a one-tap checklist. These are 10-second
 * chores (grab it from the bag, put it in the closet) — they don't deserve the
 * full mark-done-with-photo card that real repairs get, and eight of those in
 * a row buried the actual work. Tap the circle, it's done; optimistic with a
 * quiet revert on failure.
 */
export function RestockChecklist({ packetId, items }: { packetId: string; items: RestockItem[] }) {
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set(items.filter((i) => i.done).map((i) => i.attachmentId)));
  const [, start] = useTransition();

  function tap(id: string) {
    if (doneIds.has(id)) return; // no un-done on attachments (matches the card behavior)
    setDoneIds((prev) => new Set([...prev, id]));
    start(async () => {
      const res = await completeAttachedSlipInFlow({ packetId, attachmentId: id, note: '', photoUrls: [] });
      if (!res.ok) {
        setDoneIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    });
  }

  const remaining = items.filter((i) => !doneIds.has(i.attachmentId)).length;

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 2 }}>
        Restock{remaining > 0 ? ` · ${remaining} to go` : ' · all done'}
      </div>
      {items.map((i) => {
        const done = doneIds.has(i.attachmentId);
        return (
          <button
            key={i.attachmentId}
            type="button"
            onClick={() => tap(i.attachmentId)}
            disabled={done}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              borderBottom: '1px solid var(--rule-soft, var(--rule))',
              padding: '10px 2px',
              cursor: done ? 'default' : 'pointer',
              minHeight: 44,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                flexShrink: 0,
                border: `2px solid ${done ? 'var(--positive)' : 'var(--rule)'}`,
                background: done ? 'var(--positive)' : 'transparent',
                color: 'var(--paper)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                lineHeight: 1,
              }}
            >
              {done ? '✓' : ''}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14.5, color: done ? 'var(--ink-4)' : 'var(--ink)', textDecoration: done ? 'line-through' : 'none' }}>
                {i.title}
              </span>
              {i.sub && !done && (
                <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-4)', marginTop: 1 }}>{i.sub}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
