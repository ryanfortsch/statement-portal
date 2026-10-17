import type { InboxHealthResponse, listWorkFollowups } from './stay-concierge';

type WorkResult = Awaited<ReturnType<typeof listWorkFollowups>>;
type WorkData = Extract<WorkResult, { ok: true }>['data'];
const PROCESSING_LEASE_SECONDS = 30 * 60;

/**
 * Three plain words per channel (2026-10-17). The service reports seven
 * shades ("Checking", "Incomplete check", "Not verified"...); the operator
 * needs to know whether messages are arriving. The service's own label rides
 * in a title for anyone debugging. "Off" is the one extra: a channel that
 * was never switched on is neither working nor broken.
 */
export type ChannelWord = { word: 'Working' | 'Delayed' | 'Broken' | 'Off'; raw: string; tone: string };
export function channelWord(status: string): ChannelWord {
  switch (status) {
    case 'ok': return { word: 'Working', raw: 'Checked', tone: '#5b7b4e' };
    case 'checking': return { word: 'Working', raw: 'Checking now', tone: '#5b7b4e' };
    case 'partial': return { word: 'Delayed', raw: 'Incomplete check', tone: '#7a6a3a' };
    case 'stale': return { word: 'Delayed', raw: 'Check overdue', tone: '#7a6a3a' };
    case 'failed': return { word: 'Broken', raw: 'Check failed', tone: 'var(--signal)' };
    case 'disabled': return { word: 'Off', raw: 'Not enabled', tone: 'var(--ink-4)' };
    default: return { word: 'Delayed', raw: status === 'unverified' || !status ? 'Not verified' : status, tone: '#7a6a3a' };
  }
}

/** Routine intake is not an operator task. Never total overlapping work records. */
export function inboxStatus(health: InboxHealthResponse | null, work: WorkData | null, nowSeconds: number) {
  const imports = health?.unresolved.filter(item =>
    item.status !== 'processing' || nowSeconds - item.updated_at >= PROCESSING_LEASE_SECONDS,
  ) ?? [];
  const parts: string[] = [];
  const count = (n: number, singular: string, plural: string) => n === 1 ? `1 ${singular}` : `${n} ${plural}`;
  if (!health) parts.push('Import status unavailable');
  const review = imports.filter(item => item.status === 'review').length;
  const retry = imports.filter(item => item.status === 'retry').length;
  const delayed = imports.length - review - retry;
  if (review) parts.push(count(review, 'import to review', 'imports to review'));
  if (retry) parts.push(count(retry, 'import retrying', 'imports retrying'));
  if (delayed) parts.push(count(delayed, 'import delayed', 'imports delayed'));
  // The service returns only the oldest 50 receipts. Do not infer the rest are healthy.
  if (health && health.unresolved_count > health.unresolved.length) parts.push('More imports pending');
  for (const channel of health?.channels ?? []) {
    if (channel.status === 'failed') parts.push(`${channel.label} broken`);
    if (channel.status === 'stale') parts.push(`${channel.label} delayed`);
  }
  // Held pitches are information, not a task: listed so a misjudged guest can
  // be released, never counted toward attention.
  const held = health?.held?.length ?? 0;
  if (held) parts.push(count(held, 'pitch held this week', 'pitches held this week'));
  if (!work) parts.push('Work status unavailable');
  else if (work.owner_items.length || work.delivery_items.length) parts.push('Work sync pending');
  const workFailed = work?.owner_items.some(item => item.state === 'retrying' || !!item.error)
    || work?.delivery_items.some(item => item.error && item.error !== 'Waiting to file');
  return {
    imports,
    summary: parts.join(' · '),
    attention: !health || !work || imports.length > 0 || !!workFailed
      || !!health?.channels.some(channel => ['failed', 'stale'].includes(channel.status)),
  };
}
