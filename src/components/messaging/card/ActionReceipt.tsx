import Link from 'next/link';
import type { ApprovalReceipt } from '@/lib/approval-receipt';

/** Never turns a queued item into a completed action. Survives card removal. */
export function ActionReceipt({ receipt, onDismiss }: { receipt: ApprovalReceipt; onDismiss?: () => void }) {
  const checked = receipt.occurredAt ? new Date(receipt.occurredAt) : null;
  return <section role="status" aria-label="Action results" style={{ border: '1px solid var(--rule)', borderLeft: '3px solid var(--tide-deep)', background: 'var(--paper)', padding: '14px 18px', marginBottom: 18, minWidth: 0 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline' }}>
      <strong style={{ fontSize: 14 }}>{receipt.title || 'Action results'}</strong>
      {onDismiss && <button type="button" className="rt-inline-action" onClick={onDismiss} aria-label="Dismiss action results">Dismiss</button>}
    </div>
    {checked && Number.isFinite(checked.getTime()) && <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink-3)' }}>{checked.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} Eastern · results at approval</p>}
    <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
      {receipt.items.map((item) => <li key={item.key} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: 7, fontSize: 13, color: item.state === 'attention' ? 'var(--signal)' : 'var(--ink-2)' }}>
        <span style={{ fontWeight: 600 }}>{item.state === 'confirmed' ? '✓ Confirmed' : item.state === 'pending' ? '◷ Pending' : '! Needs attention'}</span>
        <span style={{ flex: '1 1 220px', overflowWrap: 'anywhere' }}>{item.href ? <Link href={item.href} style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>{item.label} ↗</Link> : item.label}</span>
      </li>)}
    </ul>
  </section>;
}
