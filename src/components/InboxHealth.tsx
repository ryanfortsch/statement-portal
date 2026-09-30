import { getInboxHealth } from '@/lib/stay-concierge';

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
  const result = await getInboxHealth();
  if (!result.ok) {
    return <section className="max-w-[1100px] mx-auto px-6 sm:px-10" style={{ width: '100%', paddingTop: 16 }}>
      <p style={{ fontSize: 12, color: 'var(--signal)' }}>Inbox checks unavailable. Message coverage could not be verified.</p>
    </section>;
  }
  const { channels, unresolved, unresolved_count, unmatched_count } = result.data;
  const needsAttention = unresolved_count > 0 || channels.some(c => ['failed', 'partial', 'stale'].includes(c.status));
  return (
    <section aria-label="Inbox checks" className="max-w-[1100px] mx-auto px-6 sm:px-10" style={{ width: '100%', paddingTop: 16 }}>
      <details open={needsAttention} style={{ border: '1px solid var(--rule)', background: 'var(--paper-2)', padding: '12px 16px' }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: needsAttention ? 'var(--signal)' : 'var(--ink-2)' }}>
          Inbox checks{unresolved_count > 0 ? ` · ${unresolved_count} message${unresolved_count === 1 ? '' : 's'} need attention` : needsAttention ? ' · coverage incomplete' : ' · view coverage'}
        </summary>
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
      </details>
    </section>
  );
}
