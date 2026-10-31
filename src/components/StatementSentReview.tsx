'use client';

import type { ReactNode } from 'react';
import { Button } from './Button';

/** Delivery is a historical fact. Readiness is a fresh check, not evidence
 * that a sent statement was unreviewed, nor proof an exception arose later. */
export function StatementSentReview({ total, finalized, checks }: {
  total: number;
  finalized: boolean;
  checks: { label: string; complete: boolean; details: ReactNode[]; open?: () => void }[];
}) {
  const outstanding = checks.filter(c => !c.complete);
  return <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 20 }} aria-label="Sent statements and current checks">
    <div className="rule-top rule-bottom" style={{ padding: '16px 0' }}>
      <h2 className="font-serif" style={{ fontSize: 22, margin: 0 }}>All {total} statements sent</h2>
      <p style={{ fontSize: 14, color: 'var(--ink-3)', margin: '8px 0 16px' }}>
        {finalized ? 'Month finalized. ' : ''}
        {outstanding.length ? 'Current checks need attention. The sent statements remain recorded as sent.' : 'No outstanding checks right now.'}
      </p>
      {outstanding.map(c => <div key={c.label} style={{ borderTop: '1px solid var(--rule)', padding: '12px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <strong style={{ fontSize: 14 }}>{c.label === 'Reviewed' ? 'Items to review' : c.label === 'Synced' ? 'New data and sync checks' : 'Source files'}</strong>
          {c.open && <Button onClick={c.open} size="sm">Review {c.label === 'Reviewed' ? 'items' : c.label === 'Synced' ? 'data' : 'files'}</Button>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 8 }}>{c.details}</div>
      </div>)}
      {outstanding.length > 0 && <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 0 }}>These checks describe the data now. They do not establish when an exception first appeared.</p>}
    </div>
  </section>;
}
