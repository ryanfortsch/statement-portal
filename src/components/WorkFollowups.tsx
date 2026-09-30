import Link from 'next/link';
import { Section } from './Section';
import { RetryRefresh } from './RetryRefresh';
import { listWorkFollowups } from '@/lib/stay-concierge';

/** Independent of the reply queue: resolving a reply cannot hide unpaid work. */
export async function WorkFollowups() {
  const response = await listWorkFollowups();
  if (!response.ok) return (
    <Section title="Follow-up work status unavailable">
      <p style={{ fontSize: 13, color: 'var(--signal)' }}>Could not verify message follow-ups. Retrying the status check.</p>
      <RetryRefresh />
    </Section>
  );
  const { owner_items: owners, delivery_items: deliveries } = response.data;
  if (!owners.length && !deliveries.length) return null;
  return (
    <Section title="Follow-up work needs attention" right={<Link href="/work">Open work board</Link>}>
      <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>These follow-ups are not confirmed yet. Helm will keep retrying. Replying or marking a message handled does not clear this list.</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {deliveries.map((item) => <li key={item.id} style={{ borderTop: '1px solid var(--rule)', padding: '12px 0', fontSize: 13 }}>
          <strong>{item.property_id.replaceAll('_', ' ')} · {item.title}</strong>
          <div style={{ color: 'var(--signal)', marginTop: 4 }}>{item.error}</div>
        </li>)}
        {owners.map((item) => <li key={item.id} style={{ borderTop: '1px solid var(--rule)', padding: '12px 0', fontSize: 13 }}>
          <strong>{item.owner_name} · {item.property_id.replaceAll('_', ' ')}</strong>
          <div style={{ color: 'var(--signal)', marginTop: 4 }}>{item.error || 'Follow-up work is waiting to be filed.'}</div>
        </li>)}
      </ul>
    </Section>
  );
}
