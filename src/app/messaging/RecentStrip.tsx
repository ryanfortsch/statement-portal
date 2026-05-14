'use client';

import { Section } from '@/components/Section';
import type { Approval } from '@/lib/stay-concierge';

type Props = {
  initialRecent: Approval[];
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  approved: { label: 'Sent', color: 'var(--ink-2)' },
  rejected: { label: 'Rejected', color: 'var(--ink-4)' },
  manual_sent: { label: 'Sent via Guesty', color: 'var(--ink-3)' },
  superseded: { label: 'Coached & regenerated', color: 'var(--ink-3)' },
  auto_rejected_stale: { label: 'Auto-pruned (stale)', color: 'var(--ink-4)' },
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
          const status = STATUS_LABELS[row.status] || {
            label: row.status,
            color: 'var(--ink-3)',
          };
          const propertyLabel = row.listing_name || row.listing_id || 'unknown property';
          const guestLabel = row.guest_first || 'Guest';
          return (
            <li
              key={row.id}
              style={{
                borderBottom: '1px solid var(--rule)',
                padding: '12px 0',
                display: 'grid',
                gridTemplateColumns: '160px 1fr 150px',
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
                style={{ color: status.color, textAlign: 'right' }}
              >
                {status.label}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
