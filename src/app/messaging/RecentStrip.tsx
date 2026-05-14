'use client';

import { Section } from '@/components/Section';
import type { Approval } from '@/lib/stay-concierge';
import { prettifySlug, guestFirstFromDraft, statusToneColor } from './format';

type Props = {
  initialRecent: Approval[];
};

const STATUS_LABELS: Record<string, string> = {
  approved: 'Sent',
  rejected: 'Rejected',
  manual_sent: 'Sent via Guesty',
  superseded: 'Coached & regenerated',
  auto_rejected_stale: 'Auto-pruned (stale)',
  courtesy_ack: 'No reply needed',
};

export function RecentStrip({ initialRecent }: Props) {
  if (initialRecent.length === 0) {
    return null;
  }

  return (
    <Section
      title="Last 24 hours"
      eyebrow={`${initialRecent.length} resolved`}
      paddingTop={36}
    >
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          borderTop: '1px solid var(--rule)',
        }}
      >
        {initialRecent.map((row) => {
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
          return (
            <li
              key={row.id}
              style={{
                borderBottom: '1px solid var(--rule)',
                padding: '12px 0',
                display: 'grid',
                gridTemplateColumns: '180px 1fr 170px',
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
    </Section>
  );
}
