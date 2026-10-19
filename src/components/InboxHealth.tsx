import Link from 'next/link';
import { cache } from 'react';
import { CompactDisclosure } from './CompactDisclosure';
import { Section } from './Section';
import { WorkFollowupsContent } from './WorkFollowups';
import { getInboxHealth, listWorkFollowups } from '@/lib/stay-concierge';
import { isOwnerSession } from '@/lib/helm-access-server';
import { auth } from '@/auth';
import { canOpenMailbox, gmailUrl } from '@/lib/gmail-links';
import { channelWord, inboxStatus } from '@/lib/inbox-status';
import { SubmitButton } from './SubmitButton';
import { releaseHeldPitch } from '@/app/messaging/inbox-health-actions';

const importLabels: Record<string, string> = { review: 'Review import', retry: 'Import retrying', processing: 'Import processing' };

function when(timestamp: number | null) {
  if (!timestamp) return 'Never';
  return new Date(timestamp * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  }) + ' ET';
}

// One read per request: an inbox page renders this twice (above the queue for
// a problem, at its foot otherwise) and the Mac Mini should answer once.
const loadStatus = cache(async () => {
  const [result, followups, owner, session] = await Promise.all([getInboxHealth(), listWorkFollowups(), isOwnerSession(), auth()]);
  return { result, followups, owner, email: session?.user?.email ?? '', checkedAt: Date.now() / 1000 };
});

/**
 * `placement` (inbox pages only): "top" renders only when something needs
 * attention, since a broken import can hide incoming messages and belongs
 * above the queue; "bottom" renders the routine summary (held pitches, work
 * sync) at the page's foot, out of the queue's way (2026-10-18). Diagnostics
 * (the Delivery & sync page) renders everything regardless.
 */
export async function InboxHealth({ diagnostics = false, placement = 'top' }: { diagnostics?: boolean; placement?: 'top' | 'bottom' }) {
  const { result, followups, owner, email, checkedAt } = await loadStatus();
  const health = result.ok ? result.data : null;
  // The emails behind a delayed import or a held pitch sit in the concierge's
  // own Gmail account, which the concierge names (asked of Gmail, never
  // assumed). The link carries that mailbox and renders only for the session
  // that owns it; everyone else sees the sender, subject and timing with
  // nothing clickable. No mailbox known means no link for anyone.
  const mailbox = health?.mailbox ?? null;
  const canOpen = canOpenMailbox(email, mailbox);
  const status = inboxStatus(health, followups.ok ? followups.data : null, checkedAt);
  if (!diagnostics && !status.summary) return null;
  if (!diagnostics && (placement === 'top') !== status.attention) return null;
  const imports = diagnostics ? health?.unresolved ?? [] : status.imports;
  const channels = health?.channels.filter(channel => diagnostics || ['failed', 'stale'].includes(channel.status)) ?? [];
  const content = <>
    {!result.ok && <p style={{ color: 'var(--signal)' }}>Message imports could not be checked. An empty inbox may not show every incoming message.</p>}
    {channels.length > 0 && <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" style={{ marginTop: 14 }}>
      {channels.map(channel => <div key={channel.id} style={{ fontSize: 12, lineHeight: 1.6 }}>
        <strong>{channel.label}</strong>
        {/* Working / Delayed / Broken; the service's own label in the title. */}
        <div title={channelWord(channel.status).raw} style={{ color: channelWord(channel.status).tone, fontWeight: 600 }}>{channelWord(channel.status).word}</div>
        <div style={{ color: 'var(--ink-3)' }}>Last successful check: {when(channel.success_at)}</div>
        {diagnostics && <div style={{ color: 'var(--ink-3)' }}>{channel.coverage}</div>}
        {channel.detail && <div>{channel.detail}</div>}
      </div>)}
    </div>}
    {imports.length > 0 && <ul style={{ margin: '14px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
      {imports.map(item => <li key={`${item.channel}:${item.source_id}`}>
        <strong>{item.status === 'processing' && !diagnostics ? 'Import delayed' : importLabels[item.status] || 'Import unconfirmed'}</strong>
        {item.detail && <> · {item.detail}</>}
        {item.channel === 'email' && canOpen && <> · <a target="_blank" rel="noreferrer" href={gmailUrl(mailbox, `all/${encodeURIComponent(item.source_id)}`)} style={{ textDecoration: 'underline' }}>Open email</a></>}
        {item.channel !== 'email' && <span style={{ color: 'var(--ink-3)' }}> · Source {item.source_id}</span>}
      </li>)}
    </ul>}
    {health && health.unresolved_count > health.unresolved.length && <p style={{ fontSize: 12 }}>Only the oldest {health.unresolved.length} of {health.unresolved_count} pending imports are available in this check.</p>}
    {diagnostics && health && health.unmatched_count > 0 && <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
      {health.unmatched_count} recent direct emails could not be matched to guest correspondence. They remain in Gmail; their contents are not imported into Helm.
    </p>}
    {(health?.held?.length ?? 0) > 0 && <div style={{ marginTop: 14 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)' }}>
        Held as pitches this week
      </p>
      <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
        {health!.held!.map(item => <li key={item.source_id}>
          <strong>{item.sender || 'Unknown sender'}</strong>
          {item.subject && <> · {item.subject}</>}
          <span style={{ color: 'var(--ink-3)' }}> · {when(item.held_at)}</span>
          {canOpen && <> · <a target="_blank" rel="noreferrer" href={gmailUrl(mailbox, `all/${encodeURIComponent(item.source_id)}`)} style={{ textDecoration: 'underline' }}>Open email</a></>}
          <form action={releaseHeldPitch} style={{ display: 'inline', marginLeft: 8 }}>
            <input type="hidden" name="source_id" value={item.source_id} />
            <SubmitButton label="Not a pitch, draft it" busyLabel="Releasing" spinnerTone="ink" className="rt-inline-action" />
          </form>
        </li>)}
      </ul>
    </div>}
    <WorkFollowupsContent result={followups} owner={owner} />
    {!diagnostics && <p style={{ margin: '12px 0 0' }}><Link href="/messaging/status" className="rt-inline-action">Delivery &amp; sync details →</Link></p>}
  </>;
  return diagnostics
    ? <Section title="Delivery & sync">{content}</Section>
    : <CompactDisclosure title="Delivery & sync" status={status.summary} attention={status.attention}>{content}</CompactDisclosure>;
}
