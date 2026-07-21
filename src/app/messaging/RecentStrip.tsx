'use client';

/**
 * The resolved-in-the-last-24h activity list. Formerly its own "Last 24
 * hours" section; now rendered inside the Performance section's
 * "Last 24 hours" tab (PerformanceDropdown), so the queue is the only
 * thing above the fold and everything analytical lives in one place.
 */

import { useState } from 'react';
import type { Approval } from '@/lib/stay-concierge';
import { prettifySlug, guestFirstFromDraft, statusToneColor, relativeTimeShort } from './format';

const STATUS_LABELS: Record<string, string> = {
  approved: 'Sent',
  rejected: 'Rejected',
  // Covers both "she replied in Guesty" (poller-captured) and "she replied
  // from the Helm thread composer" (which resolves pending drafts the same way).
  manual_sent: 'Replied manually',
  superseded: 'Coached & regenerated',
  auto_rejected_stale: 'Auto-pruned (stale)',
  courtesy_ack: 'No reply needed',
};

const DEFAULT_VISIBLE = 8;

export function RecentList({ recent }: { recent: Approval[] }) {
  const [expanded, setExpanded] = useState(false);

  if (recent.length === 0) {
    return (
      <div style={{ padding: '16px 0', fontSize: 13, color: 'var(--ink-4)' }}>
        Nothing resolved in the last 24 hours yet.
      </div>
    );
  }

  const visible = expanded ? recent : recent.slice(0, DEFAULT_VISIBLE);
  const hasMore = recent.length > DEFAULT_VISIBLE;

  return (
    <>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
        }}
      >
        {visible.map((row) => {
          const statusLabel = STATUS_LABELS[row.status] || row.status;
          const statusColor = statusToneColor(row.status);
          const propertyLabel =
            row.listing_name ||
            prettifySlug(row.listing_id) ||
            'unknown property';
          const guestLabel =
            row.guest_first ||
            guestFirstFromDraft(row.draft) ||
            'Guest';
          const ts = row.resolved_at || row.created_at;
          const relTime = relativeTimeShort(ts);
          const absTime = ts || undefined;
          return (
            <li
              key={row.id}
              style={{
                borderBottom: '1px solid var(--rule)',
                padding: '12px 0',
                display: 'grid',
                gridTemplateColumns: '180px 1fr 80px 170px',
                gap: 12,
                alignItems: 'baseline',
                fontSize: 13,
              }}
              className="rt-msg-recent-row"
            >
              <span style={{ color: 'var(--ink-3)' }}>
                {guestLabel} · {propertyLabel}
              </span>
              <span
                style={{
                  color: 'var(--ink-2)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={row.draft || row.guest_text}
              >
                {row.draft || row.guest_text || ''}
              </span>
              <span
                style={{
                  color: 'var(--ink-4)',
                  fontSize: 11,
                  textAlign: 'right',
                  whiteSpace: 'nowrap',
                }}
                title={absTime}
              >
                {relTime}
              </span>
              <span
                className="eyebrow"
                style={{
                  color: statusColor,
                  textAlign: 'right',
                  fontWeight: 600,
                }}
              >
                {statusLabel}
              </span>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            paddingTop: 14,
          }}
        >
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            style={{
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              fontWeight: 600,
              color: 'var(--ink-3)',
              background: 'transparent',
              border: '1px solid var(--rule)',
              padding: '8px 16px',
              cursor: 'pointer',
            }}
          >
            {expanded
              ? `Show less ▴`
              : `Show all ${recent.length} ▾`}
          </button>
        </div>
      )}
    </>
  );
}
