'use client';

/**
 * "Decided recently": cards marked handled in the last hours that can still
 * be reversed, under the queue on every inbox (the guest queue's alone until
 * 2026-10-18). Dotti rejected a 65 Calderwood lead by mistake on 2026-09-20
 * and had no way back. The toast is the fast undo; this is the fallback for
 * anything older, or decided on another device. Three rows, then it folds.
 * Sent replies never appear here: they are with the person.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { relativeTimeShort, statusToneColor } from '@/app/messaging/format';
import type { CardResult } from './types';

export type DecidedRow = {
  id: string;
  status: string;
  name: string;
  property?: string;
  /** What they wrote, one line. */
  quote?: string;
  at?: string | null;
  decidedBy?: string;
};

// One word. A card closed without a reply is Handled whether the service
// filed it as rejected (the Reject verb, retired 2026-10-17) or manual_sent.
const LABELS: Record<string, string> = {
  rejected: 'Handled',
  manual_sent: 'Handled',
};

const DEFAULT_VISIBLE = 3;

export function DecidedRecently({ items, undo }: { items: DecidedRow[]; undo: (id: string) => Promise<CardResult> }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const visible = expanded ? items : items.slice(0, DEFAULT_VISIBLE);
  const hidden = items.length - visible.length;

  return (
    <section
      aria-label="Decided recently"
      className="max-w-[1100px] mx-auto px-10"
      style={{ width: '100%', marginTop: 8, paddingBottom: 16 }}
    >
      <div
        className="eyebrow"
        style={{ display: 'flex', alignItems: 'baseline', gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--rule)' }}
      >
        <span style={{ color: 'var(--ink-3)' }}>Decided recently</span>
        <span style={{ color: 'var(--ink-4)', textTransform: 'none', letterSpacing: '0.04em', fontSize: 11 }}>
          Undo puts the card back as it was
        </span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {visible.map((row) => {
          const who = (row.decidedBy || '').split('@')[0];
          const quote = (row.quote || '').replace(/\s+/g, ' ').trim();
          return (
            <li
              key={row.id}
              className="rt-msg-decided-row"
              style={{
                display: 'grid',
                gridTemplateColumns: '132px minmax(0, 1fr) auto auto',
                alignItems: 'center',
                columnGap: 16,
                padding: '10px 0',
                borderBottom: '1px solid var(--rule-soft)',
                fontSize: 13,
              }}
            >
              <span className="eyebrow" style={{ color: statusToneColor(row.status), fontWeight: 600, whiteSpace: 'nowrap' }}>
                {LABELS[row.status] || row.status}
              </span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={quote || undefined}>
                <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{row.name}</span>
                {row.property && <span style={{ color: 'var(--ink-3)' }}> · {row.property}</span>}
                {quote && <span style={{ color: 'var(--ink-4)' }}> · “{quote}”</span>}
              </span>
              <span style={{ color: 'var(--ink-4)', fontSize: 11, whiteSpace: 'nowrap' }} title={row.at || undefined}>
                {relativeTimeShort(row.at || '')}
                {who ? ` · ${who}` : ''}
              </span>
              <UndoButton id={row.id} undo={undo} />
            </li>
          );
        })}
      </ul>
      {(hidden > 0 || expanded) && (
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="rt-quiet-btn" style={{ marginTop: 10 }}>
          {expanded ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
    </section>
  );
}

/** Reverse a mark-handled from the ledger. A refusal reads back in plain
 *  words next to the button. */
export function UndoButton({ id, undo, label = 'Undo' }: { id: string; undo: (id: string) => Promise<CardResult>; label?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      const res = await undo(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(true);
      router.refresh();
    });
  };

  if (done) {
    return (
      <span className="eyebrow" style={{ color: 'var(--ink-3)', fontWeight: 600 }}>
        Back in queue
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        style={{
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          fontWeight: 600,
          color: 'var(--ink-2)',
          background: 'transparent',
          border: '1px solid var(--rule)',
          padding: '6px 12px',
          cursor: isPending ? 'wait' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {isPending ? 'Undoing…' : label}
      </button>
      {error && <span style={{ fontSize: 11, color: 'var(--signal, #c85a3a)', maxWidth: 260, textAlign: 'right' }}>{error}</span>}
    </span>
  );
}
