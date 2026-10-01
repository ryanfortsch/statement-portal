import Link from 'next/link';
import { CompactDisclosure } from './CompactDisclosure';
import { Section } from './Section';
import { WorkFollowupsContent } from './WorkFollowups';
import { getInboxHealth, listWorkFollowups } from '@/lib/stay-concierge';
import { inboxStatus } from '@/lib/inbox-status';

const labels: Record<string, string> = {
  ok: 'Checked', checking: 'Checking', partial: 'Incomplete check',
  failed: 'Check failed', stale: 'Check overdue', disabled: 'Not enabled', unverified: 'Not verified',
};
const importLabels: Record<string, string> = { review: 'Review import', retry: 'Import retrying', processing: 'Import processing' };

function when(timestamp: number | null) {
  if (!timestamp) return 'Never';
  return new Date(timestamp * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  }) + ' ET';
}

async function loadStatus() {
  const [result, followups] = await Promise.all([getInboxHealth(), listWorkFollowups()]);
  return { result, followups, checkedAt: Date.now() / 1000 };
}

export async function InboxHealth({ diagnostics = false }: { diagnostics?: boolean }) {
  const { result, followups, checkedAt } = await loadStatus();
  const health = result.ok ? result.data : null;
  const status = inboxStatus(health, followups.ok ? followups.data : null, checkedAt);
  if (!diagnostics && !status.summary) return null;
  const imports = diagnostics ? health?.unresolved ?? [] : status.imports;
  const channels = health?.channels.filter(channel => diagnostics || ['failed', 'stale'].includes(channel.status)) ?? [];
  const content = <>
    {!result.ok && <p style={{ color: 'var(--signal)' }}>Message imports could not be checked. An empty inbox may not show every incoming message.</p>}
    {channels.length > 0 && <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" style={{ marginTop: 14 }}>
      {channels.map(channel => <div key={channel.id} style={{ fontSize: 12, lineHeight: 1.6 }}>
        <strong>{channel.label}</strong>
        <div>{labels[channel.status] || 'Not verified'}</div>
        <div style={{ color: 'var(--ink-3)' }}>Last successful check: {when(channel.success_at)}</div>
        {diagnostics && <div style={{ color: 'var(--ink-3)' }}>{channel.coverage}</div>}
        {channel.detail && <div>{channel.detail}</div>}
      </div>)}
    </div>}
    {imports.length > 0 && <ul style={{ margin: '14px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
      {imports.map(item => <li key={`${item.channel}:${item.source_id}`}>
        <strong>{item.status === 'processing' && !diagnostics ? 'Import delayed' : importLabels[item.status] || 'Import unconfirmed'}</strong>
        {item.detail && <> · {item.detail}</>}
        {item.channel === 'email' && <> · <a target="_blank" rel="noreferrer" href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(item.source_id)}`} style={{ textDecoration: 'underline' }}>Open email</a></>}
        {item.channel !== 'email' && <span style={{ color: 'var(--ink-3)' }}> · Source {item.source_id}</span>}
      </li>)}
    </ul>}
    {health && health.unresolved_count > health.unresolved.length && <p style={{ fontSize: 12 }}>Only the oldest {health.unresolved.length} of {health.unresolved_count} pending imports are available in this check.</p>}
    {diagnostics && health && health.unmatched_count > 0 && <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
      {health.unmatched_count} recent direct emails could not be matched to guest correspondence. They remain in Gmail; their contents are not imported into Helm.
    </p>}
    <WorkFollowupsContent result={followups} />
    {!diagnostics && <p style={{ margin: '12px 0 0' }}><Link href="/messaging/status" className="rt-inline-action">Delivery &amp; sync details →</Link></p>}
  </>;
  return diagnostics
    ? <Section title="Delivery & sync">{content}</Section>
    : <CompactDisclosure title="Delivery & sync" status={status.summary} attention={status.attention}>{content}</CompactDisclosure>;
}
