'use client';

/**
 * "Decided recently": the rejects and mark-handleds from the last hours that
 * can still be reversed. Dotti rejected a 65 Calderwood lead by mistake on
 * 2026-09-20 and had no way back; the card had simply vanished.
 *
 * 2026-09-21: the immediate undo is now the toast (UndoToast) that appears
 * the moment a card is decided. This list is the durable fallback for
 * anything older, or decided on another device, so it sits quietly UNDER
 * the queue in the page column as a plain ledger: no box, no band, three
 * rows before it folds. It used to be a bordered block above the queue,
 * rendered outside the page container, so it ran the full width of the
 * window and was the first thing on the Inbox. Disappears when there is
 * nothing reversible. Sent replies never appear here: they are with the guest.
 */

import { useState } from 'react';
import type { Approval } from '@/lib/stay-concierge';
import { prettifySlug, guestFirstFromDraft, relativeTimeShort, statusToneColor } from './format';
import { UndoButton } from './UndoButton';

const LABELS: Record<string, string> = {
  rejected: 'Rejected',
  manual_sent: 'Marked handled',
};

const DEFAULT_VISIBLE = 3;

export function RecentDecisions({ items }: { items: Approval[] }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const visible = expanded ? items : items.slice(0, DEFAULT_VISIBLE);
  const hidden = items.length - visible.length;

  return (
    <section
      aria-label="Decided recently"
      className="max-w-[1100px] mx-auto px-10"
      style={{ width: '100%', marginTop: -24, paddingBottom: 40 }}
    >
      <div
        className="eyebrow"
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          paddingBottom: 8,
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <span style={{ color: 'var(--ink-3)' }}>Decided recently</span>
        <span style={{ color: 'var(--ink-4)', textTransform: 'none', letterSpacing: '0.04em', fontSize: 11 }}>
          Undo puts the card back as it was
        </span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {visible.map((row) => {
          const guest = row.guest_first || guestFirstFromDraft(row.draft) || 'Guest';
          const property = row.listing_name || prettifySlug(row.listing_id) || 'unknown property';
          const who = (row.decided_by || '').split('@')[0];
          const quote = (row.guest_text || '').replace(/\s+/g, ' ').trim();
          return (
            <li
              key={row.id}
              className="rt-msg-decided-row"
              style={{
                display: 'grid',
                gridTemplateColumns: '112px minmax(0, 1fr) auto auto',
                alignItems: 'center',
                columnGap: 16,
                padding: '10px 0',
                borderBottom: '1px solid var(--rule-soft)',
                fontSize: 13,
              }}
            >
              <span className="eyebrow" style={{ color: statusToneColor(row.status), fontWeight: 600 }}>
                {LABELS[row.status] || row.status}
              </span>
              <span
                style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={quote || undefined}
              >
                <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{guest}</span>
                <span style={{ color: 'var(--ink-3)' }}> · {property}</span>
                {quote && <span style={{ color: 'var(--ink-4)' }}> · “{quote}”</span>}
              </span>
              <span style={{ color: 'var(--ink-4)', fontSize: 11, whiteSpace: 'nowrap' }} title={row.resolved_at || undefined}>
                {relativeTimeShort(row.resolved_at || row.created_at)}
                {who ? ` · ${who}` : ''}
              </span>
              <UndoButton approvalId={row.id} />
            </li>
          );
        })}
      </ul>
      {(hidden > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="rt-quiet-btn"
          style={{ marginTop: 10 }}
        >
          {expanded ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
    </section>
  );
}
