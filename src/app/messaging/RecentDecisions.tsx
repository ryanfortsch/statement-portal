'use client';

/**
 * "Decided recently": the rejects and mark-handleds from the last hours that
 * can still be reversed, right above the queue where the decision was made.
 * Dotti rejected a 65 Calderwood lead by mistake on 2026-09-20 and had no
 * way back; the card had simply vanished. Disappears when there is nothing
 * reversible. Sent replies never appear here: they are with the guest.
 */

import type { Approval } from '@/lib/stay-concierge';
import { prettifySlug, guestFirstFromDraft, relativeTimeShort, statusToneColor } from './format';
import { UndoButton } from './UndoButton';

const LABELS: Record<string, string> = {
  rejected: 'Rejected',
  manual_sent: 'Marked handled',
};

export function RecentDecisions({ items }: { items: Approval[] }) {
  if (items.length === 0) return null;
  return (
    <section
      aria-label="Decided recently"
      style={{
        border: '1px solid var(--rule)',
        padding: '12px 16px',
        marginBottom: 20,
      }}
    >
      <div className="eyebrow" style={{ color: 'var(--ink-3)', marginBottom: 6 }}>
        Decided recently · undo puts the card back as it was
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((row) => {
          const guest = row.guest_first || guestFirstFromDraft(row.draft) || 'Guest';
          const property = row.listing_name || prettifySlug(row.listing_id) || 'unknown property';
          const who = (row.decided_by || '').split('@')[0];
          const quote = row.guest_text ? ` · “${row.guest_text.slice(0, 90)}${row.guest_text.length > 90 ? '…' : ''}”` : '';
          return (
            <li
              key={row.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 0',
                borderTop: '1px solid var(--rule)',
                fontSize: 13,
              }}
            >
              <span className="eyebrow" style={{ color: statusToneColor(row.status), fontWeight: 600, minWidth: 120 }}>
                {LABELS[row.status] || row.status}
              </span>
              <span
                style={{ color: 'var(--ink-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={row.guest_text}
              >
                {guest} · {property}{quote}
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
    </section>
  );
}
