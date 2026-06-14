'use client';

import { useState } from 'react';
import { Section } from '@/components/Section';
import type { OwnerApproval } from '@/lib/stay-concierge';
import { prettifySlug, statusToneColor, relativeTimeShort } from '@/app/messaging/format';

type Props = { initialRecent: OwnerApproval[] };

const STATUS_LABELS: Record<string, string> = {
  approved: 'Sent',
  rejected: 'Rejected',
  manual_sent: 'Sent via Quo',
  superseded: 'Coached & regenerated',
  auto_rejected_stale: 'Auto-pruned (stale)',
};

const DEFAULT_VISIBLE = 5;

export function OwnerRecentStrip({ initialRecent }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (initialRecent.length === 0) return null;

  const visible = expanded ? initialRecent : initialRecent.slice(0, DEFAULT_VISIBLE);
  const hasMore = initialRecent.length > DEFAULT_VISIBLE;

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
        {visible.map((row) => {
          const statusLabel = STATUS_LABELS[row.status] || row.status;
          const statusColor = statusToneColor(row.status);
          const ownerLabel = row.owner_name || row.owner_contact || 'Owner';
          const propertyLabel =
            row.property_name ||
            prettifySlug(row.property_id) ||
            '(no property)';
          const ts = row.resolved_at || row.created_at;
          const relTime = relativeTimeShort(ts);
          return (
            <li
              key={row.id}
              style={{
                borderBottom: '1px solid var(--rule)',
                padding: '12px 0',
                display: 'grid',
                gridTemplateColumns: '210px 1fr 80px 170px',
                gap: 12,
                alignItems: 'baseline',
                fontSize: 13,
              }}
            >
              <span style={{ color: 'var(--ink-3)' }}>
                {ownerLabel} · {propertyLabel}
              </span>
              <span
                style={{
                  color: 'var(--ink-2)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={row.draft || row.owner_text}
              >
                {row.draft || row.owner_text || ''}
              </span>
              <span
                style={{
                  color: 'var(--ink-4)',
                  fontSize: 11,
                  textAlign: 'right',
                  whiteSpace: 'nowrap',
                }}
                title={ts || undefined}
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
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 14 }}>
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
            {expanded ? 'Show less ▴' : `Show all ${initialRecent.length} ▾`}
          </button>
        </div>
      )}
    </Section>
  );
}
