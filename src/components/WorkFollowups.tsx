import Link from 'next/link';
import { RetryRefresh } from './RetryRefresh';
import type { listWorkFollowups } from '@/lib/stay-concierge';

/** Kept inside the shared status disclosure, independent of reply decisions. */
export function WorkFollowupsContent({ result }: {
  result: Awaited<ReturnType<typeof listWorkFollowups>>;
}) {
  if (!result.ok) return <>
    <p style={{ color: 'var(--signal)' }}>Work follow-ups could not be checked. Retrying.</p>
    <RetryRefresh />
  </>;
  const { owner_items: owners, delivery_items: deliveries } = result.data;
  if (!owners.length && !deliveries.length) return null;
  return <div style={{ borderTop: '1px solid var(--rule)', marginTop: 16, paddingTop: 12 }}>
    <div className="rt-disclosure-toolbar"><strong>Work sync pending</strong><Link href="/work" className="rt-inline-action">Open work board →</Link></div>
    <p style={{ margin: '8px 0' }}>These work slips or linked notes are not confirmed yet. Helm retries automatically.</p>
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {deliveries.map(item => <li key={item.id} style={{ padding: '8px 0' }}>
        <strong>{item.property_id.replaceAll('_', ' ')} · {item.title}</strong>
        <div style={{ color: item.error === 'Waiting to file' ? 'var(--ink-3)' : 'var(--signal)' }}>{item.error}</div>
      </li>)}
      {owners.map(item => <li key={item.id} style={{ padding: '8px 0' }}>
        <strong>{item.owner_name} · {item.property_id.replaceAll('_', ' ')}</strong>
        <div style={{ color: item.error ? 'var(--signal)' : 'var(--ink-3)' }}>{item.error || 'Waiting to be filed.'}</div>
        <Link href="/owner-messaging" className="rt-inline-action">Open owner inbox →</Link>
      </li>)}
    </ul>
  </div>;
}
