import { CompactDisclosure } from './CompactDisclosure';
import { WorkFollowupsContent } from './WorkFollowups';
import { getInboxHealth, listWorkFollowups } from '@/lib/stay-concierge';

const labels: Record<string, string> = {
  ok: 'Checked', checking: 'Checking', partial: 'Incomplete check',
  failed: 'Check failed', stale: 'Check overdue', disabled: 'Not enabled', unverified: 'Not verified',
};

function when(timestamp: number | null) {
  if (!timestamp) return 'Never';
  return new Date(timestamp * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  }) + ' ET';
}

export async function InboxHealth() {
  const [result, followups] = await Promise.all([getInboxHealth(), listWorkFollowups()]);
  const { channels, unresolved, unresolved_count, unmatched_count } = result.ok ? result.data : {
    channels: [], unresolved: [], unresolved_count: 0, unmatched_count: 0,
  };
  const workCount = followups.ok ? followups.data.owner_items.length + followups.data.delivery_items.length : 0;
  const attentionCount = unresolved_count + workCount;
  const needsAttention = attentionCount > 0 || !result.ok || !followups.ok || channels.some(c => ['failed', 'stale'].includes(c.status));
  return (
    <CompactDisclosure title="Inbox status" attention={needsAttention}
      status={attentionCount > 0 ? `${attentionCount} need attention` : needsAttention ? 'Check needed' : channels.some(c => ['partial', 'unverified', 'disabled'].includes(c.status)) ? 'Limited coverage' : channels.some(c => c.status === 'checking') ? 'Checking' : 'Up to date'}>
        {!result.ok && <p style={{ color: 'var(--signal)' }}>Message coverage could not be checked.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" style={{ marginTop: 14 }}>
          {channels.map(channel => <div key={channel.id} style={{ fontSize: 12, lineHeight: 1.6 }}>
            <strong>{channel.label}</strong>
            <div>{labels[channel.status] || 'Not verified'}</div>
            <div style={{ color: 'var(--ink-3)' }}>Last successful check: {when(channel.success_at)}</div>
            <div style={{ color: 'var(--ink-3)' }}>{channel.coverage}</div>
            {channel.detail && <div style={{ color: 'var(--signal)' }}>{channel.detail}</div>}
          </div>)}
        </div>
        {unresolved.length > 0 && <ul style={{ margin: '14px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
          {unresolved.map(item => <li key={`${item.channel}:${item.source_id}`}>
            {item.detail || 'Import in progress; a saved outcome has not been confirmed.'}
            {item.channel === 'email' && <> · <a target="_blank" rel="noreferrer" href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(item.source_id)}`} style={{ textDecoration: 'underline' }}>Open email</a></>}
            {item.channel !== 'email' && <span style={{ color: 'var(--ink-3)' }}> · Source message {item.source_id}</span>}
          </li>)}
        </ul>}
        {unresolved_count > unresolved.length && <p style={{ fontSize: 12 }}>Showing the oldest {unresolved.length} of {unresolved_count} messages needing attention.</p>}
        {unmatched_count > 0 && <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
          {unmatched_count} recent direct email{unmatched_count === 1 ? '' : 's'} had no booking or established guest correspondence. These remain in the operator’s Gmail for review; their contents are not imported into Helm.
        </p>}
        <WorkFollowupsContent result={followups} />
    </CompactDisclosure>
  );
}
