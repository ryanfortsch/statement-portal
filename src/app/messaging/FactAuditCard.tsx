'use client';

import { useState, useTransition } from 'react';
import { Section } from '@/components/Section';
import type { FactAudit } from '@/lib/stay-concierge';
import { refreshFactAuditAction } from './fact-audit-actions';

type Props = {
  initial: FactAudit | null;
  initialError: string | null;
};

/** Weekly recursive-learning health, surfaced on /messaging instead of a text.
 * Shows the action punch-list (duplicates / contradictions / sprawl the inline
 * guard missed) with a Refresh button that re-runs the scan on demand. */
export function FactAuditCard({ initial, initialError }: Props) {
  const [audit, setAudit] = useState<FactAudit | null>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [pending, startTransition] = useTransition();

  const onRefresh = () => {
    startTransition(async () => {
      const res = await refreshFactAuditAction();
      if (res.ok) {
        setAudit(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
    });
  };

  const items = audit?.action_items ?? [];
  const healthy = audit?.healthy ?? false;
  const asOf = audit?.as_of || '';

  return (
    <Section
      title="Fact-base health"
      eyebrow={asOf ? `weekly · as of ${asOf}` : 'weekly audit'}
      paddingTop={36}
    >
      <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: items.length || healthy ? 14 : 0,
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
            {error
              ? 'Could not load the audit.'
              : healthy
                ? 'Healthy: no duplicates, contradictions, or sprawl. The loop is converging.'
                : `${items.length} item${items.length === 1 ? '' : 's'} to review.`}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={pending}
            style={{
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              fontWeight: 600,
              color: 'var(--ink-3)',
              background: 'transparent',
              border: '1px solid var(--rule)',
              padding: '8px 16px',
              cursor: pending ? 'default' : 'pointer',
              opacity: pending ? 0.5 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {pending ? 'Scanning…' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--signal, #c85a3a)' }}>{error}</div>
        )}

        {!error && items.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((item, i) => {
              // Items read "kind: reason (ids)" — split the leading kind tag.
              const m = item.match(/^([a-z]+):\s*(.*)$/i);
              const kind = m ? m[1] : '';
              const body = m ? m[2] : item;
              return (
                <li
                  key={i}
                  style={{
                    borderBottom: '1px solid var(--rule)',
                    padding: '10px 0',
                    display: 'grid',
                    gridTemplateColumns: '110px 1fr',
                    gap: 12,
                    alignItems: 'baseline',
                    fontSize: 13,
                  }}
                >
                  <span
                    className="eyebrow"
                    style={{ color: 'var(--ink-4)', fontWeight: 600 }}
                  >
                    {kind || 'note'}
                  </span>
                  <span style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>{body}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}
