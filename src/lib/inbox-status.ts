import type { InboxHealthResponse, listWorkFollowups } from './stay-concierge';

type WorkResult = Awaited<ReturnType<typeof listWorkFollowups>>;
type WorkData = Extract<WorkResult, { ok: true }>['data'];
const PROCESSING_LEASE_SECONDS = 30 * 60;

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
    if (channel.status === 'failed') parts.push(`${channel.label} check failed`);
    if (channel.status === 'stale') parts.push(`${channel.label} check overdue`);
  }
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
